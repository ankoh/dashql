import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OPFSStorageBackend } from './opfs_storage_backend.js';
import type { SessionData } from './storage_backend.js';
import { STORAGE_MANIFEST_FILE, STORAGE_SESSION_FILE, STORAGE_NOTEBOOK_FOLDER, STORAGE_SCRIPT_DRAFT } from './storage_backend.js';

class MockFileSystemFileHandle {
    public kind = 'file' as const;

    constructor(
        public name: string,
        private storage: Map<string, string>,
        private structure: Map<string, Set<string>>,
        private parentPath: string
    ) { }

    async getFile(): Promise<File> {
        const content = this.storage.get(this.name) || '';
        return new File([content], this.name, { type: 'text/plain' });
    }

    async createWritable(): Promise<MockFileSystemWritableFileStream> {
        return new MockFileSystemWritableFileStream(this.name, this.storage, this.structure, this.parentPath);
    }
}

class MockFileSystemWritableFileStream {
    constructor(
        private name: string,
        private storage: Map<string, string>,
        private structure: Map<string, Set<string>>,
        private parentPath: string
    ) { }

    async write(data: string): Promise<void> {
        this.storage.set(this.name, data);
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
            throw new Error(`Directory not found: ${name}`);
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

    describe('Session Management', () => {
        it('lists sessions from manifest file', async () => {
            const manifest = {
                sessions: [
                    { title: 'Session 1', path: 'session-1' },
                    { title: 'Session 2', path: 'session-2' }
                ]
            };
            storage.set(STORAGE_MANIFEST_FILE, JSON.stringify(manifest));
            structure.set('', new Set([STORAGE_MANIFEST_FILE]));

            const sessions = await backend.listSessions(STORAGE_MANIFEST_FILE);
            expect(sessions).toEqual([
                { title: 'Session 1', path: 'session-1' },
                { title: 'Session 2', path: 'session-2' }
            ]);
        });

        it('returns empty array when manifest does not exist', async () => {
            const sessions = await backend.listSessions(STORAGE_MANIFEST_FILE);
            expect(sessions).toEqual([]);
        });

        it('saves and loads a session', async () => {
            const sessionData: SessionData = {
                sessionId: crypto.randomUUID(),
                sessionPath: 'test-session',
                title: 'Test Session',
                connectionParams: { dataless: {} },
                notebook: {
                    originalFileName: 'test.sql',
                    createdAt: '2024-01-01T00:00:00Z',
                },
            };

            await backend.saveSessionManifest('test-session', sessionData);

            const loaded = await backend.loadSession('test-session');
            expect(loaded).toEqual(sessionData);
        });

        it('updates manifest when saving session', async () => {
            const sessionData: SessionData = {
                sessionId: crypto.randomUUID(),
                sessionPath: 'test-session',
                title: 'Test Session',
                connectionParams: { dataless: {} },
                notebook: {},
            };

            await backend.saveSessionManifest('test-session', sessionData);

            const sessions = await backend.listSessions(STORAGE_MANIFEST_FILE);
            expect(sessions.some(s => s.path === 'test-session')).toBe(true);
        });

        it('deletes a session and updates manifest', async () => {
            const sessionData: SessionData = {
                sessionId: crypto.randomUUID(),
                sessionPath: 'test-session',
                title: 'Test Session',
                connectionParams: { dataless: {} },
                notebook: {},
            };

            await backend.saveSessionManifest('test-session', sessionData);
            const sessionsAfterSave = await backend.listSessions(STORAGE_MANIFEST_FILE);
            expect(sessionsAfterSave.some(s => s.path === 'test-session')).toBe(true);

            await backend.deleteSession('test-session');
            const sessionsAfterDelete = await backend.listSessions(STORAGE_MANIFEST_FILE);
            expect(sessionsAfterDelete.some(s => s.path === 'test-session')).toBe(false);
        });

        it('does not duplicate sessions in manifest', async () => {
            const sessionData: SessionData = {
                sessionId: crypto.randomUUID(),
                sessionPath: 'test-session',
                title: 'Test Session',
                connectionParams: { dataless: {} },
                notebook: {},
            };

            await backend.saveSessionManifest('test-session', sessionData);
            await backend.saveSessionManifest('test-session', sessionData);

            const sessions = await backend.listSessions(STORAGE_MANIFEST_FILE);
            const count = sessions.filter(s => s.path === 'test-session').length;
            expect(count).toBe(1);
        });
    });

    describe('Notebook Pages', () => {
        beforeEach(async () => {
            const sessionData: SessionData = {
                sessionId: crypto.randomUUID(),
                sessionPath: 'test-session',
                title: 'Test Session',
                connectionParams: { dataless: {} },
                notebook: {},
            };
            await backend.saveSessionManifest('test-session', sessionData);
        });

        it('creates notebook pages', async () => {
            await backend.createNotebookPage('test-session', 'page-1');
            await backend.createNotebookPage('test-session', 'page-2');

            const pages = await backend.loadNotebookPages('test-session');
            expect(pages).toHaveLength(2);
            expect(pages[0].name).toBe('page-1');
            expect(pages[1].name).toBe('page-2');
        });

        it('deletes notebook page', async () => {
            await backend.createNotebookPage('test-session', 'page-1');
            await backend.createNotebookPage('test-session', 'page-2');

            await backend.deleteNotebookPage('test-session', 'page-1');

            const pages = await backend.loadNotebookPages('test-session');
            expect(pages).toHaveLength(1);
            expect(pages[0].name).toBe('page-2');
        });

        it('returns pages sorted by name', async () => {
            await backend.createNotebookPage('test-session', 'page-3');
            await backend.createNotebookPage('test-session', 'page-1');
            await backend.createNotebookPage('test-session', 'page-2');

            const pages = await backend.loadNotebookPages('test-session');
            expect(pages.map(p => p.name)).toEqual(['page-1', 'page-2', 'page-3']);
        });
    });

    describe('Notebook Scripts', () => {
        beforeEach(async () => {
            const sessionData: SessionData = {
                sessionId: crypto.randomUUID(),
                sessionPath: 'test-session',
                title: 'Test Session',
                connectionParams: { dataless: {} },
                notebook: {},
            };
            await backend.saveSessionManifest('test-session', sessionData);
            await backend.createNotebookPage('test-session', 'page-1');
        });

        it('saves and loads a script', async () => {
            const sql = 'SELECT * FROM users;';
            await backend.saveNotebookScript('test-session', 'page-1', '01-script.sql', sql);

            const script = await backend.loadNotebookScript('test-session', 'page-1', '01-script.sql');
            expect(script.name).toBe('01-script.sql');
            expect(script.sql).toBe(sql);
        });

        it('throws error when loading non-existent script', async () => {
            await expect(
                backend.loadNotebookScript('test-session', 'page-1', '99-nonexistent.sql')
            ).rejects.toThrow('Script not found');
        });

        it('deletes a script', async () => {
            await backend.saveNotebookScript('test-session', 'page-1', '01-script.sql', 'SELECT 1;');
            await backend.deleteNotebookScript('test-session', 'page-1', '01-script.sql');

            await expect(
                backend.loadNotebookScript('test-session', 'page-1', '01-script.sql')
            ).rejects.toThrow('Script not found');
        });

        it('loads scripts with page', async () => {
            await backend.saveNotebookScript('test-session', 'page-1', '01-script.sql', 'SELECT 1;');
            await backend.saveNotebookScript('test-session', 'page-1', '02-script.sql', 'SELECT 2;');

            const pages = await backend.loadNotebookPages('test-session');
            expect(pages[0].scripts).toHaveLength(2);
            expect(pages[0].scripts[0].sql).toBe('SELECT 1;');
            expect(pages[0].scripts[1].sql).toBe('SELECT 2;');
        });

        it('returns scripts sorted by name', async () => {
            await backend.saveNotebookScript('test-session', 'page-1', '03-script.sql', 'SELECT 3;');
            await backend.saveNotebookScript('test-session', 'page-1', '01-script.sql', 'SELECT 1;');
            await backend.saveNotebookScript('test-session', 'page-1', '02-script.sql', 'SELECT 2;');

            const pages = await backend.loadNotebookPages('test-session');
            expect(pages[0].scripts.map(s => s.name)).toEqual(['01-script.sql', '02-script.sql', '03-script.sql']);
        });
    });

    describe('Script Draft', () => {
        beforeEach(async () => {
            const sessionData: SessionData = {
                sessionId: crypto.randomUUID(),
                sessionPath: 'test-session',
                title: 'Test Session',
                connectionParams: { dataless: {} },
                notebook: {},
            };
            await backend.saveSessionManifest('test-session', sessionData);
        });

        it('saves and loads draft script', async () => {
            const sql = 'SELECT * FROM draft;';
            await backend.saveNotebookScriptDraft('test-session', sql);

            const loaded = await backend.loadNotebookScriptDraft('test-session');
            expect(loaded).toBe(sql);
        });

        it('returns null when draft does not exist', async () => {
            const loaded = await backend.loadNotebookScriptDraft('test-session');
            expect(loaded).toBeNull();
        });

        it('overwrites existing draft', async () => {
            await backend.saveNotebookScriptDraft('test-session', 'SELECT 1;');
            await backend.saveNotebookScriptDraft('test-session', 'SELECT 2;');

            const loaded = await backend.loadNotebookScriptDraft('test-session');
            expect(loaded).toBe('SELECT 2;');
        });
    });

    describe('Page Reordering', () => {
        beforeEach(async () => {
            const sessionData: SessionData = {
                sessionId: crypto.randomUUID(),
                sessionPath: 'test-session',
                title: 'Test Session',
                connectionParams: { dataless: {} },
                notebook: {},
            };
            await backend.saveSessionManifest('test-session', sessionData);
        });

        it.skip('reorders pages', async () => {
            // TODO: This test requires updating to use lexicographic page ordering
            // Pages are now sorted by name, not by numeric ID
            await backend.createNotebookPage('test-session', 'page-1');
            await backend.saveNotebookScript('test-session', 'page-1', '01-script.sql', 'Page 1 Script');

            await backend.createNotebookPage('test-session', 'page-2');
            await backend.saveNotebookScript('test-session', 'page-2', '01-script.sql', 'Page 2 Script');

            await backend.createNotebookPage('test-session', 'page-3');
            await backend.saveNotebookScript('test-session', 'page-3', '01-script.sql', 'Page 3 Script');

            // Pages are ordered lexicographically now - no reorder API needed
            const pages = await backend.loadNotebookPages('test-session');
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
                uninitializedBackend.listSessions(STORAGE_MANIFEST_FILE)
            ).rejects.toThrow('not initialized');
        });

        it('throws error when loading non-existent session', async () => {
            await expect(
                backend.loadSession('non-existent')
            ).rejects.toThrow();
        });

        it('throws error when loading pages from non-existent session', async () => {
            // loadNotebookPages will throw when trying to get the session directory that doesn't exist
            await expect(
                backend.loadNotebookPages('non-existent')
            ).rejects.toThrow();
        });
    });
});
