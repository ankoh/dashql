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

// In-memory filesystem shared with the plugin-fs mock so the *real* NativeStorageBackend works.
const fsStore = vi.hoisted(() => ({
    files: new Map<string, string>(),
    dirs: new Set<string>(),
}));

vi.mock('@tauri-apps/api/path', () => ({
    join: async (...parts: string[]) => parts.filter(p => p.length > 0).join('/'),
}));

vi.mock('@tauri-apps/plugin-fs', () => {
    const { files, dirs } = fsStore;
    const parentOf = (p: string) => {
        const i = p.lastIndexOf('/');
        return i < 0 ? '' : p.substring(0, i);
    };
    const nameOf = (p: string) => {
        const i = p.lastIndexOf('/');
        return i < 0 ? p : p.substring(i + 1);
    };
    const isAncestorDir = (p: string) => {
        for (const f of files.keys()) if (f.startsWith(p + '/')) return true;
        for (const d of dirs) if (d.startsWith(p + '/')) return true;
        return false;
    };
    return {
        exists: async (p: string) => files.has(p) || dirs.has(p) || isAncestorDir(p),
        mkdir: async (p: string) => {
            // Register the dir and all ancestors, preserving any leading slash (absolute paths)
            // the same way writeTextFile's parent walk does.
            dirs.add(p);
            let parent = parentOf(p);
            while (parent) {
                dirs.add(parent);
                parent = parentOf(parent);
            }
        },
        readDir: async (p: string) => {
            const children = new Map<string, { isFile: boolean; isDirectory: boolean }>();
            for (const f of files.keys()) {
                if (parentOf(f) === p) children.set(nameOf(f), { isFile: true, isDirectory: false });
            }
            for (const d of dirs) {
                if (parentOf(d) === p) children.set(nameOf(d), { isFile: false, isDirectory: true });
            }
            return [...children.entries()].map(([name, kind]) => ({
                name,
                isFile: kind.isFile,
                isDirectory: kind.isDirectory,
                isSymlink: false,
            }));
        },
        readTextFile: async (p: string) => {
            if (!files.has(p)) throw new Error(`File not found: ${p}`);
            return files.get(p)!;
        },
        writeTextFile: async (p: string, data: string) => {
            files.set(p, data);
            let parent = parentOf(p);
            while (parent) {
                dirs.add(parent);
                parent = parentOf(parent);
            }
        },
        remove: async (p: string, opts?: { recursive?: boolean }) => {
            files.delete(p);
            dirs.delete(p);
            if (opts?.recursive) {
                for (const f of [...files.keys()]) if (f.startsWith(p + '/')) files.delete(f);
                for (const d of [...dirs]) if (d.startsWith(p + '/')) dirs.delete(d);
            }
        },
    };
});

// Import after the mocks are registered.
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
    async reorderNotebookScript(): Promise<void> { /* not exercised */ }
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

function sessionData(id: string, title: string, extra: Partial<SessionData> = {}): SessionData {
    return { sessionId: id, title, connectionParams: { dataless: {} }, notebook: {}, ...extra };
}

describe('CompositeStorageBackend', () => {
    let opfs: MemoryRegistry;
    let composite: CompositeStorageBackend;
    let logger: TestLogger;

    beforeEach(() => {
        fsStore.files.clear();
        fsStore.dirs.clear();
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
            expect(loaded.title).toBe('Native');
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

        it('deletes a native session: removes the directory and the OPFS registry entry', async () => {
            await seedNativeSession(NATIVE_ID, NATIVE_DIR, 'Native');
            await composite.initialize();

            await composite.deleteSession(NATIVE_ID);

            expect([...fsStore.files.keys()].filter(p => p.startsWith(`${NATIVE_DIR}/`))).toEqual([]);
            expect(opfs.manifest.find(s => s.path === NATIVE_ID)).toBeUndefined();
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
});
