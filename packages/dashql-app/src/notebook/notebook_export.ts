import * as buf from "@bufbuild/protobuf";

import * as app_event from '@ankoh/dashql-jsonschema/app_event.js';

import { BASE64URL_CODEC } from '../utils/base64.js';
import type { StorageBackend, SessionData, ConnectionParams } from '../platform/storage/storage_backend.js';
import { exportSessionAsZip } from '../platform/storage/session_export.js';
import { sanitizeConnectionParamsForSharing } from '../connection/connection_params.js';

export enum NotebookLinkTarget {
    NATIVE,
    WEB
}

/// Export a session as a shareable ZIP.
///
/// Pages, scripts and the draft are read straight from disk (via `exportSessionAsZip`) so the shared
/// archive matches the persisted folder/file layout exactly. The session name is carried through from
/// the stored session untouched. Only the connection params are rewritten for sharing: the stored
/// params are swapped for the live connection's params, sanitized of secrets (or dropped entirely for
/// a dataless share), with the login hint optionally stripped.
export async function encodeNotebookAsZip(
    backend: StorageBackend,
    sessionId: string,
    connectionParams: any,
    // When true, include the connection identity (secrets stripped) so a recipient gets a
    // prefilled sign-in. When false, drop it entirely and share a dataless session.
    withConnectionInfo: boolean = true,
    // When true, carry the login hint (the sharer's resolved account username) in the shared
    // connection identity. When false, strip it so the link/file doesn't reveal who shared it.
    withLoginHint: boolean = true
): Promise<Blob> {
    const sharedConnectionParams: ConnectionParams = withConnectionInfo
        ? sanitizeConnectionParamsForSharing(connectionParams, withLoginHint)
        : { dataless: {} };

    return await exportSessionAsZip(sessionId, backend, {
        transformSession: (session: SessionData): SessionData => ({
            ...session,
            connectionParams: sharedConnectionParams,
        }),
    });
}

export async function encodeNotebookAsZipUrl(
    backend: StorageBackend,
    sessionId: string,
    connectionParams: any,
    target: NotebookLinkTarget,
    withConnectionInfo: boolean = true,
    withLoginHint: boolean = true
): Promise<URL> {
    const zipBlob = await encodeNotebookAsZip(backend, sessionId, connectionParams, withConnectionInfo, withLoginHint);
    const zipBytes = new Uint8Array(await zipBlob.arrayBuffer());

    // Wrap the zip in AppEventData - convert to base64 string as required by JSON schema
    const eventData: app_event.AppEventData = {
        session: BASE64URL_CODEC.encode(zipBytes.buffer)
    };

    // Encode the JSON to base64
    const eventDataJson = JSON.stringify(eventData);
    const eventDataBytes = new TextEncoder().encode(eventDataJson);
    const eventDataBase64 = BASE64URL_CODEC.encode(eventDataBytes.buffer);

    switch (target) {
        case NotebookLinkTarget.WEB:
            return new URL(`${process.env.DASHQL_APP_URL!}?data=${eventDataBase64}`);
        case NotebookLinkTarget.NATIVE:
            return new URL(`dashql://localhost?data=${eventDataBase64}`);
    }
}

// Temporary stub for protobuf-based notebook encoding
// TODO: Remove this when setup flow is refactored to use new storage format
export async function encodeNotebookProtoAsZipUrl(
    _notebookProto: any,
    target: NotebookLinkTarget
): Promise<URL> {
    // For now, return a placeholder URL
    // This is used in the interactive setup flow which needs refactoring
    const baseUrl = target === NotebookLinkTarget.NATIVE
        ? 'dashql://localhost'
        : process.env.DASHQL_APP_URL || 'https://dashql.com';
    return new URL(baseUrl + '?setup=todo');
}
