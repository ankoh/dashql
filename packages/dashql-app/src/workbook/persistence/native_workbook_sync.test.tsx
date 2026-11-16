import * as core from '@ankoh/dashql-core';
import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Logger } from '@ankoh/dashql-runtime/platform/logger/logger';
import { LoggerProvider, useLogger } from '../../platform/logger/logger_provider.js';
import { TestLogger } from '@ankoh/dashql-runtime/testing/test_logger';
import { CompositeStorageBackend } from '../../storage/composite_storage_backend.js';
import { NativeStorageBackend } from '@ankoh/dashql-runtime/storage/native_storage_backend';
import { WorkbookTestRegistry, testWorkbook } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import { STORAGE_ATTACHMENTS_FOLDER, STORAGE_SCRIPTS_FOLDER, STORAGE_WORKBOOK_FILE, StorageBackendType, type WorkbookData } from '@ankoh/dashql-runtime/storage/storage_backend';
import { StorageProvider } from '../../storage/storage_provider.js';
import type { StorageWriter } from '@ankoh/dashql-runtime/storage/runtime_storage';
import { fsStore, makeFsMock, resetFsStore } from '@ankoh/dashql-runtime/testing/test_fs_mock';
import { NativeWorkbookSync } from './native_workbook_sync_react.js';
import { ELECTRON_FILE_SYSTEM } from '@ankoh/dashql-runtime/platform/electron_fs';
import { TestRuntime } from '../../tests/test_runtime.js';
import type { Runtime } from '@ankoh/dashql-runtime/runtime';
import { useConnections, useRuntime, useWorkbooks } from '../../runtime/runtime_hooks.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const WORKBOOK_ID = '11111111-2222-4333-8444-555555555555';
const HYPER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TRINO_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const HYPER_PARAMS = { hyper: {} } as WorkbookData['connections'][number]['params'];
const TRINO_PARAMS = { trino: { endpoint: 'https://trino.example' } } as WorkbookData['connections'][number]['params'];
const DIR = '/Users/me/workbook';
const SCRIPT_PATH = `${DIR}/${STORAGE_SCRIPTS_FOLDER}/query.sql`;

interface Api {
    runtime: Runtime;
    writer: StorageWriter;
    logger: Logger;
    connections: ReturnType<typeof useConnections>;
    workbooks: ReturnType<typeof useWorkbooks>;
}

/// The app after its restoration: the restoration loads the connections and the workbooks into the runtime of the app
function App(props: { restore: (runtime: Runtime) => Promise<core.RestoreOutcome>; capture: (api: Api) => void }) {
    const logger = useLogger();
    const runtime = useRuntime();
    const writer = runtime.storage;
    const connections = useConnections();
    const workbooks = useWorkbooks();
    const [restored, setRestored] = React.useState<core.RestoreOutcome | null>(null);
    React.useEffect(() => {
        void props.restore(runtime).then(setRestored);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    React.useLayoutEffect(() => {
        if (restored != null) props.capture({ runtime, writer, logger, connections, workbooks });
    });
    return restored != null ? <NativeWorkbookSync /> : null;
}

describe('NativeWorkbookSync', () => {
    let dql: core.DashQL;
    let container: HTMLDivElement;
    let root: Root | null;
    let api: Api;
    let registry: WorkbookTestRegistry;
    let backend: CompositeStorageBackend;
    let confirm: ReturnType<typeof vi.fn<(options: { message: string; title: string }) => Promise<boolean>>>;

    beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

    beforeEach(async () => {
        resetFsStore();
        confirm = vi.fn(async () => true);
        globalThis.dashqlElectron = { fs: makeFsMock(), confirm, onFlush: () => () => { } } as unknown as DashQLElectronBridge;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        registry = new WorkbookTestRegistry();
        backend = new CompositeStorageBackend(registry, new TestLogger());
        await backend.initialize();
    });
    afterEach(() => {
        if (root != null) act(() => root!.unmount());
        container.remove();
        delete globalThis.dashqlElectron;
        dql.resetUnsafe();
    });

    /// A workbook in a native folder
    const workbookFile = (overrides: Partial<WorkbookData> = {}): WorkbookData => testWorkbook({
        workbookId: WORKBOOK_ID,
        name: 'Folder',
        connections: [{ connectionId: HYPER_ID, params: HYPER_PARAMS }],
        scripts: [{ name: 'query.sql', connectionId: HYPER_ID }],
        ...overrides,
    });
    async function seedFolder(): Promise<void> {
        const native = new NativeStorageBackend(DIR, ELECTRON_FILE_SYSTEM);
        await native.saveWorkbookManifest(WORKBOOK_ID, workbookFile());
        await native.saveScript(WORKBOOK_ID, 'query.sql', 'select app');
        await backend.upsertWorkbookEntry({ path: WORKBOOK_ID, storageType: StorageBackendType.Native, nativePath: DIR });
    }

    /// Restore and render the app, resolves once the first check of the workbook acknowledged the disk
    async function renderApp(options: { waitForFirstCheck?: boolean; afterRestore?: () => void } = {}): Promise<void> {
        const folder = backend.nativeWorkbookFolder(WORKBOOK_ID);
        const acknowledged = folder == null ? null : vi.spyOn(folder, 'acknowledgeScripts');
        const restore = async (runtime: Runtime) => {
            const restored = await runtime.restore();
            options.afterRestore?.();
            return restored;
        };
        api = null!;
        await act(async () => {
            root!.render(
                <LoggerProvider>
                    <StorageProvider backend={backend}>
                        <TestRuntime>
                            <App restore={restore} capture={next => { api = next; }} />
                        </TestRuntime>
                    </StorageProvider>
                </LoggerProvider>,
            );
        });
        await vi.waitFor(() => expect(api).not.toBeNull());
        if (options.waitForFirstCheck !== false && acknowledged != null) {
            await vi.waitFor(() => expect(acknowledged).toHaveBeenCalledOnce());
            await settled();
        }
    }

    /// Wait until no check is running
    const settled = () => vi.waitFor(() => expect(api.writer.isWorkbookPaused(WORKBOOK_ID)).toBe(false));
    const scriptText = (name = 'query.sql') => {
        const workbook = api.workbooks.get(WORKBOOK_ID)!;
        return api.runtime.store.get('script', workbook.scriptRefs[name].scriptId)!.scriptSession.getText();
    };
    /// Another program changes a file of the folder
    const changeOnDisk = (path: string, text: string) => {
        fsStore.files.set(path, text);
        fsStore.mtimes.set(path, ++fsStore.clock);
    };
    const focusWindow = () => act(async () => { window.dispatchEvent(new Event('focus')); });
    /// Check the folder and wait for the question and its answer
    async function checkFolder(): Promise<void> {
        await focusWindow();
        await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
        await settled();
    }
    const flush = () => act(async () => { await api.writer.flush(); });
    /// The user changes the text of the script, it changes at once and its write is debounced
    const localEdit = (sql: string) => {
        const workbook = api.workbooks.get(WORKBOOK_ID)!;
        api.runtime.dispatch({ workbook: WORKBOOK_ID }, { kind: 'setScriptText', value: { scriptKey: workbook.scriptRefs['query.sql'].scriptId, text: sql } });
    };

    describe('the first check', () => {
        it('acknowledges the disk without asking, the restoration just read it', async () => {
            await seedFolder();
            await renderApp();
            expect(confirm).not.toHaveBeenCalled();
            expect(scriptText()).toBe('select app');
        });

        it('is retried on the next focus when it failed', async () => {
            await seedFolder();
            const folder = backend.nativeWorkbookFolder(WORKBOOK_ID)!;
            const stamp = vi.spyOn(folder, 'stampFolder');
            const acknowledge = vi.spyOn(folder, 'acknowledgeScripts');
            // The restoration reads the stamps as well, only the check fails
            await renderApp({
                waitForFirstCheck: false,
                afterRestore: () => {
                    stamp.mockClear();
                    stamp.mockRejectedValueOnce(new Error('folder is gone'));
                },
            });
            await vi.waitFor(() => expect(stamp).toHaveBeenCalledOnce());
            await settled();
            expect(acknowledge).not.toHaveBeenCalled();
            await focusWindow();
            await vi.waitFor(() => expect(acknowledge).toHaveBeenCalledOnce());
            expect(confirm).not.toHaveBeenCalled();
        });
    });

    describe('a focus of the window', () => {
        it('does not read the files while their stamps are unchanged', async () => {
            await seedFolder();
            await renderApp();
            const stamp = vi.spyOn(backend.nativeWorkbookFolder(WORKBOOK_ID)!, 'stampFolder');
            const load = vi.spyOn(backend, 'loadScripts');
            await focusWindow();
            await vi.waitFor(() => expect(stamp).toHaveBeenCalledOnce());
            await settled();
            expect(load).not.toHaveBeenCalled();
            expect(confirm).not.toHaveBeenCalled();
        });

        it('does not ask when only the stamp changed, and remembers the new stamp', async () => {
            await seedFolder();
            await renderApp();
            changeOnDisk(SCRIPT_PATH, 'select app');
            const load = vi.spyOn(backend, 'loadScripts');
            await focusWindow();
            await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
            await settled();
            expect(confirm).not.toHaveBeenCalled();
            await focusWindow();
            await settled();
            expect(load).toHaveBeenCalledOnce();
        });
    });

    describe('a script that changed outside the app', () => {
        it('reloads the script when the user agrees', async () => {
            await seedFolder();
            await renderApp();
            changeOnDisk(SCRIPT_PATH, 'select external');
            await checkFolder();
            expect(confirm).toHaveBeenCalledOnce();
            expect(confirm.mock.calls[0][0].message).toContain('changed outside');
            await vi.waitFor(() => expect(scriptText()).toBe('select external'));
            // The disk is what the app shows now, the next write of the script is no conflict
            await flush();
            expect(fsStore.files.get(SCRIPT_PATH)).toBe('select external');
        });

        it('keeps the app version and writes it over the disk when the user declines', async () => {
            await seedFolder();
            await renderApp();
            confirm.mockResolvedValue(false);
            changeOnDisk(SCRIPT_PATH, 'select external');
            await checkFolder();
            expect(scriptText()).toBe('select app');
            await flush();
            expect(fsStore.files.get(SCRIPT_PATH)).toBe('select app');
            // The decision holds until the file changes again
            await focusWindow();
            await settled();
            expect(confirm).toHaveBeenCalledOnce();
        });

        it('asks again for a later change of the file', async () => {
            await seedFolder();
            await renderApp();
            confirm.mockResolvedValue(false);
            changeOnDisk(SCRIPT_PATH, 'select external');
            await checkFolder();
            await flush();
            changeOnDisk(SCRIPT_PATH, 'select external again');
            await focusWindow();
            await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
            await settled();
        });

        it('warns about local changes and discards them when the user agrees', async () => {
            await seedFolder();
            await renderApp();
            localEdit('select local');
            changeOnDisk(SCRIPT_PATH, 'select external');
            await checkFolder();
            expect(confirm.mock.calls[0][0].message).toContain('local changes waiting to be saved');
            await vi.waitFor(() => expect(scriptText()).toBe('select external'));
            expect(api.writer.getPendingKeysForWorkbook(WORKBOOK_ID)).toEqual([]);
            await flush();
            expect(fsStore.files.get(SCRIPT_PATH)).toBe('select external');
        });

        it('keeps pending local changes when the user declines', async () => {
            await seedFolder();
            await renderApp();
            confirm.mockResolvedValue(false);
            localEdit('select local');
            changeOnDisk(SCRIPT_PATH, 'select external');
            await checkFolder();
            await flush();
            expect(fsStore.files.get(SCRIPT_PATH)).toBe('select local');
        });

        it('adds a script file that appeared and lists it in the workbook file', async () => {
            await seedFolder();
            await renderApp();
            changeOnDisk(`${DIR}/${STORAGE_SCRIPTS_FOLDER}/added.sql`, 'select added');
            await checkFolder();
            await vi.waitFor(() => expect(scriptText('added.sql')).toBe('select added'));
            await flush();
            const stored = JSON.parse(fsStore.files.get(`${DIR}/${STORAGE_WORKBOOK_FILE}`)!) as WorkbookData;
            expect(stored.scripts.map(script => script.name).sort()).toEqual(['added.sql', 'query.sql']);
        });

        it('drops a script file that disappeared', async () => {
            await seedFolder();
            await new NativeStorageBackend(DIR, ELECTRON_FILE_SYSTEM).saveScript(WORKBOOK_ID, 'second.sql', 'select second');
            await renderApp();
            fsStore.files.delete(`${DIR}/${STORAGE_SCRIPTS_FOLDER}/second.sql`);
            fsStore.mtimes.delete(`${DIR}/${STORAGE_SCRIPTS_FOLDER}/second.sql`);
            await checkFolder();
            await vi.waitFor(() => expect(api.workbooks.get(WORKBOOK_ID)!.scriptOrder).toEqual(['query.sql']));
            await flush();
            const stored = JSON.parse(fsStore.files.get(`${DIR}/${STORAGE_WORKBOOK_FILE}`)!) as WorkbookData;
            expect(stored.scripts.map(script => script.name)).toEqual(['query.sql']);
        });

        it('keeps a file that only exists on disk when the user declines', async () => {
            await seedFolder();
            await renderApp();
            confirm.mockResolvedValue(false);
            const added = `${DIR}/${STORAGE_SCRIPTS_FOLDER}/added.sql`;
            changeOnDisk(added, 'select added');
            await checkFolder();
            await flush();
            expect(fsStore.files.get(added)).toBe('select added');
            expect(api.workbooks.get(WORKBOOK_ID)!.scriptRefs['added.sql']).toBeUndefined();
        });
    });

    describe('a local edit while the question is open', () => {
        it('asks again before discarding the edit, and keeps it when the user declines', async () => {
            await seedFolder();
            await renderApp();
            confirm.mockImplementationOnce(async () => { localEdit('select typed'); return true; });
            confirm.mockResolvedValueOnce(false);
            changeOnDisk(SCRIPT_PATH, 'select external');
            await checkFolder();
            await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(2));
            await settled();
            expect(confirm.mock.calls[0][0].message).toContain('changed outside');
            expect(confirm.mock.calls[1][0].message).toContain('local changes waiting to be saved');
            await flush();
            expect(fsStore.files.get(SCRIPT_PATH)).toBe('select typed');
            expect(scriptText()).toBe('select typed');
        });

        it('does not apply a stale decision, the check starts over with a fresh read of the disk', async () => {
            await seedFolder();
            await renderApp();
            // The edit arrives during the first question, the disk changes again during the second
            confirm.mockImplementationOnce(async () => { localEdit('select typed'); return true; });
            confirm.mockImplementationOnce(async () => { changeOnDisk(SCRIPT_PATH, 'select newer'); return true; });
            changeOnDisk(SCRIPT_PATH, 'select external');
            await checkFolder();
            await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(3));
            await vi.waitFor(() => expect(scriptText()).toBe('select newer'));
            await settled();
            expect(api.writer.getPendingKeysForWorkbook(WORKBOOK_ID)).toEqual([]);
            await flush();
            expect(fsStore.files.get(SCRIPT_PATH)).toBe('select newer');
        });
    });

    describe('a write that the disk overtook', () => {
        it('checks the folder and keeps the app version when the user declines', async () => {
            await seedFolder();
            await renderApp();
            confirm.mockResolvedValue(false);
            localEdit('select local');
            changeOnDisk(SCRIPT_PATH, 'select external');
            // The write finds the external change and holds, the writer calls the sync
            void api.writer.flush().catch(() => null);
            await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
            await settled();
            await flush();
            expect(fsStore.files.get(SCRIPT_PATH)).toBe('select local');
        });
    });

    describe('the connections of a workbook file that changed', () => {
        const pullTrinoScript = () => {
            changeOnDisk(`${DIR}/${STORAGE_WORKBOOK_FILE}`, JSON.stringify(workbookFile({
                connections: [{ connectionId: HYPER_ID, params: HYPER_PARAMS }, { connectionId: TRINO_ID, params: TRINO_PARAMS }],
                scripts: [{ name: 'query.sql', connectionId: HYPER_ID }, { name: 'remote.sql', connectionId: TRINO_ID }],
            })));
            changeOnDisk(`${DIR}/${STORAGE_SCRIPTS_FOLDER}/remote.sql`, 'select remote');
        };

        it('joins the app with the reload', async () => {
            await seedFolder();
            await renderApp();
            pullTrinoScript();
            await checkFolder();
            await vi.waitFor(() => expect(api.connections.has(TRINO_ID)).toBe(true));
            await vi.waitFor(() => expect(scriptText('remote.sql')).toBe('select remote'));
            await flush();
            expect(registry.connections?.map(entry => entry.id)).toContain(TRINO_ID);
        });

        it('stays out of the app when the user declines', async () => {
            await seedFolder();
            await renderApp();
            confirm.mockResolvedValue(false);
            pullTrinoScript();
            await checkFolder();
            expect(api.connections.has(TRINO_ID)).toBe(false);
            await flush();
            expect(registry.connections?.map(entry => entry.id) ?? []).not.toContain(TRINO_ID);
        });
    });

    describe('attachments', () => {
        const addAttachment = (name: string) => {
            const path = `${DIR}/${STORAGE_ATTACHMENTS_FOLDER}/${name}`;
            fsStore.binFiles.set(path, new Uint8Array([1, 2, 3]));
            fsStore.dirs.add(`${DIR}/${STORAGE_ATTACHMENTS_FOLDER}`);
            fsStore.mtimes.set(path, ++fsStore.clock);
        };
        const attachmentNames = () => api.workbooks.get(WORKBOOK_ID)!.attachments?.map(attachment => attachment.fileName);

        it('are listed again when one changed outside the app', async () => {
            await seedFolder();
            await renderApp();
            addAttachment('data.parquet');
            await focusWindow();
            await vi.waitFor(() => expect(attachmentNames()).toEqual(['data.parquet']));
            await settled();
            expect(confirm).not.toHaveBeenCalled();
        });

        it('are not read again without a change', async () => {
            await seedFolder();
            await renderApp();
            const list = vi.spyOn(backend, 'listDataFiles');
            await focusWindow();
            await settled();
            expect(list).not.toHaveBeenCalled();
        });

        it('are picked up on the next focus when reading them failed', async () => {
            await seedFolder();
            await renderApp();
            addAttachment('data.parquet');
            const load = vi.spyOn(backend, 'loadWorkbook').mockRejectedValueOnce(new Error('workbook file is locked'));
            await focusWindow();
            await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
            await settled();
            await focusWindow();
            await vi.waitFor(() => expect(attachmentNames()).toEqual(['data.parquet']));
        });
    });

    describe('errors', () => {
        it('logs a failed check and lets the writes of the workbook continue', async () => {
            await seedFolder();
            await renderApp();
            const warn = vi.spyOn(api.logger, 'warn');
            vi.spyOn(backend.nativeWorkbookFolder(WORKBOOK_ID)!, 'stampFolder').mockRejectedValueOnce(new Error('folder is gone'));
            await focusWindow();
            await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(
                'failed to check the workbook folder',
                expect.objectContaining({ workbookId: WORKBOOK_ID, error: expect.stringContaining('folder is gone') }),
                'native_workbook_sync',
            ));
            await settled();
        });

        it('keeps the app version when the question fails', async () => {
            await seedFolder();
            await renderApp();
            const warn = vi.spyOn(api.logger, 'warn');
            confirm.mockRejectedValueOnce(new Error('window closed'));
            changeOnDisk(SCRIPT_PATH, 'select external');
            await checkFolder();
            await vi.waitFor(() => expect(warn).toHaveBeenCalled());
            expect(scriptText()).toBe('select app');
        });
    });

    describe('what it leaves alone', () => {
        it('does nothing in a browser', async () => {
            await seedFolder();
            let restoring!: Promise<core.RestoreOutcome>;
            // The app restores the folder, then runs in a browser
            const restore = (runtime: Runtime) => (restoring = runtime.restore().then(restored => {
                delete globalThis.dashqlElectron;
                return restored;
            }));
            const stamp = vi.spyOn(backend.nativeWorkbookFolder(WORKBOOK_ID)!, 'stampFolder');
            await act(async () => {
                root!.render(
                    <LoggerProvider>
                        <StorageProvider backend={backend}>
                            <TestRuntime>
                                <App restore={restore} capture={next => { api = next; }} />
                            </TestRuntime>
                        </StorageProvider>
                    </LoggerProvider>,
                );
            });
            await act(async () => { await restoring; });
            // The restoration stamps the folder as well, only the checks of the sync count
            stamp.mockClear();
            await focusWindow();
            expect(stamp).not.toHaveBeenCalled();
        });

        it('does not hold the writes of a workbook in the app', async () => {
            await backend.saveWorkbookManifest(WORKBOOK_ID, workbookFile());
            await backend.saveScript(WORKBOOK_ID, 'query.sql', 'select app');
            await renderApp();
            await vi.waitFor(() => expect(api.workbooks.has(WORKBOOK_ID)).toBe(true));
            const pause = vi.spyOn(api.writer, 'pauseWorkbook');
            await focusWindow();
            expect(pause).not.toHaveBeenCalled();
            expect(confirm).not.toHaveBeenCalled();
        });

        it('stops checking when it unmounts', async () => {
            await seedFolder();
            await renderApp();
            const stamp = vi.spyOn(backend.nativeWorkbookFolder(WORKBOOK_ID)!, 'stampFolder');
            act(() => root!.unmount());
            root = null;
            window.dispatchEvent(new Event('focus'));
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(stamp).not.toHaveBeenCalled();
        });
    });
});
