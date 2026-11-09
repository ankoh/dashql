import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CatalogLoaderProvider, useCatalogLoaderQueue, type CatalogLoaderDependencies } from './catalog_loader.js';
import { type ConnectionRegistry, type DynamicConnectionDispatch } from '../connection_registry.js';
import { CATALOG_UPDATE_CANCELLED, CATALOG_UPDATE_FAILED, CATALOG_UPDATE_SUCCEEDED,
    UPDATE_CATALOG, ConnectionHealth, type ConnectionState, type CatalogAction } from '../connection_state.js';
import { reduceCatalogAction, CatalogUpdateVariant, MAX_TOUCHED_ATTEMPTS } from './catalog_update_state.js';
import { HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, DBCOM_CONNECTOR } from '../connector_info.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('CatalogLoaderProvider queue', () => {
    let container: HTMLDivElement;
    let root: Root;
    let registry: ConnectionRegistry;
    let enqueue: ReturnType<typeof useCatalogLoaderQueue>;
    let dependencies: CatalogLoaderDependencies;
    let providerRenders: number;
    const updates: Array<{ signal: AbortSignal; resolve: () => void; reject: (error: Error) => void }> = [];
    const dispatch = vi.fn<DynamicConnectionDispatch>();
    const scriptsDispatch = vi.fn();
    const updateHyperCatalog = vi.fn<CatalogLoaderDependencies['updateHyperCatalog']>();

    function CaptureQueue() {
        enqueue = useCatalogLoaderQueue();
        return null;
    }

    async function render() {
        await act(async () => root.render(
            <LoggerProvider>
                <CatalogLoaderProvider dependencies={dependencies} onCatalogDidUpdate={scriptsDispatch}>
                    <CaptureQueue />
                </CatalogLoaderProvider>
            </LoggerProvider>,
        ));
    }

    async function settleUpdate(settle: () => void, drainsQueue = false) {
        const rendersBeforeCompletion = providerRenders;
        await act(async () => {
            settle();
            // Browser act uses flushSync, not React's development async-act queue.
            // Let updateImpl and doUpdate finish before flushing their queue state update.
            await new Promise<void>(resolve => setTimeout(resolve, 0));
        });
        if (drainsQueue) {
            // Completion wakes the queue, then consuming the request commits its removal.
            // flushSync alone does not flush these asynchronously scheduled renders.
            await vi.waitFor(() => expect(providerRenders).toBeGreaterThanOrEqual(rendersBeforeCompletion + 2));
        }
    }

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        updates.length = 0;
        providerRenders = 0;
        dispatch.mockReset();
        scriptsDispatch.mockReset();
        updateHyperCatalog.mockReset();
        const connection = {
            connectionId: 'database',
            connectorInfo: {},
            details: { type: HYPER_CONNECTOR, value: { proto: { setupParams: {} } } },
            catalog: { version: () => 0 },
            catalogUpdates: {
                tasksRunning: new Map(), tasksFinished: new Map(),
                currentFullRefresh: null, described: false, touchedRelations: [], touchedFailures: 0,
            },
            queriesActive: new Map(),
        } as unknown as ConnectionState;
        registry = {
            connections: new Map([['database', connection]]),
            connectionsByType: [],
        };
        // Deliberately do not rerender on dispatch: completion itself must wake the queue.
        dispatch.mockImplementation((id, action) => {
            registry.connections.set(id!, reduceCatalogAction(
                registry.connections.get(id!)!, action as CatalogAction,
            ));
        });
        updateHyperCatalog.mockImplementation((...args) => new Promise((resolve, reject) => {
            updates.push({
                signal: args[11],
                resolve: () => resolve({ updatedDatabases: ['database'], failures: [] }),
                reject,
            });
        }));
        const executor = vi.fn<ReturnType<CatalogLoaderDependencies['useQueryExecutor']>>();
        dependencies = {
            useDynamicConnectionDispatch: () => {
                providerRenders++;
                return [registry, dispatch];
            },
            useQueryExecutor: () => executor,
            useSalesforceAPI: () => null as unknown as ReturnType<CatalogLoaderDependencies['useSalesforceAPI']>,
            updateHyperCatalog,
        };
    });

    afterEach(async () => {
        await act(async () => {
            root.unmount();
            for (const update of updates) update.reject(new DOMException('Test cleanup', 'AbortError'));
        });
        container.remove();
        vi.restoreAllMocks();
    });

    it('aborts a running refresh once, preserves pending force, and starts its replacement after cancellation settles', async () => {
        await render();
        await act(async () => enqueue('database', false));
        expect(updateHyperCatalog).toHaveBeenCalledTimes(1);
        const first = updates[0];
        const task = registry.connections.get('database')!.catalogUpdates.tasksRunning.values().next().value!;
        const abort = vi.spyOn(task.cancellation, 'abort');

        await act(async () => enqueue('database', true));
        expect(first.signal.aborted).toBe(true);
        expect(first.signal.reason.name).toBe('AbortError');
        expect(updateHyperCatalog).toHaveBeenCalledTimes(1);
        // An auto request cannot downgrade force while cancellation is still pending.
        await act(async () => enqueue('database', false));
        registry = { ...registry };
        await render();
        expect(abort).toHaveBeenCalledTimes(1);
        expect(updateHyperCatalog).toHaveBeenCalledTimes(1);

        await settleUpdate(() => first.reject(first.signal.reason), true);
        expect(updateHyperCatalog).toHaveBeenCalledTimes(2);
        expect(updates[1].signal.aborted).toBe(false);
        expect(dispatch.mock.calls.some(([, action]) => action.type === CATALOG_UPDATE_CANCELLED)).toBe(true);
        registry = { ...registry };
        await render();
        expect(updates[1].signal.aborted).toBe(false);
        expect(updateHyperCatalog).toHaveBeenCalledTimes(2);
        await settleUpdate(() => updates[1].resolve());
        expect(scriptsDispatch).toHaveBeenCalledTimes(1);
    });

    it('registers the client functions of a connection and announces them', async () => {
        const registerClientFunctions = vi.fn(() => 'cdp');
        registry.connections.set('salesforce', {
            connectionId: 'salesforce',
            connectorInfo: {},
            details: { type: SALESFORCE_DATA_CLOUD_CONNECTOR, value: { proto: { setupParams: {} } } },
            catalog: { registerClientFunctions, version: () => 0 },
            catalogUpdates: { tasksRunning: new Map(), touchedRelations: [] },
            queriesActive: new Map(),
        } as unknown as ConnectionState);
        await render();
        await vi.waitFor(() => expect(registerClientFunctions).toHaveBeenCalledTimes(1), { timeout: 5000 });
        await vi.waitFor(() => expect(scriptsDispatch).toHaveBeenCalledWith('salesforce'));
    });

    it('describes a Database.com connection with the Hyper catalog of its attached database', async () => {
        const connection = registry.connections.get('database')!;
        registry.connections.set('database', {
            ...connection,
            details: { type: DBCOM_CONNECTOR, value: { proto: { setupParams: { databaseName: 'sales' } } } },
        } as unknown as ConnectionState);
        await render();
        await act(async () => enqueue('database', true));
        expect(updateHyperCatalog).toHaveBeenCalledTimes(1);
        expect(updateHyperCatalog.mock.calls[0][4]).toEqual([{ path: 'hyper.cloud:sales', alias: 'lakehouse' }]);
        expect(updateHyperCatalog.mock.calls[0][10]).toBe(false);
        await settleUpdate(() => updates[0].resolve());
        expect(dispatch.mock.calls.some(([, action]) => action.type === CATALOG_UPDATE_SUCCEEDED)).toBe(true);
    });

    describe('the relations of executed statements', () => {
        const ORDERS = { databaseName: 'hyper', schemaName: '', tableName: 'orders' };
        const touch = () => {
            const connection = registry.connections.get('database')!;
            registry.connections.set('database', {
                ...connection,
                params: { hyper: { protocol: 'V3_HTTP', endpoint: 'http://hyper.example' } },
                connectionHealth: ConnectionHealth.ONLINE,
                catalogUpdates: { ...connection.catalogUpdates, described: true, touchedRelations: [ORDERS] },
            } as ConnectionState);
            registry = { ...registry };
        };
        const relationsOfCall = (call: number) => updateHyperCatalog.mock.calls[call][13];

        it('are asked about once the connection has room for another query', async () => {
            const connection = registry.connections.get('database')!;
            registry.connections.set('database', { ...connection, queriesActive: new Map([[1, {}], [2, {}], [3, {}], [4, {}]]) } as unknown as ConnectionState);
            touch();
            await render();
            expect(updateHyperCatalog).not.toHaveBeenCalled();
            registry.connections.set('database', { ...registry.connections.get('database')!, queriesActive: new Map() });
            registry = { ...registry };
            await render();
            await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(1));
            expect(relationsOfCall(0)).toEqual([ORDERS]);
            const started = dispatch.mock.calls.find(([, action]) => action.type === UPDATE_CATALOG)![1] as { value: [number, { taskVariant: CatalogUpdateVariant }] };
            expect(started.value[1].taskVariant).toBe(CatalogUpdateVariant.RELATION_REFRESH);
            await settleUpdate(() => updates[0].resolve());
            expect(scriptsDispatch).toHaveBeenCalledTimes(1);
        });

        it('wait for a running refresh that may have read them too early', async () => {
            await render();
            await act(async () => enqueue('database', false));
            expect(updateHyperCatalog).toHaveBeenCalledTimes(1);
            expect(relationsOfCall(0)).toBeNull();
            touch();
            await render();
            expect(updateHyperCatalog).toHaveBeenCalledTimes(1);
            await settleUpdate(() => updates[0].resolve());
            await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(2));
            expect(relationsOfCall(1)).toEqual([ORDERS]);
            await settleUpdate(() => updates[1].resolve());
        });

        it('are asked about again when the update failed', async () => {
            touch();
            await render();
            await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(1));
            await settleUpdate(() => updates[0].reject(new Error('down')));
            expect(registry.connections.get('database')!.catalogUpdates.touchedRelations).toEqual([ORDERS]);
            expect(registry.connections.get('database')!.catalogUpdates.touchedFailures).toBe(1);
            // Not right away
            registry = { ...registry };
            await render();
            expect(updateHyperCatalog).toHaveBeenCalledTimes(1);
            registry = { ...registry };
            await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(2), { timeout: 5000 });
            expect(relationsOfCall(1)).toEqual([ORDERS]);
            await settleUpdate(() => updates[1].resolve());
            expect(registry.connections.get('database')!.catalogUpdates.touchedFailures).toBe(0);
        });

        it('stop being asked about when the attempts are used up', async () => {
            const connection = registry.connections.get('database')!;
            registry.connections.set('database', { ...connection, catalogUpdates: { ...connection.catalogUpdates, touchedFailures: MAX_TOUCHED_ATTEMPTS } });
            touch();
            await render();
            await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
            expect(updateHyperCatalog).not.toHaveBeenCalled();
        });
    });

    it('tries an auto request once more after a failure, without a registry rerender or another enqueue', async () => {
        await render();
        await act(async () => enqueue('database', true));
        await act(async () => enqueue('database', false));
        expect(updates[0].signal.aborted).toBe(false);
        expect(updateHyperCatalog).toHaveBeenCalledTimes(1);
        await settleUpdate(() => updates[0].reject(new Error('metadata unavailable')), true);
        expect(dispatch.mock.calls.some(([, action]) => action.type === CATALOG_UPDATE_FAILED)).toBe(true);
        expect(scriptsDispatch).not.toHaveBeenCalled();
        await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(2));
        await settleUpdate(() => updates[1].resolve());
        registry = { ...registry };
        await render();
        expect(updateHyperCatalog).toHaveBeenCalledTimes(2);
    });

    it('runs a forced refresh ahead of a lookup that keeps coming back', async () => {
        const ORDERS = { databaseName: 'hyper', schemaName: '', tableName: 'orders' };
        const connection = registry.connections.get('database')!;
        registry.connections.set('database', {
            ...connection,
            params: { hyper: { protocol: 'V3_HTTP', endpoint: 'http://hyper.example' } },
            connectionHealth: ConnectionHealth.ONLINE,
            catalogUpdates: { ...connection.catalogUpdates, described: true, touchedRelations: [ORDERS] },
        } as ConnectionState);
        registry = { ...registry };
        await render();
        await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(1));
        expect(updateHyperCatalog.mock.calls[0][13]).toEqual([ORDERS]);

        // The forced refresh cancels the lookup, which gives its relation back
        await act(async () => enqueue('database', true));
        expect(updates[0].signal.aborted).toBe(true);
        await settleUpdate(() => updates[0].reject(new DOMException('cancelled', 'AbortError')), true);
        await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(2));
        expect(updateHyperCatalog.mock.calls[1][13]).toBeNull();

        // The lookup follows the refresh
        await settleUpdate(() => updates[1].resolve());
        await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(3));
        expect(updateHyperCatalog.mock.calls[2][13]).toEqual([ORDERS]);
        await settleUpdate(() => updates[2].resolve());
    });

    it('consumes a queued auto request after success without cancelling a later forced refresh', async () => {
        await render();
        await act(async () => enqueue('database', true));
        await act(async () => enqueue('database', false));
        await settleUpdate(() => updates[0].resolve(), true);
        expect(dispatch.mock.calls.some(([, action]) => action.type === CATALOG_UPDATE_SUCCEEDED)).toBe(true);
        expect(updateHyperCatalog).toHaveBeenCalledTimes(1);
        expect(scriptsDispatch).toHaveBeenCalledTimes(1);
        registry = { ...registry };
        await render();
        expect(updateHyperCatalog).toHaveBeenCalledTimes(1);

        await act(async () => enqueue('database', true));
        registry = { ...registry };
        await render();
        expect(updateHyperCatalog).toHaveBeenCalledTimes(2);
        expect(updates[1].signal.aborted).toBe(false);
        await settleUpdate(() => updates[1].resolve());
        expect(scriptsDispatch).toHaveBeenCalledTimes(2);
    });
    it('refreshes the catalog of an embedded database whenever it comes online', async () => {
        const connection = registry.connections.get('database')!;
        registry.connections.set('database', { ...connection, params: { hyper: { protocol: 'WASM' } }, connectionHealth: ConnectionHealth.ONLINE } as ConnectionState);
        // The request is enqueued by an effect, its update starts with a later render
        await render();
        await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(1));
        await settleUpdate(() => updates[0].resolve());
        registry = { ...registry };
        await render();
        expect(updateHyperCatalog).toHaveBeenCalledTimes(1);

        // A reconnect describes the database again
        const online = registry.connections.get('database')!;
        registry.connections.set('database', { ...online, connectionHealth: ConnectionHealth.CONNECTING });
        registry = { ...registry };
        await render();
        registry.connections.set('database', online);
        registry = { ...registry };
        await render();
        await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(2));
    });

    it('keeps the restored catalog of a durable connection when it comes online', async () => {
        const connection = registry.connections.get('database')!;
        registry.connections.set('database', {
            ...connection,
            params: { hyper: { protocol: 'V3_HTTP', endpoint: 'http://hyper.example' } },
            connectionHealth: ConnectionHealth.ONLINE,
            catalogUpdates: { ...connection.catalogUpdates, described: true },
        } as ConnectionState);
        await render();
        await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
        expect(updateHyperCatalog).not.toHaveBeenCalled();
    });

    it('asks a restored catalog only about what it has not answered yet', async () => {
        const ORDERS = { databaseName: 'hyper', schemaName: '', tableName: 'orders' };
        const connection = registry.connections.get('database')!;
        registry.connections.set('database', {
            ...connection,
            params: { hyper: { protocol: 'V3_HTTP', endpoint: 'http://hyper.example' } },
            connectionHealth: ConnectionHealth.CONNECTING,
            catalogUpdates: { ...connection.catalogUpdates, described: true, touchedRelations: [ORDERS] },
        } as ConnectionState);
        await render();
        await act(async () => { await new Promise<void>(resolve => setTimeout(resolve, 0)); });
        expect(updateHyperCatalog).not.toHaveBeenCalled();
        registry.connections.set('database', { ...registry.connections.get('database')!, connectionHealth: ConnectionHealth.ONLINE });
        registry = { ...registry };
        await render();
        await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(1));
        expect(updateHyperCatalog.mock.calls[0][13]).toEqual([ORDERS]);
        await settleUpdate(() => updates[0].resolve());
    });

    it('describes the catalog of a durable connection without one when it comes online', async () => {
        const connection = registry.connections.get('database')!;
        registry.connections.set('database', { ...connection, params: { hyper: { protocol: 'V3_HTTP', endpoint: 'http://hyper.example' } }, connectionHealth: ConnectionHealth.ONLINE } as ConnectionState);
        await render();
        await vi.waitFor(() => expect(updateHyperCatalog).toHaveBeenCalledTimes(1));
    });
});
