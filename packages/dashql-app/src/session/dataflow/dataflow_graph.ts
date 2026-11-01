import * as core from '@ankoh/dashql-core';

import { scriptDisplayName } from '../scripts/script_types.js';
import { orderedSessionScripts, sessionAnalysisSignature, type SessionScripts } from '../scripts/session_scripts.js';
import { readSessionInputType, sessionPlanRequest, type SessionInputType } from '../inputs/session_inputs.js';

const StatementType = core.buffers.parser.StatementType;

/// What carries the data of a dataflow edge
export enum DataflowEdgeKind {
    /// A table parameter inlines the terminal query of the referenced script
    Inline = 'inline',
    /// A table parameter scans the materialized result of a script of another connection
    Scan = 'scan',
    /// A table parameter with errors
    Invalid = 'invalid',
    /// A statement reads or writes a relation that another statement created or wrote
    Table = 'table',
    /// A statement uses an input, a named scalar parameter
    Input = 'input',
}

/// A statement of a script on the canvas
export interface DataflowStatement {
    statementId: number;
    statementType: core.buffers.parser.StatementType;
    /// The relation that the statement creates, writes or drops
    target: string | null;
    /// The text of the statement, in UTF-16 code units of the analyzed text
    from: number;
    to: number;
    /// The label of the statement row: the target, or the first line of the statement
    label: string;
}

/// A script on the canvas
export interface DataflowScript {
    scriptKey: number;
    fileName: string;
    connectionId: string;
    statements: DataflowStatement[];
    /// Are the statements those of the current text? A script that is being edited keeps its last statements.
    current: boolean;
}

/// An input of the session on the canvas, a named scalar parameter
export interface DataflowInput {
    name: string;
    type: SessionInputType;
    /// The value of the session, null if no script has an `@param` tag of the input
    value: string | null;
}

/// The script key of the source port of an input edge, the input of the edge names its source
export const INPUT_PORT_SCRIPT_KEY = -1;

/// An end of an edge
export interface DataflowPort {
    scriptKey: number;
    statementId: number;
}

/// The flow of data from one statement to another
export interface DataflowEdge {
    /// A key that is unique within the graph
    key: string;
    from: DataflowPort;
    to: DataflowPort;
    kind: DataflowEdgeKind;
    /// The parameter name of a reference, the relation name of a table edge, the name of the input of an input edge
    name: string;
    /// The input that an input edge starts at, null for the other edges
    input: string | null;
}

/// The dataflow of a session
export interface DataflowGraph {
    /// The scripts in session order
    scripts: DataflowScript[];
    /// The inputs in the order of their first use
    inputs: DataflowInput[];
    edges: DataflowEdge[];
}

const EMPTY_GRAPH: DataflowGraph = { scripts: [], inputs: [], edges: [] };
const NO_STATEMENTS: DataflowStatement[] = [];

/// The short name of a statement type, e.g. `CREATE` of `CREATE_TABLE_AS`
export function statementTypeLabel(type: core.buffers.parser.StatementType): string {
    switch (type) {
        case StatementType.SELECT: return 'SELECT';
        case StatementType.INSERT: return 'INSERT';
        case StatementType.DELETE: return 'DELETE';
        case StatementType.CREATE_TABLE:
        case StatementType.CREATE_TABLE_AS:
        case StatementType.CREATE_VIEW:
        case StatementType.SELECT_INTO:
            return 'CREATE';
        case StatementType.DROP_TABLE:
        case StatementType.DROP_VIEW:
            return 'DROP';
        default: {
            const name = StatementType[type] ?? 'SQL';
            return name.split('_')[0];
        }
    }
}

/// The label of a statement row
function statementLabel(text: string, target: string | null): string {
    if (target != null && target.length > 0) return target;
    const line = text.split('\n').map(l => l.trim()).find(l => l.length > 0) ?? '';
    return line;
}

/// The edge kind of a core edge
function edgeKind(kind: core.buffers.execution.DataflowEdgeKind): DataflowEdgeKind {
    switch (kind) {
        case core.buffers.execution.DataflowEdgeKind.INLINE_REFERENCE: return DataflowEdgeKind.Inline;
        case core.buffers.execution.DataflowEdgeKind.SCAN_REFERENCE: return DataflowEdgeKind.Scan;
        case core.buffers.execution.DataflowEdgeKind.INVALID_REFERENCE: return DataflowEdgeKind.Invalid;
        case core.buffers.execution.DataflowEdgeKind.INPUT: return DataflowEdgeKind.Input;
        default: return DataflowEdgeKind.Table;
    }
}

function edgeKey(from: DataflowPort, to: DataflowPort, kind: DataflowEdgeKind, name: string): string {
    if (kind === DataflowEdgeKind.Input) return `:${name}>${to.scriptKey}.${to.statementId}:${kind}`;
    return `${from.scriptKey}.${from.statementId}>${to.scriptKey}.${to.statementId}:${kind}:${name}`;
}

/// Derive the dataflow of the scripts of a session with the core. A script without a current analysis has no
/// statements and no edges.
function computeDataflowGraph(session: SessionScripts): DataflowGraph {
    const scripts = orderedSessionScripts(session);
    if (scripts.length === 0) return EMPTY_GRAPH;
    const dataflow: core.buffers.execution.SessionDataflowT = session.instance.deriveSessionDataflow(
        sessionPlanRequest(scripts, scripts.map(script => script.fileName)),
    ).unpack();
    const out: DataflowScript[] = scripts.map((script, index) => {
        const derived = dataflow.scripts[index];
        const analyzed = derived?.analyzed ?? false;
        const text = analyzed ? script.scriptSession.getText() : '';
        const statements = !analyzed ? NO_STATEMENTS : derived.statements.map((statement, statementId) => {
            const from = statement.textSpan?.offset ?? 0;
            const to = from + (statement.textSpan?.length ?? 0);
            const target = statement.target != null ? String(statement.target) : null;
            return {
                statementId,
                statementType: statement.statementType,
                target,
                from,
                to,
                label: statementLabel(text.slice(from, to), target),
            };
        });
        return {
            scriptKey: script.scriptKey,
            fileName: script.fileName,
            connectionId: script.connection.connectionId,
            statements,
            current: analyzed,
        };
    });
    const inputs: DataflowInput[] = dataflow.inputs.map(input => ({
        name: String(input.name ?? ''),
        type: readSessionInputType(input.sqlType, input.typeSource),
        value: input.hasValue ? String(input.value ?? '') : null,
    }));
    const edges: DataflowEdge[] = dataflow.edges.flatMap(edge => {
        const kind = edgeKind(edge.kind);
        const toScript = scripts[edge.toScript];
        const source = kind === DataflowEdgeKind.Input ? inputs[edge.fromScript] : null;
        const fromScript = kind === DataflowEdgeKind.Input ? null : scripts[edge.fromScript];
        if (toScript == null || (source == null && fromScript == null)) return [];
        const from = fromScript != null
            ? { scriptKey: fromScript.scriptKey, statementId: edge.fromStatement }
            : { scriptKey: INPUT_PORT_SCRIPT_KEY, statementId: 0 };
        const to = { scriptKey: toScript.scriptKey, statementId: edge.toStatement };
        const name = String(edge.name ?? '');
        return [{ key: edgeKey(from, to, kind, name), from, to, kind, name, input: source?.name ?? null }];
    });
    return { scripts: out, inputs, edges };
}

function sameStatements(l: DataflowStatement[], r: DataflowStatement[]): boolean {
    return l.length === r.length && l.every((s, i) => {
        const o = r[i];
        return s.statementType === o.statementType && s.target === o.target && s.from === o.from && s.to === o.to && s.label === o.label;
    });
}

function sameScript(l: DataflowScript, r: DataflowScript): boolean {
    return l.scriptKey === r.scriptKey && l.fileName === r.fileName && l.connectionId === r.connectionId
        && l.current === r.current && sameStatements(l.statements, r.statements);
}

/// Merge a new graph into the previous one. A script without a current analysis keeps its last statements and the
/// edges that start or end at it, as long as the other end still exists, until it is analyzed again. Scripts and
/// edges that did not change keep their identity, as does the graph if nothing changed.
export function mergeDataflowGraph(previous: DataflowGraph | null, next: DataflowGraph): DataflowGraph {
    if (previous == null) return next;
    const before = new Map(previous.scripts.map(s => [s.scriptKey, s]));
    const scripts = next.scripts.map(script => {
        const last = before.get(script.scriptKey);
        if (last == null) return script;
        const merged = !script.current && last.statements.length > 0
            ? { ...script, statements: last.statements, current: false }
            : script;
        return sameScript(merged, last) ? last : merged;
    });
    const stale = new Set(scripts.filter(s => !s.current && s.statements.length > 0).map(s => s.scriptKey));
    const present = new Map(scripts.map(s => [s.scriptKey, s]));
    const exists = (port: DataflowPort) => (present.get(port.scriptKey)?.statements.length ?? 0) > port.statementId;
    const edgesBefore = new Map(previous.edges.map(e => [e.key, e]));
    const edges: DataflowEdge[] = next.edges.map(e => edgesBefore.get(e.key) ?? e);
    const keys = new Set(edges.map(e => e.key));
    for (const edge of previous.edges) {
        if (keys.has(edge.key)) continue;
        if ((stale.has(edge.from.scriptKey) || stale.has(edge.to.scriptKey)) && (edge.input != null || exists(edge.from)) && exists(edge.to)) {
            edges.push(edge);
            keys.add(edge.key);
        }
    }
    // The inputs of a script that is being edited stay with its edges
    const inputsBefore = new Map(previous.inputs.map(i => [i.name, i]));
    const inputs: DataflowInput[] = next.inputs.map(input => {
        const last = inputsBefore.get(input.name);
        return last != null && JSON.stringify(last) === JSON.stringify(input) ? last : input;
    });
    const names = new Set(inputs.map(i => i.name));
    for (const edge of edges) {
        if (edge.input != null && !names.has(edge.input)) {
            const last = inputsBefore.get(edge.input);
            if (last != null) {
                inputs.push(last);
                names.add(last.name);
            }
        }
    }
    const unchanged = scripts.length === previous.scripts.length && scripts.every((s, i) => s === previous.scripts[i])
        && inputs.length === previous.inputs.length && inputs.every((input, i) => input === previous.inputs[i])
        && edges.length === previous.edges.length && edges.every(e => edgesBefore.get(e.key) === e);
    return unchanged ? previous : { scripts, inputs, edges };
}

interface CachedGraph {
    signature: string;
    graph: DataflowGraph;
}

/// The last dataflow of every session, by session id
const GRAPHS = new Map<string, CachedGraph>();

/// The dataflow of the scripts of a session. Derives it again only when a name, a connection or an analysis of a
/// script changed, see `mergeDataflowGraph` for what stays.
export function deriveDataflowGraph(session: SessionScripts): DataflowGraph {
    // Sessions without the core, e.g. of tests, have no dataflow
    if (session.scriptOrder == null || session.scriptOrder.length === 0 || typeof session.instance?.deriveSessionDataflow !== 'function') {
        return EMPTY_GRAPH;
    }
    const signature = sessionAnalysisSignature(session);
    const cached = GRAPHS.get(session.sessionId);
    if (cached?.signature === signature) return cached.graph;
    let graph: DataflowGraph;
    try {
        graph = mergeDataflowGraph(cached?.graph ?? null, computeDataflowGraph(session));
    } catch (e) {
        console.warn('cannot derive the dataflow of the session', e);
        return cached?.graph ?? EMPTY_GRAPH;
    }
    GRAPHS.set(session.sessionId, { signature, graph });
    return graph;
}

/// Forget the dataflow of a session
export function forgetDataflowGraph(sessionId: string): void {
    GRAPHS.delete(sessionId);
}
