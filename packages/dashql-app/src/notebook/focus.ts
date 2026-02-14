import * as dashql from '@ankoh/dashql-core';

import { ScriptData, ScriptKey } from './notebook_state.js';
import { VariantKind } from '../utils/variant.js';
import { QUALIFIED_DATABASE_ID, QUALIFIED_SCHEMA_ID, QUALIFIED_TABLE_COLUMN_ID, QUALIFIED_TABLE_ID, QualifiedCatalogObjectID } from './catalog_object_id.js';

export interface FocusedExpression {
    /// The expression id
    expression: dashql.ExternalObjectID.Value;
}
export interface FocusedTableRef {
    /// The table ref
    tableReference: dashql.ExternalObjectID.Value;
}

export interface FocusedCompletion {
    /// The completion
    completion: dashql.FlatBufferPtr<dashql.buffers.completion.Completion>;
    /// The index of the selected completion candidate
    completionCandidateIndex: number;
}

export const FOCUSED_TABLE_REF_ID = Symbol('FOCUSED_TABLE_REF_ID');
export const FOCUSED_EXPRESSION_ID = Symbol('FOCUSED_EXPRESSION_ID');
export const FOCUSED_COMPLETION = Symbol('FOCUSED_COMPLETION');

export type FocusTarget =
    QualifiedCatalogObjectID
    | VariantKind<typeof FOCUSED_TABLE_REF_ID, FocusedTableRef>
    | VariantKind<typeof FOCUSED_EXPRESSION_ID, FocusedExpression>
    | VariantKind<typeof FOCUSED_COMPLETION, FocusedCompletion>
    ;

export enum FocusType {
    COMPLETION_CANDIDATE,
    CATALOG_ENTRY,
    COLUMN_REF,
    COLUMN_REF_UNDER_CURSOR,
    COLUMN_REF_OF_TARGET_TABLE,
    COLUMN_REF_OF_TARGET_COLUMN,
    COLUMN_REF_OF_PEER_COLUMN,
    TABLE_REF,
    TABLE_REF_UNDER_CURSOR,
    TABLE_REF_OF_TARGET_TABLE,
    TABLE_REF_OF_TARGET_COLUMN,
}

export interface UserFocus {
    /// The input focus target
    focusTarget: FocusTarget;
    /// The focused catalog object
    catalogObject: (QualifiedCatalogObjectID & { focus: FocusType }) | null;
    /// The registry column info (if any)
    registryColumnInfo: dashql.FlatBufferPtr<dashql.buffers.registry.ScriptRegistryColumnInfo> | null;
    /// The column references in the script, referencing the catalog object
    scriptColumnRefs: Map<dashql.ExternalObjectID.Value, FocusType>;
    /// The table references in the script, referencing the catalog object
    scriptTableRefs: Map<dashql.ExternalObjectID.Value, FocusType>;
}

/// Derive focus from script cursor
export function deriveFocusFromScriptCursor(
    scriptRegistry: dashql.DashQLScriptRegistry,
    scriptKey: ScriptKey,
    scriptData: ScriptData
): UserFocus | null {
    const cursor = scriptData.cursor!.read();
    const tmpSourceAnalyzed = new dashql.buffers.analyzer.AnalyzedScript();
    const tmpTargetAnalyzed = new dashql.buffers.analyzer.AnalyzedScript();
    const tmpIndexedTableRef = new dashql.buffers.analyzer.IndexedTableReference();
    const tmpIndexedColumnRef = new dashql.buffers.analyzer.IndexedColumnReference();
    const tmpColumnRef = new dashql.buffers.algebra.ColumnRefExpression();
    const tmpResolvedColumn = new dashql.buffers.algebra.ResolvedColumn();
    const tmpTableRef = new dashql.buffers.analyzer.TableReference();
    const tmpResolvedTable = new dashql.buffers.analyzer.ResolvedTable();

    let sourceAnalyzed = scriptData.processed.analyzed?.read(tmpSourceAnalyzed);
    if (sourceAnalyzed == null) {
        return null;
    }

    switch (cursor.contextType()) {
        case dashql.buffers.cursor.ScriptCursorContext.ScriptCursorTableRefContext: {
            const context = cursor.context(new dashql.buffers.cursor.ScriptCursorTableRefContext());
            const focusTarget: FocusTarget = {
                type: FOCUSED_TABLE_REF_ID,
                value: {
                    tableReference: dashql.ExternalObjectID.create(scriptKey, context.tableReferenceId())
                }
            };
            const focus: UserFocus = {
                focusTarget,
                catalogObject: null,
                registryColumnInfo: null,
                scriptTableRefs: new Map(),
                scriptColumnRefs: new Map(),
            };
            // Is resolved?
            const sourceRef = sourceAnalyzed.tableReferences(context.tableReferenceId(), tmpTableRef)!;
            const resolvedTable = sourceRef.resolvedTable(tmpResolvedTable);
            if (resolvedTable != null) {
                // Focus in catalog
                focus.catalogObject = {
                    type: QUALIFIED_TABLE_ID,
                    value: {
                        database: resolvedTable.catalogDatabaseId(),
                        schema: resolvedTable.catalogSchemaId(),
                        table: resolvedTable.catalogTableId(),
                        referencedCatalogVersion: resolvedTable.referencedCatalogVersion(),
                    },
                    focus: FocusType.TABLE_REF
                };

                // Could we resolve the ref?
                if (!dashql.ExternalObjectID.isNull(resolvedTable.catalogTableId())) {
                    // Read the analyzed script
                    const targetAnalyzed = scriptData.processed.analyzed?.read(tmpTargetAnalyzed);
                    if (targetAnalyzed != null) {
                        // Find table refs for table
                        const [begin0, end0] = dashql.findScriptTableRefsEqualRange(
                            targetAnalyzed,
                            resolvedTable.catalogDatabaseId(),
                            resolvedTable.catalogSchemaId(),
                            resolvedTable.catalogTableId()
                        );
                        for (let indexEntryId = begin0; indexEntryId < end0; ++indexEntryId) {
                            const indexEntry = targetAnalyzed.resolvedTableReferencesById(indexEntryId, tmpIndexedTableRef)!;
                            const tableRefId = indexEntry.tableReferenceId();
                            const focusType = (tableRefId == context.tableReferenceId()) ? FocusType.TABLE_REF_UNDER_CURSOR : FocusType.TABLE_REF_OF_TARGET_TABLE;
                            focus.scriptTableRefs.set(dashql.ExternalObjectID.create(scriptKey, tableRefId), focusType);
                        }

                        // Find column refs for table
                        const [begin1, end1] = dashql.findScriptColumnRefsEqualRange(
                            targetAnalyzed,
                            resolvedTable.catalogDatabaseId(),
                            resolvedTable.catalogSchemaId(),
                            resolvedTable.catalogTableId()
                        );
                        for (let indexEntryId = begin1; indexEntryId < end1; ++indexEntryId) {
                            const indexEntry = targetAnalyzed.resolvedColumnReferencesById(indexEntryId, tmpIndexedColumnRef)!;
                            const expressionId = indexEntry.expressionId();
                            const focusType = FocusType.COLUMN_REF_OF_TARGET_TABLE;
                            focus.scriptColumnRefs.set(dashql.ExternalObjectID.create(scriptKey, expressionId), focusType);
                        }
                    }
                }
            }
            return focus;
        }
        case dashql.buffers.cursor.ScriptCursorContext.ScriptCursorColumnRefContext: {
            const context = cursor.context(new dashql.buffers.cursor.ScriptCursorColumnRefContext());
            const focusTarget: FocusTarget = {
                type: FOCUSED_EXPRESSION_ID,
                value: {
                    expression: dashql.ExternalObjectID.create(scriptKey, context.expressionId())
                }
            };
            const focus: UserFocus = {
                focusTarget,
                catalogObject: null,
                registryColumnInfo: null,
                scriptTableRefs: new Map(),
                scriptColumnRefs: new Map(),
            };

            // Is resolved?
            const sourceRef = sourceAnalyzed.expressions(context.expressionId())!;
            if (sourceRef.innerType() == dashql.buffers.algebra.ExpressionSubType.ColumnRefExpression) {
                const columnRef: dashql.buffers.algebra.ColumnRefExpression = sourceRef.inner(tmpColumnRef)!;

                const resolvedColumn = columnRef.resolvedColumn(tmpResolvedColumn);
                if (resolvedColumn != null) {
                    // Focus in catalog
                    focus.catalogObject = {
                        type: QUALIFIED_TABLE_COLUMN_ID,
                        value: {
                            database: resolvedColumn.catalogDatabaseId(),
                            schema: resolvedColumn.catalogSchemaId(),
                            table: resolvedColumn.catalogTableId(),
                            column: resolvedColumn.columnId(),
                            referencedCatalogVersion: resolvedColumn.referencedCatalogVersion(),
                        },
                        focus: FocusType.COLUMN_REF
                    };

                    // Could we resolve the ref?
                    if (!dashql.ExternalObjectID.isNull(resolvedColumn.catalogTableId())) {
                        /// Resolve the column info from the registry
                        focus.registryColumnInfo = scriptRegistry.findColumnInfo(
                            resolvedColumn.catalogTableId(),
                            resolvedColumn.columnId(),
                            resolvedColumn.referencedCatalogVersion(),
                        );

                        // Read the analyzed script
                        const targetAnalyzed = scriptData.processed.analyzed?.read(tmpTargetAnalyzed);
                        if (targetAnalyzed != null) {
                            // Find table refs for table
                            const [begin0, end0] = dashql.findScriptTableRefsEqualRange(
                                targetAnalyzed,
                                resolvedColumn.catalogDatabaseId(),
                                resolvedColumn.catalogSchemaId(),
                                resolvedColumn.catalogTableId(),
                            );
                            for (let indexEntryId = begin0; indexEntryId < end0; ++indexEntryId) {
                                const indexEntry = targetAnalyzed.resolvedTableReferencesById(indexEntryId, tmpIndexedTableRef)!;
                                const tableRefId = indexEntry.tableReferenceId();
                                focus.scriptTableRefs.set(dashql.ExternalObjectID.create(scriptKey, tableRefId), FocusType.TABLE_REF_OF_TARGET_COLUMN);
                            }

                            // Find column refs for table
                            const [begin1, end1] = dashql.findScriptColumnRefsEqualRange(
                                targetAnalyzed,
                                resolvedColumn.catalogDatabaseId(),
                                resolvedColumn.catalogSchemaId(),
                                resolvedColumn.catalogTableId(),
                            );
                            for (let indexEntryId = begin1; indexEntryId < end1; ++indexEntryId) {
                                const indexEntry = targetAnalyzed.resolvedColumnReferencesById(indexEntryId, tmpIndexedColumnRef)!;
                                const columnRefId = indexEntry.expressionId();
                                focus.scriptColumnRefs.set(dashql.ExternalObjectID.create(scriptKey, columnRefId), FocusType.COLUMN_REF_OF_TARGET_TABLE);
                            }

                            // Find column refs for table
                            const [begin2, end2] = dashql.findScriptColumnRefsEqualRange(
                                targetAnalyzed,
                                resolvedColumn.catalogDatabaseId(),
                                resolvedColumn.catalogSchemaId(),
                                resolvedColumn.catalogTableId(),
                                resolvedColumn.columnId(),
                            );
                            for (let indexEntryId = begin2; indexEntryId < end2; ++indexEntryId) {
                                const indexEntry = targetAnalyzed.resolvedColumnReferencesById(indexEntryId, tmpIndexedColumnRef)!;
                                const columnRefId = indexEntry.expressionId();
                                const focusType = (columnRefId == context.expressionId) ? FocusType.COLUMN_REF_UNDER_CURSOR : FocusType.COLUMN_REF_OF_TARGET_COLUMN;
                                focus.scriptColumnRefs.set(dashql.ExternalObjectID.create(scriptKey, columnRefId), focusType);
                            }
                        }
                    }
                }
            }
            return focus;
        }

        case dashql.buffers.cursor.ScriptCursorContext.NONE:
            break;
    }
    return null;
}

/// Derive focus from catalog
export function deriveFocusFromCatalogSelection(
    scriptRegistry: dashql.DashQLScriptRegistry,
    scriptData: {
        [context: number]: ScriptData;
    },
    target: QualifiedCatalogObjectID
): UserFocus | null {
    const tmpAnalyzed = new dashql.buffers.analyzer.AnalyzedScript();
    const tmpIndexedTableRef = new dashql.buffers.analyzer.IndexedTableReference();
    const tmpIndexedColumnRef = new dashql.buffers.analyzer.IndexedColumnReference();

    switch (target.type) {
        case QUALIFIED_DATABASE_ID:
        case QUALIFIED_SCHEMA_ID:
            return {
                focusTarget: target,
                catalogObject: {
                    ...target,
                    focus: FocusType.CATALOG_ENTRY
                },
                registryColumnInfo: null,
                scriptTableRefs: new Map(),
                scriptColumnRefs: new Map(),
            };
        case QUALIFIED_TABLE_ID: {
            const focus: UserFocus = {
                focusTarget: target,
                catalogObject: {
                    ...target,
                    focus: FocusType.CATALOG_ENTRY
                },
                registryColumnInfo: null,
                scriptTableRefs: new Map(),
                scriptColumnRefs: new Map(),
            };
            // Check the main and schema script for associated table and column refs
            for (const k in scriptData) {
                // Is there data for the script key?
                const d = scriptData[k];
                if (!d) {
                    continue;
                }
                // Read the analyzed script
                const targetAnalyzed = scriptData[k].processed.analyzed?.read(tmpAnalyzed);
                if (!targetAnalyzed) continue;

                // Find table refs
                const [begin0, end0] = dashql.findScriptTableRefsEqualRange(
                    targetAnalyzed,
                    target.value.database,
                    target.value.schema,
                    target.value.table,
                );
                for (let indexEntryId = begin0; indexEntryId < end0; ++indexEntryId) {
                    const indexEntry = targetAnalyzed.resolvedTableReferencesById(indexEntryId, tmpIndexedTableRef)!;
                    const tableRefId = indexEntry.tableReferenceId();
                    focus.scriptTableRefs.set(dashql.ExternalObjectID.create(d.scriptKey, tableRefId), FocusType.TABLE_REF_OF_TARGET_TABLE);
                }

                // Find column refs
                const [begin1, end1] = dashql.findScriptColumnRefsEqualRange(
                    targetAnalyzed,
                    target.value.database,
                    target.value.schema,
                    target.value.table,
                );
                for (let indexEntryId = begin1; indexEntryId < end1; ++indexEntryId) {
                    const indexEntry = targetAnalyzed.resolvedColumnReferencesById(indexEntryId, tmpIndexedColumnRef)!;
                    const expressionId = indexEntry.expressionId();
                    focus.scriptColumnRefs.set(dashql.ExternalObjectID.create(d.scriptKey, expressionId), FocusType.COLUMN_REF_OF_TARGET_TABLE);
                }
            }
            return focus;
        }
        case QUALIFIED_TABLE_COLUMN_ID: {
            const focus: UserFocus = {
                focusTarget: target,
                catalogObject: {
                    ...target,
                    focus: FocusType.CATALOG_ENTRY
                },
                registryColumnInfo: null,
                scriptTableRefs: new Map(),
                scriptColumnRefs: new Map(),
            };

            /// Resolve the column info from the registry
            focus.registryColumnInfo = scriptRegistry.findColumnInfo(
                target.value.table,
                target.value.column,
                target.value.referencedCatalogVersion,
            );

            // Collect table and column refs in notebook scripts
            for (const k in scriptData) {
                // Is there data for the script key?
                const d = scriptData[k];
                if (!d) {
                    continue;
                }
                // Read the analyzed script
                const targetAnalyzed = scriptData[k].processed.analyzed?.read(tmpAnalyzed);
                if (!targetAnalyzed) continue;

                // Find table refs
                const [begin0, end0] = dashql.findScriptTableRefsEqualRange(
                    targetAnalyzed,
                    target.value.database,
                    target.value.schema,
                    target.value.table,
                );
                for (let indexEntryId = begin0; indexEntryId < end0; ++indexEntryId) {
                    const indexEntry = targetAnalyzed.resolvedTableReferencesById(indexEntryId, tmpIndexedTableRef)!;
                    const tableRefId = indexEntry.tableReferenceId();
                    focus.scriptTableRefs.set(dashql.ExternalObjectID.create(d.scriptKey, tableRefId), FocusType.TABLE_REF_OF_TARGET_TABLE);
                }

                // Find column refs
                const [begin1, end1] = dashql.findScriptColumnRefsEqualRange(
                    targetAnalyzed,
                    target.value.database,
                    target.value.schema,
                    target.value.table,
                    target.value.column
                );
                for (let indexEntryId = begin1; indexEntryId < end1; ++indexEntryId) {
                    const indexEntry = targetAnalyzed.resolvedColumnReferencesById(indexEntryId, tmpIndexedColumnRef)!;
                    const expressionId = indexEntry.expressionId();
                    focus.scriptColumnRefs.set(dashql.ExternalObjectID.create(d.scriptKey, expressionId), FocusType.COLUMN_REF_OF_TARGET_COLUMN);
                }
            }
            return focus;
        }

    }
}

/// Derive focus from script completion
export function deriveFocusFromCompletionCandidates(
    scriptRegistry: dashql.DashQLScriptRegistry,
    _scriptKey: ScriptKey,
    scriptData: ScriptData,
): UserFocus | null {
    if (scriptData.completion == null) {
        return null;
    }
    const completion = scriptData.completion.buffer.read();
    if (completion.candidates.length == 0 || scriptData.completion.candidateId >= completion.candidates.length) {
        return null;
    }

    const focusedCandidateId = scriptData.completion.candidateId ?? 0;
    const focusTarget: FocusTarget = {
        type: FOCUSED_COMPLETION,
        value: {
            completion: scriptData.completion.buffer,
            completionCandidateIndex: focusedCandidateId
        }
    };
    const focus: UserFocus = {
        focusTarget,
        catalogObject: null,
        registryColumnInfo: null, // XXX
        scriptTableRefs: new Map(),
        scriptColumnRefs: new Map(),
    };

    // Are we focusing a valid catalog object?
    const candidate = completion.candidates(focusedCandidateId)!;
    if (scriptData.completion.catalogObjectId >= candidate.catalogObjectsLength()) {
        return focus;
    }
    const candidateObject = candidate.catalogObjects(scriptData.completion.catalogObjectId)!;

    // Inspect the catalog object and derive a focus target
    switch (candidateObject.objectType()) {
        case dashql.buffers.completion.CompletionCandidateObjectType.DATABASE:
            focus.catalogObject = {
                type: QUALIFIED_DATABASE_ID,
                value: {
                    database: candidateObject.catalogDatabaseId()
                },
                focus: FocusType.COMPLETION_CANDIDATE
            };
            break;
        case dashql.buffers.completion.CompletionCandidateObjectType.SCHEMA:
            focus.catalogObject = {
                type: QUALIFIED_SCHEMA_ID,
                value: {
                    database: candidateObject.catalogDatabaseId(),
                    schema: candidateObject.catalogSchemaId()
                },
                focus: FocusType.COMPLETION_CANDIDATE
            };
            break;
        case dashql.buffers.completion.CompletionCandidateObjectType.TABLE:
            focus.catalogObject = {
                type: QUALIFIED_TABLE_ID,
                value: {
                    database: candidateObject.catalogDatabaseId(),
                    schema: candidateObject.catalogSchemaId(),
                    table: candidateObject.catalogTableId(),
                    referencedCatalogVersion: candidateObject.referencedCatalogVersion(),
                },
                focus: FocusType.COMPLETION_CANDIDATE
            };
            break;
        case dashql.buffers.completion.CompletionCandidateObjectType.COLUMN:
            focus.catalogObject = {
                type: QUALIFIED_TABLE_COLUMN_ID,
                value: {
                    database: candidateObject.catalogDatabaseId(),
                    schema: candidateObject.catalogSchemaId(),
                    table: candidateObject.catalogTableId(),
                    column: candidateObject.tableColumnId(),
                    referencedCatalogVersion: candidateObject.referencedCatalogVersion(),
                },
                focus: FocusType.COMPLETION_CANDIDATE
            };
            focus.registryColumnInfo = scriptRegistry.findColumnInfo(
                candidateObject.catalogTableId(),
                candidateObject.tableColumnId(),
                candidateObject.referencedCatalogVersion(),
            );
            break;
    }
    return focus;
}
