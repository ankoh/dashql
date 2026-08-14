import { describe, it, expect } from 'vitest';
import { computeQueryResultCacheKey } from './query_result_cache_key.js';

describe('computeQueryResultCacheKey', () => {
    const sig = { host: 'h', database: 'db', roles: ['a', 'b'] };

    it('is deterministic for identical inputs', async () => {
        const a = await computeQueryResultCacheKey(sig, 'SELECT 1');
        const b = await computeQueryResultCacheKey(sig, 'SELECT 1');
        expect(a).toBe(b);
    });

    it('produces a lowercase 64-char hex SHA-256 digest', async () => {
        const key = await computeQueryResultCacheKey(sig, 'SELECT 1');
        expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it('changes when the query text changes', async () => {
        const a = await computeQueryResultCacheKey(sig, 'SELECT 1');
        const b = await computeQueryResultCacheKey(sig, 'SELECT 2');
        expect(a).not.toBe(b);
    });

    it('changes when the connection signature changes', async () => {
        const a = await computeQueryResultCacheKey(sig, 'SELECT 1');
        const b = await computeQueryResultCacheKey({ ...sig, database: 'other' }, 'SELECT 1');
        expect(a).not.toBe(b);
    });

    it('is stable across object key insertion order', async () => {
        const a = await computeQueryResultCacheKey({ host: 'h', database: 'db' }, 'SELECT 1');
        const b = await computeQueryResultCacheKey({ database: 'db', host: 'h' }, 'SELECT 1');
        expect(a).toBe(b);
    });

    it('does not collide by concatenation across the signature/query boundary', async () => {
        // Without the separator, ("ab","c") and ("a","bc") could hash the same input.
        const a = await computeQueryResultCacheKey('ab', 'c');
        const b = await computeQueryResultCacheKey('a', 'bc');
        expect(a).not.toBe(b);
    });
});
