import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmbeddedComputeDatabase } from '../embedded_database.js';
import { getOPFSRoot } from '../opfs_root.js';
import { STORAGE_WORKBOOKS_FOLDER } from '../storage/storage_backend.js';
import { Crc32 } from '../utils/crc32.js';
import { createWorkbookResultFiles, RESULTS_FOLDER, resultsMountPath } from './workbook_result_files.js';

const WORKBOOK = '00000000-0000-4000-8000-000000000001';
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

describe('the results of the workbooks', () => {
    let rootName: string;
    let root: FileSystemDirectoryHandle;

    beforeEach(async () => {
        rootName = `results-unit-${crypto.randomUUID()}`;
        root = await (await getOPFSRoot()).getDirectoryHandle(rootName, { create: true });
    });
    afterEach(async () => {
        await (await getOPFSRoot()).removeEntry(rootName, { recursive: true });
    });

    const results = () => createWorkbookResultFiles({ getRoot: async () => root });
    const folder = async () => await (await (await root.getDirectoryHandle(STORAGE_WORKBOOKS_FOLDER, { create: true }))
        .getDirectoryHandle(WORKBOOK, { create: true })).getDirectoryHandle(RESULTS_FOLDER, { create: true });
    /// Write a file into the results folder of the workbook
    const put = async (name: string, size = 4) => {
        const writable = await (await (await folder()).getFileHandle(name, { create: true })).createWritable();
        await writable.write(new Uint8Array(size));
        await writable.close();
        await tick();
        return name;
    };
    const names = async () => {
        const listed: string[] = [];
        for await (const name of (await folder()).keys()) listed.push(name);
        return listed.sort();
    };

    it('lists the Parquet files of a workbook, none without a folder', async () => {
        const r = results();
        expect(await r.files(WORKBOOK)).toEqual([]);
        // The listing creates no folder
        await expect((await root.getDirectoryHandle(STORAGE_WORKBOOKS_FOLDER, { create: true })).getDirectoryHandle(WORKBOOK)).rejects.toThrow();
        await put('a.sql.k.00000001.parquet', 8);
        await put('notes.txt');
        const files = await r.files(WORKBOOK);
        expect(files.map(file => file.name)).toEqual(['a.sql.k.00000001.parquet']);
        expect(files[0].size).toBe(8);
        expect(files[0].mtimeMs).toBeGreaterThan(0);
        expect(r.mountPath(WORKBOOK)).toBe(resultsMountPath(WORKBOOK));
    });

    it('moves and removes files that nobody reads, also those of other windows', async () => {
        const reader = results();
        const writer = results();
        const read = await put('a.sql.k.00000001.parquet');
        const free = await put('b.sql.k.00000002.parquet');
        const release = await reader.pin(WORKBOOK, read);
        // Another instance shares the locks of the origin
        expect(await writer.remove(WORKBOOK, read)).toBe(false);
        expect(await writer.move(WORKBOOK, read, 'c.sql.k.00000003.parquet')).toBe(false);
        expect(await writer.move(WORKBOOK, free, 'd.sql.k.00000004.parquet')).toBe(true);
        expect(await names()).toEqual([read, 'd.sql.k.00000004.parquet']);
        await release();
        expect(await writer.remove(WORKBOOK, read)).toBe(true);
        // A file that is gone is removed
        expect(await writer.remove(WORKBOOK, read)).toBe(true);
        expect(await names()).toEqual(['d.sql.k.00000004.parquet']);
    });

    it('imports bytes as a new file and leaves no file if the CRC-32 differs', async () => {
        const r = results();
        const raw = new Uint8Array([80, 65, 82, 49, 1, 2, 3]);
        const crc = new Crc32();
        crc.update(raw);
        await expect(r.importFile(WORKBOOK, 'a.sql.k.00000001.parquet', new Blob([raw]), { crc32: crc.value ^ 1 })).rejects.toThrow('checksum');
        expect(await names()).toEqual([]);
        await r.importFile(WORKBOOK, 'a.sql.k.00000001.parquet', new Blob([raw]), { crc32: crc.value });
        expect(await names()).toEqual(['a.sql.k.00000001.parquet']);
        expect((await r.readFile(WORKBOOK, 'a.sql.k.00000001.parquet')).size).toBe(raw.length);
    });

    it('mounts the results of a workbook once per database and refreshes the mount after removals', async () => {
        const fakeDatabase = () => ({
            registerExternalDirectory: vi.fn(async (_handle: FileSystemDirectoryHandle, path: string | undefined) => path!),
            removeExternalDirectory: vi.fn(async (_path: string) => {}),
            refreshExternalDirectory: vi.fn(async (_path: string) => {}),
        });
        const r = results();
        const first = fakeDatabase();
        const database = first as unknown as EmbeddedComputeDatabase;
        await r.mount(database, WORKBOOK);
        await r.mount(database, WORKBOOK);
        expect(first.registerExternalDirectory).toHaveBeenCalledTimes(1);
        expect(first.registerExternalDirectory.mock.calls[0][1]).toBe(resultsMountPath(WORKBOOK));
        expect(first.refreshExternalDirectory).not.toHaveBeenCalled();
        await put('a.sql.k.00000001.parquet');
        await r.remove(WORKBOOK, 'a.sql.k.00000001.parquet');
        await r.mount(database, WORKBOOK);
        await r.mount(database, WORKBOOK);
        expect(first.refreshExternalDirectory).toHaveBeenCalledTimes(1);
        // Another database, e.g. after a restart of the engine, gets its own mount
        const second = fakeDatabase();
        await r.mount(second as unknown as EmbeddedComputeDatabase, WORKBOOK);
        expect(first.removeExternalDirectory).toHaveBeenCalledWith(resultsMountPath(WORKBOOK));
        expect(second.registerExternalDirectory).toHaveBeenCalledTimes(1);
        // A workbook that is deleted is unmounted
        await r.unmount(WORKBOOK);
        expect(second.removeExternalDirectory).toHaveBeenCalledWith(resultsMountPath(WORKBOOK));
    });
});
