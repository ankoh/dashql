import { describe, expect, it } from 'vitest';

import { createRunMounts } from './run_mounts.js';
import { CachePins } from '../../query/cache_pins.js';
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
    } as unknown as QueryResultCache;
    const pins = () => [...pinned.values()].reduce((sum, count) => sum + count, 0);
    return { cache, pins };
}

describe('the files of the runs', () => {
    it('pins a file of a run until the runtime releases the pin', async () => {
        const { cache, pins } = testCache();
        const handles = new HandleTable();
        const kept = new CachePins();
        const mounts = createRunMounts(async () => DATABASE, cache, handles, kept);
        const path = `/mnt/cache/${mounts.fileName('a')}`;
        const pin = await mounts.pin(path);
        expect(await mounts.write(path, handles.register(tableFromArrays({ value: [1, 2] })))).toBe(2);
        expect(pins()).toBe(1);
        await kept.release(pin);
        expect(pins()).toBe(0);
        await expect(mounts.pin('/elsewhere/a.parquet')).rejects.toThrow('no file of the run');
    });

    it('releases the pins that are left when the runtime goes, and a pin that arrives later at once', async () => {
        const { cache, pins } = testCache();
        const kept = new CachePins();
        let resolveDatabase!: (database: EmbeddedComputeDatabase) => void;
        const database = new Promise<EmbeddedComputeDatabase>(resolve => { resolveDatabase = resolve; });
        const mounts = createRunMounts(() => database, cache, new HandleTable(), kept);
        // One pin waits for the database, the other is a file that a run retained
        const late = mounts.pin(`/mnt/cache/${mounts.fileName(null)}`).catch((error: unknown) => error);
        kept.add((await cache.pin('cached.parquet')));
        expect(pins()).toBe(1);
        await kept.close();
        expect(pins()).toBe(0);
        resolveDatabase(DATABASE);
        expect(await late).toBeInstanceOf(Error);
        await Promise.resolve();
        expect(pins()).toBe(0);
    });
});
