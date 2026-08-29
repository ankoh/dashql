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
import { TestLogger } from '../../../platform/logger/test_logger.js';

// Spy standing in for the filesystem scope compatibility hook.
const grantSpy = vi.hoisted(() => vi.fn(async (_path: string) => { }));
vi.mock('./native_fs_scope.js', () => ({ grantFsScope: grantSpy }));

// The plugin-fs mock is backed by a *shared* in-memory store (see test_fs_mock.ts) so the *real*
// NativeStorageBackend works. It must be shared with native_storage_backend.test.ts because the app
// runs vitest with `isolate: false`: when both files land on the same worker, the real
// native_storage_backend.ts is imported once and bound to whichever file's mock loaded first, so a
// per-file store would be read/written by the other file's backend. The factories use async
// `import()` so both files resolve the same singleton store.
vi.mock('../../../platform/electron_fs.js', async () => ({
    ...(await import('./test_fs_mock.js')).makeFsMock(),
    ...(await import('./test_fs_mock.js')).makePathMock(),
}));

// Import after the mocks are registered.
import { fsStore, resetFsStore } from './test_fs_mock.js';
import { CompositeStorageBackend } from './composite_storage_backend.js';
import {
    findNotebookImportConflict,
    prepareNativeNotebookImport,
    registerNativeNotebook,
    replaceNotebookWithNativeFolder,
    replaceNotebookWithPortableBundle,
    writePortableNotebookFresh,
} from './notebook_import_transaction.js';
import type { NotebookBundle } from './notebook_bundle.js';

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
    failNextManifestUpsert = false;
    failNextManifestRemove = false;
    failScriptWriteForNotebook: string | null = null;

    getBackendType(): StorageBackendType { return StorageBackendType.OPFS; }
    async initialize(): Promise<void> { this.initialized = true; }

    async listNotebooks(): Promise<NotebookEntry[]> {
        return [...this.manifest];
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
        this.cache.delete(notebookId);
    }

    async upsertNotebookEntry(entry: NotebookEntry): Promise<void> {
        if (this.failNextManifestUpsert) {
            this.failNextManifestUpsert = false;
            throw new Error('manifest write failed');
        }
        const i = this.manifest.findIndex(s => s.path === entry.path);
        if (i < 0) this.manifest.push(entry);
        else this.manifest[i] = entry;
    }
    async removeNotebookEntry(notebookId: string): Promise<void> {
        if (this.failNextManifestRemove) {
            this.failNextManifestRemove = false;
            throw new Error('manifest write failed');
        }
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
        if (this.failScriptWriteForNotebook === notebookId) {
            this.failScriptWriteForNotebook = null;
            throw new Error('script write failed');
        }
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
    async hasCachedQueryResult(_notebookId: string, hash: string): Promise<boolean> {
        return this.cache.has(hash);
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
const OTHER_NATIVE_DIR = '/Users/test/other-native-notebook';
const STAGING_ID = '33333333-3333-4333-8333-333333333333';

function notebookData(id: string, name: string, extra: Partial<NotebookData> = {}): NotebookData {
    return { notebookId: id, name, connectionParams: { hyper: {} } as any, metadata: {}, ...extra };
}

function notebookBundle(id: string, name: string): NotebookBundle {
    return {
        notebook: notebookData(id, name, {
            notebookPath: `fs:///source/${id}`,
            storageType: StorageBackendType.Native,
            nativePath: `/source/${id}`,
        }),
        schemaSql: `-- ${name} schema`,
        functionsSql: `-- ${name} functions`,
        folders: [{ name: 'page', scripts: [{ name: '1_query.sql', sql: `SELECT '${name}';` }] }],
        draftSql: `-- ${name} draft`,
    };
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

        it('does not mutate in-memory locations before a failed upsert persists', async () => {
            opfs.failNextManifestUpsert = true;

            await expect(composite.upsertNotebookEntry({
                path: NATIVE_ID,
                storageType: StorageBackendType.Native,
                nativePath: NATIVE_DIR,
            })).rejects.toThrow('manifest write failed');

            expect(composite.getNotebookOrder()).toEqual([]);
            expect(composite.getNotebookLocation(NATIVE_ID)).toEqual({ type: StorageBackendType.OPFS });
        });

        it('does not remove an in-memory location before a failed removal persists', async () => {
            await composite.upsertNotebookEntry({
                path: NATIVE_ID,
                storageType: StorageBackendType.Native,
                nativePath: NATIVE_DIR,
            });
            opfs.failNextManifestRemove = true;

            await expect(composite.removeNotebookEntry(NATIVE_ID)).rejects.toThrow('manifest write failed');

            expect(composite.getNotebookOrder()).toEqual([NATIVE_ID]);
            expect(composite.getNotebookLocation(NATIVE_ID)).toEqual({
                type: StorageBackendType.Native,
                nativePath: NATIVE_DIR,
            });
        });

        it('does not reorder in-memory locations before a failed reorder persists', async () => {
            await composite.upsertNotebookEntry({ path: OPFS_ID, storageType: StorageBackendType.OPFS });
            await composite.upsertNotebookEntry({ path: NATIVE_ID, storageType: StorageBackendType.OPFS });
            opfs.reorderNotebooks = async () => { throw new Error('manifest write failed'); };

            await expect(composite.reorderNotebooks([NATIVE_ID, OPFS_ID])).rejects.toThrow('manifest write failed');

            expect(composite.getNotebookOrder()).toEqual([OPFS_ID, NATIVE_ID]);
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

        it('can reorder a newly-created OPFS notebook before re-initialization', async () => {
            await opfs.saveNotebookManifest(OPFS_ID, notebookData(OPFS_ID, 'Existing'));
            await composite.initialize();
            await composite.saveNotebookManifest(NATIVE_ID, notebookData(NATIVE_ID, 'New'));

            expect(composite.getNotebookOrder()).toEqual([OPFS_ID, NATIVE_ID]);

            await composite.reorderNotebooks([NATIVE_ID, OPFS_ID]);

            expect(composite.getNotebookOrder()).toEqual([NATIVE_ID, OPFS_ID]);
            expect(opfs.manifest.map(entry => entry.path)).toEqual([NATIVE_ID, OPFS_ID]);

            const reloaded = new CompositeStorageBackend(opfs, logger);
            await reloaded.initialize();
            expect(reloaded.getNotebookOrder()).toEqual([NATIVE_ID, OPFS_ID]);
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
                connectionParams: { hyper: {} } as any,
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


    describe('notebook import transactions', () => {
        async function writeBundleToDir(bundle: NotebookBundle, dir: string): Promise<void> {
            const { NativeStorageBackend } = await import('./native_storage_backend.js');
            const native = new NativeStorageBackend(dir);
            await native.initialize();
            await native.saveNotebookManifest(bundle.notebook.notebookId, bundle.notebook);
            if (bundle.schemaSql != null) await native.saveNotebookSchema(bundle.notebook.notebookId, bundle.schemaSql);
            if (bundle.functionsSql != null) await native.saveNotebookFunctions(bundle.notebook.notebookId, bundle.functionsSql);
            for (const folder of bundle.folders) {
                await native.createScriptFolder(bundle.notebook.notebookId, folder.name);
                for (const script of folder.scripts) {
                    await native.saveScript(bundle.notebook.notebookId, folder.name, script.name, script.sql);
                }
            }
            if (bundle.draftSql != null) await native.saveScriptDraft(bundle.notebook.notebookId, bundle.draftSql);
        }

        it('finds case-insensitive conflicts from unavailable manifest entries and returns the actual key', async () => {
            const registeredId = OPFS_ID.toUpperCase();
            opfs.manifest.push({
                path: registeredId,
                storageType: StorageBackendType.Native,
                nativePath: '/missing/notebook',
            });
            await composite.initialize();

            await expect(findNotebookImportConflict(composite, OPFS_ID)).resolves.toEqual({
                notebookId: registeredId,
                location: { type: StorageBackendType.Native, nativePath: '/missing/notebook' },
            });
        });

        it('writes a fresh portable import to OPFS with its UUID despite a native routing collision', async () => {
            const bundle = notebookBundle(OPFS_ID, 'Imported');
            await composite.initialize();
            await composite.upsertNotebookEntry({
                path: OPFS_ID,
                storageType: StorageBackendType.Native,
                nativePath: NATIVE_DIR,
            });
            // Simulate a stale in-memory route after the durable registry entry has gone away.
            await opfs.removeNotebookEntry(OPFS_ID);

            await expect(writePortableNotebookFresh(composite, bundle)).resolves.toBe(OPFS_ID);

            expect(opfs.notebooks.get(OPFS_ID)).toEqual(notebookData(OPFS_ID, 'Imported'));
            expect(composite.getNotebookLocation(OPFS_ID)).toEqual({ type: StorageBackendType.OPFS });
            expect(await composite.readPortableNotebookBundle(OPFS_ID)).toEqual({
                ...bundle,
                notebook: notebookData(OPFS_ID, 'Imported'),
            });
        });

        it('stages and replaces portable data, deleting stale durable files and cache while preserving order', async () => {
            await opfs.saveNotebookManifest(OPFS_ID, notebookData(OPFS_ID, 'Old'));
            await opfs.createScriptFolder(OPFS_ID, 'stale-page');
            await opfs.saveScript(OPFS_ID, 'stale-page', 'stale.sql', 'SELECT 0;');
            await opfs.saveNotebookSchema(OPFS_ID, '-- stale schema');
            await opfs.saveQueryResultCache(OPFS_ID, 'stale-cache', new Uint8Array([1]));
            await opfs.saveNotebookManifest(NATIVE_ID, notebookData(NATIVE_ID, 'After'));
            await composite.initialize();
            const conflict = (await findNotebookImportConflict(composite, OPFS_ID))!;

            await replaceNotebookWithPortableBundle(composite, notebookBundle(OPFS_ID, 'New'), conflict, {
                randomUUID: () => STAGING_ID,
            });

            expect(opfs.manifest.map(entry => entry.path)).toEqual([OPFS_ID, NATIVE_ID]);
            expect(opfs.pages.get(OPFS_ID)?.has('stale-page')).toBe(false);
            expect(opfs.cache.has(OPFS_ID)).toBe(false);
            expect(opfs.notebooks.has(STAGING_ID)).toBe(false);
            expect(opfs.manifest.some(entry => entry.path === STAGING_ID)).toBe(false);
            expect((await opfs.loadNotebook(OPFS_ID)).name).toBe('New');
        });

        it('replaces a case-insensitive conflict under its actual registered key', async () => {
            const registeredId = OPFS_ID.toUpperCase();
            await opfs.saveNotebookManifest(registeredId, notebookData(registeredId, 'Old'));
            await composite.initialize();
            const conflict = (await findNotebookImportConflict(composite, OPFS_ID))!;

            await replaceNotebookWithPortableBundle(composite, notebookBundle(OPFS_ID, 'New'), conflict, {
                randomUUID: () => STAGING_ID,
            });

            expect(opfs.manifest.map(entry => entry.path)).toEqual([registeredId]);
            expect((await opfs.loadNotebook(registeredId)).notebookId).toBe(registeredId);
            expect(composite.getNotebookOrder()).toEqual([registeredId]);
        });

        it('replaces a native registration with OPFS without modifying the old folder', async () => {
            const oldBundle = notebookBundle(NATIVE_ID, 'Old Native');
            await writeBundleToDir(oldBundle, NATIVE_DIR);
            fsStore.binFiles.set(`${NATIVE_DIR}/cache/old.arrow`, new Uint8Array([7]));
            await opfs.upsertNotebookEntry({
                path: NATIVE_ID,
                storageType: StorageBackendType.Native,
                nativePath: NATIVE_DIR,
            });
            await composite.initialize();
            const oldFiles = new Map(fsStore.files);
            const oldCache = new Map(fsStore.binFiles);
            const conflict = (await findNotebookImportConflict(composite, NATIVE_ID.toUpperCase()))!;

            await replaceNotebookWithPortableBundle(composite, notebookBundle(NATIVE_ID, 'Portable'), conflict, {
                randomUUID: () => STAGING_ID,
            });

            expect(composite.getNotebookLocation(NATIVE_ID)).toEqual({ type: StorageBackendType.OPFS });
            expect((await opfs.loadNotebook(NATIVE_ID)).name).toBe('Portable');
            expect(fsStore.files).toEqual(oldFiles);
            expect(fsStore.binFiles).toEqual(oldCache);
        });

        it('restores the prior OPFS bundle and manifest location after a final write failure', async () => {
            const oldBundle = notebookBundle(OPFS_ID, 'Old');
            await composite.initialize();
            await composite.writePortableNotebookBundle(oldBundle, OPFS_ID, true);
            await opfs.saveQueryResultCache(OPFS_ID, 'old-cache', new Uint8Array([1]));
            const conflict = (await findNotebookImportConflict(composite, OPFS_ID))!;
            opfs.failScriptWriteForNotebook = OPFS_ID;

            await expect(replaceNotebookWithPortableBundle(
                composite,
                notebookBundle(OPFS_ID, 'New'),
                conflict,
                { randomUUID: () => STAGING_ID },
            )).rejects.toThrow('script write failed');

            expect(await composite.readPortableNotebookBundle(OPFS_ID)).toEqual({
                ...oldBundle,
                notebook: notebookData(OPFS_ID, 'Old'),
            });
            expect(composite.getNotebookLocation(OPFS_ID)).toEqual({ type: StorageBackendType.OPFS });
            expect(opfs.manifest.map(entry => entry.path)).toEqual([OPFS_ID]);
            expect(opfs.notebooks.has(STAGING_ID)).toBe(false);
            // Derived cache is intentionally not restored by runtime rollback.
            expect(opfs.cache.has(OPFS_ID)).toBe(false);
        });

        it('does not mutate the live notebook when staging fails', async () => {
            const oldBundle = notebookBundle(OPFS_ID, 'Old');
            await composite.initialize();
            await composite.writePortableNotebookBundle(oldBundle, OPFS_ID, true);
            await opfs.saveQueryResultCache(OPFS_ID, 'old-cache', new Uint8Array([1]));
            const conflict = (await findNotebookImportConflict(composite, OPFS_ID))!;
            opfs.failScriptWriteForNotebook = STAGING_ID;

            await expect(replaceNotebookWithPortableBundle(
                composite,
                notebookBundle(OPFS_ID, 'New'),
                conflict,
                { randomUUID: () => STAGING_ID },
            )).rejects.toThrow('script write failed');

            expect(await composite.readPortableNotebookBundle(OPFS_ID)).toEqual({
                ...oldBundle,
                notebook: notebookData(OPFS_ID, 'Old'),
            });
            expect(opfs.cache.has(OPFS_ID)).toBe(true);
            expect(opfs.manifest.map(entry => entry.path)).toEqual([OPFS_ID]);
        });

        it('prepares and registers a native folder without modifying it', async () => {
            const bundle = notebookBundle(NATIVE_ID, 'Native Source');
            await writeBundleToDir(bundle, NATIVE_DIR);
            const filesBefore = new Map(fsStore.files);
            await composite.initialize();

            const prepared = await prepareNativeNotebookImport(composite, NATIVE_DIR);
            await expect(registerNativeNotebook(composite, prepared)).resolves.toBe(NATIVE_ID);

            expect(fsStore.files).toEqual(filesBefore);
            expect(composite.getNotebookLocation(NATIVE_ID)).toEqual({
                type: StorageBackendType.Native,
                nativePath: NATIVE_DIR,
            });
        });

        it('replaces a native registration in place, leaves the old folder untouched, and no-ops for the same folder', async () => {
            const oldBundle = notebookBundle(NATIVE_ID, 'Old Native');
            const newBundle = notebookBundle(NATIVE_ID, 'New Native');
            await writeBundleToDir(oldBundle, NATIVE_DIR);
            await writeBundleToDir(newBundle, OTHER_NATIVE_DIR);
            await opfs.upsertNotebookEntry({
                path: NATIVE_ID,
                storageType: StorageBackendType.Native,
                nativePath: NATIVE_DIR,
            });
            await composite.initialize();
            const oldFiles = new Map([...fsStore.files].filter(([path]) => path.startsWith(`${NATIVE_DIR}/`)));
            const prepared = await prepareNativeNotebookImport(composite, OTHER_NATIVE_DIR);
            const conflict = (await findNotebookImportConflict(composite, NATIVE_ID))!;

            await replaceNotebookWithNativeFolder(composite, prepared, conflict);
            expect(composite.getNotebookLocation(NATIVE_ID)).toEqual({
                type: StorageBackendType.Native,
                nativePath: OTHER_NATIVE_DIR,
            });
            expect(new Map([...fsStore.files].filter(([path]) => path.startsWith(`${NATIVE_DIR}/`)))).toEqual(oldFiles);

            opfs.failNextManifestUpsert = true;
            await expect(replaceNotebookWithNativeFolder(
                composite,
                prepared,
                { notebookId: NATIVE_ID, location: composite.getNotebookLocation(NATIVE_ID) },
            )).resolves.toBe(NATIVE_ID);
        });

        it('flips an OPFS registration before deleting its files and leaves them intact if the flip fails', async () => {
            const oldBundle = notebookBundle(OPFS_ID, 'Old Portable');
            const nativeBundle = notebookBundle(OPFS_ID, 'Selected Native');
            await composite.initialize();
            await composite.writePortableNotebookBundle(oldBundle, OPFS_ID, true);
            await opfs.saveQueryResultCache(OPFS_ID, 'old-cache', new Uint8Array([1]));
            await writeBundleToDir(nativeBundle, NATIVE_DIR);
            const prepared = await prepareNativeNotebookImport(composite, NATIVE_DIR);
            const conflict = (await findNotebookImportConflict(composite, OPFS_ID))!;
            opfs.failNextManifestUpsert = true;

            await expect(replaceNotebookWithNativeFolder(composite, prepared, conflict))
                .rejects.toThrow('manifest write failed');

            expect((await opfs.loadNotebook(OPFS_ID)).name).toBe('Old Portable');
            expect(opfs.cache.has(OPFS_ID)).toBe(true);
            expect(composite.getNotebookLocation(OPFS_ID)).toEqual({ type: StorageBackendType.OPFS });

            await replaceNotebookWithNativeFolder(composite, prepared, conflict);
            expect(opfs.notebooks.has(OPFS_ID)).toBe(false);
            expect(opfs.cache.has(OPFS_ID)).toBe(false);
            expect(composite.getNotebookLocation(OPFS_ID)).toEqual({
                type: StorageBackendType.Native,
                nativePath: NATIVE_DIR,
            });
        });

        it('does not mutate the registry or create a directory before native source validation', async () => {
            const missingDir = '/Users/test/missing';
            await composite.initialize();

            await expect(prepareNativeNotebookImport(composite, missingDir)).rejects.toThrow('No dashql notebook found');

            expect(fsStore.dirs.has(missingDir)).toBe(false);
            expect(opfs.manifest).toEqual([]);
            expect(composite.getNotebookOrder()).toEqual([]);
        });
    });
});
