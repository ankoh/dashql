import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { InternalsViewer, InternalsViewerOverlay } from './internals_overlay.js';
import { AppConfigProvider, useAppConfig, type AppConfig } from '../../config/app_config.js';
import { FlavorProvider } from '../../config/flavor_provider.js';
import { ConnectionRegistry, useConnectionRegistry } from '../../connections/connection_registry.js';
import { ConnectionHealth, ConnectionStatus, type ConnectionState } from '../../connections/connection_state.js';
import { CONNECTOR_INFOS, ConnectorType } from '../../connections/connector_info.js';
import { createQueryExecutionState, QueryType, type QueryExecutionState } from '../../query/query_execution_state.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { StorageProvider } from '../../storage/storage_provider.js';
import { QueryResultCacheProvider } from '../../storage/query_result_cache_provider.js';
import { SessionTestBackend } from '../../storage/session_test_backend.js';
import { OPFSDirectoryMock } from '../../tests/opfs_mock.js';
import { memoryQueryResultCache } from '../../tests/memory_query_result_cache.js';
import { createTestRoot } from '../../tests/react_root.js';

type Registry = ReturnType<typeof useConnectionRegistry>;

function query(queryId: number, queryType: QueryType): QueryExecutionState {
    return createQueryExecutionState(queryId, queryId, `select ${queryId}`, {
        queryType,
        title: `Query ${queryId}`,
        description: null,
        issuer: 'test',
        userProvided: queryType === QueryType.USER_PROVIDED,
    }, new AbortController());
}

/// A Hyper connection with a finished user query, a finished SQLFrame query and an active query
function connectionWithQueries(): ConnectionState {
    return {
        connectionId: 'internals-test',
        connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER],
        params: {},
        active: false,
        connectionStatus: ConnectionStatus.NOT_STARTED,
        connectionHealth: ConnectionHealth.NOT_STARTED,
        catalog: { clear: vi.fn() },
        catalogUpdates: { tasksRunning: new Map() },
        queriesFinished: new Map([[1, query(1, QueryType.USER_PROVIDED)], [2, query(2, QueryType.INTERNAL_SQLFRAME)]]),
        // The id 4 of a query that is gone is skipped
        queriesFinishedOrdered: [1, 2, 4],
        queriesActive: new Map([[3, query(3, QueryType.USER_PROVIDED)]]),
        queriesActiveOrdered: [3],
    } as unknown as ConnectionState;
}

describe('InternalsViewer', () => {
    let root: ReturnType<typeof createTestRoot>;
    let registry: Registry | null;
    let config: AppConfig | null;
    let onClose: ReturnType<typeof vi.fn<() => void>>;

    function Capture() {
        registry = useConnectionRegistry();
        config = useAppConfig();
        return null;
    }

    beforeEach(() => {
        root = createTestRoot();
        root.container.style.width = '1000px';
        root.container.style.height = '700px';
        root.container.style.display = 'flex';
        registry = null;
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
                            <StorageProvider backend={new SessionTestBackend()}>
                                <ConnectionRegistry>
                                    <QueryResultCacheProvider cache={memoryQueryResultCache()}>
                                        <>
                                            <Capture />
                                            {content}
                                        </>
                                    </QueryResultCacheProvider>
                                </ConnectionRegistry>
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
        await act(async () => registry![1](reg => {
            reg.connections.set('internals-test', connectionWithQueries());
            return { ...reg };
        }));
        await vi.waitFor(() => expect(config).not.toBeNull());
        await root.render(tree(<InternalsViewer sessionId={null} onClose={onClose} />));

        expect(groups()).toEqual([
            ['Diagnostics', ['Application logs']],
            ['Connections', ['HTTP requests', 'Query execution history', 'Query result cache']],
            ['Storage', ['Storage browser', 'Storage writer']],
            ['Settings', ['Application settings']],
        ]);
        // The logs are shown first
        expect(tab('Application logs').getAttribute('aria-current')).toBe('page');
        expect(root.container.textContent).toContain('Logs');

        const titles: [string, string][] = [
            ['HTTP requests', 'Requests'],
            ['Query result cache', 'Cache'],
            ['Storage browser', 'Origin Private File System'],
            ['Storage writer', 'Select a session to see its storage writes'],
            ['Application settings', 'App Settings'],
        ];
        for (const [label, text] of titles) {
            await act(async () => tab(label).click());
            expect(tab(label).getAttribute('aria-current')).toBe('page');
            await vi.waitFor(() => expect(root.container.textContent).toContain(text));
        }

        // The queries of every connection, the finished before the active ones
        await act(async () => tab('Query execution history').click());
        await vi.waitFor(() => expect(root.container.querySelectorAll('[data-testid="query-history-row"]').length).toBe(3));
        const queries = [...root.container.querySelectorAll('[data-testid="query-history-row"]')]
            .map(row => `${row.firstElementChild!.children[1].textContent} ${row.querySelector('[title]')!.textContent}`);
        expect(queries.sort()).toEqual(['Hyper Query 1', 'Hyper Query 3', 'SQLFrame Query 2']);

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
