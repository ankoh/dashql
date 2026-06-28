import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SessionData } from './storage_backend.js';

// In-memory filesystem shared with the plugin-fs mock. Hoisted so the vi.mock factory can use it.
const fsStore = vi.hoisted(() => ({
    files: new Map<string, string>(),
    dirs: new Set<string>(),
}));

vi.mock('@tauri-apps/api/path', () => ({
    // OS path join - tests use "/" separators for simplicity.
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
            if (!files.has(p)) {
                throw new Error(`File not found: ${p}`);
            }
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
import { NativeStorageBackend } from './native_storage_backend.js';

// The directory that backs the single session under test. Files land *directly* here.
const DIR = '/Users/test/my-session';
// The session UUID is opaque routing context - it does not affect the on-disk layout.
const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('NativeStorageBackend (one-dir-one-session)', () => {
    let backend: NativeStorageBackend;

    beforeEach(async () => {
        fsStore.files.clear();
        fsStore.dirs.clear();
        backend = new NativeStorageBackend(DIR);
        await backend.initialize();
    });

    describe('Registry-level ops are inert (owned by OPFS)', () => {
        it('listSessions returns an empty array', async () => {
            expect(await backend.listSessions('ignored')).toEqual([]);
        });

        it('loadAppSettings returns null', async () => {
            expect(await backend.loadAppSettings()).toBeNull();
        });

        it('saveAppSettings is a no-op that does not write files', async () => {
            await backend.saveAppSettings({ someFlag: true } as any);
            expect(fsStore.files.size).toBe(0);
        });

        it('exposes the backing directory and the native backend type', () => {
            expect(backend.getDir()).toBe(DIR);
            expect(backend.getBackendType()).toBe('native');
        });
    });

    describe('Session manifest', () => {
        it('saves and loads a session, writing the manifest directly in the directory', async () => {
            const sessionData: SessionData = {
                sessionId: SID,
                title: 'Test Session',
                connectionParams: { dataless: {} },
                notebook: {
                    originalFileName: 'test.sql',
                    createdAt: '2024-01-01T00:00:00Z',
                },
            };

            await backend.saveSessionManifest(SID, sessionData);

            const loaded = await backend.loadSession(SID);
            expect(loaded).toEqual(sessionData);
            // The file lands directly under the directory - no sessions/<uuid> nesting.
            expect(fsStore.files.has(`${DIR}/dashql-session.json`)).toBe(true);
            expect(fsStore.files.has(`${DIR}/sessions/${SID}/dashql-session.json`)).toBe(false);
        });

        it('overwrites the manifest in place on re-save', async () => {
            const make = (title: string): SessionData => ({
                sessionId: SID,
                title,
                connectionParams: { dataless: {} },
                notebook: {},
            });
            await backend.saveSessionManifest(SID, make('First'));
            await backend.saveSessionManifest(SID, make('Second'));

            const loaded = await backend.loadSession(SID);
            expect(loaded.title).toBe('Second');
            // Only one manifest file ever exists.
            expect([...fsStore.files.keys()].filter(p => p.endsWith('dashql-session.json'))).toHaveLength(1);
        });
    });

    describe('Schema and Functions', () => {
        it('saves and loads schema SQL directly in the directory', async () => {
            await backend.saveSessionSchema(SID, 'CREATE TABLE t(a int);');
            expect(await backend.loadSessionSchema(SID)).toBe('CREATE TABLE t(a int);');
            expect(fsStore.files.has(`${DIR}/dashql-relations.sql`)).toBe(true);
        });

        it('returns null for missing schema', async () => {
            expect(await backend.loadSessionSchema(SID)).toBeNull();
        });

        it('saves and loads functions SQL directly in the directory', async () => {
            await backend.saveSessionFunctions(SID, 'CREATE FUNCTION f() ...;');
            expect(await backend.loadSessionFunctions(SID)).toBe('CREATE FUNCTION f() ...;');
            expect(fsStore.files.has(`${DIR}/dashql-functions.sql`)).toBe(true);
        });

        it('returns null for missing functions', async () => {
            expect(await backend.loadSessionFunctions(SID)).toBeNull();
        });
    });

    describe('Notebook Pages', () => {
        it('creates notebook pages under the notebook folder', async () => {
            await backend.createNotebookPage(SID, 'page-1');
            await backend.createNotebookPage(SID, 'page-2');

            const pages = await backend.loadNotebookPages(SID);
            expect(pages).toHaveLength(2);
            expect(pages[0].name).toBe('page-1');
            expect(pages[1].name).toBe('page-2');
            expect(fsStore.dirs.has(`${DIR}/notebook/page-1`)).toBe(true);
        });

        it('deletes a notebook page', async () => {
            await backend.createNotebookPage(SID, 'page-1');
            await backend.createNotebookPage(SID, 'page-2');

            await backend.deleteNotebookPage(SID, 'page-1');

            const pages = await backend.loadNotebookPages(SID);
            expect(pages).toHaveLength(1);
            expect(pages[0].name).toBe('page-2');
        });

        it('returns pages with natural sort (page-1 < page-2 < page-10)', async () => {
            await backend.createNotebookPage(SID, 'page-10');
            await backend.createNotebookPage(SID, 'page-2');
            await backend.createNotebookPage(SID, 'page-1');

            const pages = await backend.loadNotebookPages(SID);
            expect(pages.map(p => p.name)).toEqual(['page-1', 'page-2', 'page-10']);
        });

        it('returns an empty array when the notebook folder does not exist', async () => {
            expect(await backend.loadNotebookPages(SID)).toEqual([]);
        });
    });

    describe('Notebook Scripts', () => {
        beforeEach(async () => {
            await backend.createNotebookPage(SID, 'page-1');
        });

        it('saves and loads a script', async () => {
            const sql = 'SELECT * FROM users;';
            await backend.saveNotebookScript(SID, 'page-1', '01-script.sql', sql);

            const script = await backend.loadNotebookScript(SID, 'page-1', '01-script.sql');
            expect(script.name).toBe('01-script.sql');
            expect(script.sql).toBe(sql);
            expect(fsStore.files.has(`${DIR}/notebook/page-1/01-script.sql`)).toBe(true);
        });

        it('throws when loading a non-existent script', async () => {
            await expect(
                backend.loadNotebookScript(SID, 'page-1', '99-nonexistent.sql')
            ).rejects.toThrow('Script not found');
        });

        it('deletes a script', async () => {
            await backend.saveNotebookScript(SID, 'page-1', '01-script.sql', 'SELECT 1;');
            await backend.deleteNotebookScript(SID, 'page-1', '01-script.sql');

            await expect(
                backend.loadNotebookScript(SID, 'page-1', '01-script.sql')
            ).rejects.toThrow('Script not found');
        });

        it('returns scripts with natural sort (01- < 02- < 10-)', async () => {
            await backend.saveNotebookScript(SID, 'page-1', '10-script.sql', 'SELECT 10;');
            await backend.saveNotebookScript(SID, 'page-1', '02-script.sql', 'SELECT 2;');
            await backend.saveNotebookScript(SID, 'page-1', '01-script.sql', 'SELECT 1;');

            const pages = await backend.loadNotebookPages(SID);
            expect(pages[0].scripts.map(s => s.name)).toEqual(['01-script.sql', '02-script.sql', '10-script.sql']);
        });
    });

    describe('Script Draft', () => {
        it('saves and loads the draft script', async () => {
            await backend.saveNotebookScriptDraft(SID, 'SELECT * FROM draft;');
            expect(await backend.loadNotebookScriptDraft(SID)).toBe('SELECT * FROM draft;');
        });

        it('returns null when the draft does not exist', async () => {
            expect(await backend.loadNotebookScriptDraft(SID)).toBeNull();
        });

        it('overwrites an existing draft', async () => {
            await backend.saveNotebookScriptDraft(SID, 'SELECT 1;');
            await backend.saveNotebookScriptDraft(SID, 'SELECT 2;');
            expect(await backend.loadNotebookScriptDraft(SID)).toBe('SELECT 2;');
        });

        it('does not return the draft as a page script', async () => {
            await backend.createNotebookPage(SID, 'page-1');
            await backend.saveNotebookScript(SID, 'page-1', '01-script.sql', 'SELECT 1;');
            await backend.saveNotebookScriptDraft(SID, 'SELECT draft;');

            const pages = await backend.loadNotebookPages(SID);
            expect(pages[0].scripts.map(s => s.name)).toEqual(['01-script.sql']);
        });
    });

    describe('Script Reordering', () => {
        beforeEach(async () => {
            await backend.createNotebookPage(SID, 'page-1');
        });

        it('reorders scripts within a page', async () => {
            await backend.saveNotebookScript(SID, 'page-1', '01-script.sql', 'SELECT 1;');
            await backend.saveNotebookScript(SID, 'page-1', '02-script.sql', 'SELECT 2;');
            await backend.saveNotebookScript(SID, 'page-1', '03-script.sql', 'SELECT 3;');

            // Move script 3 to position 1 (scripts 3, 1, 2)
            await backend.reorderNotebookScript(SID, 'page-1', ['03-script.sql', '01-script.sql', '02-script.sql']);

            const pages = await backend.loadNotebookPages(SID);
            expect(pages[0].scripts.map(s => s.sql)).toEqual(['SELECT 3;', 'SELECT 1;', 'SELECT 2;']);
        });
    });

    describe('deleteSession / clearAllStorage', () => {
        async function seed(): Promise<void> {
            await backend.saveSessionManifest(SID, {
                sessionId: SID,
                title: 'Test Session',
                connectionParams: { dataless: {} },
                notebook: {},
            });
            await backend.createNotebookPage(SID, 'page-1');
            await backend.saveNotebookScript(SID, 'page-1', '01-script.sql', 'SELECT 1;');
        }

        it('deleteSession removes the whole directory', async () => {
            await seed();
            await backend.deleteSession(SID);
            expect([...fsStore.files.keys()].filter(p => p.startsWith(`${DIR}/`))).toEqual([]);
        });

        it('clearAllStorage removes the whole directory', async () => {
            await seed();
            await backend.clearAllStorage();
            expect([...fsStore.files.keys()].filter(p => p.startsWith(`${DIR}/`))).toEqual([]);
        });

        it('deleteSession on an already-empty directory does not throw', async () => {
            await expect(backend.deleteSession(SID)).resolves.toBeUndefined();
        });
    });
});
