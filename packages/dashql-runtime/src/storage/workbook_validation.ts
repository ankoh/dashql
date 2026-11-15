import type { ConnectorType } from '../connections/connector_info.js';
import type { WorkbookData } from './storage_backend.js';
import { workbookFormat } from './workbook_format.js';

// The validation of a workbook file is a function of the workbook format of the core
// (`workbook_format::validation`), see docs/wip/core_runtime.md.

/// Why a persisted workbook was rejected, the codes of the format
export enum WorkbookValidationError {
    /// The workbook does not declare the current persistence format version.
    UnsupportedFormatVersion = 'unsupported_format_version',
    /// The workbook has no `workbookId`, or it is empty.
    MissingWorkbookId = 'missing_workbook_id',
    /// The `workbookId` is present but is not a syntactically valid UUID.
    InvalidWorkbookId = 'invalid_workbook_id',
    /// The connection list of the workbook is missing, empty or malformed.
    InvalidConnections = 'invalid_connections',
    /// A connection has no valid UUID `connectionId`, or the id is listed twice.
    InvalidConnectionId = 'invalid_connection_id',
    /// A connection has no `params`.
    MissingConnectionParams = 'missing_connection_params',
    /// The connection `params` do not match any known connector.
    UnknownConnector = 'unknown_connector',
    /// The workbook is registered but its files can't be read, e.g. a native folder that was moved
    WorkbookUnreadable = 'workbook_unreadable',
    /// The workbook metadata is valid, but restoring the workbook failed, e.g. its scripts could not be read
    WorkbookNotRestored = 'workbook_not_restored',
}

/// A short, human-readable explanation for each validation error, shown in the workbook workbench.
export function describeWorkbookValidationError(error: WorkbookValidationError): string {
    return workbookFormat().describeValidationError(error);
}

/// The result of validating a workbook's metadata.
export type WorkbookValidationResult =
    | { ok: true }
    | { ok: false; error: WorkbookValidationError };

/// Validate a workbook file before it is loaded: the current format version, a workbook id that is a UUID and at
/// least one connection with a unique UUID and params of a known connector
export function validateWorkbookData(data: WorkbookData): WorkbookValidationResult {
    const error = workbookFormat().validate(data);
    return error == null ? { ok: true } : { ok: false, error: error as WorkbookValidationError };
}

/// Are the params those of the embedded Hyper of the app? A local cloud attaches a database of the clouds folder and is a
/// connection of its own.
export function isLocalHyperWasmParams(params: WorkbookData['connections'][number]['params']): boolean {
    return workbookFormat().isLocalHyperWasmParams(params);
}

/// A workbook that failed metadata validation and was refused a load. It holds what the workbench needs to show and
/// delete it: the workbook id of its entry, a title, the connector of its first connection and the reason.
export interface InvalidWorkbook {
    /// The bare workbook UUID — the key used for routing and for `deleteWorkbook`.
    workbookId: string;
    /// A best-effort display title (falls back to the display path / UUID).
    title: string;
    /// The connector type if it could be inferred from the params, else null.
    connectorType: ConnectorType | null;
    /// Why the workbook was rejected.
    error: WorkbookValidationError;
}
