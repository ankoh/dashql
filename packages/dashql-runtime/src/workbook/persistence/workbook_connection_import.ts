import type { ConnectionParams } from '../../connections/connection_params.js';
import type { ConnectionEntry, WorkbookData } from '../../storage/storage_backend.js';
import { workbookFormat } from '../../storage/workbook_format.js';

// How the connections of an imported workbook map to the connections of the app is decided by the workbook format of
// the core (`workbook_format::connection_import`), the import dialog asks the questions of the plan.

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
    return workbookFormat().planConnectionImport<ConnectionImportPlanItem>(workbook, entries);
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
): ConnectionImport {
    const applied = workbookFormat().applyConnectionImportPlan(workbook, plan, Object.fromEntries(choices), entries);
    return { workbook: applied.workbook as WorkbookData, connectionIds: new Map(applied.connectionIds) };
}

/// Did resolving the connections change the references of the workbook?
export function connectionRefsChanged(before: WorkbookData, after: WorkbookData): boolean {
    return workbookFormat().connectionRefsChanged(before, after);
}
