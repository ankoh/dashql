import * as sqlynx from '@ankoh/sqlynx-core';
import { SessionState, ScriptData, ScriptKey } from './session_state.js';
import { GraphConnectionId, GraphNodeDescriptor, GraphViewModel } from '../view/schema/graph_view_model.js';

export interface FocusInfo {
    /// The connection ids of focused edges
    graphConnections: Set<GraphConnectionId.Value>;
    /// The query_result ids
    tableIds: Set<sqlynx.ExternalObjectID.Value>;
    /// The column references
    columnRefs: Set<sqlynx.ExternalObjectID.Value>;
    /// The column references
    tableRefs: Set<sqlynx.ExternalObjectID.Value>;
}

/// Derive focus from script cursors
export function deriveScriptFocusFromCursor(
    scriptKey: ScriptKey,
    scriptData: {
        [context: number]: ScriptData;
    },
    graphViewModel: GraphViewModel,
    cursor: sqlynx.proto.ScriptCursorInfoT,
): FocusInfo {
    const focus: FocusInfo = {
        graphConnections: new Set(),
        tableIds: new Set(),
        columnRefs: new Set(),
        tableRefs: new Set(),
    };
    const tmpAnalyzed = new sqlynx.proto.AnalyzedScript();

    // Focus a query graph edge?
    const queryEdgeId = sqlynx.ExternalObjectID.create(scriptKey, cursor.queryEdgeId);
    if (!sqlynx.ExternalObjectID.isNull(queryEdgeId)) {
        const ctxData = scriptData[scriptKey];

        // Collect all graph connection ids that are associated with this query graph edge
        const connections = new Set<GraphConnectionId.Value>();
        if (ctxData !== undefined && ctxData.processed.analyzed !== null) {
            const ctxAnalyzed = ctxData.processed.analyzed.read(tmpAnalyzed);
            const queryEdge = ctxAnalyzed.graphEdges(sqlynx.ExternalObjectID.getObjectID(queryEdgeId))!;
            const countLeft = queryEdge.nodeCountLeft();
            const countRight = queryEdge.nodeCountRight();

            // Iterate over all nodes on the left, usually just 1
            for (let i = 0; i < countLeft; ++i) {
                const edgeNodeLeft = ctxAnalyzed.graphEdgeNodes(queryEdge.nodesBegin() + i)!;
                const columnRefLeft = ctxAnalyzed.columnReferences(edgeNodeLeft.columnReferenceId())!;
                const tableIdLeft = columnRefLeft.resolvedCatalogTableId();
                const nodeLeft = graphViewModel.nodesByTable.get(tableIdLeft);
                if (nodeLeft === undefined) continue;

                // Iterate over all nodes on the right, usually just 1
                for (let j = 0; j < countRight; ++j) {
                    const edgeNodeRight = ctxAnalyzed.graphEdgeNodes(queryEdge.nodesBegin() + countLeft + j)!;
                    const columnRefRight = ctxAnalyzed.columnReferences(edgeNodeRight.columnReferenceId())!;
                    const tableIdRight = columnRefRight.resolvedCatalogTableId();
                    const nodeRight = graphViewModel.nodesByTable.get(tableIdRight);
                    if (nodeRight === undefined) continue;

                    // Add the graph connection id
                    connections.add(GraphConnectionId.create(nodeLeft.nodeId, nodeRight.nodeId));
                    connections.add(GraphConnectionId.create(nodeRight.nodeId, nodeLeft.nodeId));
                }
            }
        }
        focus.graphConnections = connections;
        return focus;
    }

    // Helper to derive focus from a query_result id
    const deriveFocusFromTableId = (tableId: sqlynx.ExternalObjectID.Value): FocusInfo => {
        // Find all column and query_result refs that are referencing that query_result
        const tableIds: Set<sqlynx.ExternalObjectID.Value> = new Set();
        const columnRefs: Set<sqlynx.ExternalObjectID.Value> = new Set();
        const tableRefs: Set<sqlynx.ExternalObjectID.Value> = new Set();
        if (!sqlynx.ExternalObjectID.isNull(tableId)) {
            tableIds.add(tableId);
            const tmpColRef = new sqlynx.proto.ColumnReference();
            const tmpTblRef = new sqlynx.proto.TableReference();
            for (const key of [ScriptKey.MAIN_SCRIPT, ScriptKey.SCHEMA_SCRIPT]) {
                const data = scriptData[key];
                if (!data) {
                    continue;
                }
                const analyzed = scriptData[key].processed.analyzed?.read(new sqlynx.proto.AnalyzedScript());
                if (!analyzed) continue;
                for (let refId = 0; refId < analyzed.columnReferencesLength(); ++refId) {
                    const colRef = analyzed.columnReferences(refId, tmpColRef)!;
                    if (colRef.resolvedCatalogTableId() == tableId) {
                        columnRefs.add(sqlynx.ExternalObjectID.create(key, refId));
                    }
                }
                for (let refId = 0; refId < analyzed.tableReferencesLength(); ++refId) {
                    const tblRef = analyzed.tableReferences(refId, tmpTblRef)!;
                    if (tblRef.resolvedCatalogTableId() == tableId) {
                        tableRefs.add(sqlynx.ExternalObjectID.create(key, refId));
                    }
                }
            }
        }
        return {
            graphConnections: new Set(),
            tableIds,
            tableRefs,
            columnRefs,
        };
    };

    // Focus a query_result ref?
    const tableRefId = sqlynx.ExternalObjectID.create(scriptKey, cursor.tableReferenceId);
    if (!sqlynx.ExternalObjectID.isNull(tableRefId)) {
        const ctxData = scriptData[scriptKey];
        const analyzed = ctxData.processed.analyzed?.read(tmpAnalyzed);
        if (analyzed) {
            const tableRef = analyzed.tableReferences(cursor.tableReferenceId)!;
            const tableId = tableRef.resolvedCatalogTableId();
            const focus = deriveFocusFromTableId(tableId);
            focus.tableRefs.add(tableRefId);
            return focus;
        }
    }

    // Focus a column ref?
    const columnRefId = sqlynx.ExternalObjectID.create(scriptKey, cursor.columnReferenceId);
    if (!sqlynx.ExternalObjectID.isNull(columnRefId)) {
        const ctxData = scriptData[scriptKey];
        const analyzed = ctxData.processed.analyzed?.read(tmpAnalyzed);
        if (analyzed) {
            const colRef = analyzed.columnReferences(cursor.columnReferenceId)!;
            const tableId = colRef.resolvedCatalogTableId();
            const focus = deriveFocusFromTableId(tableId);
            focus.columnRefs.add(columnRefId);
            return focus;
        }
    }

    return focus;
}

function clearCursors(state: SessionState): SessionState {
    if (state.scripts[ScriptKey.MAIN_SCRIPT]) {
        state.scripts[ScriptKey.MAIN_SCRIPT] = {
            ...state.scripts[ScriptKey.MAIN_SCRIPT],
            cursor: null,
        };
    }
    if (state.scripts[ScriptKey.SCHEMA_SCRIPT]) {
        state.scripts[ScriptKey.SCHEMA_SCRIPT] = {
            ...state.scripts[ScriptKey.SCHEMA_SCRIPT],
            cursor: null,
        };
    }
    return state;
}

export function focusGraphNode(state: SessionState, target: GraphNodeDescriptor | null): SessionState {
    // Unset focused node?
    if (target === null) {
        // State already has cleared focus?
        if (state.userFocus === null) {
            return state;
        }
        // Otherwise clear the focus state
        return clearCursors({
            ...state,
            userFocus: null,
        });
    }
    // Determine the focused connections
    const newConnections = new Set<GraphConnectionId.Value>();
    const prevConnections = state.userFocus?.graphConnections ?? new Set();
    let allInPrev = true;

    if (target.port === null) {
        // If no port is focused, find all edges reaching that node
        for (const edge of state.graphViewModel.edges.values()) {
            if (edge.fromNode == target.nodeId || edge.toNode == target.nodeId) {
                newConnections.add(edge.connectionId);
                allInPrev &&= prevConnections.has(edge.connectionId);
            }
        }
    } else {
        // If a port is focused, find all edges reaching that port
        for (const edge of state.graphViewModel.edges.values()) {
            if (
                (edge.fromNode == target.nodeId && edge.fromPort == target.port) ||
                (edge.toNode == target.nodeId && edge.toPort == target.port)
            ) {
                newConnections.add(edge.connectionId);
                allInPrev &&= prevConnections.has(edge.connectionId);
            }
        }
    }

    // Same focus?
    if (allInPrev && newConnections.size == prevConnections.size) {
        return state;
    }

    // Find all column and query_result refs that are referencing that query_result
    const tableIds: Set<sqlynx.ExternalObjectID.Value> = new Set();
    const columnRefs: Set<sqlynx.ExternalObjectID.Value> = new Set();
    const tableRefs: Set<sqlynx.ExternalObjectID.Value> = new Set();
    const targetTableId = state.graphViewModel.nodes[target.nodeId].tableId;
    if (!sqlynx.ExternalObjectID.isNull(targetTableId)) {
        tableIds.add(targetTableId);
        const tmpAnalyzed = new sqlynx.proto.AnalyzedScript();
        const tmpColRef = new sqlynx.proto.ColumnReference();
        const tmpTblRef = new sqlynx.proto.TableReference();
        for (const key of [ScriptKey.MAIN_SCRIPT, ScriptKey.SCHEMA_SCRIPT]) {
            const analyzed = state.scripts[key].processed.analyzed?.read(tmpAnalyzed);
            if (!analyzed) continue;
            for (let refId = 0; refId < analyzed.columnReferencesLength(); ++refId) {
                const colRef = analyzed.columnReferences(refId, tmpColRef)!;
                if (colRef.resolvedCatalogTableId() == targetTableId) {
                    columnRefs.add(sqlynx.ExternalObjectID.create(key, refId));
                }
            }
            for (let refId = 0; refId < analyzed.tableReferencesLength(); ++refId) {
                const tblRef = analyzed.tableReferences(refId, tmpTblRef)!;
                if (tblRef.resolvedCatalogTableId() == targetTableId) {
                    tableRefs.add(sqlynx.ExternalObjectID.create(key, refId));
                }
            }
        }
    }

    // Clear cursor and update focus
    return clearCursors({
        ...state,
        userFocus: {
            graphConnections: newConnections,
            tableIds,
            columnRefs,
            tableRefs,
        },
    });
}

export function focusGraphEdge(state: SessionState, conn: GraphConnectionId.Value | null): SessionState {
    // Unset focused edge?
    if (conn === null) {
        // State already has cleared focus?
        if (state.userFocus === null) {
            return state;
        }
        // Otherwise clear the focus state
        return clearCursors({
            ...state,
            userFocus: null,
        });
    }
    // Does the set of focused edges only contain the newly focused edge?
    if (state.userFocus?.graphConnections?.size == 1) {
        if (state.userFocus.graphConnections.has(conn)) {
            return state;
        }
    }
    // Get the nodes
    const edgeVM = state.graphViewModel.edges.get(conn);
    if (!edgeVM) {
        console.warn(`unknown graph edge with id: ${conn}`);
        return state;
    }
    // Clear cursor and update focus
    return clearCursors({
        ...state,
        userFocus: {
            graphConnections: new Set([conn]),
            tableIds: new Set(),
            columnRefs: edgeVM.columnRefs,
            tableRefs: new Set(),
        },
    });
}
