import * as buf from "@bufbuild/protobuf";

import * as app_event from '@ankoh/dashql-jsonschema/app_event.js';

import { BASE64URL_CODEC } from '../utils/base64.js';
import { NotebookState } from './notebook_state.js';
import type { SessionData, NotebookMetadata, PageData, ScriptData } from '../platform/storage/storage_backend.js';
import { createSessionZip } from '../platform/storage/session_export.js';

export enum NotebookLinkTarget {
    NATIVE,
    WEB
}

export async function encodeNotebookAsZip(
    notebookState: NotebookState,
    connectionParams: any
): Promise<Blob> {
    // Create session data
    const notebookMetadata: NotebookMetadata = {
        originalFileName: notebookState.notebookMetadata.originalFileName,
        createdAt: new Date().toISOString(),
    };

    const sessionData: SessionData = {
        sessionId: notebookState.sessionId,
        sessionPath: notebookState.sessionId,
        title: notebookState.notebookMetadata.originalFileName || 'Untitled',
        connectionParams,
        notebook: notebookMetadata,
    };

    // Convert notebook pages to storage format
    const pages: PageData[] = [];
    for (let pageIdx = 0; pageIdx < notebookState.notebookPages.length; pageIdx++) {
        const page = notebookState.notebookPages[pageIdx];
        const pageOrder = pageIdx + 1; // Pages are 1-indexed

        const scripts: ScriptData[] = [];
        for (let entryIdx = 0; entryIdx < page.scripts.length; entryIdx++) {
            const pageScript = page.scripts[entryIdx];
            const scriptOrder = entryIdx + 1; // Scripts are 1-indexed
            const scriptData = notebookState.scripts[pageScript.scriptId];
            if (scriptData) {
                scripts.push({
                    name: `${String(scriptOrder).padStart(2, '0')}-script.sql`,
                    sql: scriptData.script.toString()
                });
            }
        }

        pages.push({
            name: `page-${pageOrder}`,
            scripts
        });
    }

    // Get draft/composer script
    const composerScriptData = notebookState.scripts[notebookState.uncommittedScriptId];
    const draftSql = composerScriptData ? composerScriptData.script.toString() : null;

    // Use shared zip creation logic
    return await createSessionZip(sessionData, pages, draftSql);
}

export async function encodeNotebookAsZipUrl(
    notebookState: NotebookState,
    connectionParams: any,
    target: NotebookLinkTarget
): Promise<URL> {
    const zipBlob = await encodeNotebookAsZip(notebookState, connectionParams);
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
