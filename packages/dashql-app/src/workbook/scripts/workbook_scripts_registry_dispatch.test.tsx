import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import { ConnectionRegistry } from '../../connections/connection_registry.js';
import { WorkbookTestBackend } from '@ankoh/dashql-sdk/testing/workbook_test_backend';
import { StorageProvider } from '../../storage/storage_provider.js';
import { isCloudPreview, isEphemeralWorkbook, REGISTER_QUERY, RENAME_WORKBOOK, REORDER_SCRIPTS, SET_WORKBOOK_CLOUD_LINK, type WorkbookScripts } from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts';
import { StorageWriter, WRITE_WORKBOOK_PROPERTIES } from '@ankoh/dashql-sdk/storage/storage_writer';
import {
    WorkbookScriptsRegistryProvider,
    useWorkbookScripts,
    useWorkbookScriptsRegistry,
} from './workbook_scripts_registry.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

function fixture(workbookId: string): WorkbookScripts {
    // REGISTER_QUERY only needs the script entry; no Wasm or execution setup is required.
    return {
        workbookId,
        pendingConnection: null,
        scripts: { 1: { scriptKey: 1, fileName: '1.sql', latestQueryId: null, connection: { connectionId: `${workbookId}-database` } } },
        scriptRefs: { '1.sql': { scriptId: 1, fileName: '1.sql' } },
        scriptOrder: ['1.sql'],
    } as unknown as WorkbookScripts;
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

describe('useWorkbookScripts dispatch', () => {
    it('keeps retained and current modifiers bound to their workbooks when a reused route batches actions', async () => {
        const write = vi.spyOn(StorageWriter.prototype, 'write').mockResolvedValue(true);
        const workbooks = [fixture('a'), fixture('b')];
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
                        <ConnectionRegistry>
                            <WorkbookScriptsRegistryProvider>
                                <SeedRegistry workbooks={workbooks}>
                                    {/* No key: changing the route id must reuse the hook and its pending queue. */}
                                    <Consumer workbookId={workbookId} capture={capture} />
                                </SeedRegistry>
                            </WorkbookScriptsRegistryProvider>
                        </ConnectionRegistry>
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
                resultA = modifyA({ type: REGISTER_QUERY, value: [1, 101] });
                resultB = modifyB({ type: REGISTER_QUERY, value: [1, 202] });
                expect(registry.workbookScriptsMap.get('a')?.scripts[1].latestQueryId).toBeNull();
                expect(registry.workbookScriptsMap.get('b')?.scripts[1].latestQueryId).toBeNull();
            });

            const [resolvedA, resolvedB] = await Promise.all([resultA, resultB]);
            expect(resolvedA).toMatchObject({ workbookId: 'a', scripts: { 1: { latestQueryId: 101 } } });
            expect(resolvedB).toMatchObject({ workbookId: 'b', scripts: { 1: { latestQueryId: 202 } } });
            await vi.waitFor(() => expect(current[0]?.scripts[1].latestQueryId).toBe(202));
            expect(registry.workbookScriptsMap.get('a')?.scripts[1].latestQueryId).toBe(101);
            expect(registry.workbookScriptsMap.get('b')?.scripts[1].latestQueryId).toBe(202);
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

    it('promotes an ephemeral workbook that holds a script', async () => {
        const write = vi.spyOn(StorageWriter.prototype, 'write').mockResolvedValue(true);
        const greeter = {
            ...fixture('greeter'),
            name: 'New Workbook',
            workbookMetadata: { originalFileName: 'hyper', ephemeral: true },
        } as WorkbookScripts;
        const empty = { ...fixture('empty'), name: 'Other', workbookMetadata: { ephemeral: true }, scriptOrder: [] } as unknown as WorkbookScripts;
        const workbooks = [{ ...fixture('other'), name: 'Untitled', workbookMetadata: {} } as WorkbookScripts, greeter, empty];
        const container = document.createElement('div');
        const root = createRoot(container);
        let current!: ScriptsHook;
        let registry!: ScriptsRegistry;
        const capture = (scripts: ScriptsHook, nextRegistry: ScriptsRegistry) => {
            current = scripts;
            registry = nextRegistry;
        };
        try {
            await act(async () => {
                root.render(<LoggerProvider>
                    <StorageProvider backend={new WorkbookTestBackend()}>
                        <ConnectionRegistry>
                            <WorkbookScriptsRegistryProvider>
                                <SeedRegistry workbooks={workbooks}>
                                    <Consumer workbookId="greeter" capture={capture} />
                                </SeedRegistry>
                            </WorkbookScriptsRegistryProvider>
                        </ConnectionRegistry>
                    </StorageProvider>
                </LoggerProvider>);
            });
            await vi.waitFor(() => expect(current?.[0]?.workbookId).toBe('greeter'));

            await act(async () => { await current[1]({ type: REGISTER_QUERY, value: [1, 101] }); });
            const promoted = registry.workbookScriptsMap.get('greeter')!;
            expect(isEphemeralWorkbook(promoted)).toBe(false);
            expect(promoted.workbookMetadata).toEqual({ originalFileName: 'hyper' });
            // A free name among the full workbooks, the name of the other ephemeral workbook is not taken
            expect(promoted.name).toBe('Untitled 2');
            expect(write).toHaveBeenCalledWith(expect.any(String), {
                type: WRITE_WORKBOOK_PROPERTIES, value: ['greeter', { name: 'Untitled 2' }],
            }, expect.any(Number));

            // Later writes of the properties don't bring the marker back
            await act(async () => { await current[1]({ type: RENAME_WORKBOOK, value: 'Renamed' }); });
            expect(isEphemeralWorkbook(registry.workbookScriptsMap.get('greeter')!)).toBe(false);
            expect(write).toHaveBeenLastCalledWith(expect.any(String), {
                type: WRITE_WORKBOOK_PROPERTIES, value: ['greeter', { name: 'Renamed' }],
            }, expect.any(Number));
        } finally {
            write.mockRestore();
            act(() => root.unmount());
        }
    });

    it('keeps a cloud preview unchanged until it is imported', async () => {
        const write = vi.spyOn(StorageWriter.prototype, 'write').mockResolvedValue(true);
        const cloud = { workbookId: 'c0ffee00-0000-4000-8000-000000000001', versionId: 'c0ffee00-0000-4000-8000-000000000002', connectionId: 'cloud' };
        const preview = {
            ...fixture('preview'),
            name: 'Published',
            workbookMetadata: { originalFileName: '', cloud: { ...cloud, preview: true } },
        } as WorkbookScripts;
        const container = document.createElement('div');
        const root = createRoot(container);
        let current!: ScriptsHook;
        let registry!: ScriptsRegistry;
        const capture = (scripts: ScriptsHook, nextRegistry: ScriptsRegistry) => {
            current = scripts;
            registry = nextRegistry;
        };
        try {
            await act(async () => {
                root.render(<LoggerProvider>
                    <StorageProvider backend={new WorkbookTestBackend()}>
                        <ConnectionRegistry>
                            <WorkbookScriptsRegistryProvider>
                                <SeedRegistry workbooks={[preview]}>
                                    <Consumer workbookId="preview" capture={capture} />
                                </SeedRegistry>
                            </WorkbookScriptsRegistryProvider>
                        </ConnectionRegistry>
                    </StorageProvider>
                </LoggerProvider>);
            });
            await vi.waitFor(() => expect(current?.[0]?.workbookId).toBe('preview'));

            // Renaming and reordering change what the workbook says, a preview refuses them
            await act(async () => { await current[1]({ type: RENAME_WORKBOOK, value: 'Renamed' }); });
            await act(async () => { await current[1]({ type: REORDER_SCRIPTS, value: ['1.sql'] }); });
            expect(registry.workbookScriptsMap.get('preview')!.name).toBe('Published');
            expect(write).not.toHaveBeenCalled();
            // What a run registers stays, the runs refuse a preview before they start
            await act(async () => { await current[1]({ type: REGISTER_QUERY, value: [1, 101] }); });
            expect(registry.workbookScriptsMap.get('preview')!.scripts[1].latestQueryId).toBe(101);

            // Importing drops the mark and keeps the link, the properties write it
            await act(async () => { await current[1]({ type: SET_WORKBOOK_CLOUD_LINK, value: cloud }); });
            const imported = registry.workbookScriptsMap.get('preview')!;
            expect(isCloudPreview(imported)).toBe(false);
            expect(imported.workbookMetadata.cloud).toEqual(cloud);
            expect(write).toHaveBeenLastCalledWith(expect.any(String), {
                type: WRITE_WORKBOOK_PROPERTIES, value: ['preview', { name: 'Published', cloud }],
            }, expect.any(Number));

            // A rename keeps the link
            await act(async () => { await current[1]({ type: RENAME_WORKBOOK, value: 'Renamed' }); });
            expect(write).toHaveBeenLastCalledWith(expect.any(String), {
                type: WRITE_WORKBOOK_PROPERTIES, value: ['preview', { name: 'Renamed', cloud }],
            }, expect.any(Number));
        } finally {
            write.mockRestore();
            act(() => root.unmount());
        }
    });
});
