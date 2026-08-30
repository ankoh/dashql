import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { OPFSStorageBackend } from './opfs_storage_backend.js';
import type { NotebookData } from './storage_backend.js';
import { STORAGE_MANIFEST_FILE, STORAGE_NOTEBOOK_FILE, STORAGE_NOTEBOOK_INDEX_FILE, STORAGE_SCRIPTS_FOLDER, STORAGE_SCRIPT_DRAFT } from './storage_backend.js';

/// When true, mock file handles expose a `move()` method (as Chromium does); when false they don't,
/// so the OPFS backend takes its copy+delete fallback (the WKWebView/Firefox path). Default false so
/// the bulk of the suite exercises the conservative fallback; the move()-path test flips it on.
let MOCK_SUPPORTS_MOVE = false;
/// Count of move() invocations, so a test can assert the native path was actually taken.
let mockMoveCalls = 0;

class MockFileSystemFileHandle {
    public kind = 'file' as const;

    constructor(
        public name: string,
        private storage: Map<string, string>,
        private structure: Map<string, Set<string>>,
        private parentPath: string
    ) {
        // Define move() as an own property only when enabled, so `typeof handle.move === 'function'`
        // (the feature check in the backend) reflects the simulated browser. It delegates to the
        // private doMove(); naming them differently avoids the own-property shadowing the method and
        // recursing into itself.
        if (MOCK_SUPPORTS_MOVE) {
            (this as any).move = (arg1: MockFileSystemDirectoryHandle | string, arg2?: string) =>
                this.doMove(arg1, arg2);
        }
    }

    async getFile(): Promise<File> {
        const content = this.storage.get(this.name) || '';
        return new File([content], this.name, { type: 'text/plain' });
    }

    async createWritable(): Promise<MockFileSystemWritableFileStream> {
        return new MockFileSystemWritableFileStream(this.name, this.storage, this.structure, this.parentPath);
    }

    /// Mirror FileSystemFileHandle.move(): move(newName) renames in place; move(destDir, newName)
    /// relocates across directories. Re-keys this file in the shared storage/structure maps.
    private async doMove(arg1: MockFileSystemDirectoryHandle | string, arg2?: string): Promise<void> {
        mockMoveCalls += 1;
        const destDirPath = typeof arg1 === 'string' ? this.parentPath : (arg1 as any).name as string;
        const destName = typeof arg1 === 'string' ? arg1 : arg2!;
        const oldFull = this.name;
        const newFull = destDirPath ? `${destDirPath}/${destName}` : destName;

        const content = this.storage.get(oldFull) ?? '';
        this.storage.delete(oldFull);
        this.storage.set(newFull, content);

        const oldName = oldFull.substring(this.parentPath.length + (this.parentPath ? 1 : 0));
        this.structure.get(this.parentPath)?.delete(oldName);
        const destChildren = this.structure.get(destDirPath) ?? new Set();
        destChildren.add(destName);
        this.structure.set(destDirPath, destChildren);

        this.name = newFull;
        this.parentPath = destDirPath;
    }
}

class MockFileSystemWritableFileStream {
    constructor(
        private name: string,
        private storage: Map<string, string>,
        private structure: Map<string, Set<string>>,
        private parentPath: string
    ) { }

    async write(data: string | Blob): Promise<void> {
        // The backend normally writes SQL strings, but the OPFS rename fallback (used when
        // FileSystemFileHandle.move() is unavailable, e.g. WKWebView) streams a File/Blob; accept both.
        const text = typeof data === 'string' ? data : await data.text();
        this.storage.set(this.name, text);
        // Add file to parent's structure
        const fileName = this.name.substring(this.parentPath.length + (this.parentPath ? 1 : 0));
        const children = this.structure.get(this.parentPath) || new Set();
        children.add(fileName);
        this.structure.set(this.parentPath, children);
    }

    async close(): Promise<void> {
        // No-op
    }
}

class MockFileSystemDirectoryHandle {
    public kind = 'directory' as const;

    constructor(
        public name: string,
        private storage: Map<string, string>,
        private structure: Map<string, Set<string>>
    ) { }

    async getFileHandle(name: string, options?: { create?: boolean }): Promise<MockFileSystemFileHandle> {
        const fullPath = this.getFullPath(name);
        if (!this.storage.has(fullPath) && !options?.create) {
            const error: any = new Error(`File not found: ${name}`);
            error.name = 'NotFoundError';
            throw error;
        }
        if (options?.create) {
            this.addToStructure(name);
        }
        return new MockFileSystemFileHandle(fullPath, this.storage, this.structure, this.name);
    }

    async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MockFileSystemDirectoryHandle> {
        const fullPath = this.getFullPath(name);
        const children = this.structure.get(this.name) || new Set();
        const dirKey = name + '/';

        if (!children.has(dirKey) && !options?.create) {
            // Match the real OPFS API, which throws a NotFoundError DOMException (the backend
            // distinguishes it by `error.name`, e.g. to no-op a rename of a never-flushed page).
            const error: any = new Error(`Directory not found: ${name}`);
            error.name = 'NotFoundError';
            throw error;
        }

        if (options?.create) {
            this.addToStructure(dirKey);
        }
        return new MockFileSystemDirectoryHandle(fullPath, this.storage, this.structure);
    }

    async removeEntry(name: string, options?: { recursive?: boolean }): Promise<void> {
        const fullPath = this.getFullPath(name);

        // Remove from structure
        const children = this.structure.get(this.name) || new Set();
        children.delete(name);
        children.delete(name + '/');

        // Remove all files/directories under this path
        const keysToRemove: string[] = [];
        for (const key of this.storage.keys()) {
            if (key === fullPath || key.startsWith(fullPath + '/')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => this.storage.delete(key));

        // Remove from structure
        const structureKeysToRemove: string[] = [];
        for (const key of this.structure.keys()) {
            if (key === fullPath || key.startsWith(fullPath + '/')) {
                structureKeysToRemove.push(key);
            }
        }
        structureKeysToRemove.forEach(key => this.structure.delete(key));
    }

    async *entries(): AsyncIterableIterator<[string, MockFileSystemFileHandle | MockFileSystemDirectoryHandle]> {
        const children = this.structure.get(this.name) || new Set();
        for (const child of children) {
            if (child.endsWith('/')) {
                const dirName = child.slice(0, -1);
                yield [dirName, await this.getDirectoryHandle(dirName)];
            } else {
                yield [child, await this.getFileHandle(child)];
            }
        }
    }

    private getFullPath(name: string): string {
        return this.name ? `${this.name}/${name}` : name;
    }

    private addToStructure(name: string): void {
        const children = this.structure.get(this.name) || new Set();
        children.add(name);
        this.structure.set(this.name, children);
    }
}

describe('OPFSStorageBackend', () => {
    let backend: OPFSStorageBackend;
    let storage: Map<string, string>;
    let structure: Map<string, Set<string>>;
    let mockRoot: MockFileSystemDirectoryHandle;

    beforeEach(async () => {
        storage = new Map();
        structure = new Map();
        mockRoot = new MockFileSystemDirectoryHandle('', storage, structure);

        // Mock navigator.storage.getDirectory()
        const mockNavigator = {
            storage: {
                getDirectory: vi.fn(async () => mockRoot),
            },
        };
        vi.stubGlobal('navigator', mockNavigator);

        backend = new OPFSStorageBackend();
        await backend.initialize();
    });

    describe('Notebook Management', () => {
        it('writes notebook metadata and scripts to the UUID-based notebook layout only', async () => {
            const notebookId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
            const notebookData: NotebookData = {
                notebookId,
                name: 'Layout Contract',
                connectionParams: { hyper: {} } as any,
                metadata: {},
            };

            await backend.saveNotebookManifest(notebookId, notebookData);
            await backend.saveScript(notebookId, '1_main', '1_query.sql', 'SELECT 1;');

            expect(storage.get('notebooks/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/dashql-notebook.json'))
                .toBe(JSON.stringify(notebookData, null, 2));
            expect(storage.get('notebooks/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/scripts/1_main/1_query.sql'))
                .toBe('SELECT 1;');
            expect(JSON.parse(storage.get(`notebooks/${notebookId}/${STORAGE_NOTEBOOK_INDEX_FILE}`)!)).toEqual({
                folders: [{ name: '1_main', scripts: [{ name: '1_query.sql' }] }],
            });
            expect(storage.has('sessions/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/dashql-session.json')).toBe(false);
            expect(storage.has('sessions/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/notebook/1_main/1_query.sql')).toBe(false);
        });

        it('lists notebooks from manifest file', async () => {
            const manifest = {
                notebooks: [
                    { title: 'Notebook 1', path: 'notebook-1' },
                    { title: 'Notebook 2', path: 'notebook-2' }
                ]
            };
            storage.set(STORAGE_MANIFEST_FILE, JSON.stringify(manifest));
            structure.set('', new Set([STORAGE_MANIFEST_FILE]));

            const notebooks = await backend.listNotebooks(STORAGE_MANIFEST_FILE);
            expect(notebooks).toEqual([
                { title: 'Notebook 1', path: 'notebook-1' },
                { title: 'Notebook 2', path: 'notebook-2' }
            ]);
        });

        it('returns empty array when manifest does not exist', async () => {
            const notebooks = await backend.listNotebooks(STORAGE_MANIFEST_FILE);
            expect(notebooks).toEqual([]);
        });

        it('resets the obsolete session manifest without importing its entries', async () => {
            storage.set(STORAGE_MANIFEST_FILE, JSON.stringify({
                sessions: [{ path: 'old-session' }],
                appSettings: { aiProvider: { model: 'test-model' } },
            }));
            structure.set('', new Set([STORAGE_MANIFEST_FILE]));

            await backend.initialize();

            expect(await backend.listNotebooks(STORAGE_MANIFEST_FILE)).toEqual([]);
            expect(await backend.loadAppSettings()).toEqual({ aiProvider: { model: 'test-model' } });
            expect(JSON.parse(storage.get(STORAGE_MANIFEST_FILE)!)).toEqual({
                notebooks: [],
                appSettings: { aiProvider: { model: 'test-model' } },
            });
        });

        it('still rejects unrelated malformed manifests', async () => {
            storage.set(STORAGE_MANIFEST_FILE, JSON.stringify({ unexpected: [] }));
            structure.set('', new Set([STORAGE_MANIFEST_FILE]));

            await expect(backend.listNotebooks(STORAGE_MANIFEST_FILE))
                .rejects.toThrow('Invalid manifest format: notebooks must be an array');
        });

        it('saves and loads a notebook', async () => {
            const notebookData: NotebookData = {
                notebookId: crypto.randomUUID(),
                notebookPath: 'test-notebook',
                name: 'Test Notebook',
                connectionParams: { hyper: {} } as any,
                metadata: {
                    originalFileName: 'test.sql',
                    createdAt: '2024-01-01T00:00:00Z',
                },
            };

            await backend.saveNotebookManifest('test-notebook', notebookData);

            const loaded = await backend.loadNotebook('test-notebook');
            expect(loaded).toEqual(notebookData);
        });

        it('updates manifest when saving notebook', async () => {
            const notebookData: NotebookData = {
                notebookId: crypto.randomUUID(),
                notebookPath: 'test-notebook',
                name: 'Test Notebook',
                connectionParams: { hyper: {} } as any,
                metadata: {},
            };

            await backend.saveNotebookManifest('test-notebook', notebookData);

            const notebooks = await backend.listNotebooks(STORAGE_MANIFEST_FILE);
            expect(notebooks.some(s => s.path === 'test-notebook')).toBe(true);
        });

        it('deletes a notebook and updates manifest', async () => {
            const notebookData: NotebookData = {
                notebookId: crypto.randomUUID(),
                notebookPath: 'test-notebook',
                name: 'Test Notebook',
                connectionParams: { hyper: {} } as any,
                metadata: {},
            };

            await backend.saveNotebookManifest('test-notebook', notebookData);
            const notebooksAfterSave = await backend.listNotebooks(STORAGE_MANIFEST_FILE);
            expect(notebooksAfterSave.some(s => s.path === 'test-notebook')).toBe(true);

            await backend.deleteNotebook('test-notebook');
            const notebooksAfterDelete = await backend.listNotebooks(STORAGE_MANIFEST_FILE);
            expect(notebooksAfterDelete.some(s => s.path === 'test-notebook')).toBe(false);
        });

        it('does not duplicate notebooks in manifest', async () => {
            const notebookData: NotebookData = {
                notebookId: crypto.randomUUID(),
                notebookPath: 'test-notebook',
                name: 'Test Notebook',
                connectionParams: { hyper: {} } as any,
                metadata: {},
            };

            await backend.saveNotebookManifest('test-notebook', notebookData);
            await backend.saveNotebookManifest('test-notebook', notebookData);

            const notebooks = await backend.listNotebooks(STORAGE_MANIFEST_FILE);
            const count = notebooks.filter(s => s.path === 'test-notebook').length;
            expect(count).toBe(1);
        });
    });

    describe('Script Folders', () => {
        beforeEach(async () => {
            const notebookData: NotebookData = {
                notebookId: crypto.randomUUID(),
                notebookPath: 'test-notebook',
                name: 'Test Notebook',
                connectionParams: { hyper: {} } as any,
                metadata: {},
            };
            await backend.saveNotebookManifest('test-notebook', notebookData);
        });

        it('backfills a missing index without overwriting an existing one', async () => {
            await backend.createScriptFolder('test-notebook', 'page-1');
            await backend.saveScript('test-notebook', 'page-1', '01-script.sql', 'SELECT 1;');
            const indexPath = `notebooks/test-notebook/${STORAGE_NOTEBOOK_INDEX_FILE}`;
            storage.delete(indexPath);
            structure.get('notebooks/test-notebook')?.delete(STORAGE_NOTEBOOK_INDEX_FILE);

            await backend.ensureNotebookIndex('test-notebook');
            expect(JSON.parse(storage.get(indexPath)!)).toEqual({
                folders: [{ name: 'page-1', scripts: [{ name: '01-script.sql' }] }],
            });

            storage.set(indexPath, 'keep-me');
            await backend.ensureNotebookIndex('test-notebook');
            expect(storage.get(indexPath)).toBe('keep-me');
        });

        it('creates script folders', async () => {
            await backend.createScriptFolder('test-notebook', 'page-1');
            await backend.createScriptFolder('test-notebook', 'page-2');

            const pages = await backend.loadScriptFolders('test-notebook');
            expect(pages).toHaveLength(2);
            expect(pages[0].name).toBe('page-1');
            expect(pages[1].name).toBe('page-2');
        });

        it('deletes script folder', async () => {
            await backend.createScriptFolder('test-notebook', 'page-1');
            await backend.createScriptFolder('test-notebook', 'page-2');

            await backend.deleteScriptFolder('test-notebook', 'page-1');

            const pages = await backend.loadScriptFolders('test-notebook');
            expect(pages).toHaveLength(1);
            expect(pages[0].name).toBe('page-2');
        });

        it('returns pages sorted by name', async () => {
            await backend.createScriptFolder('test-notebook', 'page-3');
            await backend.createScriptFolder('test-notebook', 'page-1');
            await backend.createScriptFolder('test-notebook', 'page-2');

            const pages = await backend.loadScriptFolders('test-notebook');
            expect(pages.map(p => p.name)).toEqual(['page-1', 'page-2', 'page-3']);
        });

        // The mock file handle has no move(), so these renames exercise the copy+delete fallback —
        // the same path dashql takes in WKWebView, where FileSystemFileHandle.move() is unavailable.
        it('renames a page, carrying its scripts across unchanged', async () => {
            await backend.createScriptFolder('test-notebook', '1_old');
            await backend.saveScript('test-notebook', '1_old', '1_a.sql', 'SELECT 1;');
            await backend.saveScript('test-notebook', '1_old', '2_b.sql', 'SELECT 2;');

            await backend.renameScriptFolder('test-notebook', '1_old', '1_new');

            const pages = await backend.loadScriptFolders('test-notebook');
            expect(pages.map(p => p.name)).toEqual(['1_new']);
            expect(pages[0].scripts.map(s => s.name)).toEqual(['1_a.sql', '2_b.sql']);
            expect(pages[0].scripts.map(s => s.sql)).toEqual(['SELECT 1;', 'SELECT 2;']);
        });

        it('renaming a never-flushed page is a no-op (nothing on disk to move)', async () => {
            await backend.renameScriptFolder('test-notebook', '1_ghost', '1_new');
            expect(await backend.loadScriptFolders('test-notebook')).toEqual([]);
        });
    });

    describe('Scripts', () => {
        beforeEach(async () => {
            const notebookData: NotebookData = {
                notebookId: crypto.randomUUID(),
                notebookPath: 'test-notebook',
                name: 'Test Notebook',
                connectionParams: { hyper: {} } as any,
                metadata: {},
            };
            await backend.saveNotebookManifest('test-notebook', notebookData);
            await backend.createScriptFolder('test-notebook', 'page-1');
        });

        it('saves and loads a script', async () => {
            const sql = 'SELECT * FROM users;';
            await backend.saveScript('test-notebook', 'page-1', '01-script.sql', sql);

            const script = await backend.loadScript('test-notebook', 'page-1', '01-script.sql');
            expect(script.name).toBe('01-script.sql');
            expect(script.sql).toBe(sql);
        });

        it('throws error when loading non-existent script', async () => {
            await expect(
                backend.loadScript('test-notebook', 'page-1', '99-nonexistent.sql')
            ).rejects.toThrow('Script not found');
        });

        it('deletes a script', async () => {
            await backend.saveScript('test-notebook', 'page-1', '01-script.sql', 'SELECT 1;');
            await backend.deleteScript('test-notebook', 'page-1', '01-script.sql');

            await expect(
                backend.loadScript('test-notebook', 'page-1', '01-script.sql')
            ).rejects.toThrow('Script not found');
        });

        it('loads scripts with page', async () => {
            await backend.saveScript('test-notebook', 'page-1', '01-script.sql', 'SELECT 1;');
            await backend.saveScript('test-notebook', 'page-1', '02-script.sql', 'SELECT 2;');

            const pages = await backend.loadScriptFolders('test-notebook');
            expect(pages[0].scripts).toHaveLength(2);
            expect(pages[0].scripts[0].sql).toBe('SELECT 1;');
            expect(pages[0].scripts[1].sql).toBe('SELECT 2;');
        });

        it('returns scripts sorted by name', async () => {
            await backend.saveScript('test-notebook', 'page-1', '03-script.sql', 'SELECT 3;');
            await backend.saveScript('test-notebook', 'page-1', '01-script.sql', 'SELECT 1;');
            await backend.saveScript('test-notebook', 'page-1', '02-script.sql', 'SELECT 2;');

            const pages = await backend.loadScriptFolders('test-notebook');
            expect(pages[0].scripts.map(s => s.name)).toEqual(['01-script.sql', '02-script.sql', '03-script.sql']);
        });

        it('renames a script in place, preserving its contents (copy+delete fallback)', async () => {
            await backend.saveScript('test-notebook', 'page-1', '1_old.sql', 'SELECT 42;');

            await backend.renameScript('test-notebook', 'page-1', '1_old.sql', '1_new.sql');

            await expect(
                backend.loadScript('test-notebook', 'page-1', '1_old.sql')
            ).rejects.toThrow('Script not found');
            const moved = await backend.loadScript('test-notebook', 'page-1', '1_new.sql');
            expect(moved.sql).toBe('SELECT 42;');
        });

        it('renaming a never-flushed script is a no-op', async () => {
            await backend.renameScript('test-notebook', 'page-1', '1_ghost.sql', '1_new.sql');
            const pages = await backend.loadScriptFolders('test-notebook');
            expect(pages[0].scripts).toEqual([]);
        });

        it('renaming a script in a never-flushed notebook is a no-op', async () => {
            // A notebook whose folder was never written to disk (e.g. a fresh notebook renamed before its
            // first flush). getNotebookDir re-wraps the OPFS NotFoundError into a generic "Directory not
            // found" Error, so the no-op guard must recognise that too — otherwise this throws.
            await backend.renameScript('never-flushed-notebook', 'page-1', '1_old.sql', '1_new.sql');
        });

        // Covers the primary (Chromium) path where FileSystemFileHandle.move() exists, rather than the
        // copy+delete fallback every other test exercises.
        describe('with native FileSystemFileHandle.move()', () => {
            beforeEach(() => { MOCK_SUPPORTS_MOVE = true; mockMoveCalls = 0; });
            afterEach(() => { MOCK_SUPPORTS_MOVE = false; });

            it('renames a script via move() (no copy+delete)', async () => {
                await backend.saveScript('test-notebook', 'page-1', '1_old.sql', 'SELECT 42;');

                await backend.renameScript('test-notebook', 'page-1', '1_old.sql', '1_new.sql');

                expect(mockMoveCalls).toBe(1);
                await expect(
                    backend.loadScript('test-notebook', 'page-1', '1_old.sql')
                ).rejects.toThrow('Script not found');
                expect((await backend.loadScript('test-notebook', 'page-1', '1_new.sql')).sql).toBe('SELECT 42;');
            });

            it('renames a page by moving each file across directories via move()', async () => {
                await backend.saveScript('test-notebook', '1_old', '1_a.sql', 'SELECT 1;');
                await backend.saveScript('test-notebook', '1_old', '2_b.sql', 'SELECT 2;');

                await backend.renameScriptFolder('test-notebook', '1_old', '1_new');

                expect(mockMoveCalls).toBe(2); // one cross-directory move per file
                // The describe's beforeEach seeds an empty `page-1`, so target the renamed page rather
                // than asserting the whole list: the old folder is gone and the new one holds both files.
                const pages = await backend.loadScriptFolders('test-notebook');
                expect(pages.map(p => p.name)).not.toContain('1_old');
                const moved = pages.find(p => p.name === '1_new');
                expect(moved).toBeDefined();
                expect(moved!.scripts.map(s => s.name)).toEqual(['1_a.sql', '2_b.sql']);
                expect(moved!.scripts.map(s => s.sql)).toEqual(['SELECT 1;', 'SELECT 2;']);
            });
        });
    });

    describe('Script Draft', () => {
        beforeEach(async () => {
            const notebookData: NotebookData = {
                notebookId: crypto.randomUUID(),
                notebookPath: 'test-notebook',
                name: 'Test Notebook',
                connectionParams: { hyper: {} } as any,
                metadata: {},
            };
            await backend.saveNotebookManifest('test-notebook', notebookData);
        });

        it('saves and loads draft script', async () => {
            const sql = 'SELECT * FROM draft;';
            await backend.saveScriptDraft('test-notebook', sql);

            const loaded = await backend.loadScriptDraft('test-notebook');
            expect(loaded).toBe(sql);
        });

        it('returns null when draft does not exist', async () => {
            const loaded = await backend.loadScriptDraft('test-notebook');
            expect(loaded).toBeNull();
        });

        it('overwrites existing draft', async () => {
            await backend.saveScriptDraft('test-notebook', 'SELECT 1;');
            await backend.saveScriptDraft('test-notebook', 'SELECT 2;');

            const loaded = await backend.loadScriptDraft('test-notebook');
            expect(loaded).toBe('SELECT 2;');
        });
    });

    describe('Page Reordering', () => {
        beforeEach(async () => {
            const notebookData: NotebookData = {
                notebookId: crypto.randomUUID(),
                notebookPath: 'test-notebook',
                name: 'Test Notebook',
                connectionParams: { hyper: {} } as any,
                metadata: {},
            };
            await backend.saveNotebookManifest('test-notebook', notebookData);
        });

        it.skip('reorders pages', async () => {
            // TODO: This test requires updating to use lexicographic page ordering
            // Pages are now sorted by name, not by numeric ID
            await backend.createScriptFolder('test-notebook', 'page-1');
            await backend.saveScript('test-notebook', 'page-1', '01-script.sql', 'Page 1 Script');

            await backend.createScriptFolder('test-notebook', 'page-2');
            await backend.saveScript('test-notebook', 'page-2', '01-script.sql', 'Page 2 Script');

            await backend.createScriptFolder('test-notebook', 'page-3');
            await backend.saveScript('test-notebook', 'page-3', '01-script.sql', 'Page 3 Script');

            // Pages are ordered lexicographically now - no reorder API needed
            const pages = await backend.loadScriptFolders('test-notebook');
            expect(pages).toHaveLength(3);
            expect(pages[0].scripts).toHaveLength(1);
            expect(pages[1].scripts).toHaveLength(1);
            expect(pages[2].scripts).toHaveLength(1);
            expect(pages.map(p => p.scripts[0].sql)).toEqual([
                'Page 3 Script',
                'Page 1 Script',
                'Page 2 Script',
            ]);
        });
    });

    describe('Error Handling', () => {
        it('throws error when not initialized', async () => {
            const uninitializedBackend = new OPFSStorageBackend();
            await expect(
                uninitializedBackend.listNotebooks(STORAGE_MANIFEST_FILE)
            ).rejects.toThrow('not initialized');
        });

        it('throws error when loading non-existent notebook', async () => {
            await expect(
                backend.loadNotebook('non-existent')
            ).rejects.toThrow();
        });

        it('throws error when loading pages from non-existent notebook', async () => {
            // loadScriptFolders will throw when trying to get the notebook directory that doesn't exist
            await expect(
                backend.loadScriptFolders('non-existent')
            ).rejects.toThrow();
        });
    });

    it('clears notebook and standalone shell OPFS data', async () => {
        await mockRoot.getDirectoryHandle('notebooks', { create: true });
        await mockRoot.getDirectoryHandle('dashql-shell', { create: true });

        await backend.clearAllStorage();

        await expect(mockRoot.getDirectoryHandle('notebooks')).rejects.toMatchObject({ name: 'NotFoundError' });
        await expect(mockRoot.getDirectoryHandle('dashql-shell')).rejects.toMatchObject({ name: 'NotFoundError' });
    });
});
