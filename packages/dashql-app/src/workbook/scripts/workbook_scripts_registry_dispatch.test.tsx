import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as core from '@ankoh/dashql-core';

import { CONNECTOR_INFOS, ConnectorType } from '@ankoh/dashql-runtime/connections/connector_info';
import { createEmptyMetadata } from '@ankoh/dashql-runtime/workbook/scripts/script_types';

import { LoggerProvider } from '../../platform/logger/logger_provider.js';

import { WorkbookTestBackend } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import { StorageProvider } from '../../storage/storage_provider.js';
import { createWorkbookScripts, isCloudPreview, isEphemeralWorkbook, REGISTER_QUERY, RENAME_WORKBOOK, REORDER_SCRIPTS, SET_WORKBOOK_CLOUD_LINK, type WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { StorageWriter, WRITE_WORKBOOK_PROPERTIES } from '@ankoh/dashql-runtime/storage/storage_writer';
import { useWorkbookScripts, useWorkbookScriptsRegistry } from './workbook_scripts_registry.js';
import { TestRuntime } from '../../tests/test_runtime.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

/// A workbook with the script `1.sql`, its key is the key that the tests read
function fixture(workbookId: string): WorkbookScripts {
    const connection = { connectionId: `${workbookId}-database`, connectorInfo: CONNECTOR_INFOS[ConnectorType.HYPER], catalog: dql.createCatalog() };
    return createWorkbookScripts({
        instance: dql, workbookId, name: null, workbookMetadata: createEmptyMetadata(), pendingConnection: null,
        scripts: [{ name: '1.sql', sql: 'select 1', connection }],
    });
}

function SeedRegistry(props: { workbooks: WorkbookScripts[]; children: React.ReactNode }) {
    const [, setRegistry] = useWorkbookScriptsRegistry();
    const [ready, setReady] = React.useState(false);
    React.useEffect(() => {
        setRegistry(registry => ({
            ...registry,
            workbookScriptsMap: new Map(props.workbooks.map(workbook => [workbook.workbookId, workbook])),
        }));
        setReady(true);
    }, [props.workbooks, setRegistry]);
    return ready ? props.children : null;
}

type ScriptsHook = ReturnType<typeof useWorkbookScripts>;
type ScriptsRegistry = ReturnType<typeof useWorkbookScriptsRegistry>[0];

function Consumer(props: { workbookId: string; capture: (scripts: ScriptsHook, registry: ScriptsRegistry) => void }) {
    const scripts = useWorkbookScripts(props.workbookId);
    const [registry] = useWorkbookScriptsRegistry();
    React.useLayoutEffect(() => props.capture(scripts, registry));
    return null;
}

// The actions of the registry are tested in the runtime (workbook/scripts/workbook_scripts_registry_service.test.ts), this
// is the hook of the app on it
describe('useWorkbookScripts dispatch', () => {
    it('keeps retained and current modifiers bound to their workbooks when a reused route batches actions', async () => {
        const write = vi.spyOn(StorageWriter.prototype, 'write').mockResolvedValue(true);
        const workbooks = [fixture('a'), fixture('b')];
        const [keyA, keyB] = workbooks.map(workbook => workbook.scriptRefs['1.sql'].scriptId);
        const backend = new WorkbookTestBackend();
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        let current!: ScriptsHook;
        let registry!: ScriptsRegistry;
        const capture = (scripts: ScriptsHook, nextRegistry: ScriptsRegistry) => {
            current = scripts;
            registry = nextRegistry;
        };
        const render = async (workbookId: string) => {
            await act(async () => {
                root.render(<LoggerProvider>
                    <StorageProvider backend={backend}>
                        <TestRuntime>
                            <SeedRegistry workbooks={workbooks}>
                                {/* No key: changing the route id must reuse the hook and its pending queue. */}
                                <Consumer workbookId={workbookId} capture={capture} />
                            </SeedRegistry>
                        </TestRuntime>
                    </StorageProvider>
                </LoggerProvider>);
            });
            // The seeded registry renders the consumer from a scheduled (non-sync) update.
            await vi.waitFor(() => expect(current?.[0]?.workbookId).toBe(workbookId));
        };

        try {
            await render('a');
            const modifyA = current[1];
            await render('b');
            const modifyB = current[1];
            expect(modifyB).not.toBe(modifyA);

            let resultA!: ReturnType<typeof modifyA>;
            let resultB!: ReturnType<typeof modifyB>;
            await act(async () => {
                // Both calls enqueue synchronously before the shared queue's microtask flush.
                resultA = modifyA({ type: REGISTER_QUERY, value: [keyA, 101] });
                resultB = modifyB({ type: REGISTER_QUERY, value: [keyB, 202] });
                expect(registry.workbookScriptsMap.get('a')?.scripts[keyA].latestQueryId).toBeNull();
                expect(registry.workbookScriptsMap.get('b')?.scripts[keyB].latestQueryId).toBeNull();
            });

            const [resolvedA, resolvedB] = await Promise.all([resultA, resultB]);
            expect(resolvedA).toMatchObject({ workbookId: 'a', scripts: { [keyA]: { latestQueryId: 101 } } });
            expect(resolvedB).toMatchObject({ workbookId: 'b', scripts: { [keyB]: { latestQueryId: 202 } } });
            await vi.waitFor(() => expect(current[0]?.scripts[keyB].latestQueryId).toBe(202));
            expect(registry.workbookScriptsMap.get('a')?.scripts[keyA].latestQueryId).toBe(101);
            expect(registry.workbookScriptsMap.get('b')?.scripts[keyB].latestQueryId).toBe(202);
            act(() => {
                modifyA({ type: RENAME_WORKBOOK, value: 'Offline workbook' });
            });
            await vi.waitFor(() => expect(write).toHaveBeenCalledWith(expect.any(String), {
                type: WRITE_WORKBOOK_PROPERTIES, value: ['a', { name: 'Offline workbook' }],
            }, expect.any(Number)));
        } finally {
            write.mockRestore();
            act(() => root.unmount());
            container.remove();
        }
    });

});
