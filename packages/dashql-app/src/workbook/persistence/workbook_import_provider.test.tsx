import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as core from '@ankoh/dashql';

import type { ConnectionState } from '@ankoh/dashql/platform/connections/connection_state';
import { TestRuntime } from '../../tests/test_runtime.js';
import type { Logger } from '@ankoh/dashql/platform/logger/logger';
import { LoggerProvider, useLogger } from '../../platform/logger/logger_provider.js';
import { DashQLCoreProvider } from '../../runtime/core_provider.js';
import { CompositeStorageBackend } from '../../storage/composite_storage_backend.js';
import { NativeStorageBackend } from '@ankoh/dashql/platform/storage/native_storage_backend';
import { WorkbookTestBackend, WorkbookTestRegistry, testWorkbook } from '@ankoh/dashql/platform/testing/workbook_test_backend';
import { STORAGE_WORKBOOK_FILE, StorageBackendType, type StorageBackend, type WorkbookData } from '@ankoh/dashql/platform/storage/storage_backend';
import { StorageProvider } from '../../storage/storage_provider.js';
import type { StorageCommands } from '@ankoh/dashql/runtime/runtime_storage';
import { fsStore, makeFsMock, resetFsStore } from '@ankoh/dashql/platform/testing/test_fs_mock';
import { WorkbookImportProvider, importConflictOf, useWorkbookImport, type ConflictChoice, type WorkbookImportOptions } from './workbook_import_provider.js';
import { memoryImportFolder } from './import_test_sources.js';
import { ELECTRON_FILE_SYSTEM } from '@ankoh/dashql/platform/electron_fs';
import type { Runtime, ImportSource } from '@ankoh/dashql/runtime/runtime';
import { QueryType } from '@ankoh/dashql/platform/query/query_execution_state';
import { useConnections, useRuntime, useWorkbooks } from '../../runtime/runtime_hooks.js';
import { addTestConnection, pendingTestChannel, runTestQuery } from '../../tests/test_connections.js';
import { setupTestConnection } from '@ankoh/dashql/runtime/testing/connection_fixtures';

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
const HYPER_PARAMS = { hyper: {} } as WorkbookData['connections'][number]['params'];
const TRINO_PARAMS = { trino: { endpoint: 'https://trino.example' } } as WorkbookData['connections'][number]['params'];
const NATIVE_DIR = '/Users/me/workbook';

const CENTERED = { presentation: { mode: 'centered' as const } };

/// A registry whose writes can fail
class Registry extends WorkbookTestRegistry {
    failScriptWrites = false;
    /// The loads of workbook files that succeed before the loads fail, unlimited if null
    loadsBeforeFailure: number | null = null;
    override async saveScript(workbookId: string, scriptName: string, sql: string): Promise<void> {
        if (this.failScriptWrites) throw new Error('disk full');
        await super.saveScript(workbookId, scriptName, sql);
    }
    override async loadWorkbook(workbookId: string) {
        if (this.loadsBeforeFailure != null && this.loadsBeforeFailure-- <= 0) throw new Error('workbook file unreadable');
        return await super.loadWorkbook(workbookId);
    }
}

/// A workbook to import: its workbook file, its scripts and the files of the catalogs of its connections
interface TestBundle {
    workbook: WorkbookData;
    scripts: { name: string; sql: string }[];
    files?: Record<string, string>;
}

function bundleOf(overrides: Partial<WorkbookData> = {}, sql = 'select 1'): TestBundle {
    const workbook = testWorkbook({
        workbookId: WORKBOOK_ID,
        name: 'Imported',
        connections: [{ connectionId: HYPER_ID, params: HYPER_PARAMS }],
        scripts: [{ name: 'query.sql', connectionId: HYPER_ID }],
        ...overrides,
    });
    return { workbook, scripts: workbook.scripts.map(script => ({ name: script.name, sql })) };
}

/// The source of the import of a test workbook, a workbook folder in memory
function sourceOf(bundle: TestBundle): ImportSource {
    return { folder: memoryImportFolder(bundle.workbook, bundle.scripts, { files: bundle.files }) };
}

interface Api {
    importer: ReturnType<typeof useWorkbookImport>;
    writer: StorageCommands;
    logger: Logger;
    connections: ReadonlyMap<string, ConnectionState>;
    runtime: Runtime;
    workbooks: ReturnType<typeof useWorkbooks>;
}

function Capture(props: { capture: (api: Api) => void }) {
    const importer = useWorkbookImport();
    const logger = useLogger();
    const connections = useConnections();
    const runtime = useRuntime();
    const writer = runtime.storage;
    const workbooks = useWorkbooks();
    React.useLayoutEffect(() => {
        props.capture({ importer, writer, logger, connections, runtime, workbooks });
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

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
// The runtime of the test holds the connections with this core
beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

describe('WorkbookImportProvider', () => {
    let container: HTMLDivElement;
    let root: Root;
    let api: Api;
    let registry: Registry;
    let composite: CompositeStorageBackend;
    let reload: ReturnType<typeof vi.fn<() => void>>;
    let cancelQuery: ReturnType<typeof vi.fn<(queryId: number) => Promise<void>>>;

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
                        <TestRuntime {...executor}>
                            <DashQLCoreProvider>
                                <WorkbookImportProvider dependencies={dependencies}>
                                    <Capture capture={next => { api = next; }} />
                                </WorkbookImportProvider>
                            </DashQLCoreProvider>
                        </TestRuntime>
                    </StorageProvider>
                </LoggerProvider>,
            );
        });
        await vi.waitFor(() => expect(api).toBeDefined());
    }

    /// Import a test workbook, asking what the import provider asks
    const importBundle = (bundle: TestBundle, options: WorkbookImportOptions) => api.importer.importWorkbook(sourceOf(bundle), options);
    /// Import a native folder
    const importNative = (dir: string) => api.importer.importWorkbook({ folder: composite.importFolder(dir) }, CENTERED);
    /// Import a test workbook with a choice made before, e.g. on the card of a shared workbook
    const importWithChoice = async (bundle: TestBundle, choice: ConflictChoice): Promise<string | null> => {
        const prepared = await api.importer.prepareImport(await api.importer.readImport(sourceOf(bundle)));
        return prepared == null ? null : await api.importer.commitImport(prepared, choice);
    };
    /// The registered workbook with the id of a test workbook
    const findConflict = async (bundle: TestBundle) => {
        const preview = await api.importer.readImport(sourceOf(bundle));
        api.importer.dropImport(preview);
        return importConflictOf(preview);
    };

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
            let id: string | null = null;
            await act(async () => { id = await importBundle(bundleOf(), CENTERED); });
            expect(id).toBe(WORKBOOK_ID);
            expect(reload).not.toHaveBeenCalled();
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select 1');
            await vi.waitFor(() => {
                expect(api.workbooks.has(WORKBOOK_ID)).toBe(true);
                expect(api.connections.has(HYPER_ID)).toBe(true);
            });
            expect(api.runtime.connection(HYPER_ID)?.workbooks).toContain(WORKBOOK_ID);
        });

        it('uses the embedded database of the app instead of bringing a second one', async () => {
            await renderProvider();
            await act(async () => { await importBundle(bundleOf(), CENTERED); });
            await vi.waitFor(() => expect(api.connections.has(HYPER_ID)).toBe(true));
            await act(async () => {
                await importBundle(bundleOf({
                    workbookId: OTHER_WORKBOOK_ID,
                    connections: [{ connectionId: OTHER_HYPER_ID, params: HYPER_PARAMS }],
                    scripts: [{ name: 'query.sql', connectionId: OTHER_HYPER_ID }],
                }), CENTERED);
            });
            await vi.waitFor(() => expect(api.workbooks.has(OTHER_WORKBOOK_ID)).toBe(true));
            expect(api.connections.has(OTHER_HYPER_ID)).toBe(false);
            expect(registry.workbooks.get(OTHER_WORKBOOK_ID)?.connections.map(connection => connection.connectionId)).toEqual([HYPER_ID]);
        });

        it('reloads after the write when asked to', async () => {
            await renderProvider();
            let id: string | null = null;
            await act(async () => { id = await importBundle(bundleOf(), { ...CENTERED, reloadAfterSuccess: true }); });
            expect(id).toBe(WORKBOOK_ID);
            expect(reload).toHaveBeenCalledOnce();
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select 1');
            // The reload restores the workbook
            expect(api.workbooks.has(WORKBOOK_ID)).toBe(false);
        });

        it('does not reload when the write fails', async () => {
            await renderProvider();
            registry.failScriptWrites = true;
            await expect(importBundle(bundleOf(), { ...CENTERED, reloadAfterSuccess: true })).rejects.toThrow('disk full');
            expect(reload).not.toHaveBeenCalled();
            // A failed import leaves no workbook behind
            expect(registry.manifest).toEqual([]);
        });

        it('removes a workbook again that cannot be restored', async () => {
            await renderProvider();
            // The verification of the write reads the workbook file, the restoration fails after it
            registry.loadsBeforeFailure = 1;
            await expect(importBundle(bundleOf(), CENTERED)).rejects.toThrow();
            registry.loadsBeforeFailure = null;
            expect(registry.manifest).toEqual([]);
            expect(registry.scripts.has(WORKBOOK_ID)).toBe(false);
            expect(api.workbooks.has(WORKBOOK_ID)).toBe(false);
        });

        it('drops catalogs that do not parse and warns about them', async () => {
            await renderProvider();
            const warn = vi.spyOn(api.logger, 'warn');
            const bundle = { ...bundleOf(), files: { [`connections/${HYPER_ID}/dashql-catalog-relations.sql`]: 'this is ( not sql' } };
            await act(async () => { await importBundle(bundle, { ...CENTERED, reloadAfterSuccess: true }); });
            expect(warn).toHaveBeenCalledWith('Ignored malformed workbook catalog files', expect.objectContaining({
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
            await act(async () => { result = importBundle(trinoSession(), { ...CENTERED, reloadAfterSuccess: true }); });
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
            await act(async () => { result = importBundle(trinoSession(), { ...CENTERED, reloadAfterSuccess: true }); });
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
            await act(async () => { result = importBundle(trinoSession(), CENTERED); });
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
            await act(async () => { result = importBundle(trinoSession(), { ...CENTERED, reloadAfterSuccess: true }); });
            await vi.waitFor(() => expect(document.body.textContent).toContain('Use Production'));
            await click(buttonWithText('Import'));
            expect(await result).toBe(WORKBOOK_ID);
            expect(warn).toHaveBeenCalledWith('Ignored a stored connection of an unknown connector',
                { connectionId: OTHER_HYPER_ID }, 'workbook_import');
        });

        it('prepares an import without writing and commits it later', async () => {
            await renderProvider();
            let prepared: Awaited<ReturnType<Api['importer']['prepareImport']>> = null;
            await act(async () => { prepared = await api.importer.prepareImport(await api.importer.readImport(sourceOf(bundleOf()))); });
            expect(prepared!.conflict).toBeNull();
            expect(registry.manifest).toEqual([]);
            const steps: string[] = [];
            let id: string | null = null;
            await act(async () => { id = await api.importer.commitImport(prepared!, null, { onProgress: progress => steps.push(progress.step) }); });
            expect(id).toBe(WORKBOOK_ID);
            expect(steps).toEqual(['workbook', 'scripts', 'attachments', 'open']);
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select 1');
            // A second import of the same id knows the conflict before the user decides
            let again: Awaited<ReturnType<Api['importer']['prepareImport']>> = null;
            await act(async () => { again = await api.importer.prepareImport(await api.importer.readImport(sourceOf(bundleOf()))); });
            expect(again!.conflict).not.toBeNull();
            await expect(api.importer.commitImport(again!, null)).rejects.toThrow('was added meanwhile');
        });

        it('prefers the live params of a connection over the manifest, writes are debounced', async () => {
            // The manifest still has the old endpoint, only the live connection matches the workbook
            registry.connections = [{ id: KNOWN_TRINO_ID, params: { trino: { endpoint: 'https://old.example' } }, name: 'Production' } as never];
            await renderProvider();
            await act(async () => { await addTestConnection(api.runtime, { connectionId: KNOWN_TRINO_ID, params: TRINO_PARAMS as never }); });
            let result!: Promise<string | null>;
            await act(async () => { result = importBundle(trinoSession(), CENTERED); });
            await vi.waitFor(() => expect(document.body.textContent).toContain('Use Production'));
            await cancelQuestion();
            expect(await result).toBeNull();
        });
    });

    describe('a workbook that is registered already', () => {
        beforeEach(async () => { await registerWorkbook(); });

        it('hides the app behind a centered question', async () => {
            await renderProvider();
            const { result } = await askConflict(() => importBundle(bundleOf(), CENTERED));
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
            const { result } = await askConflict(() => importBundle(bundleOf(), {
                presentation: { mode: 'anchored', anchorRef: { current: anchor }, returnFocusRef: { current: anchor } },
            }));
            expect(appWrapper().style.display).toBe('contents');
            await cancelQuestion();
            expect(await result).toBeNull();
        });

        it('leaves everything as it is when the question is cancelled', async () => {
            await renderProvider();
            const { result } = await askConflict(() => importBundle(bundleOf(), CENTERED));
            await cancelQuestion();
            expect(await result).toBeNull();
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select old');
            expect(reload).not.toHaveBeenCalled();
        });

        it('ignores a second import while a question is open', async () => {
            await renderProvider();
            const warn = vi.spyOn(api.logger, 'warn');
            const { result: first } = await askConflict(() => importBundle(bundleOf(), CENTERED));
            let second: string | null = 'pending';
            await act(async () => { second = await importBundle(bundleOf(), CENTERED); });
            expect(second).toBeNull();
            expect(warn).toHaveBeenCalledWith('ignored workbook import while another decision is pending', {}, 'workbook_import');
            expect(questionIsOpen()).toBe(true);
            await cancelQuestion();
            expect(await first).toBeNull();
        });

        it('creates a copy with a new identity next to the workbook', async () => {
            await renderProvider();
            const { result } = await askConflict(() => importBundle(bundleOf(), CENTERED));
            await click(byTestId('workbook-import-create-new'));
            const id = await result;
            expect(id).not.toBe(WORKBOOK_ID);
            expect(registry.workbooks.get(id!)?.name).toBe('Imported (copy)');
            expect(registry.scripts.get(id!)?.get('query.sql')).toBe('select 1');
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select old');
            expect(reload).not.toHaveBeenCalled();
            await vi.waitFor(() => expect(api.workbooks.has(id!)).toBe(true));
            await vi.waitFor(() => expect(questionIsOpen()).toBe(false));
        });

        it('creates a copy and reloads when asked to', async () => {
            await renderProvider();
            const { result } = await askConflict(() => importBundle(bundleOf(), { ...CENTERED, reloadAfterSuccess: true }));
            await click(byTestId('workbook-import-create-new'));
            const id = await result;
            expect(registry.workbooks.get(id!)?.name).toBe('Imported (copy)');
            expect(reload).toHaveBeenCalledOnce();
        });

        it('replaces the workbook and reloads', async () => {
            await renderProvider();
            const { result } = await askConflict(() => importBundle(bundleOf(), CENTERED));
            await click(byTestId('workbook-import-replace'));
            expect(await result).toBe(WORKBOOK_ID);
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select 1');
            expect(registry.workbooks.get(WORKBOOK_ID)?.name).toBe('Imported');
            expect(reload).toHaveBeenCalledOnce();
            // The workbook of the runtime is the replaced version until the app reloads, its writes stay held
            expect(api.writer.isWorkbookHeld(WORKBOOK_ID)).toBe(true);
            // The staged copy is gone again
            expect(registry.manifest.map(entry => entry.path)).toEqual([WORKBOOK_ID]);
        });

        it('keeps the workbook and the question when the replacement fails', async () => {
            await renderProvider();
            const error = vi.spyOn(api.logger, 'error');
            const { result } = await askConflict(() => importBundle(bundleOf(), CENTERED));
            registry.failScriptWrites = true;
            await click(byTestId('workbook-import-replace'));
            await vi.waitFor(() => expect(error).toHaveBeenCalledWith('workbook import failed', expect.objectContaining({ error: expect.stringContaining('disk full') }), 'workbook_import'));
            expect(reload).not.toHaveBeenCalled();
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select old');
            // The user may try again or leave
            await vi.waitFor(() => expect(byTestId('workbook-import-replace')?.disabled).toBe(false));
            await cancelQuestion();
            expect(await result).toBeNull();
        });

        it('returns null when the connections are cancelled after the choice', async () => {
            knowTrinoConnection();
            await renderProvider();
            const { result } = await askConflict(() => importBundle(trinoSession(), CENTERED));
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
        await act(async () => { await importBundle(bundleOf(), CENTERED); });
        await vi.waitFor(() => expect(api.connections.has(HYPER_ID)).toBe(true));
        const queries: number[] = [];
        // The queries run on a channel of the test until they are cancelled
        await act(async () => { await setupTestConnection(api.runtime, HYPER_ID, { channel: pendingTestChannel() }); });
        await act(async () => {
            const metadata = (workbookId: string) => ({
                queryType: QueryType.USER_PROVIDED, title: null, description: null, issuer: null, userProvided: true, workbookId,
            });
            queries.push(runTestQuery(api.runtime, HYPER_ID, 'select 1', metadata(WORKBOOK_ID), false));
            queries.push(runTestQuery(api.runtime, HYPER_ID, 'select 1', metadata(OTHER_WORKBOOK_ID), false));
        });
        await vi.waitFor(() => expect(api.connections.get(HYPER_ID)?.queriesActiveOrdered).toEqual(queries));
        const { result } = await askConflict(() => importBundle(bundleOf({}, 'select 2'), CENTERED));
        await click(byTestId('workbook-import-replace'));
        expect(await result).toBe(WORKBOOK_ID);
        expect(cancelQuery.mock.calls).toEqual([[queries[0]]]);
    });

    describe('the registered workbook of an import', () => {
        it('finds nothing for a new workbook', async () => {
            await renderProvider();
            expect(await findConflict(bundleOf())).toBeNull();
        });

        it('finds a workbook of the app', async () => {
            await registerWorkbook();
            await renderProvider();
            expect(await findConflict(bundleOf())).toEqual({
                workbookId: WORKBOOK_ID,
                displayLocation: `opfs://workbooks/${WORKBOOK_ID}`,
                isNative: false,
            });
        });

        it('finds a workbook in a folder', async () => {
            await composite.upsertWorkbookEntry({ path: WORKBOOK_ID, storageType: StorageBackendType.Native, nativePath: NATIVE_DIR });
            await renderProvider();
            expect(await findConflict(bundleOf())).toEqual({
                workbookId: WORKBOOK_ID,
                displayLocation: `fs://${NATIVE_DIR}`,
                isNative: true,
            });
        });
    });

    describe('a choice made before the import', () => {
        it('imports a new workbook whatever the choice', async () => {
            await renderProvider();
            let id: string | null = null;
            await act(async () => { id = await importWithChoice(bundleOf(), 'replace'); });
            expect(id).toBe(WORKBOOK_ID);
            expect(reload).not.toHaveBeenCalled();
            await vi.waitFor(() => expect(api.workbooks.has(WORKBOOK_ID)).toBe(true));
        });

        it('creates a copy of a registered workbook', async () => {
            await registerWorkbook();
            await renderProvider();
            let id: string | null = null;
            await act(async () => { id = await importWithChoice(bundleOf(), 'create-new'); });
            expect(id).not.toBe(WORKBOOK_ID);
            expect(registry.workbooks.get(id!)?.name).toBe('Imported (copy)');
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select old');
        });

        it('replaces a registered workbook and reloads', async () => {
            await registerWorkbook();
            await renderProvider();
            let id: string | null = null;
            await act(async () => { id = await importWithChoice(bundleOf(), 'replace'); });
            expect(id).toBe(WORKBOOK_ID);
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select 1');
            expect(reload).toHaveBeenCalledOnce();
        });

        it('keeps the workbook when the replacement fails', async () => {
            await registerWorkbook();
            await renderProvider();
            registry.failScriptWrites = true;
            await expect(importWithChoice(bundleOf(), 'replace')).rejects.toThrow('disk full');
            expect(reload).not.toHaveBeenCalled();
            expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select old');
        });

        it('returns null when the connections are cancelled', async () => {
            knowTrinoConnection();
            await renderProvider();
            let result!: Promise<string | null>;
            await act(async () => { result = importWithChoice(trinoSession(), 'create-new'); });
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
            await act(async () => { id = await importNative(NATIVE_DIR); });
            expect(id).toBe(WORKBOOK_ID);
            expect(reload).toHaveBeenCalledOnce();
            expect(composite.getWorkbookLocation(WORKBOOK_ID)).toEqual({ type: StorageBackendType.Native, nativePath: NATIVE_DIR });
            expect((await folderWorkbook())?.connections).toEqual(before?.connections);
        });

        it('rejects a folder without a workbook and does not reload', async () => {
            await renderProvider();
            await expect(importNative('/Users/me/empty')).rejects.toThrow();
            expect(reload).not.toHaveBeenCalled();
            expect(registry.manifest).toEqual([]);
        });

        it('writes the consolidated connections into the folder', async () => {
            knowTrinoConnection();
            const native = new NativeStorageBackend(NATIVE_DIR, ELECTRON_FILE_SYSTEM);
            await native.saveWorkbookManifest(WORKBOOK_ID, trinoSession().workbook);
            await renderProvider();
            let result!: Promise<string | null>;
            await act(async () => { result = importNative(NATIVE_DIR); });
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
            await act(async () => { result = importNative(NATIVE_DIR); });
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
                const { result } = await askConflict(() => importNative(NATIVE_DIR));
                expect(document.body.textContent).toContain(`opfs://workbooks/${WORKBOOK_ID}`);
                await cancelQuestion();
                expect(await result).toBeNull();
                expect(registry.scripts.get(WORKBOOK_ID)?.get('query.sql')).toBe('select old');
            });

            it('replaces the workbook with the folder and removes the copy in the app', async () => {
                await renderProvider();
                const { result } = await askConflict(() => importNative(NATIVE_DIR));
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
                const { result } = await askConflict(() => importNative(NATIVE_DIR));
                await click(byTestId('workbook-import-replace'));
                await vi.waitFor(() => expect(document.body.textContent).toContain('Use existing connections?'));
                await click(buttonWithText('Import'));
                expect(await result).toBe(WORKBOOK_ID);
                expect((await composite.loadWorkbook(WORKBOOK_ID)).connections.map(connection => connection.connectionId)).toEqual([KNOWN_TRINO_ID]);
            });

            it('copies the folder into the app for a new workbook and leaves the folder alone', async () => {
                await renderProvider();
                const before = await folderWorkbook();
                const { result } = await askConflict(() => importNative(NATIVE_DIR));
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
            await expect(importBundle(bundleOf(), CENTERED)).rejects.toThrow('Workbook imports require composite storage');
            await expect(findConflict(bundleOf())).rejects.toThrow('Workbook imports require composite storage');
            await expect(importWithChoice(bundleOf(), 'replace')).rejects.toThrow('Workbook imports require composite storage');
        });
    });
});
