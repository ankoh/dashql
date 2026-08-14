import type { NotebookData, NotebookEntry } from './storage_backend.js';
import { getConnectorInfoForParams, ConnectorType } from '../connections/connector_info.js';

/// A syntactically valid UUID (any version), e.g. the output of `crypto.randomUUID()`.
///
/// Matched case-insensitively and deliberately not pinned to v4: the only requirement is the
/// canonical 8-4-4-4-12 hex shape, which is enough to treat the value as an authoritative notebook
/// key. Anything else (a legacy `opfs://notebooks/<uuid>` path, a slug, an empty string) fails.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/// Whether a string is a syntactically valid UUID.
export function isValidUuid(value: string): boolean {
    return UUID_PATTERN.test(value);
}

/// Why a persisted notebook was rejected during validation.
///
/// These are *metadata* problems detected before any heavy restoration work runs. A notebook that
/// validates here may still hit non-fatal hiccups later (e.g. a catalog that fails to load), but
/// such hiccups never make the notebook "invalid" — they degrade gracefully as before.
export enum NotebookValidationError {
    /// The notebook has no `notebookId`, or it is empty.
    MissingNotebookId = 'missing_notebook_id',
    /// The `notebookId` is present but is not a syntactically valid UUID.
    InvalidNotebookId = 'invalid_notebook_id',
    /// The notebook has no `connectionParams`.
    MissingConnectionParams = 'missing_connection_params',
    /// The `connectionParams` do not match any known connector.
    UnknownConnector = 'unknown_connector',
    /// The notebook is registered in the manifest but its files can't be read (e.g. a native notebook
    /// whose folder was moved or deleted on disk, or a corrupt/absent OPFS notebook). Unlike the
    /// errors above this is detected by an actual load failure rather than by inspecting metadata,
    /// but it lands in the same bucket: the notebook can't be opened and should be surfaced as invalid
    /// so the user can remove the stale entry.
    NotebookUnreadable = 'notebook_unreadable',
}

/// A short, human-readable explanation for each validation error, shown in the notebook selector.
export function describeNotebookValidationError(error: NotebookValidationError): string {
    switch (error) {
        case NotebookValidationError.MissingNotebookId:
            return 'Missing notebook id';
        case NotebookValidationError.InvalidNotebookId:
            return 'Invalid notebook id';
        case NotebookValidationError.MissingConnectionParams:
            return 'Missing connection parameters';
        case NotebookValidationError.UnknownConnector:
            return 'Unknown connector';
        case NotebookValidationError.NotebookUnreadable:
            return 'Notebook files missing';
    }
}

/// The result of validating a notebook's metadata.
export type NotebookValidationResult =
    | { ok: true }
    | { ok: false; error: NotebookValidationError };

/// Validate a notebook's metadata before loading it.
///
/// This is a fail-fast gate run up front in the loader: it rejects notebooks whose metadata is
/// structurally unusable (no id, no connection params, or params that map to no known connector).
/// It deliberately does NOT attempt the full connection decode — `getConnectorInfoForParams` is a
/// non-throwing connector probe, so a notebook that passes here can still be decoded by
/// `decodeConnectionFromProto` during restore.
export function validateNotebookData(data: NotebookData): NotebookValidationResult {
    if (!data.notebookId) {
        return { ok: false, error: NotebookValidationError.MissingNotebookId };
    }
    if (!isValidUuid(data.notebookId)) {
        return { ok: false, error: NotebookValidationError.InvalidNotebookId };
    }
    if (!data.connectionParams) {
        return { ok: false, error: NotebookValidationError.MissingConnectionParams };
    }
    if (getConnectorInfoForParams(data.connectionParams as any) == null) {
        return { ok: false, error: NotebookValidationError.UnknownConnector };
    }
    return { ok: true };
}

/// A notebook that failed metadata validation and was refused a load.
///
/// Carried out of the loader so the notebook selector can surface it (marked invalid, blocked from
/// opening, still deletable). It holds just enough to render and to delete the notebook: the bare
/// UUID (the storage key), a best-effort title, a connector type for the icon when one could be
/// inferred, and the reason it was rejected.
export interface InvalidNotebook {
    /// The bare notebook UUID — the key used for routing and for `deleteNotebook`.
    notebookId: string;
    /// A best-effort display title (falls back to the display path / UUID).
    title: string;
    /// The connector type if it could be inferred from the params, else null.
    connectorType: ConnectorType | null;
    /// Why the notebook was rejected.
    error: NotebookValidationError;
}

/// Build an `InvalidNotebook` record from whatever metadata is available.
///
/// `data` may be absent (e.g. the notebook file failed to load/parse entirely), in which case we
/// fall back to the manifest entry's path for the id and title.
export function describeInvalidNotebook(
    entry: NotebookEntry,
    error: NotebookValidationError,
    data: NotebookData | null,
): InvalidNotebook {
    // The manifest entry's path is the authoritative registry key, so it is what `deleteNotebook`
    // must be handed to evict the notebook — not `data.notebookId`, which is exactly the field that
    // may be missing or malformed on an invalid notebook.
    const notebookId = entry.path;
    const connectorInfo = data?.connectionParams
        ? getConnectorInfoForParams(data.connectionParams as any)
        : null;
    return {
        notebookId,
        title: data?.name || data?.notebookPath || notebookId,
        connectorType: connectorInfo?.connectorType ?? null,
        error,
    };
}
