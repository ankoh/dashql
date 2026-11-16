import { describe, expect, it, vi } from 'vitest';

import { createRunMounts } from './run_mounts.js';
import { HandleTable } from '../../store/handles.js';
import type { EmbeddedComputeDatabase } from '../../../platform/platform/database/embedded_database.js';
import type { QueryResultCache } from '../../../platform/query/query_result_cache.js';
import { tableFromArrays } from '../../../platform/testing/arrow_fixtures.js';

/// A compute database that reads Parquet files, its calls do nothing
const DATABASE = {
    registerExternalDirectory: async () => { },
    removeExternalDirectory: async () => { },
    registerExternalFile: async () => { },
    removeExternalFile: async () => { },
    refreshExternalDirectory: async () => { },
} as unknown as EmbeddedComputeDatabase;

/// A query result cache that counts the pins of its files
function testCache() {
    const pinned = new Map<string, number>();
    const cache = {
        mountPath: '/mnt/cache',
        mount: async () => { },
        pin: async (name: string) => {
            pinned.set(name, (pinned.get(name) ?? 0) + 1);
            return async () => { pinned.set(name, pinned.get(name)! - 1); };
        },
        writeTable: async () => { },
        newFileName: (key: string) => `${key}.parquet`,
        newTransientFileName: () => 'transient.parquet',
        remove: vi.fn(async () => true),
    } as unknown as QueryResultCache;
    const pins = () => [...pinned.values()].reduce((sum, count) => sum + count, 0);
    return { cache, pins };
}

describe('the files of the runs', () => {
    it('releases the pin of a write that ends after the release of its run', async () => {
        const { cache, pins } = testCache();
        let resolveDatabase!: (database: EmbeddedComputeDatabase) => void;
        const database = new Promise<EmbeddedComputeDatabase>(resolve => { resolveDatabase = resolve; });
        const handles = new HandleTable();
        const mounts = createRunMounts(() => database, cache, handles);
        const table = handles.register(tableFromArrays({ value: [1, 2] }));

        // The write waits for the database, the run ends meanwhile
        const write = mounts.write(1, `/mnt/cache/${mounts.fileName(1, 'a')}`, table).catch(error => error);
        await mounts.release(1);
        resolveDatabase(DATABASE);
        expect(await write).toBeInstanceOf(Error);
        expect(pins()).toBe(0);
    });

    it('releases the files of the runs that the runtime left when it goes', async () => {
        const { cache, pins } = testCache();
        const handles = new HandleTable();
        const mounts = createRunMounts(async () => DATABASE, cache, handles);
        await mounts.use(1, '/mnt/cache/a.parquet');
        await mounts.write(2, `/mnt/cache/${mounts.fileName(2, null)}`, handles.register(tableFromArrays({ value: [1] })));
        expect(pins()).toBe(2);
        await mounts.dispose();
        expect(pins()).toBe(0);
        expect(cache.remove).toHaveBeenCalledWith('transient.parquet');
    });
});
