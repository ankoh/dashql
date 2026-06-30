import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SessionData } from './storage_backend.js';

// The plugin-fs mock is backed by a *shared* in-memory store (see test_fs_mock.ts). It must be
// shared with composite_storage_backend.test.ts because the app runs vitest with `isolate: false`:
// when both files land on the same worker, the real native_storage_backend.ts is imported once and
// bound to whichever file's mock loaded first, so a per-file store would be read/written by the
// other file's backend. The factories use async `import()` so both files resolve the same singleton.
vi.mock('@tauri-apps/api/path', async () => (await import('./test_fs_mock.js')).makePathMock());
vi.mock('@tauri-apps/plugin-fs', async () => (await import('./test_fs_mock.js')).makeFsMock());

// Import after the mocks are registered.
import { fsStore, resetFsStore } from './test_fs_mock.js';
import { NativeStorageBackend } from './native_storage_backend.js';

// The directory that backs the single session under test. Files land *directly* here.
const DIR = '/Users/test/my-session';
// The session UUID is opaque routing context - it does not affect the on-disk layout.
const SID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

describe('NativeStorageBackend (one-dir-one-session)', () => {
    let backend: NativeStorageBackend;

    beforeEach(async () => {
        resetFsStore();
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

        it('deleteSession leaves the user-owned folder on disk untouched', async () => {
            await seed();
            const before = [...fsStore.files.keys()].filter(p => p.startsWith(`${DIR}/`)).sort();
            expect(before.length).toBeGreaterThan(0);

            await backend.deleteSession(SID);

            // Deleting a native session only unregisters it (handled by the composite via the OPFS
            // manifest); the files on disk are deliberately preserved.
            const after = [...fsStore.files.keys()].filter(p => p.startsWith(`${DIR}/`)).sort();
            expect(after).toEqual(before);
        });

        it('clearAllStorage leaves the user-owned folder on disk untouched', async () => {
            await seed();
            const before = [...fsStore.files.keys()].filter(p => p.startsWith(`${DIR}/`)).sort();
            expect(before.length).toBeGreaterThan(0);

            await backend.clearAllStorage();

            const after = [...fsStore.files.keys()].filter(p => p.startsWith(`${DIR}/`)).sort();
            expect(after).toEqual(before);
        });

        it('deleteSession on an already-empty directory does not throw', async () => {
            await expect(backend.deleteSession(SID)).resolves.toBeUndefined();
        });
    });
});
