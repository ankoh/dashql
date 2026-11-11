import { describe, expect, it } from 'vitest';

import { OPFSDirectoryMock } from '../tests/opfs_mock.js';
import { findOPFSCleanupCandidates, removeOPFSCleanupCandidates } from './opfs_cleanup.js';

const LIVE = crypto.randomUUID();
const CLOSED = crypto.randomUUID();
const LEGACY = crypto.randomUUID();

const MANIFEST = JSON.stringify({
    connections: [{ id: 'c1', params: {} }],
});
/// The workbook tree registers s1 in the root and S2 in a folder
const ROOT_FOLDER = JSON.stringify({ workbooks: [{ path: 's1' }] });
const CLIENTS_FOLDER = JSON.stringify({ workbooks: [{ path: 'S2', storageType: 'native', nativePath: '/x/s2' }] });

/// An OPFS root with the files and directories, every directory is listed explicitly
function opfs(files: Record<string, string>, dirs: string[]) {
    const fileMap = new Map<string, string | ArrayBuffer>(Object.entries(files));
    const dirSet = new Set(dirs);
    const root = new OPFSDirectoryMock('', fileMap, dirSet) as unknown as FileSystemDirectoryHandle;
    return { root, files: fileMap, dirs: dirSet };
}

/// A lock manager where the given locks are held by other app windows
function fakeLocks(held: string[]): LockManager {
    return {
        query: async () => ({ held: held.map(name => ({ name, mode: 'exclusive' })), pending: [] }),
        request: async (name: string, ...args: unknown[]) => {
            const callback = args[args.length - 1] as (lock: Lock | null) => unknown;
            const options = (args.length > 1 ? args[0] : {}) as LockOptions;
            return await callback(options.ifAvailable && held.includes(name) ? null : { name, mode: 'exclusive' } as Lock);
        },
    } as unknown as LockManager;
}

function messyStorage() {
    return opfs({
        'dashql-manifest.json': MANIFEST,
        'workbooktree/dashql-folder.json': ROOT_FOLDER,
        'workbooktree/clients/dashql-folder.json': CLIENTS_FOLDER,
        'stray.txt': '',
        'workbooks/s1/dashql-workbook.json': '{}',
        'workbooks/s1/dashql-session-index.json': '{}',
        'workbooks/s1/scripts/1.sql': 'SELECT 1',
        'workbooks/s1/scripts/page/2.sql': 'SELECT 2',
        'workbooks/s2/attachments/a.parquet': '',
        'workbooks/s2/dashql-workbook.json': '{}',
        'workbooks/gone/dashql-workbook.json': '{}',
        'connections/c1/dashql-catalog-relations.sql': '',
        'connections/c2/dashql-catalog-relations.sql': '',
        'exports/e1/result.parquet': '',
        // The local cloud keeps its database across windows
        'clouds/local.hyper': '',
    }, [
        'workbooktree', 'workbooktree/clients',
        'workbooks', 'workbooks/s1', 'workbooks/s1/scripts', 'workbooks/s1/scripts/page', 'workbooks/s1/cache',
        'workbooks/s2', 'workbooks/s2/attachments', 'workbooks/gone',
        'connections', 'connections/c1', 'connections/c2',
        'instances', `instances/${LIVE}`, `instances/${CLOSED}`,
        'exports', 'exports/e1', 'shell', 'imported', 'logs', 'notebooks', 'tests', 'cache', 'clouds',
        `dashql-session-${LEGACY}`,
    ]);
}

describe('findOPFSCleanupCandidates', () => {
    it('flags everything the current layout does not use', async () => {
        const { root } = messyStorage();
        const candidates = await findOPFSCleanupCandidates(root, fakeLocks([`dashql-instance-${LIVE}`]));
        expect(candidates.map(c => c.path.join('/')).sort()).toEqual([
            `dashql-session-${LEGACY}`,
            'connections/c2',
            'exports/e1',
            `instances/${CLOSED}`,
            'logs',
            'notebooks',
            'workbooks/gone',
            'workbooks/s1/cache',
            'workbooks/s1/dashql-session-index.json',
            'workbooks/s1/scripts/page',
            'workbooks/s2/dashql-workbook.json',
            'stray.txt',
            'tests',
        ].sort());

        const byPath = new Map(candidates.map(c => [c.path.join('/'), c]));
        expect(byPath.get('workbooks/gone')?.guard).toEqual({ workbookId: 'gone' });
        expect(byPath.get('connections/c2')?.guard).toEqual({ connectionId: 'c2' });
        expect(byPath.get(`instances/${CLOSED}`)?.lockName).toBe(`dashql-instance-${CLOSED}`);
        expect(byPath.get('stray.txt')?.directory).toBe(false);
    });

    it('leaves workbooks and connections alone without a manifest', async () => {
        const { root, files } = messyStorage();
        files.delete('dashql-manifest.json');
        const paths = (await findOPFSCleanupCandidates(root, fakeLocks([]))).map(c => c.path.join('/'));
        expect(paths.some(path => path.startsWith('workbooks/') || path.startsWith('connections/'))).toBe(false);
    });

    it('leaves instance folders alone without Web Locks', async () => {
        const { root } = messyStorage();
        const paths = (await findOPFSCleanupCandidates(root, null)).map(c => c.path.join('/'));
        expect(paths.some(path => path.startsWith('instances/') || path.startsWith('dashql-session-'))).toBe(false);
    });
});

describe('removeOPFSCleanupCandidates', () => {
    it('deletes the candidates', async () => {
        const { root, files, dirs } = messyStorage();
        const locks = fakeLocks([`dashql-instance-${LIVE}`]);
        const candidates = await findOPFSCleanupCandidates(root, locks);

        const result = await removeOPFSCleanupCandidates(root, candidates, locks);
        expect(result).toEqual({ removed: candidates.length, skipped: [] });
        expect(await findOPFSCleanupCandidates(root, locks)).toEqual([]);
        expect(files.has('workbooks/s1/scripts/1.sql')).toBe(true);
        expect(files.has('workbooks/s1/scripts/page/2.sql')).toBe(false);
        expect(dirs.has(`instances/${LIVE}`)).toBe(true);
    });

    it('keeps entries that were registered again or are in use', async () => {
        const { root, files, dirs } = messyStorage();
        const candidates = await findOPFSCleanupCandidates(root, fakeLocks([]));

        // A workbook with the same id is registered and an app window opens the closed instance again
        files.set('workbooktree/dashql-folder.json', JSON.stringify({ workbooks: [{ path: 's1' }, { path: 'GONE' }] }));
        const result = await removeOPFSCleanupCandidates(root, candidates, fakeLocks([`dashql-instance-${CLOSED}`]));

        expect(result.skipped).toEqual([
            { path: `instances/${CLOSED}`, reason: 'in use' },
            { path: 'workbooks/gone', reason: 'registered again' },
        ]);
        expect(result.removed).toBe(candidates.length - 2);
        expect(dirs.has('workbooks/gone')).toBe(true);
        expect(dirs.has(`instances/${CLOSED}`)).toBe(true);
    });

    it('keeps files that are still open', async () => {
        const { root } = opfs({ 'dashql-manifest.json': MANIFEST, 'stray.txt': '' }, []);
        const open = new Error('open');
        open.name = 'NoModificationAllowedError';
        (root as unknown as OPFSDirectoryMock).removeEntry = async () => { throw open; };
        const result = await removeOPFSCleanupCandidates(root, await findOPFSCleanupCandidates(root, null), null);
        expect(result).toEqual({ removed: 0, skipped: [{ path: 'stray.txt', reason: 'in use' }] });
    });
});
