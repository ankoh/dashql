import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { QueryCacheView } from './query_cache_view.js';
import type { ConnectionState } from '@ankoh/dashql/platform/connections/connection_state';
import type { Runtime } from '@ankoh/dashql/runtime/runtime';
import { useRuntime } from '../../runtime/runtime_hooks.js';
import { LoggerProvider, useLogger } from '../../platform/logger/logger_provider.js';
import type { Logger } from '@ankoh/dashql/platform/platform/logger/logger';
import { StorageProvider } from '../../storage/storage_provider.js';
import { QueryResultCacheProvider } from '../../storage/query_result_cache_provider.js';
import { WorkbookTestBackend } from '@ankoh/dashql/platform/testing/workbook_test_backend';
import { memoryQueryResultCache } from '@ankoh/dashql/platform/testing/memory_query_result_cache';
import { createTestRoot } from '../../tests/react_root.js';
import { TestRuntime } from '../../tests/test_runtime.js';

const CONNECTION_ID = 'query-cache-view-test';

/// A finished query that advertises the result of a cache key
interface CachedQuery { queryId: number; cacheKey: string; cacheDeleted: boolean }

/// Finished queries of a connection that advertise the results of cache keys. The queries get their keys when the
/// executor caches their results (tested in the runtime), the runtime of the test lists them on a connection and
/// marks them when the view deletes their results.
function withCachedQueries(runtime: Runtime, cacheKeys: string[]): Map<number, CachedQuery> {
    const queries = new Map(cacheKeys.map((cacheKey, i): [number, CachedQuery] => [i + 1, { queryId: i + 1, cacheKey, cacheDeleted: false }]));
    const all = runtime.store.all.bind(runtime.store);
    vi.spyOn(runtime.store, 'all').mockImplementation(((kind: string) => {
        const current = (all as (kind: string) => ReadonlyMap<unknown, unknown>)(kind);
        if (kind !== 'connection') return current;
        const connection = { connectionId: CONNECTION_ID, queriesFinishedOrdered: [...queries.keys()] } as unknown as ConnectionState;
        return new Map([...current, [CONNECTION_ID, connection]]);
    }) as typeof runtime.store.all);
    const get = runtime.store.get.bind(runtime.store);
    vi.spyOn(runtime.store, 'get').mockImplementation(((kind: string, id: unknown) => kind === 'query' && queries.has(id as number)
        ? queries.get(id as number)
        : (get as (kind: string, id: unknown) => unknown)(kind, id)) as typeof runtime.store.get);
    const dispatch = runtime.dispatch.bind(runtime);
    vi.spyOn(runtime, 'dispatch').mockImplementation((target, action) => {
        if (action.kind === 'queryCacheDeleted' && queries.has(action.value.queryId)) {
            queries.get(action.value.queryId)!.cacheDeleted = true;
            return { ok: true } as ReturnType<Runtime['dispatch']>;
        }
        return dispatch(target, action);
    });
    return queries;
}

describe('QueryCacheView', () => {
    let root: ReturnType<typeof createTestRoot>;
    let cache: ReturnType<typeof memoryQueryResultCache>;
    let runtime: Runtime | null;
    let cached: Map<number, CachedQuery> | null;
    let logger: Logger;
    let onClose: ReturnType<typeof vi.fn<() => void>>;

    function Capture() {
        runtime = useRuntime();
        logger = useLogger();
        return null;
    }

    async function render(showView: boolean = true, cacheKeys: string[] | null = null) {
        const tree = (show: boolean) => (
            <LoggerProvider>
                <StorageProvider backend={new WorkbookTestBackend()}>
                    <QueryResultCacheProvider cache={cache}>
                        <TestRuntime>
                            <>
                                <Capture />
                                {show && <QueryCacheView onClose={onClose} />}
                            </>
                        </TestRuntime>
                    </QueryResultCacheProvider>
                </StorageProvider>
            </LoggerProvider>
        );
        await root.render(tree(false));
        if (cacheKeys != null) cached = withCachedQueries(runtime!, cacheKeys);
        if (showView) await root.render(tree(true));
    }

    const button = (label: string) => root.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    const rows = () => [...root.container.querySelectorAll<HTMLElement>('[title]')]
        .filter(cell => cell.parentElement?.querySelector('button[aria-label="Delete cache entry"]') != null);
    const keys = () => [...new Set(rows().map(cell => cell.parentElement!.firstElementChild!.textContent))];
    const summary = () => root.container.textContent?.match(/\d+ entr(y|ies) · [^K]+/)?.[0] ?? null;
    const query = (id: number) => cached!.get(id)!;
    const records = () => [...Array(logger.buffer.length).keys()].map(i => logger.buffer.at(i)!);

    beforeEach(() => {
        root = createTestRoot();
        root.container.style.width = '800px';
        root.container.style.height = '400px';
        root.container.style.display = 'flex';
        cache = memoryQueryResultCache();
        runtime = null;
        cached = null;
        onClose = vi.fn<() => void>();
    });

    afterEach(() => {
        root.unmount();
        vi.restoreAllMocks();
    });

    it('shows an empty cache', async () => {
        await render();
        await vi.waitFor(() => expect(cache.list).toHaveBeenCalled());
        expect(root.container.textContent).toContain('Nothing to see here');
        expect(button('Clear the query cache').disabled).toBe(true);
        act(() => button('close-overlay').click());
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('lists the cached results, the most recent first', async () => {
        cache.put('older');
        cache.put('newer');
        await render();
        await vi.waitFor(() => expect(keys()).toEqual(['newer', 'older']));
        expect(summary()).toMatch(/^2 entries · 2 bytes/);
        expect(button('Clear the query cache').disabled).toBe(false);

        // A refresh picks up new entries
        cache.put('newest');
        await act(async () => button('Refresh cache listing').click());
        await vi.waitFor(() => expect(keys()).toEqual(['newest', 'newer', 'older']));
        expect(summary()).toMatch(/^3 entries/);
    });

    it('deletes an entry and marks the queries of its results', async () => {
        cache.put('a');
        cache.put('b');
        await render(true, ['a', 'b']);
        await vi.waitFor(() => expect(keys()).toEqual(['b', 'a']));

        const deleteA = rows().find(cell => cell.textContent === 'a')!.parentElement!.querySelector<HTMLButtonElement>('button[aria-label="Delete cache entry"]')!;
        await act(async () => deleteA.click());
        await vi.waitFor(() => expect(keys()).toEqual(['b']));
        expect(cache.delete).toHaveBeenCalledWith('a');
        expect(summary()).toMatch(/^1 entry · 1 byte/);
        await vi.waitFor(() => expect(query(1).cacheDeleted).toBe(true));
        expect(query(2).cacheDeleted).toBe(false);
    });

    it('keeps the queries of an entry that is still read', async () => {
        cache.put('a');
        cache.delete.mockResolvedValueOnce(false);
        await render(true, ['a']);
        await vi.waitFor(() => expect(keys()).toEqual(['a']));
        await act(async () => root.container.querySelector<HTMLButtonElement>('button[aria-label="Delete cache entry"]')!.click());
        await vi.waitFor(() => expect(cache.delete).toHaveBeenCalledWith('a'));
        await vi.waitFor(() => expect(cache.list).toHaveBeenCalledTimes(2));
        expect(keys()).toEqual(['a']);
        expect(query(1).cacheDeleted).toBe(false);
    });

    it('clears the cache and marks the queries of every result', async () => {
        cache.put('a');
        cache.put('b');
        await render(true, ['a', 'b', 'c']);
        await vi.waitFor(() => expect(keys()).toEqual(['b', 'a']));
        await act(async () => button('Clear the query cache').click());
        await vi.waitFor(() => expect(root.container.textContent).toContain('Nothing to see here'));
        expect(cache.clear).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(query(1).cacheDeleted).toBe(true));
        expect(query(2).cacheDeleted).toBe(true);
        expect(query(3).cacheDeleted).toBe(false);
        const cleared = records().find(r => r.message === 'cleared the query result cache');
        expect(cleared?.keyValues).toEqual({ entries: '2', queries: '2' });
    });

    it('logs failures of the cache', async () => {
        cache.put('a');
        cache.list.mockRejectedValueOnce(new Error('listing broke'));
        await render();
        await vi.waitFor(() => expect(records().find(r => r.message === 'failed to list query result cache')?.keyValues).toEqual({ error: 'listing broke' }));
        expect(root.container.textContent).toContain('Nothing to see here');

        await act(async () => button('Refresh cache listing').click());
        await vi.waitFor(() => expect(keys()).toEqual(['a']));

        cache.delete.mockRejectedValueOnce(new Error('delete broke'));
        await act(async () => root.container.querySelector<HTMLButtonElement>('button[aria-label="Delete cache entry"]')!.click());
        await vi.waitFor(() => expect(records().find(r => r.message === 'failed to delete query result cache entry')?.keyValues).toEqual({ error: 'delete broke' }));
        expect(keys()).toEqual(['a']);

        cache.clear.mockRejectedValueOnce(new Error('clear broke'));
        await act(async () => button('Clear the query cache').click());
        await vi.waitFor(() => expect(records().find(r => r.message === 'failed to clear the query result cache')?.keyValues).toEqual({ error: 'clear broke' }));
        expect(keys()).toEqual(['a']);
    });

    it('shows nothing without a cache', async () => {
        await root.render(
            <LoggerProvider>
                <StorageProvider backend={new WorkbookTestBackend()}>
                    <TestRuntime>
                        <QueryCacheView onClose={onClose} />
                    </TestRuntime>
                </StorageProvider>
            </LoggerProvider>,
        );
        expect(root.container.textContent).toContain('Nothing to see here');
        // Clearing is disabled, refreshing without a cache keeps the list empty
        await act(async () => button('Refresh cache listing').click());
        expect(root.container.textContent).toContain('Nothing to see here');
    });
});
