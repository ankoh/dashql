import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NODE_FILE_SYSTEM } from './node_file_system.js';

/// Runs right after the next rename of a file, e.g. a write of another program
const afterRename: { next: (() => Promise<void>) | null } = vi.hoisted(() => ({ next: null }));
vi.mock('node:fs/promises', async importOriginal => {
    const original = await importOriginal<typeof import('node:fs/promises')>();
    return {
        ...original,
        rename: async (from: string, to: string) => {
            await original.rename(from, to);
            const next = afterRename.next;
            afterRename.next = null;
            await next?.();
        },
    };
});
import { NativeStorageBackend } from '../storage/native_storage_backend.js';
import { TEST_WORKBOOK_ID, testWorkbook } from '../testing/workbook_test_backend.js';

let dir: string;

beforeEach(async () => {
    dir = await mkdtemp(join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-workbook-'));
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe('a workbook folder on the file system of Node', () => {
    it('keeps what one backend writes for the next one', async () => {
        const writer = new NativeStorageBackend(dir, NODE_FILE_SYSTEM);
        await writer.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
        await writer.saveScript(TEST_WORKBOOK_ID, '2_second.sql', 'select 2');
        await writer.saveScript(TEST_WORKBOOK_ID, '10_tenth.sql', 'select 10');

        const reader = new NativeStorageBackend(dir, NODE_FILE_SYSTEM);
        expect(await reader.loadWorkbook(TEST_WORKBOOK_ID)).toEqual(testWorkbook());
        expect(await reader.loadScripts(TEST_WORKBOOK_ID)).toEqual([
            { name: '2_second.sql', sql: 'select 2' },
            { name: '10_tenth.sql', sql: 'select 10' },
        ]);
        expect(await readFile(join(dir, '.gitignore'), 'utf8')).toBe('results/\ncache/\n*.hyper\n');
    });

    it('stamps files and lists them', async () => {
        const path = join(dir, 'a.sql');
        expect(await NODE_FILE_SYSTEM.fileStamp(path)).toBeNull();
        const stamp = await NODE_FILE_SYSTEM.writeTextFile(path, 'select 1');
        expect(stamp.size).toBe(8);
        expect(await NODE_FILE_SYSTEM.fileStamp(path)).toEqual(stamp);
        expect(await NODE_FILE_SYSTEM.listFiles(dir)).toEqual([{ name: 'a.sql', ...stamp }]);
        expect(await NODE_FILE_SYSTEM.listFiles(join(dir, 'missing'))).toEqual([]);
    });

    it('returns the stamp of its own write, not of a write of another program right after it', async () => {
        const path = join(dir, 'a.sql');
        afterRename.next = () => writeFile(path, 'select 2 from another program');
        const stamp = await NODE_FILE_SYSTEM.writeTextFile(path, 'select 1');
        expect(stamp.size).toBe(8);
        // The file on disk is not what the app wrote, its stamp differs
        expect(await NODE_FILE_SYSTEM.fileStamp(path)).not.toEqual(stamp);
    });

    it('replaces a file atomically and leaves no temporary file', async () => {
        const path = join(dir, 'dashql-workbook.json');
        await NODE_FILE_SYSTEM.writeTextFile(path, 'old');
        await NODE_FILE_SYSTEM.writeTextFile(path, 'new');
        await NODE_FILE_SYSTEM.writeFile(join(dir, 'a.parquet'), new Uint8Array([1, 2]));
        expect(await readFile(path, 'utf8')).toBe('new');
        expect((await readdir(dir)).sort()).toEqual(['a.parquet', 'dashql-workbook.json']);
        // A write that fails leaves nothing behind
        await expect(NODE_FILE_SYSTEM.writeTextFile(join(dir, 'missing', 'a.sql'), 'x')).rejects.toThrow();
        expect((await readdir(dir)).sort()).toEqual(['a.parquet', 'dashql-workbook.json']);
    });
});
