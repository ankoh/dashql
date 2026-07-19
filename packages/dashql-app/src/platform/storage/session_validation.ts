import type { SessionData, SessionEntry } from './storage_backend.js';
import { getConnectorInfoForParams, ConnectorType } from '../../connection/connector_info.js';

/// A syntactically valid UUID (any version), e.g. the output of `crypto.randomUUID()`.
///
/// Matched case-insensitively and deliberately not pinned to v4: the only requirement is the
/// canonical 8-4-4-4-12 hex shape, which is enough to treat the value as an authoritative session
/// key. Anything else (a legacy `opfs://sessions/<uuid>` path, a slug, an empty string) fails.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/// Whether a string is a syntactically valid UUID.
export function isValidUuid(value: string): boolean {
    return UUID_PATTERN.test(value);
}

/// Why a persisted session was rejected during validation.
///
/// These are *metadata* problems detected before any heavy restoration work runs. A session that
/// validates here may still hit non-fatal hiccups later (e.g. a catalog that fails to load), but
/// such hiccups never make the session "invalid" — they degrade gracefully as before.
export enum SessionValidationError {
    /// The session has no `sessionId`, or it is empty.
    MissingSessionId = 'missing_session_id',
    /// The `sessionId` is present but is not a syntactically valid UUID.
    InvalidSessionId = 'invalid_session_id',
    /// The session has no `connectionParams`.
    MissingConnectionParams = 'missing_connection_params',
    /// The `connectionParams` do not match any known connector.
    UnknownConnector = 'unknown_connector',
    /// The session is registered in the manifest but its files can't be read (e.g. a native session
    /// whose folder was moved or deleted on disk, or a corrupt/absent OPFS session). Unlike the
    /// errors above this is detected by an actual load failure rather than by inspecting metadata,
    /// but it lands in the same bucket: the session can't be opened and should be surfaced as invalid
    /// so the user can remove the stale entry.
    SessionUnreadable = 'session_unreadable',
}

/// A short, human-readable explanation for each validation error, shown in the session selector.
export function describeSessionValidationError(error: SessionValidationError): string {
    switch (error) {
        case SessionValidationError.MissingSessionId:
            return 'Missing session id';
        case SessionValidationError.InvalidSessionId:
            return 'Invalid session id';
        case SessionValidationError.MissingConnectionParams:
            return 'Missing connection parameters';
        case SessionValidationError.UnknownConnector:
            return 'Unknown connector';
        case SessionValidationError.SessionUnreadable:
            return 'Session files missing';
    }
}

/// The result of validating a session's metadata.
export type SessionValidationResult =
    | { ok: true }
    | { ok: false; error: SessionValidationError };

/// Validate a session's metadata before loading it.
///
/// This is a fail-fast gate run up front in the loader: it rejects sessions whose metadata is
/// structurally unusable (no id, no connection params, or params that map to no known connector).
/// It deliberately does NOT attempt the full connection decode — `getConnectorInfoForParams` is a
/// non-throwing connector probe, so a session that passes here can still be decoded by
/// `decodeConnectionFromProto` during restore.
export function validateSessionData(data: SessionData): SessionValidationResult {
    if (!data.sessionId) {
        return { ok: false, error: SessionValidationError.MissingSessionId };
    }
    if (!isValidUuid(data.sessionId)) {
        return { ok: false, error: SessionValidationError.InvalidSessionId };
    }
    if (!data.connectionParams) {
        return { ok: false, error: SessionValidationError.MissingConnectionParams };
    }
    if (getConnectorInfoForParams(data.connectionParams as any) == null) {
        return { ok: false, error: SessionValidationError.UnknownConnector };
    }
    return { ok: true };
}

/// A session that failed metadata validation and was refused a load.
///
/// Carried out of the loader so the session selector can surface it (marked invalid, blocked from
/// opening, still deletable). It holds just enough to render and to delete the session: the bare
/// UUID (the storage key), a best-effort title, a connector type for the icon when one could be
/// inferred, and the reason it was rejected.
export interface InvalidSession {
    /// The bare session UUID — the key used for routing and for `deleteSession`.
    sessionId: string;
    /// A best-effort display title (falls back to the display path / UUID).
    title: string;
    /// The connector type if it could be inferred from the params, else null.
    connectorType: ConnectorType | null;
    /// Why the session was rejected.
    error: SessionValidationError;
}

/// Build an `InvalidSession` record from whatever metadata is available.
///
/// `data` may be absent (e.g. the session file failed to load/parse entirely), in which case we
/// fall back to the manifest entry's path for the id and title.
export function describeInvalidSession(
    entry: SessionEntry,
    error: SessionValidationError,
    data: SessionData | null,
): InvalidSession {
    // The manifest entry's path is the authoritative registry key, so it is what `deleteSession`
    // must be handed to evict the session — not `data.sessionId`, which is exactly the field that
    // may be missing or malformed on an invalid session.
    const sessionId = entry.path;
    const connectorInfo = data?.connectionParams
        ? getConnectorInfoForParams(data.connectionParams as any)
        : null;
    return {
        sessionId,
        title: data?.title || data?.sessionPath || sessionId,
        connectorType: connectorInfo?.connectorType ?? null,
        error,
    };
}
