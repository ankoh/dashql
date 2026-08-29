import { describe, it, expect, beforeEach } from 'vitest';
import { cloneNotebook, copyNotebook, verifyNotebook } from './storage_migration.js';
import {
    type StorageBackend,
    type NotebookData,
    type ScriptFolderData,
    type ScriptData,
    type NotebookEntry,
    type AppSettings,
    type CachedQueryResult,
    StorageBackendType,
} from './storage_backend.js';
import { type CacheFileStat } from './query_result_cache_eviction.js';
import { TestLogger } from '../../../platform/logger/test_logger.js';

/// A minimal in-memory StorageBackend used to drive single-notebook copy tests.
/// Per-notebook ops are keyed by the bare notebook UUID (no storage prefix anymore).
class MemoryBackend implements StorageBackend {
    private readonly type: StorageBackendType;
    private appSettings: AppSettings | null = null;
    private notebooks = new Map<string, NotebookData>();
    private schema = new Map<string, string>();
    private functions = new Map<string, string>();
    private drafts = new Map<string, string>();
    private pages = new Map<string, Map<string, Map<string, string>>>();
    private cache = new Map<string, Map<string, Uint8Array>>();

    constructor(type: StorageBackendType) {
        this.type = type;
    }

    getBackendType(): StorageBackendType { return this.type; }

    async listNotebooks(): Promise<NotebookEntry[]> {
        return [...this.notebooks.keys()].sort().map(path => ({ path }));
    }
    async loadAppSettings(): Promise<AppSettings | null> { return this.appSettings; }
    async saveAppSettings(settings: AppSettings): Promise<void> { this.appSettings = settings; }
    async loadNotebook(notebookId: string): Promise<NotebookData> {
        const data = this.notebooks.get(notebookId);
        if (!data) throw new Error(`No notebook ${notebookId}`);
        return data;
    }
    async saveNotebookManifest(notebookId: string, data: NotebookData): Promise<void> {
        this.notebooks.set(notebookId, data);
    }
    async deleteNotebook(notebookId: string): Promise<void> {
        this.notebooks.delete(notebookId);
        this.schema.delete(notebookId);
        this.functions.delete(notebookId);
        this.drafts.delete(notebookId);
        this.pages.delete(notebookId);
    }
    async loadNotebookSchema(notebookId: string): Promise<string | null> { return this.schema.get(notebookId) ?? null; }
    async saveNotebookSchema(notebookId: string, sql: string): Promise<void> { this.schema.set(notebookId, sql); }
    async loadNotebookFunctions(notebookId: string): Promise<string | null> { return this.functions.get(notebookId) ?? null; }
    async saveNotebookFunctions(notebookId: string, sql: string): Promise<void> { this.functions.set(notebookId, sql); }
    async loadScriptFolders(notebookId: string): Promise<ScriptFolderData[]> {
        const scriptFolders = this.pages.get(notebookId);
        if (!scriptFolders) return [];
        return [...scriptFolders.entries()].map(([name, scripts]) => ({
            name,
            scripts: [...scripts.entries()].map(([sn, sql]): ScriptData => ({ name: sn, sql })),
        }));
    }
    async createScriptFolder(notebookId: string, folderName: string): Promise<void> {
        const scriptFolders = this.pages.get(notebookId) ?? new Map();
        if (!scriptFolders.has(folderName)) scriptFolders.set(folderName, new Map());
        this.pages.set(notebookId, scriptFolders);
    }
    async deleteScriptFolder(notebookId: string, folderName: string): Promise<void> {
        this.pages.get(notebookId)?.delete(folderName);
    }
    async renameScriptFolder(notebookId: string, oldFolderName: string, newFolderName: string): Promise<void> {
        const scriptFolders = this.pages.get(notebookId);
        const page = scriptFolders?.get(oldFolderName);
        if (!scriptFolders || !page) return;
        scriptFolders.delete(oldFolderName);
        scriptFolders.set(newFolderName, page);
    }
    async loadScript(notebookId: string, folderName: string, scriptName: string): Promise<ScriptData> {
        const sql = this.pages.get(notebookId)?.get(folderName)?.get(scriptName);
        if (sql == null) throw new Error('Script not found');
        return { name: scriptName, sql };
    }
    async saveScript(notebookId: string, folderName: string, scriptName: string, sql: string): Promise<void> {
        const scriptFolders = this.pages.get(notebookId) ?? new Map();
        const page = scriptFolders.get(folderName) ?? new Map();
        page.set(scriptName, sql);
        scriptFolders.set(folderName, page);
        this.pages.set(notebookId, scriptFolders);
    }
    async deleteScript(notebookId: string, folderName: string, scriptName: string): Promise<void> {
        this.pages.get(notebookId)?.get(folderName)?.delete(scriptName);
    }
    async renameScript(notebookId: string, folderName: string, oldScriptName: string, newScriptName: string): Promise<void> {
        const page = this.pages.get(notebookId)?.get(folderName);
        if (!page || !page.has(oldScriptName)) return;
        const sql = page.get(oldScriptName)!;
        page.delete(oldScriptName);
        page.set(newScriptName, sql);
    }
    async loadScriptDraft(notebookId: string): Promise<string | null> { return this.drafts.get(notebookId) ?? null; }
    async saveScriptDraft(notebookId: string, sql: string): Promise<void> { this.drafts.set(notebookId, sql); }
    async loadQueryResultCache(notebookId: string, hash: string): Promise<CachedQueryResult | null> {
        const bytes = this.cache.get(notebookId)?.get(hash);
        return bytes ? { bytes, cachedAtMs: 0 } : null;
    }
    async saveQueryResultCache(notebookId: string, hash: string, bytes: Uint8Array): Promise<void> {
        const c = this.cache.get(notebookId) ?? new Map<string, Uint8Array>();
        c.set(hash, bytes);
        this.cache.set(notebookId, c);
    }
    async touchQueryResultCacheAccess(): Promise<void> { }
    async hasCachedQueryResult(notebookId: string, hash: string): Promise<boolean> {
        let entries = this.cache.get(notebookId);
        return entries?.has(hash) ?? false;
    }
    async listQueryResultCache(notebookId: string): Promise<CacheFileStat[]> {
        return [...(this.cache.get(notebookId)?.entries() ?? [])].map(([hash, bytes]) => ({
            name: `${hash}.arrow`, size: bytes.byteLength, mtimeMs: 0, lastAccessMs: 0,
        }));
    }
    async deleteQueryResultCache(notebookId: string, hash: string): Promise<void> {
        this.cache.get(notebookId)?.delete(hash);
    }
}

function seedNotebook(backend: MemoryBackend, id: string): Promise<void> {
    return (async () => {
        await backend.saveNotebookManifest(id, {
            notebookId: id,
            name: `Notebook ${id}`,
            connectionParams: { hyper: {} } as any,
            metadata: {},
        });
        await backend.saveNotebookSchema(id, `-- schema ${id}`);
        await backend.saveNotebookFunctions(id, `-- functions ${id}`);
        await backend.createScriptFolder(id, 'page-1');
        await backend.saveScript(id, 'page-1', '01-script.sql', `SELECT '${id}-1';`);
        await backend.saveScript(id, 'page-1', '02-script.sql', `SELECT '${id}-2';`);
        await backend.createScriptFolder(id, 'page-2');
        await backend.saveScript(id, 'page-2', '01-script.sql', `SELECT '${id}-3';`);
        await backend.saveScriptDraft(id, `-- draft ${id}`);
    })();
}

describe('storage_migration', () => {
    let source: MemoryBackend;
    let target: MemoryBackend;
    let logger: TestLogger;
    const UUID = 'aaa';

    beforeEach(async () => {
        source = new MemoryBackend(StorageBackendType.OPFS);
        target = new MemoryBackend(StorageBackendType.Native);
        logger = new TestLogger();
        await seedNotebook(source, UUID);
    });

    it('copies one notebook to the target, preserving the UUID', async () => {
        const result = await copyNotebook(UUID, source, target, logger);
        expect(result.notebookCount).toBe(1);
        // 1 manifest + 1 schema + 1 functions + 3 scripts + 1 draft = 7
        expect(result.fileCount).toBe(7);

        const targetNotebooks = await target.listNotebooks();
        expect(targetNotebooks.map(s => s.path)).toEqual([UUID]);
    });

    it('keeps the same notebookId on the copy', async () => {
        await copyNotebook(UUID, source, target, logger);
        const migrated = await target.loadNotebook(UUID);
        expect(migrated.notebookId).toBe(UUID);
        expect(migrated.name).toBe('Notebook aaa');
    });

    it('copies schema, functions, scripts and draft contents verbatim', async () => {
        await copyNotebook(UUID, source, target, logger);
        expect(await target.loadNotebookSchema(UUID)).toBe('-- schema aaa');
        expect(await target.loadNotebookFunctions(UUID)).toBe('-- functions aaa');
        expect(await target.loadScriptDraft(UUID)).toBe('-- draft aaa');

        const pages = await target.loadScriptFolders(UUID);
        const scriptCount = pages.reduce((n, p) => n + p.scripts.length, 0);
        expect(scriptCount).toBe(3);
        const script = await target.loadScript(UUID, 'page-1', '01-script.sql');
        expect(script.sql).toBe("SELECT 'aaa-1';");
    });

    it('verifyNotebook returns true for a complete copy', async () => {
        await copyNotebook(UUID, source, target, logger);
        expect(await verifyNotebook(UUID, source, target)).toBe(true);
    });

    it('verifyNotebook returns false when the notebook is missing', async () => {
        expect(await verifyNotebook(UUID, source, target)).toBe(false);
    });

    it('verifyNotebook returns false when script counts mismatch', async () => {
        await copyNotebook(UUID, source, target, logger);
        await target.deleteScript(UUID, 'page-1', '02-script.sql');
        expect(await verifyNotebook(UUID, source, target)).toBe(false);
    });
});

describe('cloneNotebook', () => {
    let source: MemoryBackend;
    let target: MemoryBackend;
    let logger: TestLogger;
    const SOURCE_ID = 'aaa';
    const CLONE_ID = 'bbb';

    beforeEach(async () => {
        source = new MemoryBackend(StorageBackendType.Native);
        target = new MemoryBackend(StorageBackendType.OPFS);
        logger = new TestLogger();
        await seedNotebook(source, SOURCE_ID);
        await source.saveQueryResultCache(SOURCE_ID, 'hash1', new Uint8Array([1, 2, 3]));
    });

    it('writes a new notebook id and suffixes the name', async () => {
        await cloneNotebook(SOURCE_ID, source, target, CLONE_ID, logger);
        const cloned = await target.loadNotebook(CLONE_ID);
        expect(cloned.notebookId).toBe(CLONE_ID);
        expect(cloned.name).toBe('Notebook aaa (copy)');
        expect(cloned.notebookPath).toBeUndefined();
        expect((await source.loadNotebook(SOURCE_ID)).notebookId).toBe(SOURCE_ID);
    });

    it('copies schema, functions, scripts and draft under the new id', async () => {
        const result = await cloneNotebook(SOURCE_ID, source, target, CLONE_ID, logger);
        expect(result.notebookCount).toBe(1);
        expect(result.fileCount).toBe(7);
        expect(await target.loadNotebookSchema(CLONE_ID)).toBe('-- schema aaa');
        expect(await target.loadNotebookFunctions(CLONE_ID)).toBe('-- functions aaa');
        expect(await target.loadScriptDraft(CLONE_ID)).toBe('-- draft aaa');
        const script = await target.loadScript(CLONE_ID, 'page-1', '01-script.sql');
        expect(script.sql).toBe("SELECT 'aaa-1';");
    });

    it('does not copy the query result cache', async () => {
        await cloneNotebook(SOURCE_ID, source, target, CLONE_ID, logger);
        expect(await target.hasCachedQueryResult(CLONE_ID, 'hash1')).toBe(false);
        expect(await source.hasCachedQueryResult(SOURCE_ID, 'hash1')).toBe(true);
    });

    it('leaves an unnamed notebook unnamed', async () => {
        await source.saveNotebookManifest(SOURCE_ID, {
            notebookId: SOURCE_ID,
            name: '   ',
            connectionParams: { hyper: {} } as any,
            metadata: {},
        });
        await cloneNotebook(SOURCE_ID, source, target, CLONE_ID, logger);
        expect((await target.loadNotebook(CLONE_ID)).name).toBe('   ');
    });

    it('rolls back the clone when a later write fails', async () => {
        const failing = Object.create(target) as MemoryBackend;
        failing.saveScriptDraft = async () => { throw new Error('draft write failed'); };
        await expect(cloneNotebook(SOURCE_ID, source, failing, CLONE_ID, logger)).rejects.toThrow('draft write failed');
        await expect(target.loadNotebook(CLONE_ID)).rejects.toThrow(`No notebook ${CLONE_ID}`);
    });
});
