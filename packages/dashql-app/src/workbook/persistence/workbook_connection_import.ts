import { connectionParamsShareEqual, type ConnectionParams } from '@ankoh/dashql-runtime/connections/connection_params';
import type { ConnectionEntry, WorkbookConnection, WorkbookData } from '@ankoh/dashql-runtime/storage/storage_backend';
import { dedupeConnections } from '@ankoh/dashql-runtime/storage/storage_writer';
import { isLocalHyperWasmParams } from '@ankoh/dashql-runtime/storage/workbook_validation';

/// A connection that a workbook brings along
export interface ImportedConnectionRef {
    /// The id of the connection in the workbook
    connectionId: string;
    /// The params of the connection in the workbook, shared workbooks carry them without secrets
    params: ConnectionParams;
    /// The name the connection had in the exporting app
    name?: string;
}

/// How an imported connection relates to the connections of the app
export type ConnectionImportDecision =
    /// The connection is unknown, it is registered as a new connection
    | { kind: 'register' }
    /// The connection is known and describes the same database, the workbook uses it
    | { kind: 'link'; connectionId: string }
    /// Connections of the app may describe the same database, the user decides
    | { kind: 'ask'; candidates: ConnectionEntry[] };

/// The decision for a connection of an imported workbook
export interface ConnectionImportPlanItem {
    /// The connection of the workbook
    ref: ImportedConnectionRef;
    /// The decision
    decision: ConnectionImportDecision;
}

/// What the user chose for a connection that may consolidate with an existing one
export type ConnectionImportChoice =
    /// Use an existing connection
    | { kind: 'link'; connectionId: string }
    /// Keep the connection of the workbook as a connection of its own
    | { kind: 'separate' };

/// Find the entry of a connection id
function findEntry(entries: readonly ConnectionEntry[], connectionId: string): ConnectionEntry | null {
    return entries.find(entry => entry.id === connectionId) ?? null;
}

/// Decide how the connections of an imported workbook map to the connections of the app.
///
/// A workbook that comes back with the id of a known connection and the same params (ignoring
/// secrets, sharing strips them) simply uses the known connection. Every other connection that
/// describes the same database, or shares the id but not the params, is a candidate for
/// consolidation that the user decides on. Exports usually regenerate the ids, so the candidates are
/// found by params.
///
/// The embedded database is not a choice: the app holds a single connection to it, every embedded
/// database of a workbook uses that one. It is registered only when the app doesn't have one.
export function planConnectionImport(workbook: WorkbookData, entries: readonly ConnectionEntry[]): ConnectionImportPlanItem[] {
    const refs: ImportedConnectionRef[] = workbook.connections.map(connection => ({
        connectionId: connection.connectionId,
        params: connection.params,
        ...(connection.name == null ? {} : { name: connection.name }),
    }));
    const embedded = entries.find(entry => isLocalHyperWasmParams(entry.params)) ?? null;
    return refs.map(ref => {
        if (isLocalHyperWasmParams(ref.params)) {
            return { ref, decision: embedded == null ? { kind: 'register' } : { kind: 'link', connectionId: embedded.id } };
        }
        const sameId = findEntry(entries, ref.connectionId);
        if (sameId != null && connectionParamsShareEqual(sameId.params, ref.params)) {
            return { ref, decision: { kind: 'link', connectionId: sameId.id } };
        }
        const candidates = [
            ...(sameId == null ? [] : [sameId]),
            ...entries.filter(entry => entry !== sameId && connectionParamsShareEqual(entry.params, ref.params)),
        ];
        if (candidates.length === 0) {
            return { ref, decision: { kind: 'register' } };
        }
        return { ref, decision: { kind: 'ask', candidates } };
    });
}

/// The plan items that need a decision of the user
export function connectionImportQuestions(plan: readonly ConnectionImportPlanItem[]): ConnectionImportPlanItem[] {
    return plan.filter(item => item.decision.kind === 'ask');
}

/// An imported workbook with resolved connection references
export interface ConnectionImport {
    /// The workbook with the rewritten references
    workbook: WorkbookData;
    /// The ids that the connections of the imported workbook got (imported id -> id)
    connectionIds: Map<string, string>;
}

/// Rewrite the connection references of an imported workbook.
///
/// Linked references take the id and the full params of the app's connection, the workbook then
/// carries the secrets the same way every other copy does, and the app's connection keeps its name.
/// Separate connections keep their id unless the app already uses it for another connection, and
/// keep their name to be registered with it. Unanswered questions keep the connection separate.
export function applyConnectionImportPlan(
    workbook: WorkbookData,
    plan: readonly ConnectionImportPlanItem[],
    choices: ReadonlyMap<string, ConnectionImportChoice>,
    entries: readonly ConnectionEntry[],
    randomUUID: () => string = () => crypto.randomUUID(),
): ConnectionImport {
    const byRef = new Map(plan.map(item => [item.ref.connectionId, item]));
    const freshIds = new Map<string, string>();
    const resolve = (connectionId: string): { connectionId: string; entry: ConnectionEntry | null } => {
        const item = byRef.get(connectionId);
        let link: string | null = null;
        if (item?.decision.kind === 'link') {
            link = item.decision.connectionId;
        } else if (item?.decision.kind === 'ask') {
            const choice = choices.get(connectionId);
            if (choice?.kind === 'link') link = choice.connectionId;
        }
        if (link != null) {
            const entry = entries.find(e => e.id === link);
            if (entry != null) return { connectionId: entry.id, entry };
        }
        // A separate connection must not take over the id of an existing one
        if (findEntry(entries, connectionId) == null) {
            return { connectionId, entry: null };
        }
        let freshId = freshIds.get(connectionId);
        if (freshId == null) {
            freshId = randomUUID();
            freshIds.set(connectionId, freshId);
        }
        return { connectionId: freshId, entry: null };
    };
    const rewrite = (connection: WorkbookConnection): WorkbookConnection => {
        const resolved = resolve(connection.connectionId);
        if (resolved.entry != null) return { connectionId: resolved.connectionId, params: resolved.entry.params };
        return {
            connectionId: resolved.connectionId,
            params: connection.params,
            ...(connection.name == null ? {} : { name: connection.name }),
        };
    };
    // The scripts follow their connections
    return {
        workbook: {
            ...workbook,
            connections: dedupeConnections(workbook.connections.map(rewrite)),
            scripts: workbook.scripts.map(script => ({ ...script, connectionId: resolve(script.connectionId).connectionId })),
        },
        connectionIds: new Map(workbook.connections.map(connection => [connection.connectionId, resolve(connection.connectionId).connectionId])),
    };
}

/// Did resolving the connections change the references of the workbook?
export function connectionRefsChanged(before: WorkbookData, after: WorkbookData): boolean {
    const refs = (workbook: WorkbookData) => JSON.stringify([
        ...workbook.connections.flatMap(connection => [connection.connectionId, connection.params]),
        ...workbook.scripts.map(script => script.connectionId),
    ]);
    return refs(before) !== refs(after);
}
