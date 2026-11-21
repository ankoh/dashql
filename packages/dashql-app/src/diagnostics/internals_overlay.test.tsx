import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { InternalsViewer, InternalsViewerOverlay } from './internals_overlay.js';
import { AppConfigProvider, useAppConfig, type AppConfig } from '../config/app_config.js';
import { FlavorProvider } from '../config/flavor_provider.js';
import { QueryType } from '@akohn/dashql/platform/query/query_execution_state';
import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import { LoggerProvider } from '../host/logger_provider.js';
import { StorageProvider } from '../storage/storage_provider.js';
import { QueryResultCacheProvider } from '../storage/query_result_cache_provider.js';
import { WorkbookTestBackend } from '@akohn/dashql/platform/testing/workbook_test_backend';
import { OPFSDirectoryMock } from '@akohn/dashql/platform/testing/opfs_mock';
import { memoryQueryResultCache } from '@akohn/dashql/platform/testing/memory_query_result_cache';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { TestRuntime } from '../tests/test_runtime.js';
import * as core from '@akohn/dashql';
import type { Runtime } from '@akohn/dashql/runtime/runtime';
import { useRuntime } from '@akohn/dashql-react/hooks';
import { addTestConnection, pendingTestChannel, runTestQuery } from '../tests/test_connections.js';

let appRuntime: Runtime | null = null;

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

/// The metadata of a query of the test
function metadata(queryId: number, queryType: QueryType) {
    return { queryType, title: `Query ${queryId}`, description: null, issuer: 'test', userProvided: queryType === QueryType.USER_PROVIDED };
}

/// A Hyper connection with a finished user query, a finished SQLFrame query and an active query on its channel
async function connectionWithQueries(runtime: Runtime): Promise<void> {
    const connectionId = 'internals-test';
    await addTestConnection(runtime, { connectionId, params: { hyper: {} } as never, health: ConnectionHealth.ONLINE, channel: pendingTestChannel() });
    runTestQuery(runtime, connectionId, 'select 1', metadata(1, QueryType.USER_PROVIDED), true);
    runTestQuery(runtime, connectionId, 'select 2', metadata(2, QueryType.INTERNAL_SQLFRAME), true);
    runTestQuery(runtime, connectionId, 'select 3', metadata(3, QueryType.USER_PROVIDED), false);
    // The queries of the test are in the history, next to the probe of the setup
    await vi.waitFor(() => {
        runtime.flush();
        const connection = runtime.connection(connectionId);
        const texts = [...connection?.queriesFinishedOrdered ?? [], ...connection?.queriesActiveOrdered ?? []]
            .map(queryId => runtime.store.get('query', queryId)?.queryText);
        expect(texts).toEqual(expect.arrayContaining(['select 1', 'select 2', 'select 3']));
    });
}

describe('InternalsViewer', () => {
    let root: ReturnType<typeof createTestRoot>;
    let config: AppConfig | null;
    let onClose: ReturnType<typeof vi.fn<() => void>>;

    function Capture() {
        appRuntime = useRuntime();
        config = useAppConfig();
        return null;
    }

    beforeEach(() => {
        root = createTestRoot();
        root.container.style.width = '1000px';
        root.container.style.height = '700px';
        root.container.style.display = 'flex';
        config = null;
        onClose = vi.fn<() => void>();
        // The storage browser lists an empty OPFS
        const opfs = new OPFSDirectoryMock('', new Map(), new Set());
        vi.spyOn(navigator.storage, 'getDirectory').mockImplementation(async () => opfs as unknown as FileSystemDirectoryHandle);
    });

    afterEach(() => {
        root.unmount();
        vi.restoreAllMocks();
    });

    function tree(content: React.ReactElement | null) {
        return (
            <LoggerProvider>
                <FlavorProvider requested={null}>
                    <AppConfigProvider>
                        <MemoryRouter>
                            <StorageProvider backend={new WorkbookTestBackend()}>
                                <QueryResultCacheProvider cache={memoryQueryResultCache()}>
                                    <TestRuntime>
                                        <>
                                            <Capture />
                                            {content}
                                        </>
                                    </TestRuntime>
                                </QueryResultCacheProvider>
                            </StorageProvider>
                        </MemoryRouter>
                    </AppConfigProvider>
                </FlavorProvider>
            </LoggerProvider>
        );
    }

    const tab = (label: string) => root.container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    const groups = () => [...root.container.querySelectorAll('[role="group"]')].map(group =>
        [group.getAttribute('aria-label'), [...group.querySelectorAll('button[aria-label]')].map(b => b.getAttribute('aria-label'))]);

    it('switches between the tabs', async () => {
        await root.render(tree(null));
        await act(async () => connectionWithQueries(appRuntime!));
        await vi.waitFor(() => expect(config).not.toBeNull());
        await root.render(tree(<InternalsViewer workbookId={null} onClose={onClose} />));

        expect(groups()).toEqual([
            ['Diagnostics', ['Application logs']],
            ['Connections', ['HTTP requests', 'Query execution history', 'Query result cache']],
            ['Storage', ['Storage browser', 'Storage writer']],
            ['Settings', ['Tools', 'Application settings']],
        ]);
        // The logs are shown first
        expect(tab('Application logs').getAttribute('aria-current')).toBe('page');
        expect(root.container.textContent).toContain('Logs');

        const titles: [string, string][] = [
            ['HTTP requests', 'Requests'],
            ['Query result cache', 'Cache'],
            ['Storage browser', 'Origin Private File System'],
            ['Storage writer', 'Select a workbook to see its storage writes'],
            ['Application settings', 'App Settings'],
            ['Tools', 'Drop a .dashql file'],
        ];
        for (const [label, text] of titles) {
            await act(async () => tab(label).click());
            expect(tab(label).getAttribute('aria-current')).toBe('page');
            await vi.waitFor(() => expect(root.container.textContent).toContain(text));
        }

        // A tool opens its page next to the app
        await act(async () => tab('Tools').click());
        expect(root.container.querySelector('a[href="/tools/unpacker"]')?.getAttribute('target')).toBe('_blank');

        // The queries of every connection, the finished before the active ones
        await act(async () => tab('Query execution history').click());
        // The health check of the setup of the connection is a query of its history as well
        await vi.waitFor(() => expect(root.container.querySelectorAll('[data-testid="query-history-row"]').length).toBe(4));
        const queries = [...root.container.querySelectorAll('[data-testid="query-history-row"]')]
            .map(row => `${row.firstElementChild!.children[1].textContent} ${row.querySelector('[title]')!.textContent}`);
        expect(queries).toEqual(expect.arrayContaining(['Hyper Query 1', 'Hyper Query 3', 'SQLFrame Query 2']));

        // Every tab closes the overlay
        act(() => root.container.querySelector<HTMLButtonElement>('button[aria-label="close-overlay"]')!.click());
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('opens as an overlay at its anchor', async () => {
        const overlay = (open: boolean) => tree(
            <InternalsViewerOverlay
                isOpen={open}
                onClose={onClose}
                renderAnchor={p => <button {...p}>Internals</button>}
            />,
        );
        await root.render(overlay(false));
        expect(document.querySelector('button[aria-label="Application logs"]')).toBeNull();
        await root.render(overlay(true));
        await vi.waitFor(() => expect(document.querySelector('button[aria-label="Application logs"]')).not.toBeNull());
        await root.render(overlay(false));
        await vi.waitFor(() => expect(document.querySelector('button[aria-label="Application logs"]')).toBeNull());
    });
});
