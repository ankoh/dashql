import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionRegistry, useConnectionRegistry } from '../../connections/connection_registry.js';
import type { ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { EXECUTOR_CTX } from '../../connections/query_executor.js';
import type { Logger } from '@ankoh/dashql-runtime/platform/logger/logger';
import { LoggerProvider, useLogger } from '../../platform/logger/logger_provider.js';
import { DashQLCoreProvider } from '../../runtime/core_provider.js';
import { CompositeStorageBackend } from '../../storage/composite_storage_backend.js';
import { NativeStorageBackend } from '@ankoh/dashql-runtime/storage/native_storage_backend';
import type { WorkbookBundle } from '@ankoh/dashql-runtime/storage/workbook_bundle';
import { WorkbookTestBackend, WorkbookTestRegistry, testWorkbook } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import { STORAGE_WORKBOOK_FILE, StorageBackendType, type StorageBackend } from '@ankoh/dashql-runtime/storage/storage_backend';
import { StorageProvider, useStorage } from '../../storage/storage_provider.js';
import type { StorageWriter } from '@ankoh/dashql-runtime/storage/storage_writer';
import { fsStore, makeFsMock, resetFsStore } from '../../storage/test_fs_mock.js';
import { WorkbookScriptsRegistryProvider, useWorkbookScriptsRegistry } from '../scripts/workbook_scripts_registry.js';
import { WorkbookImportProvider, useWorkbookImport } from './workbook_import_provider.js';
import { ELECTRON_FILE_SYSTEM } from '@ankoh/dashql-runtime/platform/electron_fs';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class {
    observe() { }
    unobserve() { }
    disconnect() { }
});

const WORKBOOK_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_WORKBOOK_ID = '22222222-3333-4444-8555-666666666666';
const HYPER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_HYPER_ID = 'cccccccc-dddd-4eee-8fff-000000000000';
const TRINO_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const KNOWN_TRINO_ID = 'dddddddd-eeee-4fff-8000-111111111111';
const HYPER_PARAMS = { hyper: {} } as WorkbookBundle['workbook']['connections'][number]['params'];
const TRINO_PARAMS = { trino: { endpoint: 'https://trino.example' } } as WorkbookBundle['workbook']['connections'][number]['params'];
const NATIVE_DIR = '/Users/me/workbook';

const CENTERED = { presentation: { mode: 'centered' as const } };

/// A registry whose writes can fail
class Registry extends WorkbookTestRegistry {
    failScriptWrites = false;
    failWorkbookLoads = false;
    override async saveScript(workbookId: string, scriptName: string, sql: string): Promise<void> {
        if (this.failScriptWrites) throw new Error('disk full');
        await super.saveScript(workbookId, scriptName, sql);
    }
    override async loadWorkbook(workbookId: string) {
        if (this.failWorkbookLoads) throw new Error('workbook file unreadable');
        return await super.loadWorkbook(workbookId);
    }
}

function bundleOf(overrides: Partial<WorkbookBundle['workbook']> = {}, sql = 'select 1'): WorkbookBundle {
    const workbook = testWorkbook({
        workbookId: WORKBOOK_ID,
        name: 'Imported',
        connections: [{ connectionId: HYPER_ID, params: HYPER_PARAMS }],
        scripts: [{ name: 'query.sql', connectionId: HYPER_ID }],
        ...overrides,
    });
    return {
        workbook,
        catalogs: [],
        scripts: workbook.scripts.map(script => ({ name: script.name, sql })),
        data: [],
    };
}

interface Api {
    importer: ReturnType<typeof useWorkbookImport>;
    writer: StorageWriter;
    logger: Logger;
    connections: ReadonlyMap<string, ConnectionState>;
    setConnections: ReturnType<typeof useConnectionRegistry>[1];
    workbooks: ReturnType<typeof useWorkbookScriptsRegistry>[0];
}

function Capture(props: { capture: (api: Api) => void }) {
    const importer = useWorkbookImport();
    const [, writer] = useStorage();
    const logger = useLogger();
    const [registry, setConnections] = useConnectionRegistry();
    const [workbooks] = useWorkbookScriptsRegistry();
    React.useLayoutEffect(() => {
        props.capture({ importer, writer, logger, connections: registry.connections, setConnections, workbooks });
    });
    return <div data-testid="app-content" />;
}

function byTestId(testId: string): HTMLButtonElement | null {
    return document.querySelector(`[data-testid="${testId}"]`);
}
const questionIsOpen = () => byTestId('workbook-import-replace') != null;
function buttonWithText(text: string): HTMLButtonElement {
    const button = [...document.querySelectorAll('button')].find(candidate => candidate.textContent?.trim() === text);
    if (button == null) throw new Error(`No button "${text}"`);
    return button;
}

describe('WorkbookImportProvider', () => {
    let container: HTMLDivElement;
    let root: Root;
    let api: Api;
    let registry: Registry;
    let composite: CompositeStorageBackend;
    let reload: ReturnType<typeof vi.fn<() => void>>;
    let cancelQuery: ReturnType<typeof vi.fn<(connectionId: string, queryId: number) => Promise<void>>>;

    beforeEach(async () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        reload = vi.fn<() => void>();
        cancelQuery = vi.fn(async () => { });
        registry = new Registry();
        resetFsStore();
        composite = new CompositeStorageBackend(registry, { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger);
        await composite.initialize();
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        document.body.innerHTML = '';
        delete globalThis.dashqlElectron;
    });

    async function renderProvider(backend: StorageBackend = composite) {
        const executor = { execute: vi.fn(), cancel: cancelQuery, watchProfile: () => () => { } };
        const dependencies = { reload, card: { CompactNavBar: () => <></> } };
        await act(async () => {
            root.render(
                <LoggerProvider>
                    <StorageProvider backend={backend}>
                        <ConnectionRegistry>
                            <WorkbookScriptsRegistryProvider>
                                <EXECUTOR_CTX.Provider value={executor as never}>
                                    <DashQLCoreProvider>
                                        <WorkbookImportProvider dependencies={dependencies}>
                                            <Capture capture={next => { api = next; }} />
                                        </WorkbookImportProvider>
                                    </DashQLCoreProvider>
                                </EXECUTOR_CTX.Provider>
                            </WorkbookScriptsRegistryProvider>
                        </ConnectionRegistry>
                    </StorageProvider>
                </LoggerProvider>,
            );
        });
        await vi.waitFor(() => expect(api).toBeDefined());
    }

    /// A workbook that is registered already
    async function registerWorkbook(sql = 'select old'): Promise<void> {
        await composite.saveWorkbookManifest(WORKBOOK_ID, testWorkbook({
            workbookId: WORKBOOK_ID,
            name: 'Existing',
            connections: [{ connectionId: HYPER_ID, params: HYPER_PARAMS }],
            scripts: [{ name: 'query.sql', connectionId: HYPER_ID }],
        }));
        await composite.saveScript(WORKBOOK_ID, 'query.sql', sql);
    }

    /// The connections of the app when a connection of the workbook may be one of them
    function knowTrinoConnection() {
        registry.connections = [{ id: KNOWN_TRINO_ID, params: TRINO_PARAMS, name: 'Production' } as never];
    }
    const trinoSession = () => bundleOf({
        connections: [{ connectionId: TRINO_ID, params: TRINO_PARAMS }],
        scripts: [{ name: 'query.sql', connectionId: TRINO_ID }],
    });

    /// Start an import and wait for its question. The pending import comes back in an object, an async function that
    /// returns the promise would wait for the answer to the question.
    async function askConflict(start: () => Promise<string | null>): Promise<{ result: Promise<string | null> }> {
        let result!: Promise<string | null>;
        await act(async () => { result = start(); });
        await vi.waitFor(() => expect(questionIsOpen()).toBe(true));
        return { result };
    }
    const appWrapper = () => container.querySelector<HTMLElement>('[data-testid="app-content"]')!.parentElement!;
    async function click(button: HTMLElement | null) {
        await act(async () => button!.click());
    }
    /// Cancel the open question: the dialog of the connections, a centered or an anchored conflict
    async function cancelQuestion() {
        await click(byTestId('workbook-import-cancel') ?? byTestId('dialog-close') ?? buttonWithText('Cancel'));
    }

    describe('a new portable workbook', () => {
        it('is written and restored without a reload', async () => {
            await renderProvider();
            const writer = vi.spyOn(api.writer, 'reviveWorkbook');
            let id: string | null = null;
            await act(async () => { id = await api.importer.importPortableBundle(bundleOf(), CENTERED); });
            expect(id).toBe(WORKBOOK_ID);
            expect(reload).not.toHaveBeenCalled();
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select 1');
            // An earlier import of the bundle may have been deleted in this tab
            expect(writer).toHaveBeenCalledWith(WORKBOOK_ID);
            await vi.waitFor(() => {
                expect(api.workbooks.workbookScriptsMap.has(WORKBOOK_ID)).toBe(true);
                expect(api.connections.has(HYPER_ID)).toBe(true);
            });
            expect(api.workbooks.workbookScriptsByConnection.get(HYPER_ID)).toContain(WORKBOOK_ID);
        });

        it('uses the embedded database of the app instead of bringing a second one', async () => {
            await renderProvider();
            await act(async () => { await api.importer.importPortableBundle(bundleOf(), CENTERED); });
            await vi.waitFor(() => expect(api.connections.has(HYPER_ID)).toBe(true));
            await act(async () => {
                await api.importer.importPortableBundle(bundleOf({
                    workbookId: OTHER_WORKBOOK_ID,
                    connections: [{ connectionId: OTHER_HYPER_ID, params: HYPER_PARAMS }],
                    scripts: [{ name: 'query.sql', connectionId: OTHER_HYPER_ID }],
                }), CENTERED);
            });
            await vi.waitFor(() => expect(api.workbooks.workbookScriptsMap.has(OTHER_WORKBOOK_ID)).toBe(true));
            expect(api.connections.has(OTHER_HYPER_ID)).toBe(false);
            expect(registry.workbooks.get(OTHER_WORKBOOK_ID)?.connections.map(connection => connection.connectionId)).toEqual([HYPER_ID]);
        });

        it('reloads after the write when asked to, and keeps the writer paused for the reload', async () => {
            await renderProvider();
            const pause = vi.spyOn(api.writer, 'pause');
            const resume = vi.spyOn(api.writer, 'resume');
            const flush = vi.spyOn(api.writer, 'flush');
            let id: string | null = null;
            await act(async () => { id = await api.importer.importPortableBundle(bundleOf(), { ...CENTERED, reloadAfterSuccess: true }); });
            expect(id).toBe(WORKBOOK_ID);
            expect(reload).toHaveBeenCalledOnce();
            expect(pause).toHaveBeenCalledOnce();
            expect(flush).toHaveBeenCalledOnce();
            expect(resume).not.toHaveBeenCalled();
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select 1');
            // The reload restores the workbook
            expect(api.workbooks.workbookScriptsMap.has(WORKBOOK_ID)).toBe(false);
        });

        it('resumes the writer and does not reload when the write fails', async () => {
            await renderProvider();
            const resume = vi.spyOn(api.writer, 'resume');
            registry.failScriptWrites = true;
            await expect(api.importer.importPortableBundle(bundleOf(), { ...CENTERED, reloadAfterSuccess: true })).rejects.toThrow('disk full');
            expect(resume).toHaveBeenCalledOnce();
            expect(reload).not.toHaveBeenCalled();
            // A failed import leaves no workbook behind
            expect(registry.manifest).toEqual([]);
        });

        it('removes a workbook again that cannot be restored', async () => {
            await renderProvider();
            // The write succeeded when the writer is told about the workbook, the restoration fails after it
            vi.spyOn(api.writer, 'reviveWorkbook').mockImplementation(() => { registry.failWorkbookLoads = true; });
            await expect(api.importer.importPortableBundle(bundleOf(), CENTERED)).rejects.toThrow(`invalid workbook ${WORKBOOK_ID}`);
            registry.failWorkbookLoads = false;
            expect(registry.manifest).toEqual([]);
            expect(registry.scripts.has(WORKBOOK_ID)).toBe(false);
            expect(api.workbooks.workbookScriptsMap.has(WORKBOOK_ID)).toBe(false);
        });

        it('drops catalogs that do not parse and warns about them', async () => {
            await renderProvider();
            const warn = vi.spyOn(api.logger, 'warn');
            const bundle = bundleOf();
            bundle.catalogs = [{ connectionId: HYPER_ID, relations: 'this is ( not sql', functions: null }];
            await act(async () => { await api.importer.importPortableBundle(bundle, { ...CENTERED, reloadAfterSuccess: true }); });
            expect(warn).toHaveBeenCalledWith('ignored malformed workbook catalog files', expect.objectContaining({
                workbookId: WORKBOOK_ID,
                files: expect.stringContaining(HYPER_ID),
            }), 'workbook_import');
            expect(registry.connectionFiles.size).toBe(0);
        });
    });

    describe('the question for the connections', () => {
        it('uses an existing connection when the user picks it', async () => {
            knowTrinoConnection();
            await renderProvider();
            let result!: Promise<string | null>;
            await act(async () => { result = api.importer.importPortableBundle(trinoSession(), { ...CENTERED, reloadAfterSuccess: true }); });
            await vi.waitFor(() => expect(document.body.textContent).toContain('Use existing connections?'));
            expect(document.body.textContent).toContain('The workbook Imported uses connections');
            expect(document.body.textContent).toContain('Use Production');
            // Nothing is written before the user decided
            expect(registry.manifest).toEqual([]);
            await click(buttonWithText('Import'));
            expect(await result).toBe(WORKBOOK_ID);
            expect(registry.workbooks.get(WORKBOOK_ID)?.connections.map(connection => connection.connectionId)).toEqual([KNOWN_TRINO_ID]);
            expect(registry.workbooks.get(WORKBOOK_ID)?.scripts).toEqual([{ name: 'query.sql', connectionId: KNOWN_TRINO_ID }]);
            await vi.waitFor(() => expect(document.body.textContent).not.toContain('Use existing connections?'));
        });

        it('keeps the connection of the workbook when the user prefers that', async () => {
            knowTrinoConnection();
            await renderProvider();
            let result!: Promise<string | null>;
            await act(async () => { result = api.importer.importPortableBundle(trinoSession(), { ...CENTERED, reloadAfterSuccess: true }); });
            await vi.waitFor(() => expect(document.body.textContent).toContain('Keep as a new connection'));
            const separate = document.querySelector('input[value="separate"]') as HTMLInputElement;
            await click(separate);
            await click(buttonWithText('Import'));
            expect(await result).toBe(WORKBOOK_ID);
            expect(registry.workbooks.get(WORKBOOK_ID)?.connections.map(connection => connection.connectionId)).toEqual([TRINO_ID]);
        });

        it('cancels the import and writes nothing', async () => {
            knowTrinoConnection();
            await renderProvider();
            let result!: Promise<string | null>;
            await act(async () => { result = api.importer.importPortableBundle(trinoSession(), CENTERED); });
            await vi.waitFor(() => expect(document.body.textContent).toContain('Use existing connections?'));
            await cancelQuestion();
            expect(await result).toBeNull();
            expect(registry.manifest).toEqual([]);
            expect(reload).not.toHaveBeenCalled();
        });

        it('skips a stored connection of an unknown connector like the restoration does', async () => {
            // A tab of an older version may write the former key after the migration
            registry.connections = [
                { id: OTHER_HYPER_ID, params: { sidb: { instanceUrl: 'https://old.example' } }, name: 'Stale' } as never,
                { id: KNOWN_TRINO_ID, params: TRINO_PARAMS, name: 'Production' } as never,
            ];
            await renderProvider();
            const warn = vi.spyOn(api.logger, 'warn');
            let result!: Promise<string | null>;
            await act(async () => { result = api.importer.importPortableBundle(trinoSession(), { ...CENTERED, reloadAfterSuccess: true }); });
            await vi.waitFor(() => expect(document.body.textContent).toContain('Use Production'));
            await click(buttonWithText('Import'));
            expect(await result).toBe(WORKBOOK_ID);
            expect(warn).toHaveBeenCalledWith('ignored a stored connection of an unknown connector',
                { connectionId: OTHER_HYPER_ID, keys: 'sidb' }, 'workbook_import');
        });

        it('prepares an import without writing and commits it later', async () => {
            await renderProvider();
            let prepared: Awaited<ReturnType<Api['importer']['preparePortableImport']>> = null;
            await act(async () => { prepared = await api.importer.preparePortableImport(bundleOf()); });
            expect(prepared!.conflict).toBeNull();
            expect(registry.manifest).toEqual([]);
            const steps: string[] = [];
            let id: string | null = null;
            await act(async () => { id = await api.importer.commitPortableImport(prepared!, null, progress => steps.push(progress.step)); });
            expect(id).toBe(WORKBOOK_ID);
            expect(steps).toEqual(['workbook']);
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select 1');
            // A second import of the same id knows the conflict before the user decides
            let again: Awaited<ReturnType<Api['importer']['preparePortableImport']>> = null;
            await act(async () => { again = await api.importer.preparePortableImport(bundleOf()); });
            expect(again!.conflict).not.toBeNull();
            await expect(api.importer.commitPortableImport(again!, null)).rejects.toThrow('was added meanwhile');
        });

        it('prefers the live params of a connection over the manifest, writes are debounced', async () => {
            // The manifest still has the old endpoint, only the live connection matches the workbook
            registry.connections = [{ id: KNOWN_TRINO_ID, params: { trino: { endpoint: 'https://old.example' } }, name: 'Production' } as never];
            await renderProvider();
            await act(async () => {
                api.setConnections(current => {
                    const connections = new Map(current.connections);
                    connections.set(KNOWN_TRINO_ID, { connectionId: KNOWN_TRINO_ID, params: TRINO_PARAMS } as never);
                    return { ...current, connections };
                });
            });
            let result!: Promise<string | null>;
            await act(async () => { result = api.importer.importPortableBundle(trinoSession(), CENTERED); });
            await vi.waitFor(() => expect(document.body.textContent).toContain('Use Production'));
            await cancelQuestion();
            expect(await result).toBeNull();
        });
    });

    describe('a workbook that is registered already', () => {
        beforeEach(async () => { await registerWorkbook(); });

        it('hides the app behind a centered question', async () => {
            await renderProvider();
            const { result } = await askConflict(() => api.importer.importPortableBundle(bundleOf(), CENTERED));
            expect(appWrapper().style.display).toBe('none');
            expect(appWrapper().getAttribute('aria-hidden')).toBe('true');
            expect(document.body.textContent).toContain(`opfs://workbooks/${WORKBOOK_ID}`);
            await cancelQuestion();
            expect(await result).toBeNull();
            await vi.waitFor(() => expect(appWrapper().style.display).toBe('contents'));
            expect(appWrapper().getAttribute('aria-hidden')).toBeNull();
        });

        it('keeps the app visible behind an anchored question', async () => {
            await renderProvider();
            const anchor = document.createElement('button');
            document.body.appendChild(anchor);
            const { result } = await askConflict(() => api.importer.importPortableBundle(bundleOf(), {
                presentation: { mode: 'anchored', anchorRef: { current: anchor }, returnFocusRef: { current: anchor } },
            }));
            expect(appWrapper().style.display).toBe('contents');
            await cancelQuestion();
            expect(await result).toBeNull();
        });

        it('leaves everything as it is when the question is cancelled', async () => {
            await renderProvider();
            const { result } = await askConflict(() => api.importer.importPortableBundle(bundleOf(), CENTERED));
            await cancelQuestion();
            expect(await result).toBeNull();
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select old');
            expect(reload).not.toHaveBeenCalled();
        });

        it('ignores a second import while a question is open', async () => {
            await renderProvider();
            const warn = vi.spyOn(api.logger, 'warn');
            const { result: first } = await askConflict(() => api.importer.importPortableBundle(bundleOf(), CENTERED));
            let second: string | null = 'pending';
            await act(async () => { second = await api.importer.importPortableBundle(bundleOf(), CENTERED); });
            expect(second).toBeNull();
            expect(warn).toHaveBeenCalledWith('ignored workbook import while another decision is pending', {}, 'workbook_import');
            expect(questionIsOpen()).toBe(true);
            await cancelQuestion();
            expect(await first).toBeNull();
        });

        it('creates a copy with a new identity next to the workbook', async () => {
            await renderProvider();
            const { result } = await askConflict(() => api.importer.importPortableBundle(bundleOf(), CENTERED));
            await click(byTestId('workbook-import-create-new'));
            const id = await result;
            expect(id).not.toBe(WORKBOOK_ID);
            expect(registry.workbooks.get(id!)?.name).toBe('Imported (copy)');
            expect(registry.scripts.get(id!)?.get('query.sql')).toBe('select 1');
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select old');
            expect(reload).not.toHaveBeenCalled();
            await vi.waitFor(() => expect(api.workbooks.workbookScriptsMap.has(id!)).toBe(true));
            await vi.waitFor(() => expect(questionIsOpen()).toBe(false));
        });

        it('creates a copy and reloads when asked to', async () => {
            await renderProvider();
            const { result } = await askConflict(() => api.importer.importPortableBundle(bundleOf(), { ...CENTERED, reloadAfterSuccess: true }));
            await click(byTestId('workbook-import-create-new'));
            const id = await result;
            expect(registry.workbooks.get(id!)?.name).toBe('Imported (copy)');
            expect(reload).toHaveBeenCalledOnce();
        });

        it('replaces the workbook and reloads', async () => {
            await renderProvider();
            const pause = vi.spyOn(api.writer, 'pause');
            const resume = vi.spyOn(api.writer, 'resume');
            const { result } = await askConflict(() => api.importer.importPortableBundle(bundleOf(), CENTERED));
            await click(byTestId('workbook-import-replace'));
            expect(await result).toBe(WORKBOOK_ID);
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select 1');
            expect(registry.workbooks.get(WORKBOOK_ID)?.name).toBe('Imported');
            expect(reload).toHaveBeenCalledOnce();
            expect(pause).toHaveBeenCalledOnce();
            expect(resume).not.toHaveBeenCalled();
            // The staged copy is gone again
            expect(registry.manifest.map(entry => entry.path)).toEqual([WORKBOOK_ID]);
        });

        it('keeps the workbook and the question when the replacement fails', async () => {
            await renderProvider();
            const resume = vi.spyOn(api.writer, 'resume');
            const error = vi.spyOn(api.logger, 'error');
            const { result } = await askConflict(() => api.importer.importPortableBundle(bundleOf(), CENTERED));
            registry.failScriptWrites = true;
            await click(byTestId('workbook-import-replace'));
            await vi.waitFor(() => expect(error).toHaveBeenCalledWith('workbook import failed', expect.objectContaining({ error: expect.stringContaining('disk full') }), 'workbook_import'));
            expect(resume).toHaveBeenCalledOnce();
            expect(reload).not.toHaveBeenCalled();
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select old');
            // The user may try again or leave
            await vi.waitFor(() => expect(byTestId('workbook-import-replace')?.disabled).toBe(false));
            await cancelQuestion();
            expect(await result).toBeNull();
        });

        it('does not start the replacement when the pending writes cannot be flushed', async () => {
            await renderProvider();
            vi.spyOn(api.writer, 'flush').mockRejectedValue(new Error('flush failed'));
            const resume = vi.spyOn(api.writer, 'resume');
            const { result } = await askConflict(() => api.importer.importPortableBundle(bundleOf(), CENTERED));
            await click(byTestId('workbook-import-replace'));
            await vi.waitFor(() => expect(resume).toHaveBeenCalledOnce());
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select old');
            expect(reload).not.toHaveBeenCalled();
            await vi.waitFor(() => expect(byTestId('workbook-import-replace')?.disabled).toBe(false));
            await cancelQuestion();
            expect(await result).toBeNull();
        });

        it('returns null when the connections are cancelled after the choice', async () => {
            knowTrinoConnection();
            await renderProvider();
            const { result } = await askConflict(() => api.importer.importPortableBundle(trinoSession(), CENTERED));
            await click(byTestId('workbook-import-replace'));
            await vi.waitFor(() => expect(document.body.textContent).toContain('Use existing connections?'));
            // The conflict question waits behind the connections
            expect(questionIsOpen()).toBe(false);
            await cancelQuestion();
            expect(await result).toBeNull();
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select old');
            expect(reload).not.toHaveBeenCalled();
        });
    });

    it('stops only the running queries of the replaced workbook', async () => {
        await renderProvider();
        await act(async () => { await api.importer.importPortableBundle(bundleOf(), CENTERED); });
        await vi.waitFor(() => expect(api.connections.has(HYPER_ID)).toBe(true));
        await act(async () => {
            api.setConnections(current => {
                const connections = new Map(current.connections);
                const query = (workbookId: string) => ({ queryMetadata: { workbookId } });
                connections.set(HYPER_ID, {
                    ...connections.get(HYPER_ID)!,
                    queriesActive: new Map([[1, query(WORKBOOK_ID)], [2, query(OTHER_WORKBOOK_ID)]]),
                    queriesActiveOrdered: [1, 2],
                } as never);
                return { ...current, connections };
            });
        });
        await vi.waitFor(() => expect(api.connections.get(HYPER_ID)?.queriesActiveOrdered).toEqual([1, 2]));
        const { result } = await askConflict(() => api.importer.importPortableBundle(bundleOf({}, 'select 2'), CENTERED));
        await click(byTestId('workbook-import-replace'));
        expect(await result).toBe(WORKBOOK_ID);
        expect(cancelQuery.mock.calls).toEqual([[HYPER_ID, 1]]);
    });

    describe('findPortableBundleConflict', () => {
        it('finds nothing for a new workbook', async () => {
            await renderProvider();
            expect(await api.importer.findPortableBundleConflict(bundleOf())).toBeNull();
        });

        it('finds a workbook of the app', async () => {
            await registerWorkbook();
            await renderProvider();
            expect(await api.importer.findPortableBundleConflict(bundleOf())).toEqual({
                displayLocation: `opfs://workbooks/${WORKBOOK_ID}`,
                isNative: false,
            });
        });

        it('finds a workbook in a folder', async () => {
            await composite.upsertWorkbookEntry({ path: WORKBOOK_ID, storageType: StorageBackendType.Native, nativePath: NATIVE_DIR });
            await renderProvider();
            expect(await api.importer.findPortableBundleConflict(bundleOf())).toEqual({
                displayLocation: `fs://${NATIVE_DIR}`,
                isNative: true,
            });
        });
    });

    describe('importPortableBundleWithChoice', () => {
        it('imports a new workbook whatever the choice', async () => {
            await renderProvider();
            let id: string | null = null;
            await act(async () => { id = await api.importer.importPortableBundleWithChoice(bundleOf(), 'replace'); });
            expect(id).toBe(WORKBOOK_ID);
            expect(reload).not.toHaveBeenCalled();
            await vi.waitFor(() => expect(api.workbooks.workbookScriptsMap.has(WORKBOOK_ID)).toBe(true));
        });

        it('creates a copy of a registered workbook', async () => {
            await registerWorkbook();
            await renderProvider();
            let id: string | null = null;
            await act(async () => { id = await api.importer.importPortableBundleWithChoice(bundleOf(), 'create-new'); });
            expect(id).not.toBe(WORKBOOK_ID);
            expect(registry.workbooks.get(id!)?.name).toBe('Imported (copy)');
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select old');
        });

        it('replaces a registered workbook and reloads', async () => {
            await registerWorkbook();
            await renderProvider();
            let id: string | null = null;
            await act(async () => { id = await api.importer.importPortableBundleWithChoice(bundleOf(), 'replace'); });
            expect(id).toBe(WORKBOOK_ID);
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select 1');
            expect(reload).toHaveBeenCalledOnce();
        });

        it('resumes the writer when the replacement fails', async () => {
            await registerWorkbook();
            await renderProvider();
            const resume = vi.spyOn(api.writer, 'resume');
            registry.failScriptWrites = true;
            await expect(api.importer.importPortableBundleWithChoice(bundleOf(), 'replace')).rejects.toThrow('disk full');
            expect(resume).toHaveBeenCalledOnce();
            expect(reload).not.toHaveBeenCalled();
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select old');
        });

        it('returns null when the connections are cancelled', async () => {
            knowTrinoConnection();
            await renderProvider();
            let result!: Promise<string | null>;
            await act(async () => { result = api.importer.importPortableBundleWithChoice(trinoSession(), 'create-new'); });
            await vi.waitFor(() => expect(document.body.textContent).toContain('Use existing connections?'));
            await cancelQuestion();
            expect(await result).toBeNull();
            expect(registry.manifest).toEqual([]);
        });
    });

    describe('a native folder', () => {
        beforeEach(async () => {
            globalThis.dashqlElectron = { fs: makeFsMock(), onFlush: () => () => { } } as unknown as DashQLElectronBridge;
            const native = new NativeStorageBackend(NATIVE_DIR, ELECTRON_FILE_SYSTEM);
            await native.saveWorkbookManifest(WORKBOOK_ID, bundleOf({ name: 'From folder' }).workbook);
            await native.saveScript(WORKBOOK_ID, 'query.sql', 'select folder');
        });
        const folderWorkbook = async () => JSON.parse(fsStore.files.get(`${NATIVE_DIR}/${STORAGE_WORKBOOK_FILE}`) ?? 'null');

        it('is registered as it is and reloads', async () => {
            await renderProvider();
            const before = await folderWorkbook();
            let id: string | null = null;
            await act(async () => { id = await api.importer.importNativeFolder(NATIVE_DIR, CENTERED.presentation); });
            expect(id).toBe(WORKBOOK_ID);
            expect(reload).toHaveBeenCalledOnce();
            expect(composite.getWorkbookLocation(WORKBOOK_ID)).toEqual({ type: StorageBackendType.Native, nativePath: NATIVE_DIR });
            expect((await folderWorkbook())?.connections).toEqual(before?.connections);
        });

        it('rejects a folder without a workbook and does not reload', async () => {
            await renderProvider();
            await expect(api.importer.importNativeFolder('/Users/me/empty', CENTERED.presentation)).rejects.toThrow();
            expect(reload).not.toHaveBeenCalled();
            expect(registry.manifest).toEqual([]);
        });

        it('writes the consolidated connections into the folder', async () => {
            knowTrinoConnection();
            const native = new NativeStorageBackend(NATIVE_DIR, ELECTRON_FILE_SYSTEM);
            await native.saveWorkbookManifest(WORKBOOK_ID, trinoSession().workbook);
            await renderProvider();
            let result!: Promise<string | null>;
            await act(async () => { result = api.importer.importNativeFolder(NATIVE_DIR, CENTERED.presentation); });
            await vi.waitFor(() => expect(document.body.textContent).toContain('Use existing connections?'));
            await click(buttonWithText('Import'));
            expect(await result).toBe(WORKBOOK_ID);
            const stored = await composite.loadWorkbook(WORKBOOK_ID);
            expect(stored.connections.map(connection => connection.connectionId)).toEqual([KNOWN_TRINO_ID]);
            expect(stored.scripts).toEqual([{ name: 'query.sql', connectionId: KNOWN_TRINO_ID }]);
            expect(reload).toHaveBeenCalledOnce();
        });

        it('imports nothing when the connections are cancelled', async () => {
            knowTrinoConnection();
            const native = new NativeStorageBackend(NATIVE_DIR, ELECTRON_FILE_SYSTEM);
            await native.saveWorkbookManifest(WORKBOOK_ID, trinoSession().workbook);
            await renderProvider();
            let result!: Promise<string | null>;
            await act(async () => { result = api.importer.importNativeFolder(NATIVE_DIR, CENTERED.presentation); });
            await vi.waitFor(() => expect(document.body.textContent).toContain('Use existing connections?'));
            await cancelQuestion();
            expect(await result).toBeNull();
            expect(registry.manifest).toEqual([]);
            expect(reload).not.toHaveBeenCalled();
        });

        describe('of a workbook that is registered already', () => {
            beforeEach(async () => { await registerWorkbook(); });

            it('says that the workbook lives in the app', async () => {
                await renderProvider();
                const { result } = await askConflict(() => api.importer.importNativeFolder(NATIVE_DIR, CENTERED.presentation));
                expect(document.body.textContent).toContain(`opfs://workbooks/${WORKBOOK_ID}`);
                await cancelQuestion();
                expect(await result).toBeNull();
                expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select old');
            });

            it('replaces the workbook with the folder and removes the copy in the app', async () => {
                await renderProvider();
                const { result } = await askConflict(() => api.importer.importNativeFolder(NATIVE_DIR, CENTERED.presentation));
                await click(byTestId('workbook-import-replace'));
                expect(await result).toBe(WORKBOOK_ID);
                expect(composite.getWorkbookLocation(WORKBOOK_ID)).toEqual({ type: StorageBackendType.Native, nativePath: NATIVE_DIR });
                expect(registry.scripts.has(WORKBOOK_ID)).toBe(false);
                expect(reload).toHaveBeenCalledOnce();
            });

            it('writes the consolidated connections when it replaces the workbook', async () => {
                knowTrinoConnection();
                const native = new NativeStorageBackend(NATIVE_DIR, ELECTRON_FILE_SYSTEM);
                await native.saveWorkbookManifest(WORKBOOK_ID, trinoSession().workbook);
                await renderProvider();
                const { result } = await askConflict(() => api.importer.importNativeFolder(NATIVE_DIR, CENTERED.presentation));
                await click(byTestId('workbook-import-replace'));
                await vi.waitFor(() => expect(document.body.textContent).toContain('Use existing connections?'));
                await click(buttonWithText('Import'));
                expect(await result).toBe(WORKBOOK_ID);
                expect((await composite.loadWorkbook(WORKBOOK_ID)).connections.map(connection => connection.connectionId)).toEqual([KNOWN_TRINO_ID]);
            });

            it('copies the folder into the app for a new workbook and leaves the folder alone', async () => {
                await renderProvider();
                const before = await folderWorkbook();
                const { result } = await askConflict(() => api.importer.importNativeFolder(NATIVE_DIR, CENTERED.presentation));
                await click(byTestId('workbook-import-create-new'));
                const id = await result;
                expect(id).not.toBe(WORKBOOK_ID);
                expect(registry.workbooks.get(id!)?.name).toBe('From folder (copy)');
                expect(registry.scripts.get(id!)?.get('query.sql')).toBe('select folder');
                expect(composite.getWorkbookLocation(id!).type).toBe(StorageBackendType.OPFS);
                expect(await folderWorkbook()).toEqual(before);
                expect(reload).toHaveBeenCalledOnce();
            });
        });
    });

    describe('without composite storage', () => {
        it('rejects every import', async () => {
            await renderProvider(new WorkbookTestBackend());
            await expect(api.importer.importPortableBundle(bundleOf(), CENTERED)).rejects.toThrow('Workbook imports require composite storage');
            await expect(api.importer.findPortableBundleConflict(bundleOf())).rejects.toThrow('Workbook imports require composite storage');
            await expect(api.importer.importPortableBundleWithChoice(bundleOf(), 'replace')).rejects.toThrow('Workbook imports require composite storage');
            await expect(api.importer.importNativeFolder(NATIVE_DIR, CENTERED.presentation)).rejects.toThrow('Native workbook imports require composite storage');
        });
    });
});
