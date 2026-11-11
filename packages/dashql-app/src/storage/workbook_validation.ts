import type { WorkbookData, WorkbookEntry } from './storage_backend.js';
import { getConnectorInfoForParams, ConnectorType } from '../connections/connector_info.js';
import { WORKBOOK_FORMAT_VERSION } from './migration/versions.js';
import { embeddedCloudDatabases } from '../connections/hyper/local_cloud.js';

/// A syntactically valid UUID (any version), e.g. the output of `crypto.randomUUID()`.
///
/// Matched case-insensitively and deliberately not pinned to v4: the only requirement is the
/// canonical 8-4-4-4-12 hex shape, which is enough to treat the value as an authoritative workbook
/// key. Anything else (a legacy `opfs://workbooks/<uuid>` path, a slug, an empty string) fails.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/// Whether a string is a syntactically valid UUID.
export function isValidUuid(value: string): boolean {
    return UUID_PATTERN.test(value);
}

/// Why a persisted workbook was rejected during validation.
///
/// These are *metadata* problems detected before any heavy restoration work runs. A workbook that
/// validates here may still hit non-fatal hiccups later (e.g. a catalog that fails to load), but
/// such hiccups never make the workbook "invalid" — they degrade gracefully as before.
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
    /// The workbook is registered in the manifest but its files can't be read (e.g. a native workbook
    /// whose folder was moved or deleted on disk, or a corrupt/absent OPFS workbook). Unlike the
    /// errors above this is detected by an actual load failure rather than by inspecting metadata,
    /// but it lands in the same bucket: the workbook can't be opened and should be surfaced as invalid
    /// so the user can remove the stale entry.
    WorkbookUnreadable = 'workbook_unreadable',
    /// The workbook metadata is valid, but restoring the workbook failed, e.g. its scripts could not be read
    WorkbookNotRestored = 'workbook_not_restored',
}

/// A short, human-readable explanation for each validation error, shown in the workbook workbench.
export function describeWorkbookValidationError(error: WorkbookValidationError): string {
    switch (error) {
        case WorkbookValidationError.UnsupportedFormatVersion:
            return 'Unsupported workbook format version';
        case WorkbookValidationError.MissingWorkbookId:
            return 'Missing workbook id';
        case WorkbookValidationError.InvalidWorkbookId:
            return 'Invalid workbook id';
        case WorkbookValidationError.InvalidConnections:
            return 'Workbook must list at least one connection';
        case WorkbookValidationError.InvalidConnectionId:
            return 'Invalid connection id';
        case WorkbookValidationError.MissingConnectionParams:
            return 'Missing connection parameters';
        case WorkbookValidationError.UnknownConnector:
            return 'Unknown connector';
        case WorkbookValidationError.WorkbookUnreadable:
            return 'Workbook files missing';
        case WorkbookValidationError.WorkbookNotRestored:
            return 'Workbook could not be loaded';
    }
}

/// The result of validating a workbook's metadata.
export type WorkbookValidationResult =
    | { ok: true }
    | { ok: false; error: WorkbookValidationError };

/// Validate a workbook's metadata before loading it.
///
/// This is a fail-fast gate run up front in the loader: it rejects workbooks whose metadata is
/// structurally unusable (unsupported format, no id, or an invalid connection).
/// It deliberately does NOT attempt the full connection decode — `getConnectorInfoForParams` is a
/// non-throwing connector probe, so a workbook that passes here can still be decoded by
/// `decodeConnectionFromProto` during restore.
export function validateWorkbookData(data: WorkbookData): WorkbookValidationResult {
    if ((data as { formatVersion?: unknown }).formatVersion !== WORKBOOK_FORMAT_VERSION) {
        return { ok: false, error: WorkbookValidationError.UnsupportedFormatVersion };
    }
    if (!data.workbookId) {
        return { ok: false, error: WorkbookValidationError.MissingWorkbookId };
    }
    if (!isValidUuid(data.workbookId)) {
        return { ok: false, error: WorkbookValidationError.InvalidWorkbookId };
    }
    const connections: unknown = (data as { connections?: unknown }).connections;
    if (!Array.isArray(connections) || connections.length === 0) {
        return { ok: false, error: WorkbookValidationError.InvalidConnections };
    }
    const connectionIds = new Set<string>();
    for (const connection of connections as WorkbookData['connections']) {
        if (!connection || typeof connection.connectionId !== 'string' || !isValidUuid(connection.connectionId)
            || connectionIds.has(connection.connectionId)) {
            return { ok: false, error: WorkbookValidationError.InvalidConnectionId };
        }
        connectionIds.add(connection.connectionId);
        if (!connection.params) {
            return { ok: false, error: WorkbookValidationError.MissingConnectionParams };
        }
        if (getConnectorInfoForParams(connection.params as any) == null) {
            return { ok: false, error: WorkbookValidationError.UnknownConnector };
        }
        if (connection.paramsDraft != null && getConnectorInfoForParams(connection.paramsDraft as any)?.connectorType
            !== getConnectorInfoForParams(connection.params as any)?.connectorType) {
            return { ok: false, error: WorkbookValidationError.UnknownConnector };
        }
    }
    return { ok: true };
}

/// Are the params those of the embedded Hyper of the app? A local cloud attaches a database of the clouds folder and is a
/// connection of its own.
export function isLocalHyperWasmParams(params: WorkbookData['connections'][number]['params']): boolean {
    return 'hyper' in params && (params.hyper?.protocol ?? 'WASM') === 'WASM' && embeddedCloudDatabases(params.hyper).length === 0;
}

/// A workbook that failed metadata validation and was refused a load.
///
/// Carried out of the loader so the workbook workbench can surface it (marked invalid, blocked from
/// opening, still deletable). It holds just enough to render and to delete the workbook: the bare
/// UUID (the storage key), a best-effort title, a connector type for the icon when one could be
/// inferred, and the reason it was rejected.
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

/// Build an `InvalidWorkbook` record from whatever metadata is available.
///
/// `data` may be absent (e.g. the workbook file failed to load/parse entirely), in which case we
/// fall back to the manifest entry's path for the id and title.
export function describeInvalidWorkbook(
    entry: WorkbookEntry,
    error: WorkbookValidationError,
    data: WorkbookData | null,
): InvalidWorkbook {
    // The manifest entry's path is the authoritative registry key, so it is what `deleteWorkbook`
    // must be handed to evict the workbook — not `data.workbookId`, which is exactly the field that
    // may be missing or malformed on an invalid workbook.
    const workbookId = entry.path;
    const params = Array.isArray(data?.connections) ? data.connections[0]?.params : undefined;
    const connectorInfo = params
        ? getConnectorInfoForParams(params as any)
        : null;
    return {
        workbookId,
        title: data?.name || data?.workbookPath || workbookId,
        connectorType: connectorInfo?.connectorType ?? null,
        error,
    };
}
