import * as core from '@ankoh/dashql-core';
import * as React from 'react';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectionRegistry, useConnectionRegistry } from '../../connections/connection_registry.js';
import type { Logger } from '../../platform/logger/logger.js';
import { LoggerProvider, useLogger } from '../../platform/logger/logger_provider.js';
import { TestLogger } from '../../platform/logger/test_logger.js';
import { CompositeStorageBackend } from '../../storage/composite_storage_backend.js';
import { NativeStorageBackend } from '../../storage/native_storage_backend.js';
import { SessionTestRegistry, testSession } from '../../storage/session_test_backend.js';
import { STORAGE_ATTACHMENTS_FOLDER, STORAGE_SCRIPTS_FOLDER, STORAGE_SESSION_FILE, StorageBackendType, type SessionData } from '../../storage/storage_backend.js';
import { StorageProvider, useStorage } from '../../storage/storage_provider.js';
import { DEBOUNCE_DURATION_SCRIPT_WRITE, groupScriptWrites, WRITE_SCRIPT, type StorageWriter } from '../../storage/storage_writer.js';
import { fsStore, makeFsMock, resetFsStore } from '../../storage/test_fs_mock.js';
import { SessionScriptsRegistryProvider, useSessionScriptsRegistry } from '../scripts/session_scripts_registry.js';
import { restoreAppState, type RestoredAppState } from './app_state_loader.js';
import { NativeSessionSync, readStoredSessionScripts } from './native_session_sync_react.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

const SESSION_ID = '11111111-2222-4333-8444-555555555555';
const HYPER_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TRINO_ID = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const HYPER_PARAMS = { hyper: {} } as SessionData['connections'][number]['params'];
const TRINO_PARAMS = { trino: { endpoint: 'https://trino.example' } } as SessionData['connections'][number]['params'];
const DIR = '/Users/me/session';
const SCRIPT_PATH = `${DIR}/${STORAGE_SCRIPTS_FOLDER}/query.sql`;

interface Api {
    writer: StorageWriter;
    logger: Logger;
    connections: ReturnType<typeof useConnectionRegistry>[0];
    sessions: ReturnType<typeof useSessionScriptsRegistry>[0];
}

/// The app after its restoration: the registries hold what the restoration read
function App(props: { restored: RestoredAppState; capture: (api: Api) => void }) {
    const [, writer] = useStorage();
    const logger = useLogger();
    const [connections, setConnections] = useConnectionRegistry();
    const [sessions, setSessions] = useSessionScriptsRegistry();
    React.useEffect(() => {
        setConnections(registry => ({
            ...registry,
            connections: props.restored.connectionStates,
            connectionsByType: props.restored.connectionStatesByType,
        }));
        setSessions(registry => ({
            ...registry,
            sessionScriptsMap: props.restored.sessionScripts,
            sessionScriptsByConnection: props.restored.sessionScriptsByConnection,
        }));
    }, [props.restored, setConnections, setSessions]);
    React.useLayoutEffect(() => {
        props.capture({ writer, logger, connections, sessions });
    });
    return <NativeSessionSync />;
}

describe('NativeSessionSync', () => {
    let dql: core.DashQL;
    let container: HTMLDivElement;
    let root: Root | null;
    let api: Api;
    let registry: SessionTestRegistry;
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
        registry = new SessionTestRegistry();
        backend = new CompositeStorageBackend(registry, new TestLogger());
        await backend.initialize();
    });
    afterEach(() => {
        if (root != null) act(() => root!.unmount());
        container.remove();
        delete globalThis.dashqlElectron;
        dql.resetUnsafe();
    });

    /// A session in a native folder
    const sessionFile = (overrides: Partial<SessionData> = {}): SessionData => testSession({
        sessionId: SESSION_ID,
        name: 'Folder',
        connections: [{ connectionId: HYPER_ID, params: HYPER_PARAMS }],
        scripts: [{ name: 'query.sql', connectionId: HYPER_ID }],
        ...overrides,
    });
    async function seedFolder(): Promise<void> {
        const native = new NativeStorageBackend(DIR);
        await native.saveSessionManifest(SESSION_ID, sessionFile());
        await native.saveScript(SESSION_ID, 'query.sql', 'select app');
        await backend.upsertSessionEntry({ path: SESSION_ID, storageType: StorageBackendType.Native, nativePath: DIR });
    }

    /// Restore and render the app, resolves once the first check of the session acknowledged the disk
    async function renderApp(options: { waitForFirstCheck?: boolean; afterRestore?: () => void } = {}): Promise<void> {
        const folder = backend.nativeSessionFolder(SESSION_ID);
        const acknowledged = folder == null ? null : vi.spyOn(folder, 'acknowledgeScripts');
        const restored = await restoreAppState(dql, backend, new TestLogger(), () => { });
        options.afterRestore?.();
        await act(async () => {
            root!.render(
                <LoggerProvider>
                    <StorageProvider backend={backend}>
                        <ConnectionRegistry>
                            <SessionScriptsRegistryProvider>
                                <App restored={restored} capture={next => { api = next; }} />
                            </SessionScriptsRegistryProvider>
                        </ConnectionRegistry>
                    </StorageProvider>
                </LoggerProvider>,
            );
        });
        if (options.waitForFirstCheck !== false && acknowledged != null) {
            await vi.waitFor(() => expect(acknowledged).toHaveBeenCalledOnce());
            await settled();
        }
    }

    /// Wait until no check is running
    const settled = () => vi.waitFor(() => expect(api.writer.isSessionPaused(SESSION_ID)).toBe(false));
    const scriptText = (name = 'query.sql') => {
        const session = api.sessions.sessionScriptsMap.get(SESSION_ID)!;
        return session.scripts[session.scriptRefs[name].scriptId].scriptSession.getText();
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
    /// The user types into the editor, the text changes at once and its write is debounced
    const localEdit = (sql: string) => {
        const session = api.sessions.sessionScriptsMap.get(SESSION_ID)!;
        const script = session.scripts[session.scriptRefs['query.sql'].scriptId].scriptSession;
        script.replaceText(script.getTextVersion(), sql);
        void api.writer.write(
            groupScriptWrites(SESSION_ID, 'query.sql'),
            { type: WRITE_SCRIPT, value: [SESSION_ID, 'query.sql', sql] },
            DEBOUNCE_DURATION_SCRIPT_WRITE,
        );
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
            const folder = backend.nativeSessionFolder(SESSION_ID)!;
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
            const stamp = vi.spyOn(backend.nativeSessionFolder(SESSION_ID)!, 'stampFolder');
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
            expect(api.writer.getPendingKeysForSession(SESSION_ID)).toEqual([]);
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

        it('adds a script file that appeared and lists it in the session file', async () => {
            await seedFolder();
            await renderApp();
            changeOnDisk(`${DIR}/${STORAGE_SCRIPTS_FOLDER}/added.sql`, 'select added');
            await checkFolder();
            await vi.waitFor(() => expect(scriptText('added.sql')).toBe('select added'));
            await flush();
            const stored = JSON.parse(fsStore.files.get(`${DIR}/${STORAGE_SESSION_FILE}`)!) as SessionData;
            expect(stored.scripts.map(script => script.name).sort()).toEqual(['added.sql', 'query.sql']);
        });

        it('drops a script file that disappeared', async () => {
            await seedFolder();
            await new NativeStorageBackend(DIR).saveScript(SESSION_ID, 'second.sql', 'select second');
            await renderApp();
            fsStore.files.delete(`${DIR}/${STORAGE_SCRIPTS_FOLDER}/second.sql`);
            fsStore.mtimes.delete(`${DIR}/${STORAGE_SCRIPTS_FOLDER}/second.sql`);
            await checkFolder();
            await vi.waitFor(() => expect(api.sessions.sessionScriptsMap.get(SESSION_ID)!.scriptOrder).toEqual(['query.sql']));
            await flush();
            const stored = JSON.parse(fsStore.files.get(`${DIR}/${STORAGE_SESSION_FILE}`)!) as SessionData;
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
            expect(api.sessions.sessionScriptsMap.get(SESSION_ID)!.scriptRefs['added.sql']).toBeUndefined();
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
            expect(api.writer.getPendingKeysForSession(SESSION_ID)).toEqual([]);
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

    describe('the connections of a session file that changed', () => {
        const pullTrinoScript = () => {
            changeOnDisk(`${DIR}/${STORAGE_SESSION_FILE}`, JSON.stringify(sessionFile({
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
            await vi.waitFor(() => expect(api.connections.connections.has(TRINO_ID)).toBe(true));
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
            expect(api.connections.connections.has(TRINO_ID)).toBe(false);
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
        const attachmentNames = () => api.sessions.sessionScriptsMap.get(SESSION_ID)!.attachments?.map(attachment => attachment.fileName);

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
            const load = vi.spyOn(backend, 'loadSession').mockRejectedValueOnce(new Error('session file is locked'));
            await focusWindow();
            await vi.waitFor(() => expect(load).toHaveBeenCalledOnce());
            await settled();
            await focusWindow();
            await vi.waitFor(() => expect(attachmentNames()).toEqual(['data.parquet']));
        });
    });

    describe('errors', () => {
        it('logs a failed check and lets the writes of the session continue', async () => {
            await seedFolder();
            await renderApp();
            const warn = vi.spyOn(api.logger, 'warn');
            vi.spyOn(backend.nativeSessionFolder(SESSION_ID)!, 'stampFolder').mockRejectedValueOnce(new Error('folder is gone'));
            await focusWindow();
            await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(
                'failed to check the session folder',
                expect.objectContaining({ sessionId: SESSION_ID, error: expect.stringContaining('folder is gone') }),
                'native_session_sync',
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
            const restored = await restoreAppState(dql, backend, new TestLogger(), () => { });
            const stamp = vi.spyOn(backend.nativeSessionFolder(SESSION_ID)!, 'stampFolder');
            delete globalThis.dashqlElectron;
            await act(async () => {
                root!.render(
                    <LoggerProvider>
                        <StorageProvider backend={backend}>
                            <ConnectionRegistry>
                                <SessionScriptsRegistryProvider>
                                    <App restored={restored} capture={next => { api = next; }} />
                                </SessionScriptsRegistryProvider>
                            </ConnectionRegistry>
                        </StorageProvider>
                    </LoggerProvider>,
                );
            });
            await focusWindow();
            expect(stamp).not.toHaveBeenCalled();
        });

        it('does not hold the writes of a session in the app', async () => {
            await backend.saveSessionManifest(SESSION_ID, sessionFile());
            await backend.saveScript(SESSION_ID, 'query.sql', 'select app');
            await renderApp();
            await vi.waitFor(() => expect(api.sessions.sessionScriptsMap.has(SESSION_ID)).toBe(true));
            const pause = vi.spyOn(api.writer, 'pauseSession');
            await focusWindow();
            expect(pause).not.toHaveBeenCalled();
            expect(confirm).not.toHaveBeenCalled();
        });

        it('stops checking when it unmounts', async () => {
            await seedFolder();
            await renderApp();
            const stamp = vi.spyOn(backend.nativeSessionFolder(SESSION_ID)!, 'stampFolder');
            act(() => root!.unmount());
            root = null;
            window.dispatchEvent(new Event('focus'));
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(stamp).not.toHaveBeenCalled();
        });
    });
});

describe('readStoredSessionScripts', () => {
    it('reads nothing while the app has no embedded connection, scripts on unknown connections need it', () => {
        const session = testSession({ sessionId: SESSION_ID, connections: [], scripts: [] });
        expect(readStoredSessionScripts({ connections: new Map(), connectionsByType: [] }, session, [])).toBeNull();
    });
});
