import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    type NotebookRegistryBackend,
    type NotebookData,
    type ScriptFolderData,
    type ScriptData,
    type NotebookEntry,
    type AppSettings,
    type CachedQueryResult,
    StorageBackendType,
} from './storage_backend.js';
import { type CacheFileStat } from './query_result_cache_eviction.js';
import { TestLogger } from '../../../shared/platform/logger/test_logger.js';

// Spy standing in for the Tauri `grant_fs_scope` bridge. Hoisted so the vi.mock factory can use it.
const grantSpy = vi.hoisted(() => vi.fn(async (_path: string) => { }));
vi.mock('./native_fs_scope.js', () => ({ grantFsScope: grantSpy }));

// The plugin-fs mock is backed by a *shared* in-memory store (see test_fs_mock.ts) so the *real*
// NativeStorageBackend works. It must be shared with native_storage_backend.test.ts because the app
// runs vitest with `isolate: false`: when both files land on the same worker, the real
// native_storage_backend.ts is imported once and bound to whichever file's mock loaded first, so a
// per-file store would be read/written by the other file's backend. The factories use async
// `import()` so both files resolve the same singleton store.
vi.mock('@tauri-apps/api/path', async () => (await import('./test_fs_mock.js')).makePathMock());
vi.mock('@tauri-apps/plugin-fs', async () => (await import('./test_fs_mock.js')).makeFsMock());

// Import after the mocks are registered.
import { fsStore, resetFsStore } from './test_fs_mock.js';
import { CompositeStorageBackend } from './composite_storage_backend.js';

/// An in-memory stand-in for the OPFS registry backend.
///
/// Mirrors the real OPFS semantics the composite relies on: per-notebook ops are keyed by the bare
/// UUID, `saveNotebookManifest` also writes an OPFS registry entry, and the registry methods keep a
/// single manifest array of `NotebookEntry` rows.
class MemoryRegistry implements NotebookRegistryBackend {
    manifest: NotebookEntry[] = [];
    appSettings: AppSettings | null = null;
    initialized = false;
    notebooks = new Map<string, NotebookData>();
    schema = new Map<string, string>();
    functions = new Map<string, string>();
    drafts = new Map<string, string>();
    pages = new Map<string, Map<string, Map<string, string>>>();
    cache = new Map<string, Map<string, Uint8Array>>();

    getBackendType(): StorageBackendType { return StorageBackendType.OPFS; }
    async initialize(): Promise<void> { this.initialized = true; }

    async listNotebooks(): Promise<NotebookEntry[]> {
        return [...this.manifest].sort((a, b) => a.path.localeCompare(b.path));
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
        await this.upsertNotebookEntry({ path: notebookId, storageType: StorageBackendType.OPFS });
    }
    async deleteNotebook(notebookId: string): Promise<void> {
        await this.deleteNotebookFiles(notebookId);
        await this.removeNotebookEntry(notebookId);
    }
    async deleteNotebookFiles(notebookId: string): Promise<void> {
        this.notebooks.delete(notebookId);
        this.schema.delete(notebookId);
        this.functions.delete(notebookId);
        this.drafts.delete(notebookId);
        this.pages.delete(notebookId);
    }

    async upsertNotebookEntry(entry: NotebookEntry): Promise<void> {
        const i = this.manifest.findIndex(s => s.path === entry.path);
        if (i < 0) this.manifest.push(entry);
        else this.manifest[i] = entry;
    }
    async removeNotebookEntry(notebookId: string): Promise<void> {
        this.manifest = this.manifest.filter(s => s.path !== notebookId);
    }
    async reorderNotebooks(orderedIds: string[]): Promise<void> {
        const byId = new Map(this.manifest.map(s => [s.path, s]));
        const reordered: NotebookEntry[] = [];
        const taken = new Set<string>();
        for (const id of orderedIds) {
            const entry = byId.get(id);
            if (entry && !taken.has(id)) { reordered.push(entry); taken.add(id); }
        }
        for (const entry of this.manifest) {
            if (!taken.has(entry.path)) reordered.push(entry);
        }
        this.manifest = reordered;
    }

    async loadNotebookSchema(notebookId: string): Promise<string | null> { return this.schema.get(notebookId) ?? null; }
    async saveNotebookSchema(notebookId: string, sql: string): Promise<void> { this.schema.set(notebookId, sql); }
    async loadNotebookFunctions(notebookId: string): Promise<string | null> { return this.functions.get(notebookId) ?? null; }
    async saveNotebookFunctions(notebookId: string, sql: string): Promise<void> { this.functions.set(notebookId, sql); }

    async loadScriptFolders(notebookId: string): Promise<ScriptFolderData[]> {
        const p = this.pages.get(notebookId);
        if (!p) return [];
        return [...p.entries()].map(([name, scripts]) => ({
            name,
            scripts: [...scripts.entries()].map(([sn, sql]): ScriptData => ({ name: sn, sql })),
        }));
    }
    async createScriptFolder(notebookId: string, folderName: string): Promise<void> {
        const p = this.pages.get(notebookId) ?? new Map();
        if (!p.has(folderName)) p.set(folderName, new Map());
        this.pages.set(notebookId, p);
    }
    async deleteScriptFolder(notebookId: string, folderName: string): Promise<void> {
        this.pages.get(notebookId)?.delete(folderName);
    }
    async renameScriptFolder(notebookId: string, oldFolderName: string, newFolderName: string): Promise<void> {
        const p = this.pages.get(notebookId);
        const page = p?.get(oldFolderName);
        if (!p || !page) return;
        p.delete(oldFolderName);
        p.set(newFolderName, page);
    }
    async loadScript(notebookId: string, folderName: string, scriptName: string): Promise<ScriptData> {
        const sql = this.pages.get(notebookId)?.get(folderName)?.get(scriptName);
        if (sql == null) throw new Error('Script not found');
        return { name: scriptName, sql };
    }
    async saveScript(notebookId: string, folderName: string, scriptName: string, sql: string): Promise<void> {
        const p = this.pages.get(notebookId) ?? new Map();
        const page = p.get(folderName) ?? new Map();
        page.set(scriptName, sql);
        p.set(folderName, page);
        this.pages.set(notebookId, p);
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
    async touchQueryResultCacheAccess(_notebookId: string, _hash: string): Promise<void> { }
    async listQueryResultCache(notebookId: string): Promise<CacheFileStat[]> {
        return [...(this.cache.get(notebookId)?.entries() ?? [])].map(([hash, bytes]) => ({
            name: `${hash}.arrow`, size: bytes.byteLength, mtimeMs: 0, lastAccessMs: 0,
        }));
    }
    async deleteQueryResultCache(notebookId: string, hash: string): Promise<void> {
        this.cache.get(notebookId)?.delete(hash);
    }

    async clearAllStorage(): Promise<void> {
        this.manifest = [];
        this.appSettings = null;
        this.notebooks.clear();
        this.schema.clear();
        this.functions.clear();
        this.drafts.clear();
        this.pages.clear();
        this.cache.clear();
    }
}

const OPFS_ID = '11111111-1111-1111-1111-111111111111';
const NATIVE_ID = '22222222-2222-2222-2222-222222222222';
const NATIVE_DIR = '/Users/test/native-notebook';

function notebookData(id: string, name: string, extra: Partial<NotebookData> = {}): NotebookData {
    return { notebookId: id, name, connectionParams: { dataless: {} }, metadata: {}, ...extra };
}

describe('CompositeStorageBackend', () => {
    let opfs: MemoryRegistry;
    let composite: CompositeStorageBackend;
    let logger: TestLogger;

    beforeEach(() => {
        resetFsStore();
        grantSpy.mockClear();
        opfs = new MemoryRegistry();
        logger = new TestLogger();
        composite = new CompositeStorageBackend(opfs, logger);
    });

    /// Seed a native notebook: write its files into the directory and register it in the manifest.
    async function seedNativeNotebook(id: string, dir: string, title: string): Promise<void> {
        const { NativeStorageBackend } = await import('./native_storage_backend.js');
        const nb = new NativeStorageBackend(dir);
        await nb.initialize();
        await nb.saveNotebookManifest(id, notebookData(id, title, {
            storageType: StorageBackendType.Native,
            nativePath: dir,
        }));
        await opfs.upsertNotebookEntry({ path: id, storageType: StorageBackendType.Native, nativePath: dir });
    }

    describe('initialize / refreshLocations', () => {
        it('initializes the OPFS backend and grants scope for native notebooks in the manifest', async () => {
            await seedNativeNotebook(NATIVE_ID, NATIVE_DIR, 'Native');
            await composite.initialize();

            expect(opfs.initialized).toBe(true);
            // Scope is granted once for the native directory, before any read.
            expect(grantSpy).toHaveBeenCalledWith(NATIVE_DIR);
            expect(grantSpy).toHaveBeenCalledTimes(1);
        });

        it('grants no scope when every notebook is OPFS', async () => {
            await opfs.saveNotebookManifest(OPFS_ID, notebookData(OPFS_ID, 'Opfs'));
            await composite.initialize();
            expect(grantSpy).not.toHaveBeenCalled();
        });
    });

    describe('registry-level ops always hit OPFS', () => {
        beforeEach(() => composite.initialize());

        it('listNotebooks returns the OPFS manifest', async () => {
            await opfs.saveNotebookManifest(OPFS_ID, notebookData(OPFS_ID, 'Opfs'));
            const notebooks = await composite.listNotebooks('dashql-manifest.json');
            expect(notebooks.map(s => s.path)).toEqual([OPFS_ID]);
        });

        it('app settings round-trip through OPFS', async () => {
            await composite.saveAppSettings({ flag: true } as any);
            expect(await composite.loadAppSettings()).toEqual({ flag: true });
            expect(opfs.appSettings).toEqual({ flag: true });
        });
    });

    describe('per-notebook routing by uuid -> location', () => {
        it('routes an OPFS notebook to the OPFS backend', async () => {
            await composite.initialize();
            await composite.saveNotebookManifest(OPFS_ID, notebookData(OPFS_ID, 'Opfs'));
            await composite.saveNotebookSchema(OPFS_ID, 'CREATE TABLE t(a int);');

            expect(opfs.notebooks.has(OPFS_ID)).toBe(true);
            expect(await composite.loadNotebookSchema(OPFS_ID)).toBe('CREATE TABLE t(a int);');
            // Nothing was written to the native filesystem.
            expect(fsStore.files.size).toBe(0);
            expect(composite.getNotebookLocation(OPFS_ID)).toEqual({ type: StorageBackendType.OPFS });
        });

        it('routes a native notebook to its directory on disk', async () => {
            await seedNativeNotebook(NATIVE_ID, NATIVE_DIR, 'Native');
            await composite.initialize();

            const loaded = await composite.loadNotebook(NATIVE_ID);
            expect(loaded.notebookId).toBe(NATIVE_ID);
            expect(loaded.name).toBe('Native');
            // The file physically lives directly in the directory.
            expect(fsStore.files.has(`${NATIVE_DIR}/dashql-notebook.json`)).toBe(true);
            expect(composite.getNotebookLocation(NATIVE_ID)).toEqual({
                type: StorageBackendType.Native,
                nativePath: NATIVE_DIR,
            });
        });

        it('handles a mixed manifest (one OPFS, one native)', async () => {
            await opfs.saveNotebookManifest(OPFS_ID, notebookData(OPFS_ID, 'Opfs'));
            await seedNativeNotebook(NATIVE_ID, NATIVE_DIR, 'Native');
            await composite.initialize();

            expect(composite.getNotebookLocation(OPFS_ID).type).toBe(StorageBackendType.OPFS);
            expect(composite.getNotebookLocation(NATIVE_ID).type).toBe(StorageBackendType.Native);

            // Writes route independently.
            await composite.saveNotebookSchema(OPFS_ID, 'opfs-schema');
            await composite.saveNotebookSchema(NATIVE_ID, 'native-schema');
            expect(opfs.schema.get(OPFS_ID)).toBe('opfs-schema');
            expect(fsStore.files.get(`${NATIVE_DIR}/dashql-relations.sql`)).toBe('native-schema');
        });
    });

    describe('saveNotebookManifest keeps the registry in sync', () => {
        it('records an OPFS registry entry for a new OPFS notebook', async () => {
            await composite.initialize();
            await composite.saveNotebookManifest(OPFS_ID, notebookData(OPFS_ID, 'Opfs'));
            const entry = opfs.manifest.find(s => s.path === OPFS_ID);
            expect(entry?.storageType).toBe(StorageBackendType.OPFS);
        });

        it('keeps a native registry entry native when re-saving a native notebook', async () => {
            await seedNativeNotebook(NATIVE_ID, NATIVE_DIR, 'Native');
            await composite.initialize();

            await composite.saveNotebookManifest(NATIVE_ID, notebookData(NATIVE_ID, 'Renamed', {
                storageType: StorageBackendType.Native,
                nativePath: NATIVE_DIR,
            }));

            const entry = opfs.manifest.find(s => s.path === NATIVE_ID);
            expect(entry?.storageType).toBe(StorageBackendType.Native);
            expect(entry?.nativePath).toBe(NATIVE_DIR);
            // The manifest still has exactly one entry for this notebook.
            expect(opfs.manifest.filter(s => s.path === NATIVE_ID)).toHaveLength(1);
        });
    });

    describe('deleteNotebook routes and cleans up', () => {
        it('deletes an OPFS notebook via the OPFS backend (files + entry)', async () => {
            await composite.initialize();
            await composite.saveNotebookManifest(OPFS_ID, notebookData(OPFS_ID, 'Opfs'));

            await composite.deleteNotebook(OPFS_ID);

            expect(opfs.notebooks.has(OPFS_ID)).toBe(false);
            expect(opfs.manifest.find(s => s.path === OPFS_ID)).toBeUndefined();
            expect(composite.getNotebookLocation(OPFS_ID).type).toBe(StorageBackendType.OPFS); // default
        });

        it('deletes a native notebook: drops the OPFS registry entry but keeps the files on disk', async () => {
            await seedNativeNotebook(NATIVE_ID, NATIVE_DIR, 'Native');
            await composite.initialize();
            const filesBefore = [...fsStore.files.keys()].filter(p => p.startsWith(`${NATIVE_DIR}/`)).sort();
            expect(filesBefore.length).toBeGreaterThan(0);

            await composite.deleteNotebook(NATIVE_ID);

            // The notebook is unregistered (gone from the manifest and the location map)...
            expect(opfs.manifest.find(s => s.path === NATIVE_ID)).toBeUndefined();
            expect(composite.getNotebookLocation(NATIVE_ID).type).toBe(StorageBackendType.OPFS); // default for unknown
            // ...but its user-owned folder on disk is left intact.
            expect([...fsStore.files.keys()].filter(p => p.startsWith(`${NATIVE_DIR}/`)).sort()).toEqual(filesBefore);
        });

        it('deletes a native notebook whose folder is gone: drops the entry without resurrecting the folder', async () => {
            await seedNativeNotebook(NATIVE_ID, NATIVE_DIR, 'Native');
            await composite.initialize();

            // Simulate the user deleting the notebook's folder on disk out from under dashql — the
            // manifest still references it. Deleting must drop the stale entry and must NOT re-create
            // the folder (routing through the native backend's initialize() would mkdir it back).
            resetFsStore();

            await composite.deleteNotebook(NATIVE_ID);

            expect(opfs.manifest.find(s => s.path === NATIVE_ID)).toBeUndefined();
            expect(composite.getNotebookLocation(NATIVE_ID).type).toBe(StorageBackendType.OPFS); // default for unknown
            // The folder was not resurrected as an empty directory.
            expect(fsStore.dirs.has(NATIVE_DIR)).toBe(false);
            expect([...fsStore.files.keys()].some(p => p.startsWith(`${NATIVE_DIR}/`))).toBe(false);
        });
    });

    describe('relocateNotebookToNative', () => {
        async function seedFullOpfsNotebook(id: string): Promise<void> {
            await opfs.saveNotebookManifest(id, notebookData(id, 'To Relocate'));
            await opfs.saveNotebookSchema(id, '-- schema');
            await opfs.saveNotebookFunctions(id, '-- functions');
            await opfs.createScriptFolder(id, 'page-1');
            await opfs.saveScript(id, 'page-1', '01-script.sql', 'SELECT 1;');
            await opfs.saveScript(id, 'page-1', '02-script.sql', 'SELECT 2;');
            await opfs.saveScriptDraft(id, '-- draft');
        }

        it('copies the notebook to disk, flips the entry, and deletes the OPFS copy', async () => {
            await seedFullOpfsNotebook(OPFS_ID);
            await composite.initialize();

            await composite.relocateNotebookToNative(OPFS_ID, NATIVE_DIR);

            // Scope granted for the new directory.
            expect(grantSpy).toHaveBeenCalledWith(NATIVE_DIR);

            // Files now live on disk, directly in the directory.
            expect(fsStore.files.has(`${NATIVE_DIR}/dashql-notebook.json`)).toBe(true);
            expect(fsStore.files.get(`${NATIVE_DIR}/dashql-relations.sql`)).toBe('-- schema');
            expect(fsStore.files.has(`${NATIVE_DIR}/scripts/page-1/01-script.sql`)).toBe(true);

            // The OPFS copy of the files is gone, but the registry entry stays (now native).
            expect(opfs.notebooks.has(OPFS_ID)).toBe(false);
            const entry = opfs.manifest.find(s => s.path === OPFS_ID);
            expect(entry?.storageType).toBe(StorageBackendType.Native);
            expect(entry?.nativePath).toBe(NATIVE_DIR);

            // The notebook now reads from the native directory, with its UUID preserved.
            expect(composite.getNotebookLocation(OPFS_ID)).toEqual({
                type: StorageBackendType.Native,
                nativePath: NATIVE_DIR,
            });
            const loaded = await composite.loadNotebook(OPFS_ID);
            expect(loaded.notebookId).toBe(OPFS_ID);
            expect(loaded.storageType).toBe(StorageBackendType.Native);
            expect(loaded.nativePath).toBe(NATIVE_DIR);
        });

        it('throws when the notebook is already native (and leaves it intact)', async () => {
            await seedNativeNotebook(NATIVE_ID, NATIVE_DIR, 'Native');
            await composite.initialize();

            await expect(
                composite.relocateNotebookToNative(NATIVE_ID, '/Users/test/another-dir')
            ).rejects.toThrow(/not an OPFS notebook/);
        });
    });

    describe('loadNativeNotebook', () => {
        /// Write a complete notebook into a directory on disk *without* registering it (as if a
        /// previous run left it there). Mirrors what the native backend persists for a real notebook.
        async function writeNotebookToDir(id: string, dir: string, title: string): Promise<void> {
            const { NativeStorageBackend } = await import('./native_storage_backend.js');
            const nb = new NativeStorageBackend(dir);
            await nb.initialize();
            await nb.saveNotebookManifest(id, notebookData(id, title, {
                storageType: StorageBackendType.Native,
                nativePath: dir,
            }));
            await nb.saveNotebookSchema(id, '-- loaded schema');
            await nb.createScriptFolder(id, 'page-1');
            await nb.saveScript(id, 'page-1', '01-script.sql', 'SELECT 1;');
        }

        it('registers an existing on-disk notebook and routes to it, copying nothing', async () => {
            await writeNotebookToDir(NATIVE_ID, NATIVE_DIR, 'Loaded');
            await composite.initialize();
            const filesBefore = fsStore.files.size;

            const loaded = await composite.loadNativeNotebook(NATIVE_DIR);

            expect(loaded).toBe(NATIVE_ID);
            // Scope was granted for the folder.
            expect(grantSpy).toHaveBeenCalledWith(NATIVE_DIR);
            // The manifest now carries a native entry pointing at the folder.
            const entry = opfs.manifest.find(s => s.path === NATIVE_ID);
            expect(entry?.storageType).toBe(StorageBackendType.Native);
            expect(entry?.nativePath).toBe(NATIVE_DIR);
            // Nothing was copied; the on-disk files are untouched.
            expect(fsStore.files.size).toBe(filesBefore);
            expect(opfs.notebooks.has(NATIVE_ID)).toBe(false);
            // Reads now route to the folder.
            expect(composite.getNotebookLocation(NATIVE_ID)).toEqual({
                type: StorageBackendType.Native,
                nativePath: NATIVE_DIR,
            });
            expect((await composite.loadNotebook(NATIVE_ID)).name).toBe('Loaded');
            expect(await composite.loadNotebookSchema(NATIVE_ID)).toBe('-- loaded schema');
        });

        it('the loaded notebook survives a re-init from the manifest', async () => {
            await writeNotebookToDir(NATIVE_ID, NATIVE_DIR, 'Loaded');
            await composite.initialize();
            await composite.loadNativeNotebook(NATIVE_DIR);

            // A fresh composite over the same OPFS manifest (i.e. an app reload) picks it up.
            const reloaded = new CompositeStorageBackend(opfs, logger);
            await reloaded.initialize();
            expect(reloaded.getNotebookLocation(NATIVE_ID).type).toBe(StorageBackendType.Native);
            expect((await reloaded.loadNotebook(NATIVE_ID)).name).toBe('Loaded');
        });

        it('throws when the folder holds no notebook', async () => {
            await composite.initialize();
            await expect(
                composite.loadNativeNotebook('/Users/test/empty-dir')
            ).rejects.toThrow(/No dashql notebook found/);
            expect(opfs.manifest).toHaveLength(0);
        });

        it('throws when the notebook metadata is invalid', async () => {
            const { NativeStorageBackend } = await import('./native_storage_backend.js');
            const nb = new NativeStorageBackend(NATIVE_DIR);
            await nb.initialize();
            // A notebook file whose id is not a valid UUID is refused by the validation gate.
            await nb.saveNotebookManifest('bad', notebookData('not-a-uuid', 'Bad'));

            await composite.initialize();
            await expect(
                composite.loadNativeNotebook(NATIVE_DIR)
            ).rejects.toThrow(/is invalid/);
            expect(opfs.manifest).toHaveLength(0);
        });

        it('reports a missing notebook id instead of claiming the manifest is absent', async () => {
            fsStore.files.set(`${NATIVE_DIR}/dashql-notebook.json`, JSON.stringify({
                sessionId: NATIVE_ID,
                connectionParams: { dataless: {} },
                notebook: {},
            }));

            await composite.initialize();
            await expect(composite.loadNativeNotebook(NATIVE_DIR))
                .rejects.toThrow(`Notebook in ${NATIVE_DIR} is invalid: Missing notebook id`);
            expect(opfs.manifest).toHaveLength(0);
        });

        it('throws when a notebook with the same id is already registered', async () => {
            await writeNotebookToDir(NATIVE_ID, NATIVE_DIR, 'Loaded');
            await composite.initialize();
            await composite.loadNativeNotebook(NATIVE_DIR);

            await expect(
                composite.loadNativeNotebook(NATIVE_DIR)
            ).rejects.toThrow(/already registered/);
        });
    });
});
