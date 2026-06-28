import type { Logger } from '../logger/logger.js';
import type { StorageBackend } from './storage_backend.js';

const LOG_CTX = 'storage_migration';

/// The result of copying one or more sessions between backends.
export interface MigrationResult {
    /// The number of sessions copied
    sessionCount: number;
    /// The number of files written (manifests + schema + functions + scripts + drafts)
    fileCount: number;
}

/// Copy a single session's files from `source` to `target`, keyed by the same UUID.
///
/// The UUID is the authoritative identity and is preserved verbatim - nothing is re-prefixed. The
/// session manifest, schema, functions, every notebook page + script, and the draft are copied as
/// they are. `source` is left untouched; the caller deletes the source copy only after the copy is
/// verified.
export async function copySession(
    sessionId: string,
    source: StorageBackend,
    target: StorageBackend,
    logger: Logger,
): Promise<MigrationResult> {
    let fileCount = 0;

    // Session manifest (copied verbatim; sessionId is preserved)
    const sessionData = await source.loadSession(sessionId);
    await target.saveSessionManifest(sessionId, sessionData);
    fileCount++;

    // Schema
    const schema = await source.loadSessionSchema(sessionId);
    if (schema != null) {
        await target.saveSessionSchema(sessionId, schema);
        fileCount++;
    }

    // Functions
    const functions = await source.loadSessionFunctions(sessionId);
    if (functions != null) {
        await target.saveSessionFunctions(sessionId, functions);
        fileCount++;
    }

    // Notebook pages + scripts
    const pages = await source.loadNotebookPages(sessionId);
    for (const page of pages) {
        await target.createNotebookPage(sessionId, page.name);
        for (const script of page.scripts) {
            await target.saveNotebookScript(sessionId, page.name, script.name, script.sql);
            fileCount++;
        }
    }

    // Draft
    const draft = await source.loadNotebookScriptDraft(sessionId);
    if (draft != null) {
        await target.saveNotebookScriptDraft(sessionId, draft);
        fileCount++;
    }

    logger.info('copied session', { sessionId, files: String(fileCount) }, LOG_CTX);
    return { sessionCount: 1, fileCount };
}

/// Verify a single session was copied completely by re-reading `target`.
///
/// Checks that the target session parses with a sessionId and that its per-session script count
/// matches the source. Returns false on any mismatch so the caller can abort and keep the source
/// untouched.
export async function verifySession(sessionId: string, source: StorageBackend, target: StorageBackend): Promise<boolean> {
    let targetData;
    try {
        targetData = await target.loadSession(sessionId);
    } catch {
        return false;
    }
    if (!targetData.sessionId) {
        return false;
    }

    const sourceScripts = countScripts(await source.loadNotebookPages(sessionId));
    const targetScripts = countScripts(await target.loadNotebookPages(sessionId));
    return sourceScripts === targetScripts;
}

function countScripts(pages: { scripts: unknown[] }[]): number {
    return pages.reduce((sum, page) => sum + page.scripts.length, 0);
}
