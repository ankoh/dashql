import * as core from '../../core/index.js';

import { beforeAll, afterEach, describe, expect, it } from 'vitest';

import { type StorageBackend, type SessionData, type PageData, type ScriptData, type CachedQueryResult, StorageBackendType } from './storage_backend.js';
import { type CacheFileStat } from './query_result_cache_eviction.js';
import {
    StorageWriter,
    WRITE_SESSION_MANIFEST,
    RENAME_NOTEBOOK_PAGE,
    RENAME_NOTEBOOK_SCRIPT,
    WRITE_NOTEBOOK_SCRIPT,
    groupSessionWrites,
    groupPageRenames,
    groupScriptDeletes,
    groupScriptRenames,
    groupScriptWrites,
    storageWriteKeyBelongsToSession,
    storageWriteKeyWithinSession,
} from './storage_writer.js';
import { type ConnectionState } from '../../connection/connection_state.js';
import { createDatalessConnectionState } from '../../connection/dataless/dataless_connection_state.js';
import { Logger } from '../logger/logger.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

class NullLogger extends Logger {
    public destroy(): void { }
    protected flushPendingRecords(): void { }
}

/// A minimal in-memory backend that records how often each session manifest is written.
class CountingBackend implements StorageBackend {
    sessions = new Map<string, SessionData>();
    saveCount = 0;

    getBackendType(): StorageBackendType { return StorageBackendType.OPFS; }

    async listSessions(): Promise<any[]> { return []; }
    async loadAppSettings(): Promise<any> { return null; }
    async saveAppSettings(): Promise<void> { }

    async loadSession(sessionId: string): Promise<SessionData> {
        const data = this.sessions.get(sessionId);
        if (!data) throw new Error(`No session ${sessionId}`);
        // Return a deep copy so callers can't mutate our stored copy in place.
        return JSON.parse(JSON.stringify(data));
    }
    async saveSessionManifest(sessionId: string, data: SessionData): Promise<void> {
        this.saveCount += 1;
        this.sessions.set(sessionId, JSON.parse(JSON.stringify(data)));
    }
    async deleteSession(sessionId: string): Promise<void> { this.sessions.delete(sessionId); }

    async loadSessionSchema(): Promise<string | null> { return null; }
    async saveSessionSchema(): Promise<void> { }
    async loadSessionFunctions(): Promise<string | null> { return null; }
    async saveSessionFunctions(): Promise<void> { }
    async loadNotebookPages(): Promise<PageData[]> { return []; }
    async createNotebookPage(): Promise<void> { }
    async deleteNotebookPage(): Promise<void> { }
    async renameNotebookPage(): Promise<void> { }
    async loadNotebookScript(): Promise<ScriptData> { return { name: '', sql: '' }; }
    async saveNotebookScript(): Promise<void> { }
    async deleteNotebookScript(): Promise<void> { }
    async renameNotebookScript(): Promise<void> { }
    async loadNotebookScriptDraft(): Promise<string | null> { return null; }
    async saveNotebookScriptDraft(): Promise<void> { }
    async loadQueryResultCache(): Promise<CachedQueryResult | null> { return null; }
    async saveQueryResultCache(): Promise<void> { }
    async touchQueryResultCacheAccess(): Promise<void> { }
    async listQueryResultCache(): Promise<CacheFileStat[]> { return []; }
    async deleteQueryResultCache(): Promise<void> { }
}

/// Records every notebook mutation call in order, so tests can assert that a rename reaches the
/// backend and that a rename followed by a content write of the new name dispatch as two ordered ops.
class CallLogBackend implements StorageBackend {
    calls: string[] = [];

    getBackendType(): StorageBackendType { return StorageBackendType.OPFS; }
    async listSessions(): Promise<any[]> { return []; }
    async loadAppSettings(): Promise<any> { return null; }
    async saveAppSettings(): Promise<void> { }
    async loadSession(): Promise<SessionData> { throw new Error('not used'); }
    async saveSessionManifest(): Promise<void> { }
    async deleteSession(): Promise<void> { }
    async loadSessionSchema(): Promise<string | null> { return null; }
    async saveSessionSchema(): Promise<void> { }
    async loadSessionFunctions(): Promise<string | null> { return null; }
    async saveSessionFunctions(): Promise<void> { }
    async loadNotebookPages(): Promise<PageData[]> { return []; }
    async createNotebookPage(): Promise<void> { }
    async deleteNotebookPage(): Promise<void> { }
    async renameNotebookPage(_s: string, oldName: string, newName: string): Promise<void> {
        this.calls.push(`renamePage:${oldName}->${newName}`);
    }
    async loadNotebookScript(): Promise<ScriptData> { return { name: '', sql: '' }; }
    async saveNotebookScript(_s: string, page: string, name: string, sql: string): Promise<void> {
        this.calls.push(`write:${page}/${name}=${sql}`);
    }
    async deleteNotebookScript(): Promise<void> { }
    async renameNotebookScript(_s: string, page: string, oldName: string, newName: string): Promise<void> {
        this.calls.push(`renameScript:${page}/${oldName}->${newName}`);
    }
    async loadNotebookScriptDraft(): Promise<string | null> { return null; }
    async saveNotebookScriptDraft(): Promise<void> { }
    async loadQueryResultCache(): Promise<CachedQueryResult | null> { return null; }
    async saveQueryResultCache(): Promise<void> { }
    async touchQueryResultCacheAccess(): Promise<void> { }
    async listQueryResultCache(): Promise<CacheFileStat[]> { return []; }
    async deleteQueryResultCache(): Promise<void> { }
}

let dql: core.DashQL | null = null;
const logger = new NullLogger();

beforeAll(async () => {
    const wasmBinary = await DASHQL_PRECOMPILED;
    dql = await core.DashQL.create({ wasmBinary });
    expect(dql).not.toBeNull();
});

afterEach(() => {
    dql!.resetUnsafe();
});

describe('storage write key session scoping', () => {
    const SID = 'a0000000-0000-4000-8000-000000000001';
    const OTHER = 'b0000000-0000-4000-8000-000000000002';

    it('recognises keys that belong to a session across namespaces', () => {
        expect(storageWriteKeyBelongsToSession(SID, SID)).toBe(true);
        expect(storageWriteKeyBelongsToSession(groupSessionWrites(SID), SID)).toBe(true);
        expect(storageWriteKeyBelongsToSession(groupScriptWrites(SID, 'page-1', '01.sql'), SID)).toBe(true);
        expect(storageWriteKeyBelongsToSession(groupScriptRenames(SID, 'page-1', '01.sql'), SID)).toBe(true);
        expect(storageWriteKeyBelongsToSession(groupScriptDeletes(SID, 'page-1', '01.sql'), SID)).toBe(true);
    });

    it('rejects keys from a different session (no id-prefix false positives)', () => {
        expect(storageWriteKeyBelongsToSession(groupSessionWrites(OTHER), SID)).toBe(false);
        expect(storageWriteKeyBelongsToSession(groupScriptWrites(OTHER, 'page-1', '01.sql'), SID)).toBe(false);
        // A session id that is a string prefix of another must not match.
        expect(storageWriteKeyBelongsToSession(`${SID}-suffix/notebook`, SID)).toBe(false);
    });

    it('strips the session id prefix for display, keeping the action namespace suffix', () => {
        expect(storageWriteKeyWithinSession(groupScriptWrites(SID, 'page-1', '01.sql'), SID))
            .toBe('notebook/page-1/01.sql');
        expect(storageWriteKeyWithinSession(groupScriptRenames(SID, 'page-1', '01.sql'), SID))
            .toBe('notebook/page-1/01.sql:rename');
        expect(storageWriteKeyWithinSession(groupScriptDeletes(SID, 'page-1', '01.sql'), SID))
            .toBe('notebook/page-1/01.sql:delete');
        // The session manifest keys on its real file path, so it reads as a normal file row.
        expect(storageWriteKeyWithinSession(groupSessionWrites(SID), SID)).toBe('dashql-session.json');
        // A bare session id (no trailing path) still collapses to empty.
        expect(storageWriteKeyWithinSession(SID, SID)).toBe('');
        // A key from another session is returned unchanged.
        expect(storageWriteKeyWithinSession(groupSessionWrites(OTHER), SID)).toBe(groupSessionWrites(OTHER));
    });
});

describe('StorageWriter session coordination', () => {
    const SID = 'a0000000-0000-4000-8000-000000000001';

    it('holds and resumes debounced writes for one session', async () => {
        vi.useFakeTimers();
        try {
            const backend = new CallLogBackend();
            const writer = new StorageWriter(logger, backend);
            writer.pauseSession(SID);
            const result = writer.write(
                groupScriptWrites(SID, 'page', '1.sql'),
                { type: WRITE_NOTEBOOK_SCRIPT, value: [SID, 'page', '1.sql', 'SELECT 1'] },
                10,
            );

            await vi.advanceTimersByTimeAsync(20);
            expect(backend.calls).toEqual([]);
            expect(writer.getPendingKeysForSession(SID)).toHaveLength(1);

            writer.resumeSession(SID);
            await vi.advanceTimersByTimeAsync(20);
            await expect(result).resolves.toBe(true);
            expect(backend.calls).toEqual(['write:page/1.sql=SELECT 1']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('cancels only the selected session pending writes', async () => {
        vi.useFakeTimers();
        try {
            const backend = new CallLogBackend();
            const writer = new StorageWriter(logger, backend);
            const other = 'b0000000-0000-4000-8000-000000000002';
            writer.pauseSession(SID);
            writer.pauseSession(other);
            const cancelled = writer.write(
                groupScriptWrites(SID, 'page', '1.sql'),
                { type: WRITE_NOTEBOOK_SCRIPT, value: [SID, 'page', '1.sql', 'SELECT 1'] },
                10,
            );
            const retained = writer.write(
                groupScriptWrites(other, 'page', '2.sql'),
                { type: WRITE_NOTEBOOK_SCRIPT, value: [other, 'page', '2.sql', 'SELECT 2'] },
                10,
            );

            writer.cancelPendingWritesForSession(SID);
            await expect(cancelled).resolves.toBe(false);
            expect(writer.getPendingKeysForSession(SID)).toEqual([]);
            expect(writer.getPendingKeysForSession(other)).toHaveLength(1);

            writer.resumeSession(other);
            await vi.advanceTimersByTimeAsync(20);
            await expect(retained).resolves.toBe(true);
            expect(backend.calls).toEqual(['write:page/2.sql=SELECT 2']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('flushes session-paused writes when an outer lifecycle requires a full drain', async () => {
        const backend = new CallLogBackend();
        const writer = new StorageWriter(logger, backend);
        writer.pauseSession(SID);
        const result = writer.write(
            groupScriptWrites(SID, 'page', '1.sql'),
            { type: WRITE_NOTEBOOK_SCRIPT, value: [SID, 'page', '1.sql', 'SELECT 1'] },
            10_000,
        );

        await writer.flush();
        await expect(result).resolves.toBe(true);
        expect(writer.getPendingKeysForSession(SID)).toEqual([]);
        expect(backend.calls).toEqual(['write:page/1.sql=SELECT 1']);
    });

    it('can cancel notebook writes without dropping an unrelated manifest write', async () => {
        const backend = new CountingBackend();
        const writer = new StorageWriter(logger, backend);
        writer.pauseSession(SID);
        const connection = makeConnection(SID);
        const manifest = writer.write(
            groupSessionWrites(SID),
            { type: WRITE_SESSION_MANIFEST, value: [SID, connection] },
            10_000,
        );
        const notebook = writer.write(
            groupScriptWrites(SID, 'page', '1.sql'),
            { type: WRITE_NOTEBOOK_SCRIPT, value: [SID, 'page', '1.sql', 'SELECT 1'] },
            10_000,
        );

        writer.cancelPendingWritesForSession(SID, key => key.includes('/notebook/'));
        await expect(notebook).resolves.toBe(false);
        expect(writer.getPendingKeysForSession(SID)).toEqual([groupSessionWrites(SID)]);
        writer.resumeSession(SID);
        await writer.flush();
        await expect(manifest).resolves.toBe(true);
    });
});

function makeConnection(sessionId: string): ConnectionState {
    return { ...createDatalessConnectionState(dql!, new Map()), sessionId };
}

describe('StorageWriter session manifest writes', () => {
    it('skips rewriting the manifest when nothing changed', async () => {
        const backend = new CountingBackend();
        const writer = new StorageWriter(logger, backend);
        const conn = makeConnection('a0000000-0000-4000-8000-000000000001');
        const key = groupSessionWrites(conn.sessionId);

        // First write: nothing on disk yet, so it must persist.
        await writer.write(key, { type: WRITE_SESSION_MANIFEST, value: [conn.sessionId, conn] });
        await writer.flush();
        expect(backend.saveCount).toBe(1);

        // Second write with identical content: should be skipped.
        await writer.write(key, { type: WRITE_SESSION_MANIFEST, value: [conn.sessionId, conn] });
        await writer.flush();
        expect(backend.saveCount).toBe(1);
    });

    it('preserves createdAt across rewrites and writes again when content changes', async () => {
        const backend = new CountingBackend();
        const writer = new StorageWriter(logger, backend);
        const conn = makeConnection('a0000000-0000-4000-8000-000000000002');
        const key = groupSessionWrites(conn.sessionId);

        await writer.write(key, { type: WRITE_SESSION_MANIFEST, value: [conn.sessionId, conn] });
        await writer.flush();
        const createdAt = backend.sessions.get(conn.sessionId)!.notebook.createdAt;
        expect(createdAt).toBeTruthy();

        // A change to a persisted field (name) must trigger a write that keeps the original createdAt.
        const renamed: ConnectionState = { ...conn, name: 'Renamed' };
        await writer.write(key, { type: WRITE_SESSION_MANIFEST, value: [renamed.sessionId, renamed] });
        await writer.flush();
        expect(backend.saveCount).toBe(2);

        const persisted = backend.sessions.get(conn.sessionId)!;
        expect(persisted.name).toBe('Renamed');
        expect(persisted.notebook.createdAt).toBe(createdAt);
    });

    it('persists a user-supplied name and omits it when unset', async () => {
        const backend = new CountingBackend();
        const writer = new StorageWriter(logger, backend);
        const conn = makeConnection('a0000000-0000-4000-8000-000000000003');
        const key = groupSessionWrites(conn.sessionId);

        // No name set: the manifest carries no `name` key at all.
        await writer.write(key, { type: WRITE_SESSION_MANIFEST, value: [conn.sessionId, conn] });
        await writer.flush();
        expect(backend.saveCount).toBe(1);
        expect(backend.sessions.get(conn.sessionId)!.name).toBeUndefined();

        // Setting a name is a change to a persisted field, so it must trigger a rewrite.
        const named: ConnectionState = { ...conn, name: 'Q3 Revenue' };
        await writer.write(key, { type: WRITE_SESSION_MANIFEST, value: [named.sessionId, named] });
        await writer.flush();
        expect(backend.saveCount).toBe(2);
        expect(backend.sessions.get(conn.sessionId)!.name).toBe('Q3 Revenue');

        // Re-writing the same name is a no-op.
        await writer.write(key, { type: WRITE_SESSION_MANIFEST, value: [named.sessionId, named] });
        await writer.flush();
        expect(backend.saveCount).toBe(2);
    });
});

describe('StorageWriter notebook renames', () => {
    const SID = 'b0000000-0000-4000-8000-000000000001';

    it('dispatches a RENAME_NOTEBOOK_PAGE task to the backend', async () => {
        const backend = new CallLogBackend();
        const writer = new StorageWriter(logger, backend);
        await writer.write(groupPageRenames(SID, '1_old'), { type: RENAME_NOTEBOOK_PAGE, value: [SID, '1_old', '1_new'] });
        await writer.flush();
        expect(backend.calls).toEqual(['renamePage:1_old->1_new']);
    });

    it('dispatches a RENAME_NOTEBOOK_SCRIPT task to the backend', async () => {
        const backend = new CallLogBackend();
        const writer = new StorageWriter(logger, backend);
        await writer.write(groupScriptRenames(SID, 'page', '1_old.sql'), { type: RENAME_NOTEBOOK_SCRIPT, value: [SID, 'page', '1_old.sql', '1_new.sql'] });
        await writer.flush();
        expect(backend.calls).toEqual(['renameScript:page/1_old.sql->1_new.sql']);
    });

    it('keeps a rename and a later write of the new name as two distinct, ordered ops', async () => {
        // A rename of A->B, then a content edit of B (the post-rename name), is exactly the sequence a
        // user produces by renaming a script and then typing into it. The rename lives in its own
        // `:rename` keyspace keyed by the source, the write in the destination keyspace, so they do not
        // coalesce — and since the rename is scheduled first, the move runs before the content write.
        const backend = new CallLogBackend();
        const writer = new StorageWriter(logger, backend);

        const p = writer.write(groupScriptRenames(SID, 'page', '1_a.sql'), { type: RENAME_NOTEBOOK_SCRIPT, value: [SID, 'page', '1_a.sql', '1_b.sql'] });
        const w = writer.write(groupScriptWrites(SID, 'page', '1_b.sql'), { type: WRITE_NOTEBOOK_SCRIPT, value: [SID, 'page', '1_b.sql', 'SELECT 1;'] });
        await writer.flush();
        await Promise.all([p, w]);

        expect(backend.calls).toEqual(['renameScript:page/1_a.sql->1_b.sql', 'write:page/1_b.sql=SELECT 1;']);
    });
});
