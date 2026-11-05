import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionRegistry, useConnectionRegistry } from '../../connections/connection_registry.js';
import type { ConnectionState } from '../../connections/connection_state.js';
import { EXECUTOR_CTX } from '../../connections/query_executor.js';
import type { Logger } from '../../platform/logger/logger.js';
import { LoggerProvider, useLogger } from '../../platform/logger/logger_provider.js';
import { DashQLCoreProvider } from '../../runtime/core_provider.js';
import { CompositeStorageBackend } from '../../storage/composite_storage_backend.js';
import { NativeStorageBackend } from '../../storage/native_storage_backend.js';
import type { SessionBundle } from '../../storage/session_bundle.js';
import { SessionTestBackend, SessionTestRegistry, testSession } from '../../storage/session_test_backend.js';
import { STORAGE_SESSION_FILE, StorageBackendType, type StorageBackend } from '../../storage/storage_backend.js';
import { StorageProvider, useStorage } from '../../storage/storage_provider.js';
import type { StorageWriter } from '../../storage/storage_writer.js';
import { fsStore, makeFsMock, resetFsStore } from '../../storage/test_fs_mock.js';
import { SessionScriptsRegistryProvider, useSessionScriptsRegistry } from '../scripts/session_scripts_registry.js';
import { SessionImportProvider, useSessionImport } from './session_import_provider.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class {
    observe() { }
    unobserve() { }
    disconnect() { }
});

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_SESSION_ID = '22222222-3333-4444-8555-666666666666';
const HYPER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const OTHER_HYPER_ID = 'cccccccc-dddd-4eee-8fff-000000000000';
const TRINO_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const KNOWN_TRINO_ID = 'dddddddd-eeee-4fff-8000-111111111111';
const HYPER_PARAMS = { hyper: {} } as SessionBundle['session']['connections'][number]['params'];
const TRINO_PARAMS = { trino: { endpoint: 'https://trino.example' } } as SessionBundle['session']['connections'][number]['params'];
const NATIVE_DIR = '/Users/me/session';

const CENTERED = { presentation: { mode: 'centered' as const } };

/// A registry whose writes can fail
class Registry extends SessionTestRegistry {
    failScriptWrites = false;
    failSessionLoads = false;
    override async saveScript(sessionId: string, scriptName: string, sql: string): Promise<void> {
        if (this.failScriptWrites) throw new Error('disk full');
        await super.saveScript(sessionId, scriptName, sql);
    }
    override async loadSession(sessionId: string) {
        if (this.failSessionLoads) throw new Error('session file unreadable');
        return await super.loadSession(sessionId);
    }
}

function bundleOf(overrides: Partial<SessionBundle['session']> = {}, sql = 'select 1'): SessionBundle {
    const session = testSession({
        sessionId: SESSION_ID,
        name: 'Imported',
        connections: [{ connectionId: HYPER_ID, params: HYPER_PARAMS }],
        scripts: [{ name: 'query.sql', connectionId: HYPER_ID }],
        ...overrides,
    });
    return {
        session,
        catalogs: [],
        scripts: session.scripts.map(script => ({ name: script.name, sql })),
        data: [],
    };
}

interface Api {
    importer: ReturnType<typeof useSessionImport>;
    writer: StorageWriter;
    logger: Logger;
    connections: ReadonlyMap<string, ConnectionState>;
    setConnections: ReturnType<typeof useConnectionRegistry>[1];
    sessions: ReturnType<typeof useSessionScriptsRegistry>[0];
}

function Capture(props: { capture: (api: Api) => void }) {
    const importer = useSessionImport();
    const [, writer] = useStorage();
    const logger = useLogger();
    const [registry, setConnections] = useConnectionRegistry();
    const [sessions] = useSessionScriptsRegistry();
    React.useLayoutEffect(() => {
        props.capture({ importer, writer, logger, connections: registry.connections, setConnections, sessions });
    });
    return <div data-testid="app-content" />;
}

function byTestId(testId: string): HTMLButtonElement | null {
    return document.querySelector(`[data-testid="${testId}"]`);
}
const questionIsOpen = () => byTestId('session-import-replace') != null;
function buttonWithText(text: string): HTMLButtonElement {
    const button = [...document.querySelectorAll('button')].find(candidate => candidate.textContent?.trim() === text);
    if (button == null) throw new Error(`No button "${text}"`);
    return button;
}

describe('SessionImportProvider', () => {
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
        const dependencies = { reload, card: { CompactNavBar: () => <></>, ParticleFlowBackground: () => null } };
        await act(async () => {
            root.render(
                <LoggerProvider>
                    <StorageProvider backend={backend}>
                        <ConnectionRegistry>
                            <SessionScriptsRegistryProvider>
                                <EXECUTOR_CTX.Provider value={executor as never}>
                                    <DashQLCoreProvider>
                                        <SessionImportProvider dependencies={dependencies}>
                                            <Capture capture={next => { api = next; }} />
                                        </SessionImportProvider>
                                    </DashQLCoreProvider>
                                </EXECUTOR_CTX.Provider>
                            </SessionScriptsRegistryProvider>
                        </ConnectionRegistry>
                    </StorageProvider>
                </LoggerProvider>,
            );
        });
        await vi.waitFor(() => expect(api).toBeDefined());
    }

    /// A session that is registered already
    async function registerSession(sql = 'select old'): Promise<void> {
        await composite.saveSessionManifest(SESSION_ID, testSession({
            sessionId: SESSION_ID,
            name: 'Existing',
            connections: [{ connectionId: HYPER_ID, params: HYPER_PARAMS }],
            scripts: [{ name: 'query.sql', connectionId: HYPER_ID }],
        }));
        await composite.saveScript(SESSION_ID, 'query.sql', sql);
    }

    /// The connections of the app when a connection of the session may be one of them
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
        await click(byTestId('session-import-cancel') ?? byTestId('dialog-close') ?? buttonWithText('Cancel'));
    }

    describe('a new portable session', () => {
        it('is written and restored without a reload', async () => {
            await renderProvider();
            const writer = vi.spyOn(api.writer, 'reviveSession');
            let id: string | null = null;
            await act(async () => { id = await api.importer.importPortableBundle(bundleOf(), CENTERED); });
            expect(id).toBe(SESSION_ID);
            expect(reload).not.toHaveBeenCalled();
            expect(registry.scripts.get(SESSION_ID)?.get('query.sql')).toBe('select 1');
            // An earlier import of the bundle may have been deleted in this tab
            expect(writer).toHaveBeenCalledWith(SESSION_ID);
            await vi.waitFor(() => {
                expect(api.sessions.sessionScriptsMap.has(SESSION_ID)).toBe(true);
                expect(api.connections.has(HYPER_ID)).toBe(true);
            });
            expect(api.sessions.sessionScriptsByConnection.get(HYPER_ID)).toContain(SESSION_ID);
        });

        it('uses the embedded database of the app instead of bringing a second one', async () => {
            await renderProvider();
            await act(async () => { await api.importer.importPortableBundle(bundleOf(), CENTERED); });
            await vi.waitFor(() => expect(api.connections.has(HYPER_ID)).toBe(true));
            await act(async () => {
                await api.importer.importPortableBundle(bundleOf({
                    sessionId: OTHER_SESSION_ID,
                    connections: [{ connectionId: OTHER_HYPER_ID, params: HYPER_PARAMS }],
                    scripts: [{ name: 'query.sql', connectionId: OTHER_HYPER_ID }],
                }), CENTERED);
            });
            await vi.waitFor(() => expect(api.sessions.sessionScriptsMap.has(OTHER_SESSION_ID)).toBe(true));
            expect(api.connections.has(OTHER_HYPER_ID)).toBe(false);
            expect(registry.sessions.get(OTHER_SESSION_ID)?.connections.map(connection => connection.connectionId)).toEqual([HYPER_ID]);
        });

        it('reloads after the write when asked to, and keeps the writer paused for the reload', async () => {
            await renderProvider();
            const pause = vi.spyOn(api.writer, 'pause');
            const resume = vi.spyOn(api.writer, 'resume');
            const flush = vi.spyOn(api.writer, 'flush');
            let id: string | null = null;
            await act(async () => { id = await api.importer.importPortableBundle(bundleOf(), { ...CENTERED, reloadAfterSuccess: true }); });
            expect(id).toBe(SESSION_ID);
            expect(reload).toHaveBeenCalledOnce();
            expect(pause).toHaveBeenCalledOnce();
            expect(flush).toHaveBeenCalledOnce();
            expect(resume).not.toHaveBeenCalled();
            expect(registry.scripts.get(SESSION_ID)?.get('query.sql')).toBe('select 1');
            // The reload restores the session
            expect(api.sessions.sessionScriptsMap.has(SESSION_ID)).toBe(false);
        });

        it('resumes the writer and does not reload when the write fails', async () => {
            await renderProvider();
            const resume = vi.spyOn(api.writer, 'resume');
            registry.failScriptWrites = true;
            await expect(api.importer.importPortableBundle(bundleOf(), { ...CENTERED, reloadAfterSuccess: true })).rejects.toThrow('disk full');
            expect(resume).toHaveBeenCalledOnce();
            expect(reload).not.toHaveBeenCalled();
            // A failed import leaves no session behind
            expect(registry.manifest).toEqual([]);
        });

        it('removes a session again that cannot be restored', async () => {
            await renderProvider();
            // The write succeeded when the writer is told about the session, the restoration fails after it
            vi.spyOn(api.writer, 'reviveSession').mockImplementation(() => { registry.failSessionLoads = true; });
            await expect(api.importer.importPortableBundle(bundleOf(), CENTERED)).rejects.toThrow(`invalid session ${SESSION_ID}`);
            registry.failSessionLoads = false;
            expect(registry.manifest).toEqual([]);
            expect(registry.scripts.has(SESSION_ID)).toBe(false);
            expect(api.sessions.sessionScriptsMap.has(SESSION_ID)).toBe(false);
        });

        it('drops catalogs that do not parse and warns about them', async () => {
            await renderProvider();
            const warn = vi.spyOn(api.logger, 'warn');
            const bundle = bundleOf();
            bundle.catalogs = [{ connectionId: HYPER_ID, relations: 'this is ( not sql', functions: null }];
            await act(async () => { await api.importer.importPortableBundle(bundle, { ...CENTERED, reloadAfterSuccess: true }); });
            expect(warn).toHaveBeenCalledWith('ignored malformed session catalog files', expect.objectContaining({
                sessionId: SESSION_ID,
                files: expect.stringContaining(HYPER_ID),
            }), 'session_import');
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
            expect(document.body.textContent).toContain('The session Imported uses connections');
            expect(document.body.textContent).toContain('Use Production');
            // Nothing is written before the user decided
            expect(registry.manifest).toEqual([]);
            await click(buttonWithText('Import'));
            expect(await result).toBe(SESSION_ID);
            expect(registry.sessions.get(SESSION_ID)?.connections.map(connection => connection.connectionId)).toEqual([KNOWN_TRINO_ID]);
            expect(registry.sessions.get(SESSION_ID)?.scripts).toEqual([{ name: 'query.sql', connectionId: KNOWN_TRINO_ID }]);
            await vi.waitFor(() => expect(document.body.textContent).not.toContain('Use existing connections?'));
        });

        it('keeps the connection of the session when the user prefers that', async () => {
            knowTrinoConnection();
            await renderProvider();
            let result!: Promise<string | null>;
            await act(async () => { result = api.importer.importPortableBundle(trinoSession(), { ...CENTERED, reloadAfterSuccess: true }); });
            await vi.waitFor(() => expect(document.body.textContent).toContain('Keep as a new connection'));
            const separate = document.querySelector('input[value="separate"]') as HTMLInputElement;
            await click(separate);
            await click(buttonWithText('Import'));
            expect(await result).toBe(SESSION_ID);
            expect(registry.sessions.get(SESSION_ID)?.connections.map(connection => connection.connectionId)).toEqual([TRINO_ID]);
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

        it('prefers the live params of a connection over the manifest, writes are debounced', async () => {
            // The manifest still has the old endpoint, only the live connection matches the session
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

    describe('a session that is registered already', () => {
        beforeEach(async () => { await registerSession(); });

        it('hides the app behind a centered question', async () => {
            await renderProvider();
            const { result } = await askConflict(() => api.importer.importPortableBundle(bundleOf(), CENTERED));
            expect(appWrapper().style.display).toBe('none');
            expect(appWrapper().getAttribute('aria-hidden')).toBe('true');
            expect(document.body.textContent).toContain(`opfs://sessions/${SESSION_ID}`);
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
            expect(registry.scripts.get(SESSION_ID)?.get('query.sql')).toBe('select old');
            expect(reload).not.toHaveBeenCalled();
        });

        it('ignores a second import while a question is open', async () => {
            await renderProvider();
            const warn = vi.spyOn(api.logger, 'warn');
            const { result: first } = await askConflict(() => api.importer.importPortableBundle(bundleOf(), CENTERED));
            let second: string | null = 'pending';
            await act(async () => { second = await api.importer.importPortableBundle(bundleOf(), CENTERED); });
            expect(second).toBeNull();
            expect(warn).toHaveBeenCalledWith('ignored session import while another decision is pending', {}, 'session_import');
            expect(questionIsOpen()).toBe(true);
            await cancelQuestion();
            expect(await first).toBeNull();
        });

        it('creates a copy with a new identity next to the session', async () => {
            await renderProvider();
            const { result } = await askConflict(() => api.importer.importPortableBundle(bundleOf(), CENTERED));
            await click(byTestId('session-import-create-new'));
            const id = await result;
            expect(id).not.toBe(SESSION_ID);
            expect(registry.sessions.get(id!)?.name).toBe('Imported (copy)');
            expect(registry.scripts.get(id!)?.get('query.sql')).toBe('select 1');
            expect(registry.scripts.get(SESSION_ID)?.get('query.sql')).toBe('select old');
            expect(reload).not.toHaveBeenCalled();
            await vi.waitFor(() => expect(api.sessions.sessionScriptsMap.has(id!)).toBe(true));
            await vi.waitFor(() => expect(questionIsOpen()).toBe(false));
        });

        it('creates a copy and reloads when asked to', async () => {
            await renderProvider();
            const { result } = await askConflict(() => api.importer.importPortableBundle(bundleOf(), { ...CENTERED, reloadAfterSuccess: true }));
            await click(byTestId('session-import-create-new'));
            const id = await result;
            expect(registry.sessions.get(id!)?.name).toBe('Imported (copy)');
            expect(reload).toHaveBeenCalledOnce();
        });

        it('replaces the session and reloads', async () => {
            await renderProvider();
            const pause = vi.spyOn(api.writer, 'pause');
            const resume = vi.spyOn(api.writer, 'resume');
            const { result } = await askConflict(() => api.importer.importPortableBundle(bundleOf(), CENTERED));
            await click(byTestId('session-import-replace'));
            expect(await result).toBe(SESSION_ID);
            expect(registry.scripts.get(SESSION_ID)?.get('query.sql')).toBe('select 1');
            expect(registry.sessions.get(SESSION_ID)?.name).toBe('Imported');
            expect(reload).toHaveBeenCalledOnce();
            expect(pause).toHaveBeenCalledOnce();
            expect(resume).not.toHaveBeenCalled();
            // The staged copy is gone again
            expect(registry.manifest.map(entry => entry.path)).toEqual([SESSION_ID]);
        });

        it('keeps the session and the question when the replacement fails', async () => {
            await renderProvider();
            const resume = vi.spyOn(api.writer, 'resume');
            const error = vi.spyOn(api.logger, 'error');
            const { result } = await askConflict(() => api.importer.importPortableBundle(bundleOf(), CENTERED));
            registry.failScriptWrites = true;
            await click(byTestId('session-import-replace'));
            await vi.waitFor(() => expect(error).toHaveBeenCalledWith('session import failed', expect.objectContaining({ error: expect.stringContaining('disk full') }), 'session_import'));
            expect(resume).toHaveBeenCalledOnce();
            expect(reload).not.toHaveBeenCalled();
            expect(registry.scripts.get(SESSION_ID)?.get('query.sql')).toBe('select old');
            // The user may try again or leave
            await vi.waitFor(() => expect(byTestId('session-import-replace')?.disabled).toBe(false));
            await cancelQuestion();
            expect(await result).toBeNull();
        });

        it('does not start the replacement when the pending writes cannot be flushed', async () => {
            await renderProvider();
            vi.spyOn(api.writer, 'flush').mockRejectedValue(new Error('flush failed'));
            const resume = vi.spyOn(api.writer, 'resume');
            const { result } = await askConflict(() => api.importer.importPortableBundle(bundleOf(), CENTERED));
            await click(byTestId('session-import-replace'));
            await vi.waitFor(() => expect(resume).toHaveBeenCalledOnce());
            expect(registry.scripts.get(SESSION_ID)?.get('query.sql')).toBe('select old');
            expect(reload).not.toHaveBeenCalled();
            await vi.waitFor(() => expect(byTestId('session-import-replace')?.disabled).toBe(false));
            await cancelQuestion();
            expect(await result).toBeNull();
        });

        it('returns null when the connections are cancelled after the choice', async () => {
            knowTrinoConnection();
            await renderProvider();
            const { result } = await askConflict(() => api.importer.importPortableBundle(trinoSession(), CENTERED));
            await click(byTestId('session-import-replace'));
            await vi.waitFor(() => expect(document.body.textContent).toContain('Use existing connections?'));
            // The conflict question waits behind the connections
            expect(questionIsOpen()).toBe(false);
            await cancelQuestion();
            expect(await result).toBeNull();
            expect(registry.scripts.get(SESSION_ID)?.get('query.sql')).toBe('select old');
            expect(reload).not.toHaveBeenCalled();
        });
    });

    it('stops only the running queries of the replaced session', async () => {
        await renderProvider();
        await act(async () => { await api.importer.importPortableBundle(bundleOf(), CENTERED); });
        await vi.waitFor(() => expect(api.connections.has(HYPER_ID)).toBe(true));
        await act(async () => {
            api.setConnections(current => {
                const connections = new Map(current.connections);
                const query = (sessionId: string) => ({ queryMetadata: { sessionId } });
                connections.set(HYPER_ID, {
                    ...connections.get(HYPER_ID)!,
                    queriesActive: new Map([[1, query(SESSION_ID)], [2, query(OTHER_SESSION_ID)]]),
                    queriesActiveOrdered: [1, 2],
                } as never);
                return { ...current, connections };
            });
        });
        await vi.waitFor(() => expect(api.connections.get(HYPER_ID)?.queriesActiveOrdered).toEqual([1, 2]));
        const { result } = await askConflict(() => api.importer.importPortableBundle(bundleOf({}, 'select 2'), CENTERED));
        await click(byTestId('session-import-replace'));
        expect(await result).toBe(SESSION_ID);
        expect(cancelQuery.mock.calls).toEqual([[HYPER_ID, 1]]);
    });

    describe('findPortableBundleConflict', () => {
        it('finds nothing for a new session', async () => {
            await renderProvider();
            expect(await api.importer.findPortableBundleConflict(bundleOf())).toBeNull();
        });

        it('finds a session of the app', async () => {
            await registerSession();
            await renderProvider();
            expect(await api.importer.findPortableBundleConflict(bundleOf())).toEqual({
                displayLocation: `opfs://sessions/${SESSION_ID}`,
                isNative: false,
            });
        });

        it('finds a session in a folder', async () => {
            await composite.upsertSessionEntry({ path: SESSION_ID, storageType: StorageBackendType.Native, nativePath: NATIVE_DIR });
            await renderProvider();
            expect(await api.importer.findPortableBundleConflict(bundleOf())).toEqual({
                displayLocation: `fs://${NATIVE_DIR}`,
                isNative: true,
            });
        });
    });

    describe('importPortableBundleWithChoice', () => {
        it('imports a new session whatever the choice', async () => {
            await renderProvider();
            let id: string | null = null;
            await act(async () => { id = await api.importer.importPortableBundleWithChoice(bundleOf(), 'replace'); });
            expect(id).toBe(SESSION_ID);
            expect(reload).not.toHaveBeenCalled();
            await vi.waitFor(() => expect(api.sessions.sessionScriptsMap.has(SESSION_ID)).toBe(true));
        });

        it('creates a copy of a registered session', async () => {
            await registerSession();
            await renderProvider();
            let id: string | null = null;
            await act(async () => { id = await api.importer.importPortableBundleWithChoice(bundleOf(), 'create-new'); });
            expect(id).not.toBe(SESSION_ID);
            expect(registry.sessions.get(id!)?.name).toBe('Imported (copy)');
            expect(registry.scripts.get(SESSION_ID)?.get('query.sql')).toBe('select old');
        });

        it('replaces a registered session and reloads', async () => {
            await registerSession();
            await renderProvider();
            let id: string | null = null;
            await act(async () => { id = await api.importer.importPortableBundleWithChoice(bundleOf(), 'replace'); });
            expect(id).toBe(SESSION_ID);
            expect(registry.scripts.get(SESSION_ID)?.get('query.sql')).toBe('select 1');
            expect(reload).toHaveBeenCalledOnce();
        });

        it('resumes the writer when the replacement fails', async () => {
            await registerSession();
            await renderProvider();
            const resume = vi.spyOn(api.writer, 'resume');
            registry.failScriptWrites = true;
            await expect(api.importer.importPortableBundleWithChoice(bundleOf(), 'replace')).rejects.toThrow('disk full');
            expect(resume).toHaveBeenCalledOnce();
            expect(reload).not.toHaveBeenCalled();
            expect(registry.scripts.get(SESSION_ID)?.get('query.sql')).toBe('select old');
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
            const native = new NativeStorageBackend(NATIVE_DIR);
            await native.saveSessionManifest(SESSION_ID, bundleOf({ name: 'From folder' }).session);
            await native.saveScript(SESSION_ID, 'query.sql', 'select folder');
        });
        const folderSession = async () => JSON.parse(fsStore.files.get(`${NATIVE_DIR}/${STORAGE_SESSION_FILE}`) ?? 'null');

        it('is registered as it is and reloads', async () => {
            await renderProvider();
            const before = await folderSession();
            let id: string | null = null;
            await act(async () => { id = await api.importer.importNativeFolder(NATIVE_DIR, CENTERED.presentation); });
            expect(id).toBe(SESSION_ID);
            expect(reload).toHaveBeenCalledOnce();
            expect(composite.getSessionLocation(SESSION_ID)).toEqual({ type: StorageBackendType.Native, nativePath: NATIVE_DIR });
            expect((await folderSession())?.connections).toEqual(before?.connections);
        });

        it('rejects a folder without a session and does not reload', async () => {
            await renderProvider();
            await expect(api.importer.importNativeFolder('/Users/me/empty', CENTERED.presentation)).rejects.toThrow();
            expect(reload).not.toHaveBeenCalled();
            expect(registry.manifest).toEqual([]);
        });

        it('writes the consolidated connections into the folder', async () => {
            knowTrinoConnection();
            const native = new NativeStorageBackend(NATIVE_DIR);
            await native.saveSessionManifest(SESSION_ID, trinoSession().session);
            await renderProvider();
            let result!: Promise<string | null>;
            await act(async () => { result = api.importer.importNativeFolder(NATIVE_DIR, CENTERED.presentation); });
            await vi.waitFor(() => expect(document.body.textContent).toContain('Use existing connections?'));
            await click(buttonWithText('Import'));
            expect(await result).toBe(SESSION_ID);
            const stored = await composite.loadSession(SESSION_ID);
            expect(stored.connections.map(connection => connection.connectionId)).toEqual([KNOWN_TRINO_ID]);
            expect(stored.scripts).toEqual([{ name: 'query.sql', connectionId: KNOWN_TRINO_ID }]);
            expect(reload).toHaveBeenCalledOnce();
        });

        it('imports nothing when the connections are cancelled', async () => {
            knowTrinoConnection();
            const native = new NativeStorageBackend(NATIVE_DIR);
            await native.saveSessionManifest(SESSION_ID, trinoSession().session);
            await renderProvider();
            let result!: Promise<string | null>;
            await act(async () => { result = api.importer.importNativeFolder(NATIVE_DIR, CENTERED.presentation); });
            await vi.waitFor(() => expect(document.body.textContent).toContain('Use existing connections?'));
            await cancelQuestion();
            expect(await result).toBeNull();
            expect(registry.manifest).toEqual([]);
            expect(reload).not.toHaveBeenCalled();
        });

        describe('of a session that is registered already', () => {
            beforeEach(async () => { await registerSession(); });

            it('says that the session lives in the app', async () => {
                await renderProvider();
                const { result } = await askConflict(() => api.importer.importNativeFolder(NATIVE_DIR, CENTERED.presentation));
                expect(document.body.textContent).toContain(`opfs://sessions/${SESSION_ID}`);
                await cancelQuestion();
                expect(await result).toBeNull();
                expect(registry.scripts.get(SESSION_ID)?.get('query.sql')).toBe('select old');
            });

            it('replaces the session with the folder and removes the copy in the app', async () => {
                await renderProvider();
                const { result } = await askConflict(() => api.importer.importNativeFolder(NATIVE_DIR, CENTERED.presentation));
                await click(byTestId('session-import-replace'));
                expect(await result).toBe(SESSION_ID);
                expect(composite.getSessionLocation(SESSION_ID)).toEqual({ type: StorageBackendType.Native, nativePath: NATIVE_DIR });
                expect(registry.scripts.has(SESSION_ID)).toBe(false);
                expect(reload).toHaveBeenCalledOnce();
            });

            it('writes the consolidated connections when it replaces the session', async () => {
                knowTrinoConnection();
                const native = new NativeStorageBackend(NATIVE_DIR);
                await native.saveSessionManifest(SESSION_ID, trinoSession().session);
                await renderProvider();
                const { result } = await askConflict(() => api.importer.importNativeFolder(NATIVE_DIR, CENTERED.presentation));
                await click(byTestId('session-import-replace'));
                await vi.waitFor(() => expect(document.body.textContent).toContain('Use existing connections?'));
                await click(buttonWithText('Import'));
                expect(await result).toBe(SESSION_ID);
                expect((await composite.loadSession(SESSION_ID)).connections.map(connection => connection.connectionId)).toEqual([KNOWN_TRINO_ID]);
            });

            it('copies the folder into the app for a new session and leaves the folder alone', async () => {
                await renderProvider();
                const before = await folderSession();
                const { result } = await askConflict(() => api.importer.importNativeFolder(NATIVE_DIR, CENTERED.presentation));
                await click(byTestId('session-import-create-new'));
                const id = await result;
                expect(id).not.toBe(SESSION_ID);
                expect(registry.sessions.get(id!)?.name).toBe('From folder (copy)');
                expect(registry.scripts.get(id!)?.get('query.sql')).toBe('select folder');
                expect(composite.getSessionLocation(id!).type).toBe(StorageBackendType.OPFS);
                expect(await folderSession()).toEqual(before);
                expect(reload).toHaveBeenCalledOnce();
            });
        });
    });

    describe('without composite storage', () => {
        it('rejects every import', async () => {
            await renderProvider(new SessionTestBackend());
            await expect(api.importer.importPortableBundle(bundleOf(), CENTERED)).rejects.toThrow('Session imports require composite storage');
            await expect(api.importer.findPortableBundleConflict(bundleOf())).rejects.toThrow('Session imports require composite storage');
            await expect(api.importer.importPortableBundleWithChoice(bundleOf(), 'replace')).rejects.toThrow('Session imports require composite storage');
            await expect(api.importer.importNativeFolder(NATIVE_DIR, CENTERED.presentation)).rejects.toThrow('Native session imports require composite storage');
        });
    });
});
