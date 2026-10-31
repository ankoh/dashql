import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getOPFSRoot } from '../../platform/opfs_root.js';
import { cacheFileKey, createOPFSQueryResultCache, isTransientCacheFile, QUERY_RESULT_CACHE_DIRECTORY } from './opfs_query_result_cache.js';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

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

    it('removes transient files once nobody pins them, also those of other windows', async () => {
        const run = cache();
        const other = cache();
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
        expect(await files()).toEqual([older]);
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
});
