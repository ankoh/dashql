import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EmbeddedComputeDatabase } from '../embedded_database.js';
import { getOPFSRoot } from '../opfs_root.js';
import { Crc32 } from '../utils/crc32.js';
import { cacheFileKey, createOPFSQueryResultCache, isTransientCacheFile, QUERY_RESULT_CACHE_DIRECTORY, QUERY_RESULT_CACHE_MOUNT } from './opfs_query_result_cache.js';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const HOUR_MS = 60 * 60 * 1000;

/// The locks of another process of Node on the same root: they never see the pins of this one
const UNSHARED_LOCKS = {
    request: async (_name: string, ...args: unknown[]) => await (args[args.length - 1] as (lock: Lock) => Promise<unknown>)({ name: _name, mode: 'exclusive' } as Lock),
    query: async () => ({ held: [], pending: [] }),
} as unknown as LockManager;

describe('OPFS query result cache', () => {
    let rootName: string;
    let root: FileSystemDirectoryHandle;
    let folder: FileSystemDirectoryHandle;

    beforeEach(async () => {
        rootName = `cache-unit-${crypto.randomUUID()}`;
        root = await (await getOPFSRoot()).getDirectoryHandle(rootName, { create: true });
        folder = await root.getDirectoryHandle(QUERY_RESULT_CACHE_DIRECTORY, { create: true });
    });
    afterEach(async () => {
        await (await getOPFSRoot()).removeEntry(rootName, { recursive: true });
    });

    const cache = () => createOPFSQueryResultCache({ getRoot: async () => root });
    /// A cache whose clock is two hours ahead, the transient and empty files are old for it
    const later = (locks?: LockManager) => createOPFSQueryResultCache({ getRoot: async () => root, locks, now: () => Date.now() + 2 * HOUR_MS });
    /// Write a file into the cache folder
    const put = async (name: string, size = 4) => {
        const writable = await (await folder.getFileHandle(name, { create: true })).createWritable();
        await writable.write(new Uint8Array(size));
        await writable.close();
        await tick();
        return name;
    };
    const files = async () => {
        const names: string[] = [];
        for await (const name of folder.keys()) names.push(name);
        return names.sort();
    };

    it('names files after their keys', () => {
        const name = cache().newFileName(KEY_A);
        expect(name).toMatch(new RegExp(`^${KEY_A}\\.[0-9a-f-]{36}\\.parquet$`));
        expect(cacheFileKey(name)).toBe(KEY_A);
        expect(isTransientCacheFile(name)).toBe(false);
        // Results that can't be reused and files that are being written are transient, they have no key
        const transient = cache().newTransientFileName();
        expect(transient).toMatch(/^[0-9a-f-]{36}\.transient\.parquet$/);
        expect(isTransientCacheFile(transient)).toBe(true);
        expect(cacheFileKey(transient)).toBeNull();
    });

    it('finds the newest file of a key and lists only the files of keys', async () => {
        const c = cache();
        const older = await put(c.newFileName(KEY_A));
        const newer = await put(c.newFileName(KEY_A), 8);
        const other = await put(c.newFileName(KEY_B));
        const transient = await put(c.newTransientFileName());
        const release = await c.pin(transient);
        expect(await c.lookup(KEY_A)).toMatchObject({ name: newer, key: KEY_A, size: 8 });
        expect(await c.has(KEY_B)).toBe(true);
        expect(await c.has('c'.repeat(64))).toBe(false);
        expect((await c.list()).map(entry => entry.name).sort()).toEqual([older, newer, other].sort());
        expect(await files()).toContain(transient);
        await release();
    });

    it('removes old transient files once nobody pins them, also those of other windows', async () => {
        const run = cache();
        const other = later();
        const pinned = await put(run.newTransientFileName());
        // A transient file of a window that was closed during its run
        const left = await put(other.newTransientFileName());
        const release = await run.pin(pinned);
        const entry = await put(run.newFileName(KEY_A));
        // Every listing removes the transient files that nobody pins, the pinned ones stay
        expect(await other.has(KEY_A)).toBe(true);
        expect(await files()).toEqual([entry, pinned].sort());
        await release();
        await other.list();
        expect(await files()).toEqual([entry]);
        expect(left).not.toBe(pinned);
    });

    it('records reads in markers and removes markers without files', async () => {
        const c = cache();
        const name = await put(c.newFileName(KEY_A));
        const before = (await c.lookup(KEY_A))!;
        await tick();
        await c.touch(name);
        const after = (await c.lookup(KEY_A))!;
        expect(after.lastAccessMs).toBeGreaterThan(before.lastAccessMs);
        expect(after.cachedAtMs).toBe(before.cachedAtMs);
        // A marker whose file is gone is removed by the next listing
        await put(`${KEY_B}.0b5e3b7c-0000-4000-8000-000000000000.parquet.last_access`, 0);
        await c.list();
        expect(await files()).toEqual([name, `${name}.last_access`]);
    });

    it('retains the newest file of a key until the release and records the read', async () => {
        const reader = cache();
        const other = cache();
        const name = await put(reader.newFileName(KEY_A));
        const before = (await reader.lookup(KEY_A))!;
        await tick();
        const retained = (await reader.retain(KEY_A))!;
        expect(retained.entry.name).toBe(name);
        expect((await reader.lookup(KEY_A))!.lastAccessMs).toBeGreaterThan(before.lastAccessMs);
        // Other windows can't remove the file while it is retained
        expect(await other.clear()).toEqual([]);
        expect(await files()).toContain(name);
        await retained.release();
        expect(await other.clear()).toEqual([KEY_A]);
        expect(await reader.retain(KEY_A)).toBeNull();
    });

    it('imports the bytes of a result as a new file of its key, the cached results win', async () => {
        const c = createOPFSQueryResultCache({ getRoot: async () => root, maxFiles: 2 });
        const raw = new Uint8Array([80, 65, 82, 49, 1, 2, 3]);
        // A slice of a larger file, as an import of an archive passes it
        const bytes = new Blob([new Uint8Array([7, 7]), raw, new Uint8Array([7])]).slice(2, 2 + raw.length);
        expect(await c.importFile(KEY_A, bytes)).toBe(true);
        const entry = (await c.lookup(KEY_A))!;
        expect(entry).toMatchObject({ key: KEY_A, size: raw.length });
        expect(new Uint8Array(await (await c.readFile(entry.name)).arrayBuffer())).toEqual(raw);
        // A key that is cached keeps its file
        expect(await c.importFile(KEY_A, new Blob([new Uint8Array([9])]))).toBe(false);
        expect((await c.list()).map(e => e.name)).toEqual([entry.name]);
        // The cache keeps every imported file, the runtime evicts beyond the limits. No transient file is left.
        await tick();
        expect(await c.importFile(KEY_B, bytes)).toBe(true);
        await tick();
        expect(await c.importFile('c'.repeat(64), bytes)).toBe(true);
        expect((await c.list()).map(e => e.key).sort()).toEqual([KEY_A, KEY_B, 'c'.repeat(64)].sort());
        expect((await files()).filter(name => isTransientCacheFile(name))).toEqual([]);
        expect(c.capacity).toEqual({ maxBytes: null, maxFiles: 2 });
        // The files of the eviction, least recently read first: the read of the first file counts
        await c.touch(entry.name);
        const stats = await c.fileStats();
        expect(stats.map(file => file.name).sort()).toEqual((await c.list()).map(e => e.name).sort());
        expect(stats.find(file => file.name === entry.name)!.lastAccessMs).toBeGreaterThanOrEqual(stats.find(file => file.name === entry.name)!.mtimeMs);
        // A file that is read stays, one that nobody reads goes with its marker
        const release = await c.pin(entry.name);
        expect(await c.remove(entry.name)).toBe(false);
        await release();
        expect(await c.remove(entry.name)).toBe(true);
        expect((await files()).filter(name => name.startsWith(entry.name))).toEqual([]);
        await expect(c.importFile('not-a-key', bytes)).rejects.toThrow('Invalid cache key');
    });

    it('checks the CRC-32 of an imported result and leaves no file if it differs', async () => {
        const c = cache();
        const raw = new Uint8Array([80, 65, 82, 49, 1, 2, 3]);
        const crc = new Crc32();
        crc.update(raw);
        await expect(c.importFile(KEY_A, new Blob([raw]), { crc32: crc.value ^ 1 })).rejects.toThrow('checksum');
        expect(await c.lookup(KEY_A)).toBeNull();
        expect(await files()).toEqual([]);
        expect(await c.importFile(KEY_A, new Blob([raw]), { crc32: crc.value })).toBe(true);
        expect(await c.lookup(KEY_A)).toMatchObject({ size: raw.length });
        expect(c.capacity).toEqual({ maxBytes: null, maxFiles: null });
    });

    it('drops an imported result once a run wrote its key while the bytes were streamed', async () => {
        const c = cache();
        let written = '';
        // The bytes arrive after a run wrote the key
        const data = { size: 4, stream: () => new ReadableStream<Uint8Array>({
            async start(controller) {
                written = await put(c.newFileName(KEY_A), 8);
                controller.enqueue(new Uint8Array([80, 65, 82, 49]));
                controller.close();
            },
        }) } as unknown as Blob;
        expect(await c.importFile(KEY_A, data)).toBe(false);
        expect(await c.lookup(KEY_A)).toMatchObject({ name: written, size: 8 });
        expect(await files()).toEqual([written]);
    });

    it('finds no result in an empty file of a key and removes it once nobody writes it', async () => {
        const c = cache();
        const older = await put(c.newFileName(KEY_A));
        // A write without `move` creates the file of the key before its content
        const writing = await put(c.newFileName(KEY_A), 0);
        const release = await c.pin(writing);
        expect((await c.lookup(KEY_A))?.name).toBe(older);
        expect(await files()).toContain(writing);
        await release();
        await c.list();
        expect(await files()).toContain(writing);
        await later().list();
        expect(await files()).toEqual([older]);
    });

    it('keeps young transient and empty files that another process may write', async () => {
        const c = cache();
        const writing = await put(c.newTransientFileName());
        const empty = await put(c.newFileName(KEY_A), 0);
        // The pins of this process are not seen there, the files are young
        await createOPFSQueryResultCache({ getRoot: async () => root, locks: UNSHARED_LOCKS }).list();
        expect(await files()).toEqual([empty, writing].sort());
        await later(UNSHARED_LOCKS).list();
        expect(await files()).toEqual([]);
    });

    it('reports the keys whose files stay because they are read', async () => {
        const reader = cache();
        const writer = cache();
        await put(reader.newFileName(KEY_A));
        const newer = await put(reader.newFileName(KEY_A));
        await put(reader.newFileName(KEY_B));
        const release = await reader.pin(newer);
        // The older file of KEY_A goes, the newer one stays: KEY_A is still cached
        expect(await writer.clear()).toEqual([KEY_B]);
        expect(await writer.delete(KEY_A)).toBe(false);
        await release();
        expect(await writer.delete(KEY_A)).toBe(true);
        expect(await files()).toEqual([]);
    });

    it('leaves pinned files alone, also those of other windows', async () => {
        const reader = cache();
        const writer = cache();
        const pinned = await put(reader.newFileName(KEY_A));
        const free = await put(reader.newFileName(KEY_B));
        await reader.touch(free);
        // A file of an older version without a key
        await put('run-0b5e3b7c-0000-4000-8000-000000000000-s0.parquet');
        const release = await reader.pin(pinned);
        // Another cache instance shares the locks of the origin
        await writer.delete(KEY_A);
        expect(await writer.has(KEY_A)).toBe(true);
        expect(await writer.clear()).toEqual([KEY_B]);
        expect(await files()).toEqual([pinned]);
        await writer.remove(pinned);
        expect(await files()).toEqual([pinned]);
        // Once released, the file can be removed
        await release();
        await release();
        await writer.delete(KEY_A);
        expect(await files()).toEqual([]);
    });

    it('mounts the files once per database and refreshes the mount after removals, also while it is used', async () => {
        const fakeDatabase = () => ({
            registerExternalDirectory: vi.fn(async (_handle: FileSystemDirectoryHandle, path: string | undefined) => path!),
            removeExternalDirectory: vi.fn(async (_path: string) => {}),
            refreshExternalDirectory: vi.fn(async (_path: string) => {}),
        });
        const c = cache();
        const first = fakeDatabase();
        const database = first as unknown as EmbeddedComputeDatabase;
        await c.mount(database);
        await c.mount(database);
        expect(first.registerExternalDirectory).toHaveBeenCalledTimes(1);
        expect(first.registerExternalDirectory.mock.calls[0][1]).toBe(QUERY_RESULT_CACHE_MOUNT);
        expect(first.refreshExternalDirectory).not.toHaveBeenCalled();
        // A run reads a file through the mount while the cache removes another one
        const read = await put(c.newFileName(KEY_A));
        await put(c.newFileName(KEY_B));
        const release = await c.pin(read);
        await c.delete(KEY_B);
        expect(await files()).toEqual([read]);
        await c.mount(database);
        await c.mount(database);
        expect(first.refreshExternalDirectory).toHaveBeenCalledTimes(1);
        expect(first.refreshExternalDirectory).toHaveBeenCalledWith(QUERY_RESULT_CACHE_MOUNT);
        expect(first.removeExternalDirectory).not.toHaveBeenCalled();
        await release();
        // A failed refresh is retried by the next mount
        await c.delete(KEY_A);
        first.refreshExternalDirectory.mockRejectedValueOnce(new Error('refresh failed'));
        await expect(c.mount(database)).rejects.toThrow('refresh failed');
        await c.mount(database);
        expect(first.refreshExternalDirectory).toHaveBeenCalledTimes(3);
        // Another database, e.g. after a restart of the engine, gets its own mount
        const second = fakeDatabase();
        await c.mount(second as unknown as EmbeddedComputeDatabase);
        expect(first.removeExternalDirectory).toHaveBeenCalledWith(QUERY_RESULT_CACHE_MOUNT);
        expect(second.registerExternalDirectory).toHaveBeenCalledTimes(1);
        expect(second.refreshExternalDirectory).not.toHaveBeenCalled();
    });
});
