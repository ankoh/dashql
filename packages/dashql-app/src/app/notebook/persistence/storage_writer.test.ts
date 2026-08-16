import * as core from '../../../shared/core/index.js';

import { beforeAll, afterEach, describe, expect, it } from 'vitest';

import { type StorageBackend, type NotebookData, type ScriptFolderData, type ScriptData, type CachedQueryResult, StorageBackendType } from './storage_backend.js';
import { type CacheFileStat } from './query_result_cache_eviction.js';
import {
    StorageWriter,
    WRITE_NOTEBOOK_MANIFEST,
    RENAME_SCRIPT_FOLDER,
    RENAME_SCRIPT,
    WRITE_SCRIPT,
    groupNotebookManifestWrites,
    groupScriptFolderRenames,
    groupScriptDeletes,
    groupScriptRenames,
    groupScriptWrites,
    storageWriteKeyBelongsToNotebook,
    storageWriteKeyWithinNotebook,
} from './storage_writer.js';
import { type ConnectionState } from '../connections/connection_state.js';
import { createDatalessConnectionState } from '../connections/dataless/dataless_connection_state.js';
import { Logger } from '../../../shared/platform/logger/logger.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

class NullLogger extends Logger {
    public destroy(): void { }
    protected flushPendingRecords(): void { }
}

/// A minimal in-memory backend that records how often each notebook manifest is written.
class CountingBackend implements StorageBackend {
    notebooks = new Map<string, NotebookData>();
    saveCount = 0;

    getBackendType(): StorageBackendType { return StorageBackendType.OPFS; }

    async listNotebooks(): Promise<any[]> { return []; }
    async loadAppSettings(): Promise<any> { return null; }
    async saveAppSettings(): Promise<void> { }

    async loadNotebook(notebookId: string): Promise<NotebookData> {
        const data = this.notebooks.get(notebookId);
        if (!data) throw new Error(`No notebook ${notebookId}`);
        // Return a deep copy so callers can't mutate our stored copy in place.
        return JSON.parse(JSON.stringify(data));
    }
    async saveNotebookManifest(notebookId: string, data: NotebookData): Promise<void> {
        this.saveCount += 1;
        this.notebooks.set(notebookId, JSON.parse(JSON.stringify(data)));
    }
    async deleteNotebook(notebookId: string): Promise<void> { this.notebooks.delete(notebookId); }

    async loadNotebookSchema(): Promise<string | null> { return null; }
    async saveNotebookSchema(): Promise<void> { }
    async loadNotebookFunctions(): Promise<string | null> { return null; }
    async saveNotebookFunctions(): Promise<void> { }
    async loadScriptFolders(): Promise<ScriptFolderData[]> { return []; }
    async createScriptFolder(): Promise<void> { }
    async deleteScriptFolder(): Promise<void> { }
    async renameScriptFolder(): Promise<void> { }
    async loadScript(): Promise<ScriptData> { return { name: '', sql: '' }; }
    async saveScript(): Promise<void> { }
    async deleteScript(): Promise<void> { }
    async renameScript(): Promise<void> { }
    async loadScriptDraft(): Promise<string | null> { return null; }
    async saveScriptDraft(): Promise<void> { }
    async loadQueryResultCache(): Promise<CachedQueryResult | null> { return null; }
    async saveQueryResultCache(): Promise<void> { }
    async touchQueryResultCacheAccess(): Promise<void> { }
    async hasCachedQueryResult(): Promise<boolean> { return false; }
    async listQueryResultCache(): Promise<CacheFileStat[]> { return []; }
    async deleteQueryResultCache(): Promise<void> { }
}

/// Records every notebook mutation call in order, so tests can assert that a rename reaches the
/// backend and that a rename followed by a content write of the new name dispatch as two ordered ops.
class CallLogBackend implements StorageBackend {
    calls: string[] = [];

    getBackendType(): StorageBackendType { return StorageBackendType.OPFS; }
    async listNotebooks(): Promise<any[]> { return []; }
    async loadAppSettings(): Promise<any> { return null; }
    async saveAppSettings(): Promise<void> { }
    async loadNotebook(): Promise<NotebookData> { throw new Error('not used'); }
    async saveNotebookManifest(): Promise<void> { }
    async deleteNotebook(): Promise<void> { }
    async loadNotebookSchema(): Promise<string | null> { return null; }
    async saveNotebookSchema(): Promise<void> { }
    async loadNotebookFunctions(): Promise<string | null> { return null; }
    async saveNotebookFunctions(): Promise<void> { }
    async loadScriptFolders(): Promise<ScriptFolderData[]> { return []; }
    async createScriptFolder(): Promise<void> { }
    async deleteScriptFolder(): Promise<void> { }
    async renameScriptFolder(_s: string, oldName: string, newName: string): Promise<void> {
        this.calls.push(`renameFolder:${oldName}->${newName}`);
    }
    async loadScript(): Promise<ScriptData> { return { name: '', sql: '' }; }
    async saveScript(_s: string, page: string, name: string, sql: string): Promise<void> {
        this.calls.push(`write:${page}/${name}=${sql}`);
    }
    async deleteScript(): Promise<void> { }
    async renameScript(_s: string, page: string, oldName: string, newName: string): Promise<void> {
        this.calls.push(`renameScript:${page}/${oldName}->${newName}`);
    }
    async loadScriptDraft(): Promise<string | null> { return null; }
    async saveScriptDraft(): Promise<void> { }
    async loadQueryResultCache(): Promise<CachedQueryResult | null> { return null; }
    async saveQueryResultCache(): Promise<void> { }
    async touchQueryResultCacheAccess(): Promise<void> { }
    async hasCachedQueryResult(): Promise<boolean> { return false; }
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

describe('storage write key notebook scoping', () => {
    const SID = 'a0000000-0000-4000-8000-000000000001';
    const OTHER = 'b0000000-0000-4000-8000-000000000002';

    it('recognises keys that belong to a notebook across namespaces', () => {
        expect(storageWriteKeyBelongsToNotebook(SID, SID)).toBe(true);
        expect(storageWriteKeyBelongsToNotebook(groupNotebookManifestWrites(SID), SID)).toBe(true);
        expect(storageWriteKeyBelongsToNotebook(groupScriptWrites(SID, 'page-1', '01.sql'), SID)).toBe(true);
        expect(storageWriteKeyBelongsToNotebook(groupScriptRenames(SID, 'page-1', '01.sql'), SID)).toBe(true);
        expect(storageWriteKeyBelongsToNotebook(groupScriptDeletes(SID, 'page-1', '01.sql'), SID)).toBe(true);
    });

    it('rejects keys from a different notebook (no id-prefix false positives)', () => {
        expect(storageWriteKeyBelongsToNotebook(groupNotebookManifestWrites(OTHER), SID)).toBe(false);
        expect(storageWriteKeyBelongsToNotebook(groupScriptWrites(OTHER, 'page-1', '01.sql'), SID)).toBe(false);
        // A notebook id that is a string prefix of another must not match.
        expect(storageWriteKeyBelongsToNotebook(`${SID}-suffix/notebook`, SID)).toBe(false);
    });

    it('strips the notebook id prefix for display, keeping the action namespace suffix', () => {
        expect(storageWriteKeyWithinNotebook(groupScriptWrites(SID, 'page-1', '01.sql'), SID))
            .toBe('scripts/page-1/01.sql');
        expect(storageWriteKeyWithinNotebook(groupScriptRenames(SID, 'page-1', '01.sql'), SID))
            .toBe('scripts/page-1/01.sql:rename');
        expect(storageWriteKeyWithinNotebook(groupScriptDeletes(SID, 'page-1', '01.sql'), SID))
            .toBe('scripts/page-1/01.sql:delete');
        // The notebook manifest keys on its real file path, so it reads as a normal file row.
        expect(storageWriteKeyWithinNotebook(groupNotebookManifestWrites(SID), SID)).toBe('dashql-notebook.json');
        // A bare notebook id (no trailing path) still collapses to empty.
        expect(storageWriteKeyWithinNotebook(SID, SID)).toBe('');
        // A key from another notebook is returned unchanged.
        expect(storageWriteKeyWithinNotebook(groupNotebookManifestWrites(OTHER), SID)).toBe(groupNotebookManifestWrites(OTHER));
    });
});

describe('StorageWriter notebook coordination', () => {
    const SID = 'a0000000-0000-4000-8000-000000000001';

    it('holds and resumes debounced writes for one notebook', async () => {
        vi.useFakeTimers();
        try {
            const backend = new CallLogBackend();
            const writer = new StorageWriter(logger, backend);
            writer.pauseNotebook(SID);
            const result = writer.write(
                groupScriptWrites(SID, 'page', '1.sql'),
                { type: WRITE_SCRIPT, value: [SID, 'page', '1.sql', 'SELECT 1'] },
                10,
            );

            await vi.advanceTimersByTimeAsync(20);
            expect(backend.calls).toEqual([]);
            expect(writer.getPendingKeysForNotebook(SID)).toHaveLength(1);

            writer.resumeNotebook(SID);
            await vi.advanceTimersByTimeAsync(20);
            await expect(result).resolves.toBe(true);
            expect(backend.calls).toEqual(['write:page/1.sql=SELECT 1']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('cancels only the selected notebook pending writes', async () => {
        vi.useFakeTimers();
        try {
            const backend = new CallLogBackend();
            const writer = new StorageWriter(logger, backend);
            const other = 'b0000000-0000-4000-8000-000000000002';
            writer.pauseNotebook(SID);
            writer.pauseNotebook(other);
            const cancelled = writer.write(
                groupScriptWrites(SID, 'page', '1.sql'),
                { type: WRITE_SCRIPT, value: [SID, 'page', '1.sql', 'SELECT 1'] },
                10,
            );
            const retained = writer.write(
                groupScriptWrites(other, 'page', '2.sql'),
                { type: WRITE_SCRIPT, value: [other, 'page', '2.sql', 'SELECT 2'] },
                10,
            );

            writer.cancelPendingWritesForNotebook(SID);
            await expect(cancelled).resolves.toBe(false);
            expect(writer.getPendingKeysForNotebook(SID)).toEqual([]);
            expect(writer.getPendingKeysForNotebook(other)).toHaveLength(1);

            writer.resumeNotebook(other);
            await vi.advanceTimersByTimeAsync(20);
            await expect(retained).resolves.toBe(true);
            expect(backend.calls).toEqual(['write:page/2.sql=SELECT 2']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('flushes notebook-paused writes when an outer lifecycle requires a full drain', async () => {
        const backend = new CallLogBackend();
        const writer = new StorageWriter(logger, backend);
        writer.pauseNotebook(SID);
        const result = writer.write(
            groupScriptWrites(SID, 'page', '1.sql'),
            { type: WRITE_SCRIPT, value: [SID, 'page', '1.sql', 'SELECT 1'] },
            10_000,
        );

        await writer.flush();
        await expect(result).resolves.toBe(true);
        expect(writer.getPendingKeysForNotebook(SID)).toEqual([]);
        expect(backend.calls).toEqual(['write:page/1.sql=SELECT 1']);
    });

    it('can cancel notebook writes without dropping an unrelated manifest write', async () => {
        const backend = new CountingBackend();
        const writer = new StorageWriter(logger, backend);
        writer.pauseNotebook(SID);
        const connection = makeConnection(SID);
        const manifest = writer.write(
            groupNotebookManifestWrites(SID),
            { type: WRITE_NOTEBOOK_MANIFEST, value: [SID, connection] },
            10_000,
        );
        const notebook = writer.write(
            groupScriptWrites(SID, 'page', '1.sql'),
            { type: WRITE_SCRIPT, value: [SID, 'page', '1.sql', 'SELECT 1'] },
            10_000,
        );

        writer.cancelPendingWritesForNotebook(SID, key => key.includes('/scripts/'));
        await expect(notebook).resolves.toBe(false);
        expect(writer.getPendingKeysForNotebook(SID)).toEqual([groupNotebookManifestWrites(SID)]);
        writer.resumeNotebook(SID);
        await writer.flush();
        await expect(manifest).resolves.toBe(true);
    });
});

function makeConnection(notebookId: string): ConnectionState {
    return { ...createDatalessConnectionState(dql!, new Map()), notebookId };
}

describe('StorageWriter notebook manifest writes', () => {
    it('skips rewriting the manifest when nothing changed', async () => {
        const backend = new CountingBackend();
        const writer = new StorageWriter(logger, backend);
        const conn = makeConnection('a0000000-0000-4000-8000-000000000001');
        const key = groupNotebookManifestWrites(conn.notebookId);

        // First write: nothing on disk yet, so it must persist.
        await writer.write(key, { type: WRITE_NOTEBOOK_MANIFEST, value: [conn.notebookId, conn] });
        await writer.flush();
        expect(backend.saveCount).toBe(1);

        // Second write with identical content: should be skipped.
        await writer.write(key, { type: WRITE_NOTEBOOK_MANIFEST, value: [conn.notebookId, conn] });
        await writer.flush();
        expect(backend.saveCount).toBe(1);
    });

    it('preserves createdAt across rewrites and writes again when content changes', async () => {
        const backend = new CountingBackend();
        const writer = new StorageWriter(logger, backend);
        const conn = makeConnection('a0000000-0000-4000-8000-000000000002');
        const key = groupNotebookManifestWrites(conn.notebookId);

        await writer.write(key, { type: WRITE_NOTEBOOK_MANIFEST, value: [conn.notebookId, conn] });
        await writer.flush();
        const createdAt = backend.notebooks.get(conn.notebookId)!.metadata.createdAt;
        expect(createdAt).toBeTruthy();

        // A change to a persisted field (name) must trigger a write that keeps the original createdAt.
        const renamed: ConnectionState = { ...conn, name: 'Renamed' };
        await writer.write(key, { type: WRITE_NOTEBOOK_MANIFEST, value: [renamed.notebookId, renamed] });
        await writer.flush();
        expect(backend.saveCount).toBe(2);

        const persisted = backend.notebooks.get(conn.notebookId)!;
        expect(persisted.name).toBe('Renamed');
        expect(persisted.metadata.createdAt).toBe(createdAt);
    });

    it('persists a user-supplied name and omits it when unset', async () => {
        const backend = new CountingBackend();
        const writer = new StorageWriter(logger, backend);
        const conn = makeConnection('a0000000-0000-4000-8000-000000000003');
        const key = groupNotebookManifestWrites(conn.notebookId);

        // No name set: the manifest carries no `name` key at all.
        await writer.write(key, { type: WRITE_NOTEBOOK_MANIFEST, value: [conn.notebookId, conn] });
        await writer.flush();
        expect(backend.saveCount).toBe(1);
        expect(backend.notebooks.get(conn.notebookId)!.name).toBeUndefined();

        // Setting a name is a change to a persisted field, so it must trigger a rewrite.
        const named: ConnectionState = { ...conn, name: 'Q3 Revenue' };
        await writer.write(key, { type: WRITE_NOTEBOOK_MANIFEST, value: [named.notebookId, named] });
        await writer.flush();
        expect(backend.saveCount).toBe(2);
        expect(backend.notebooks.get(conn.notebookId)!.name).toBe('Q3 Revenue');

        // Re-writing the same name is a no-op.
        await writer.write(key, { type: WRITE_NOTEBOOK_MANIFEST, value: [named.notebookId, named] });
        await writer.flush();
        expect(backend.saveCount).toBe(2);
    });
});

describe('StorageWriter notebook renames', () => {
    const SID = 'b0000000-0000-4000-8000-000000000001';

    it('dispatches a RENAME_SCRIPT_FOLDER task to the backend', async () => {
        const backend = new CallLogBackend();
        const writer = new StorageWriter(logger, backend);
        await writer.write(groupScriptFolderRenames(SID, '1_old'), { type: RENAME_SCRIPT_FOLDER, value: [SID, '1_old', '1_new'] });
        await writer.flush();
        expect(backend.calls).toEqual(['renameFolder:1_old->1_new']);
    });

    it('dispatches a RENAME_SCRIPT task to the backend', async () => {
        const backend = new CallLogBackend();
        const writer = new StorageWriter(logger, backend);
        await writer.write(groupScriptRenames(SID, 'page', '1_old.sql'), { type: RENAME_SCRIPT, value: [SID, 'page', '1_old.sql', '1_new.sql'] });
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

        const p = writer.write(groupScriptRenames(SID, 'page', '1_a.sql'), { type: RENAME_SCRIPT, value: [SID, 'page', '1_a.sql', '1_b.sql'] });
        const w = writer.write(groupScriptWrites(SID, 'page', '1_b.sql'), { type: WRITE_SCRIPT, value: [SID, 'page', '1_b.sql', 'SELECT 1;'] });
        await writer.flush();
        await Promise.all([p, w]);

        expect(backend.calls).toEqual(['renameScript:page/1_a.sql->1_b.sql', 'write:page/1_b.sql=SELECT 1;']);
    });
});
