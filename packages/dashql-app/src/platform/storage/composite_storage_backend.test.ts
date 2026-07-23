import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    type SessionRegistryBackend,
    type SessionData,
    type PageData,
    type ScriptData,
    type SessionEntry,
    type AppSettings,
    StorageBackendType,
} from './storage_backend.js';
import { TestLogger } from '../logger/test_logger.js';

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
/// Mirrors the real OPFS semantics the composite relies on: per-session ops are keyed by the bare
/// UUID, `saveSessionManifest` also writes an OPFS registry entry, and the registry methods keep a
/// single manifest array of `SessionEntry` rows.
class MemoryRegistry implements SessionRegistryBackend {
    manifest: SessionEntry[] = [];
    appSettings: AppSettings | null = null;
    initialized = false;
    sessions = new Map<string, SessionData>();
    schema = new Map<string, string>();
    functions = new Map<string, string>();
    drafts = new Map<string, string>();
    pages = new Map<string, Map<string, Map<string, string>>>();

    getBackendType(): StorageBackendType { return StorageBackendType.OPFS; }
    async initialize(): Promise<void> { this.initialized = true; }

    async listSessions(): Promise<SessionEntry[]> {
        return [...this.manifest].sort((a, b) => a.path.localeCompare(b.path));
    }
    async loadAppSettings(): Promise<AppSettings | null> { return this.appSettings; }
    async saveAppSettings(settings: AppSettings): Promise<void> { this.appSettings = settings; }

    async loadSession(sessionId: string): Promise<SessionData> {
        const data = this.sessions.get(sessionId);
        if (!data) throw new Error(`No session ${sessionId}`);
        return data;
    }
    async saveSessionManifest(sessionId: string, data: SessionData): Promise<void> {
        this.sessions.set(sessionId, data);
        await this.upsertSessionEntry({ path: sessionId, storageType: StorageBackendType.OPFS });
    }
    async deleteSession(sessionId: string): Promise<void> {
        await this.deleteSessionFiles(sessionId);
        await this.removeSessionEntry(sessionId);
    }
    async deleteSessionFiles(sessionId: string): Promise<void> {
        this.sessions.delete(sessionId);
        this.schema.delete(sessionId);
        this.functions.delete(sessionId);
        this.drafts.delete(sessionId);
        this.pages.delete(sessionId);
    }

    async upsertSessionEntry(entry: SessionEntry): Promise<void> {
        const i = this.manifest.findIndex(s => s.path === entry.path);
        if (i < 0) this.manifest.push(entry);
        else this.manifest[i] = entry;
    }
    async removeSessionEntry(sessionId: string): Promise<void> {
        this.manifest = this.manifest.filter(s => s.path !== sessionId);
    }
    async reorderSessions(orderedIds: string[]): Promise<void> {
        const byId = new Map(this.manifest.map(s => [s.path, s]));
        const reordered: SessionEntry[] = [];
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

    async loadSessionSchema(sessionId: string): Promise<string | null> { return this.schema.get(sessionId) ?? null; }
    async saveSessionSchema(sessionId: string, sql: string): Promise<void> { this.schema.set(sessionId, sql); }
    async loadSessionFunctions(sessionId: string): Promise<string | null> { return this.functions.get(sessionId) ?? null; }
    async saveSessionFunctions(sessionId: string, sql: string): Promise<void> { this.functions.set(sessionId, sql); }

    async loadNotebookPages(sessionId: string): Promise<PageData[]> {
        const p = this.pages.get(sessionId);
        if (!p) return [];
        return [...p.entries()].map(([name, scripts]) => ({
            name,
            scripts: [...scripts.entries()].map(([sn, sql]): ScriptData => ({ name: sn, sql })),
        }));
    }
    async createNotebookPage(sessionId: string, pageName: string): Promise<void> {
        const p = this.pages.get(sessionId) ?? new Map();
        if (!p.has(pageName)) p.set(pageName, new Map());
        this.pages.set(sessionId, p);
    }
    async deleteNotebookPage(sessionId: string, pageName: string): Promise<void> {
        this.pages.get(sessionId)?.delete(pageName);
    }
    async renameNotebookPage(sessionId: string, oldPageName: string, newPageName: string): Promise<void> {
        const p = this.pages.get(sessionId);
        const page = p?.get(oldPageName);
        if (!p || !page) return;
        p.delete(oldPageName);
        p.set(newPageName, page);
    }
    async loadNotebookScript(sessionId: string, pageName: string, scriptName: string): Promise<ScriptData> {
        const sql = this.pages.get(sessionId)?.get(pageName)?.get(scriptName);
        if (sql == null) throw new Error('Script not found');
        return { name: scriptName, sql };
    }
    async saveNotebookScript(sessionId: string, pageName: string, scriptName: string, sql: string): Promise<void> {
        const p = this.pages.get(sessionId) ?? new Map();
        const page = p.get(pageName) ?? new Map();
        page.set(scriptName, sql);
        p.set(pageName, page);
        this.pages.set(sessionId, p);
    }
    async deleteNotebookScript(sessionId: string, pageName: string, scriptName: string): Promise<void> {
        this.pages.get(sessionId)?.get(pageName)?.delete(scriptName);
    }
    async renameNotebookScript(sessionId: string, pageName: string, oldScriptName: string, newScriptName: string): Promise<void> {
        const page = this.pages.get(sessionId)?.get(pageName);
        if (!page || !page.has(oldScriptName)) return;
        const sql = page.get(oldScriptName)!;
        page.delete(oldScriptName);
        page.set(newScriptName, sql);
    }
    async loadNotebookScriptDraft(sessionId: string): Promise<string | null> { return this.drafts.get(sessionId) ?? null; }
    async saveNotebookScriptDraft(sessionId: string, sql: string): Promise<void> { this.drafts.set(sessionId, sql); }

    async clearAllStorage(): Promise<void> {
        this.manifest = [];
        this.appSettings = null;
        this.sessions.clear();
        this.schema.clear();
        this.functions.clear();
        this.drafts.clear();
        this.pages.clear();
    }
}

const OPFS_ID = '11111111-1111-1111-1111-111111111111';
const NATIVE_ID = '22222222-2222-2222-2222-222222222222';
const NATIVE_DIR = '/Users/test/native-session';

function sessionData(id: string, name: string, extra: Partial<SessionData> = {}): SessionData {
    return { sessionId: id, name, connectionParams: { dataless: {} }, notebook: {}, ...extra };
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

    /// Seed a native session: write its files into the directory and register it in the manifest.
    async function seedNativeSession(id: string, dir: string, title: string): Promise<void> {
        const { NativeStorageBackend } = await import('./native_storage_backend.js');
        const nb = new NativeStorageBackend(dir);
        await nb.initialize();
        await nb.saveSessionManifest(id, sessionData(id, title, {
            storageType: StorageBackendType.Native,
            nativePath: dir,
        }));
        await opfs.upsertSessionEntry({ path: id, storageType: StorageBackendType.Native, nativePath: dir });
    }

    describe('initialize / refreshLocations', () => {
        it('initializes the OPFS backend and grants scope for native sessions in the manifest', async () => {
            await seedNativeSession(NATIVE_ID, NATIVE_DIR, 'Native');
            await composite.initialize();

            expect(opfs.initialized).toBe(true);
            // Scope is granted once for the native directory, before any read.
            expect(grantSpy).toHaveBeenCalledWith(NATIVE_DIR);
            expect(grantSpy).toHaveBeenCalledTimes(1);
        });

        it('grants no scope when every session is OPFS', async () => {
            await opfs.saveSessionManifest(OPFS_ID, sessionData(OPFS_ID, 'Opfs'));
            await composite.initialize();
            expect(grantSpy).not.toHaveBeenCalled();
        });
    });

    describe('registry-level ops always hit OPFS', () => {
        beforeEach(() => composite.initialize());

        it('listSessions returns the OPFS manifest', async () => {
            await opfs.saveSessionManifest(OPFS_ID, sessionData(OPFS_ID, 'Opfs'));
            const sessions = await composite.listSessions('dashql-manifest.json');
            expect(sessions.map(s => s.path)).toEqual([OPFS_ID]);
        });

        it('app settings round-trip through OPFS', async () => {
            await composite.saveAppSettings({ flag: true } as any);
            expect(await composite.loadAppSettings()).toEqual({ flag: true });
            expect(opfs.appSettings).toEqual({ flag: true });
        });
    });

    describe('per-session routing by uuid -> location', () => {
        it('routes an OPFS session to the OPFS backend', async () => {
            await composite.initialize();
            await composite.saveSessionManifest(OPFS_ID, sessionData(OPFS_ID, 'Opfs'));
            await composite.saveSessionSchema(OPFS_ID, 'CREATE TABLE t(a int);');

            expect(opfs.sessions.has(OPFS_ID)).toBe(true);
            expect(await composite.loadSessionSchema(OPFS_ID)).toBe('CREATE TABLE t(a int);');
            // Nothing was written to the native filesystem.
            expect(fsStore.files.size).toBe(0);
            expect(composite.getSessionLocation(OPFS_ID)).toEqual({ type: StorageBackendType.OPFS });
        });

        it('routes a native session to its directory on disk', async () => {
            await seedNativeSession(NATIVE_ID, NATIVE_DIR, 'Native');
            await composite.initialize();

            const loaded = await composite.loadSession(NATIVE_ID);
            expect(loaded.sessionId).toBe(NATIVE_ID);
            expect(loaded.name).toBe('Native');
            // The file physically lives directly in the directory.
            expect(fsStore.files.has(`${NATIVE_DIR}/dashql-session.json`)).toBe(true);
            expect(composite.getSessionLocation(NATIVE_ID)).toEqual({
                type: StorageBackendType.Native,
                nativePath: NATIVE_DIR,
            });
        });

        it('handles a mixed manifest (one OPFS, one native)', async () => {
            await opfs.saveSessionManifest(OPFS_ID, sessionData(OPFS_ID, 'Opfs'));
            await seedNativeSession(NATIVE_ID, NATIVE_DIR, 'Native');
            await composite.initialize();

            expect(composite.getSessionLocation(OPFS_ID).type).toBe(StorageBackendType.OPFS);
            expect(composite.getSessionLocation(NATIVE_ID).type).toBe(StorageBackendType.Native);

            // Writes route independently.
            await composite.saveSessionSchema(OPFS_ID, 'opfs-schema');
            await composite.saveSessionSchema(NATIVE_ID, 'native-schema');
            expect(opfs.schema.get(OPFS_ID)).toBe('opfs-schema');
            expect(fsStore.files.get(`${NATIVE_DIR}/dashql-relations.sql`)).toBe('native-schema');
        });
    });

    describe('saveSessionManifest keeps the registry in sync', () => {
        it('records an OPFS registry entry for a new OPFS session', async () => {
            await composite.initialize();
            await composite.saveSessionManifest(OPFS_ID, sessionData(OPFS_ID, 'Opfs'));
            const entry = opfs.manifest.find(s => s.path === OPFS_ID);
            expect(entry?.storageType).toBe(StorageBackendType.OPFS);
        });

        it('keeps a native registry entry native when re-saving a native session', async () => {
            await seedNativeSession(NATIVE_ID, NATIVE_DIR, 'Native');
            await composite.initialize();

            await composite.saveSessionManifest(NATIVE_ID, sessionData(NATIVE_ID, 'Renamed', {
                storageType: StorageBackendType.Native,
                nativePath: NATIVE_DIR,
            }));

            const entry = opfs.manifest.find(s => s.path === NATIVE_ID);
            expect(entry?.storageType).toBe(StorageBackendType.Native);
            expect(entry?.nativePath).toBe(NATIVE_DIR);
            // The manifest still has exactly one entry for this session.
            expect(opfs.manifest.filter(s => s.path === NATIVE_ID)).toHaveLength(1);
        });
    });

    describe('deleteSession routes and cleans up', () => {
        it('deletes an OPFS session via the OPFS backend (files + entry)', async () => {
            await composite.initialize();
            await composite.saveSessionManifest(OPFS_ID, sessionData(OPFS_ID, 'Opfs'));

            await composite.deleteSession(OPFS_ID);

            expect(opfs.sessions.has(OPFS_ID)).toBe(false);
            expect(opfs.manifest.find(s => s.path === OPFS_ID)).toBeUndefined();
            expect(composite.getSessionLocation(OPFS_ID).type).toBe(StorageBackendType.OPFS); // default
        });

        it('deletes a native session: drops the OPFS registry entry but keeps the files on disk', async () => {
            await seedNativeSession(NATIVE_ID, NATIVE_DIR, 'Native');
            await composite.initialize();
            const filesBefore = [...fsStore.files.keys()].filter(p => p.startsWith(`${NATIVE_DIR}/`)).sort();
            expect(filesBefore.length).toBeGreaterThan(0);

            await composite.deleteSession(NATIVE_ID);

            // The session is unregistered (gone from the manifest and the location map)...
            expect(opfs.manifest.find(s => s.path === NATIVE_ID)).toBeUndefined();
            expect(composite.getSessionLocation(NATIVE_ID).type).toBe(StorageBackendType.OPFS); // default for unknown
            // ...but its user-owned folder on disk is left intact.
            expect([...fsStore.files.keys()].filter(p => p.startsWith(`${NATIVE_DIR}/`)).sort()).toEqual(filesBefore);
        });

        it('deletes a native session whose folder is gone: drops the entry without resurrecting the folder', async () => {
            await seedNativeSession(NATIVE_ID, NATIVE_DIR, 'Native');
            await composite.initialize();

            // Simulate the user deleting the session's folder on disk out from under dashql — the
            // manifest still references it. Deleting must drop the stale entry and must NOT re-create
            // the folder (routing through the native backend's initialize() would mkdir it back).
            resetFsStore();

            await composite.deleteSession(NATIVE_ID);

            expect(opfs.manifest.find(s => s.path === NATIVE_ID)).toBeUndefined();
            expect(composite.getSessionLocation(NATIVE_ID).type).toBe(StorageBackendType.OPFS); // default for unknown
            // The folder was not resurrected as an empty directory.
            expect(fsStore.dirs.has(NATIVE_DIR)).toBe(false);
            expect([...fsStore.files.keys()].some(p => p.startsWith(`${NATIVE_DIR}/`))).toBe(false);
        });
    });

    describe('relocateSessionToNative', () => {
        async function seedFullOpfsSession(id: string): Promise<void> {
            await opfs.saveSessionManifest(id, sessionData(id, 'To Relocate'));
            await opfs.saveSessionSchema(id, '-- schema');
            await opfs.saveSessionFunctions(id, '-- functions');
            await opfs.createNotebookPage(id, 'page-1');
            await opfs.saveNotebookScript(id, 'page-1', '01-script.sql', 'SELECT 1;');
            await opfs.saveNotebookScript(id, 'page-1', '02-script.sql', 'SELECT 2;');
            await opfs.saveNotebookScriptDraft(id, '-- draft');
        }

        it('copies the session to disk, flips the entry, and deletes the OPFS copy', async () => {
            await seedFullOpfsSession(OPFS_ID);
            await composite.initialize();

            await composite.relocateSessionToNative(OPFS_ID, NATIVE_DIR);

            // Scope granted for the new directory.
            expect(grantSpy).toHaveBeenCalledWith(NATIVE_DIR);

            // Files now live on disk, directly in the directory.
            expect(fsStore.files.has(`${NATIVE_DIR}/dashql-session.json`)).toBe(true);
            expect(fsStore.files.get(`${NATIVE_DIR}/dashql-relations.sql`)).toBe('-- schema');
            expect(fsStore.files.has(`${NATIVE_DIR}/notebook/page-1/01-script.sql`)).toBe(true);

            // The OPFS copy of the files is gone, but the registry entry stays (now native).
            expect(opfs.sessions.has(OPFS_ID)).toBe(false);
            const entry = opfs.manifest.find(s => s.path === OPFS_ID);
            expect(entry?.storageType).toBe(StorageBackendType.Native);
            expect(entry?.nativePath).toBe(NATIVE_DIR);

            // The session now reads from the native directory, with its UUID preserved.
            expect(composite.getSessionLocation(OPFS_ID)).toEqual({
                type: StorageBackendType.Native,
                nativePath: NATIVE_DIR,
            });
            const loaded = await composite.loadSession(OPFS_ID);
            expect(loaded.sessionId).toBe(OPFS_ID);
            expect(loaded.storageType).toBe(StorageBackendType.Native);
            expect(loaded.nativePath).toBe(NATIVE_DIR);
        });

        it('throws when the session is already native (and leaves it intact)', async () => {
            await seedNativeSession(NATIVE_ID, NATIVE_DIR, 'Native');
            await composite.initialize();

            await expect(
                composite.relocateSessionToNative(NATIVE_ID, '/Users/test/another-dir')
            ).rejects.toThrow(/not an OPFS session/);
        });
    });

    describe('loadNativeSession', () => {
        /// Write a complete session into a directory on disk *without* registering it (as if a
        /// previous run left it there). Mirrors what the native backend persists for a real session.
        async function writeSessionToDir(id: string, dir: string, title: string): Promise<void> {
            const { NativeStorageBackend } = await import('./native_storage_backend.js');
            const nb = new NativeStorageBackend(dir);
            await nb.initialize();
            await nb.saveSessionManifest(id, sessionData(id, title, {
                storageType: StorageBackendType.Native,
                nativePath: dir,
            }));
            await nb.saveSessionSchema(id, '-- loaded schema');
            await nb.createNotebookPage(id, 'page-1');
            await nb.saveNotebookScript(id, 'page-1', '01-script.sql', 'SELECT 1;');
        }

        it('registers an existing on-disk session and routes to it, copying nothing', async () => {
            await writeSessionToDir(NATIVE_ID, NATIVE_DIR, 'Loaded');
            await composite.initialize();
            const filesBefore = fsStore.files.size;

            const loaded = await composite.loadNativeSession(NATIVE_DIR);

            expect(loaded).toBe(NATIVE_ID);
            // Scope was granted for the folder.
            expect(grantSpy).toHaveBeenCalledWith(NATIVE_DIR);
            // The manifest now carries a native entry pointing at the folder.
            const entry = opfs.manifest.find(s => s.path === NATIVE_ID);
            expect(entry?.storageType).toBe(StorageBackendType.Native);
            expect(entry?.nativePath).toBe(NATIVE_DIR);
            // Nothing was copied; the on-disk files are untouched.
            expect(fsStore.files.size).toBe(filesBefore);
            expect(opfs.sessions.has(NATIVE_ID)).toBe(false);
            // Reads now route to the folder.
            expect(composite.getSessionLocation(NATIVE_ID)).toEqual({
                type: StorageBackendType.Native,
                nativePath: NATIVE_DIR,
            });
            expect((await composite.loadSession(NATIVE_ID)).name).toBe('Loaded');
            expect(await composite.loadSessionSchema(NATIVE_ID)).toBe('-- loaded schema');
        });

        it('the loaded session survives a re-init from the manifest', async () => {
            await writeSessionToDir(NATIVE_ID, NATIVE_DIR, 'Loaded');
            await composite.initialize();
            await composite.loadNativeSession(NATIVE_DIR);

            // A fresh composite over the same OPFS manifest (i.e. an app reload) picks it up.
            const reloaded = new CompositeStorageBackend(opfs, logger);
            await reloaded.initialize();
            expect(reloaded.getSessionLocation(NATIVE_ID).type).toBe(StorageBackendType.Native);
            expect((await reloaded.loadSession(NATIVE_ID)).name).toBe('Loaded');
        });

        it('throws when the folder holds no session', async () => {
            await composite.initialize();
            await expect(
                composite.loadNativeSession('/Users/test/empty-dir')
            ).rejects.toThrow(/No dashql session found/);
            expect(opfs.manifest).toHaveLength(0);
        });

        it('throws when the session metadata is invalid', async () => {
            const { NativeStorageBackend } = await import('./native_storage_backend.js');
            const nb = new NativeStorageBackend(NATIVE_DIR);
            await nb.initialize();
            // A session file whose id is not a valid UUID is refused by the validation gate.
            await nb.saveSessionManifest('bad', sessionData('not-a-uuid', 'Bad'));

            await composite.initialize();
            await expect(
                composite.loadNativeSession(NATIVE_DIR)
            ).rejects.toThrow(/is invalid/);
            expect(opfs.manifest).toHaveLength(0);
        });

        it('throws when a session with the same id is already registered', async () => {
            await writeSessionToDir(NATIVE_ID, NATIVE_DIR, 'Loaded');
            await composite.initialize();
            await composite.loadNativeSession(NATIVE_DIR);

            await expect(
                composite.loadNativeSession(NATIVE_DIR)
            ).rejects.toThrow(/already registered/);
        });
    });
});
