import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CatalogLoaderProvider, useCatalogLoaderQueue, type CatalogLoaderDependencies } from './catalog_loader.js';
import { type ConnectionRegistry, type DynamicConnectionDispatch } from '../connection_registry.js';
import { CATALOG_UPDATE_CANCELLED, CATALOG_UPDATE_FAILED, CATALOG_UPDATE_SUCCEEDED,
    UPDATE_CATALOG, ConnectionHealth, type ConnectionState, type CatalogAction } from '@ankoh/dashql-runtime/connections/connection_state';
import { reduceCatalogAction, CatalogUpdateVariant, MAX_TOUCHED_ATTEMPTS } from '@ankoh/dashql-runtime/connections/catalog/catalog_update_state';
import { HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, DBCOM_CONNECTOR } from '@ankoh/dashql-runtime/connections/connector_info';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

// The loader is tested in the runtime (connections/catalog/catalog_loader_service.test.ts), this is the provider of the
// app on it: the queue it hands out and the registries of its renders
describe('CatalogLoaderProvider queue', () => {
    let container: HTMLDivElement;
    let root: Root;
    let registry: ConnectionRegistry;
    let enqueue: ReturnType<typeof useCatalogLoaderQueue>;
    let dependencies: CatalogLoaderDependencies;
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

    async function settleUpdate(settle: () => void) {
        await act(async () => {
            settle();
            // The update finishes in microtasks, then the loader reconsiders its queue in one more microtask and may
            // start the next update. A task turn lets all of them run.
            await new Promise<void>(resolve => setTimeout(resolve, 0));
        });
    }

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        updates.length = 0;
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
            useDynamicConnectionDispatch: () => [registry, dispatch],
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

        await settleUpdate(() => first.reject(first.signal.reason));
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

});
