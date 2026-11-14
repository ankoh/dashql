import { describe, expect, it, vi } from 'vitest';

import type { LoggerLike } from '@ankoh/dashql-runtime/platform/logger/logger';
import { memoryQueryResultCache } from '@ankoh/dashql-runtime/testing/memory_query_result_cache';
import { importWorkbookQueryResults, workbookResultKey, workbookResultPath } from './workbook_query_results.js';

function testLogger() {
    return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), exception: vi.fn() } satisfies LoggerLike;
}

const result = (key: string, bytes: number[]) => ({ key, bytes: new Blob([new Uint8Array(bytes)]) });

describe('workbook query results', () => {
    it('names the files of the results folder after their keys', () => {
        const key = 'a'.repeat(64);
        expect(workbookResultPath(key)).toBe(`results/${key}.parquet`);
        expect(workbookResultKey(`${key}.parquet`)).toBe(key);
        expect(workbookResultKey(`${'A'.repeat(64)}.parquet`)).toBeNull();
        expect(workbookResultKey('notes.txt')).toBeNull();
    });

    it('imports every result it can, keeps the cached keys and logs each one', async () => {
        const [added, kept, failing] = ['a', 'b', 'c'].map(c => c.repeat(64));
        const cache = memoryQueryResultCache();
        cache.put(kept, null, new Uint8Array([1]));
        const importFile = cache.importFile.getMockImplementation()!;
        // A result whose file is gone, e.g. a dropped file that was moved before the import
        cache.importFile.mockImplementation(async (key, data) => {
            if (key === failing) throw new Error('NotReadableError');
            return await importFile(key, data);
        });
        const logger = testLogger();

        const outcome = await importWorkbookQueryResults(cache, [
            result(failing, [9]), result(added, [1, 2, 3]), result(kept, [4]),
        ], logger);

        expect(outcome).toEqual({ total: 3, added: 1, kept: 1, failed: 1, dropped: 0, bytes: 3, error: 'NotReadableError' });
        expect(await cache.has(added)).toBe(true);
        expect(logger.warn).toHaveBeenCalledWith('Adding an imported query result to the cache failed',
            expect.objectContaining({ key: failing, error: expect.stringContaining('NotReadableError') }), expect.any(String));
        expect(logger.debug).toHaveBeenCalledWith('Added an imported query result to the cache', { key: added, bytes: '3' }, expect.any(String));
        expect(logger.debug).toHaveBeenCalledWith('Kept the cached query result of an imported key', { key: kept, bytes: '1' }, expect.any(String));
    });

    it('leaves out the results beyond the capacity of the cache, they would evict each other', async () => {
        const cache = memoryQueryResultCache();
        cache.capacity = { maxBytes: 5, maxFiles: 10 };
        const logger = testLogger();
        const [first, second] = ['a', 'b'].map(c => c.repeat(64));
        expect(await importWorkbookQueryResults(cache, [result(first, [1, 2, 3]), result(second, [4, 5, 6])], logger))
            .toEqual({ total: 2, added: 1, kept: 0, failed: 0, dropped: 1, bytes: 3, error: null });
        expect(await cache.has(second)).toBe(false);
        expect(logger.warn).toHaveBeenCalledWith('Left out an imported query result, the cache is full', { key: second, bytes: '3' }, expect.any(String));
        // The checksum of the archive goes to the cache, which checks it while it streams the bytes
        const target = memoryQueryResultCache();
        await importWorkbookQueryResults(target, [{ ...result(first, [1]), crc32: 1234 }]);
        expect(target.importFile).toHaveBeenCalledWith(first, expect.any(Blob), { crc32: 1234 });
    });
});
