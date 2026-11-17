import { describe, expect, it, vi } from 'vitest';

import type { QueryResultCache } from '@akohn/dashql/platform/query/query_result_cache';

import { sendCachedResult } from './agent_session_runs.js';

describe('the runs of the agent in the tab', () => {
    it('sends the cached file of a key while it keeps it, nothing without one', async () => {
        const order: string[] = [];
        const entry = { name: 'k.1.parquet', key: 'k', size: 4, cachedAtMs: 1, lastAccessMs: 1 };
        const cache = {
            retain: vi.fn(async (key: string) => key !== 'k' ? null : {
                entry,
                release: async () => { order.push('release'); },
            }),
            readFile: vi.fn(async (name: string) => {
                order.push(`read ${name}`);
                return new Blob(['PAR1']);
            }),
        } as unknown as QueryResultCache;
        const write = vi.fn(async (data: Blob) => {
            order.push(`write ${await data.text()}`);
            return '/work/.dashql/cache/k.1.parquet';
        });
        expect(await sendCachedResult(cache, 'k', write)).toBe('/work/.dashql/cache/k.1.parquet');
        expect(order).toEqual(['read k.1.parquet', 'write PAR1', 'release']);
        expect(await sendCachedResult(cache, 'other', write)).toBeNull();
        expect(await sendCachedResult(null, 'k', write)).toBeNull();
        // A failed write still releases the file
        order.length = 0;
        await expect(sendCachedResult(cache, 'k', async () => { throw new Error('gone'); })).rejects.toThrow('gone');
        expect(order).toEqual(['read k.1.parquet', 'release']);
    });
});
