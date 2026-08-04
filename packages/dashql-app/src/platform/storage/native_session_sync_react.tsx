import * as React from 'react';

import { useConnectionRegistry } from '../../connection/connection_registry.js';
import { catalogFileMatchesStorage, connectionCatalogMatchesStorage, replaceConnectionCatalogFromStorage } from '../../connection/connection_state.js';
import { useNotebookRegistry } from '../../notebook/notebook_state_registry.js';
import { notebookMatchesStorageSnapshot, replaceNotebookFromStorage } from '../../notebook/notebook_state.js';
import { isNativePlatform } from '../native_globals.js';
import { useLogger } from '../logger/logger_provider.js';
import { stringifyError } from '../logger/logger.js';
import { useStorage } from './storage_provider.js';
import { NativeSessionSyncService, nativeSessionWatchForLocation } from './native_session_sync.js';
import type { NotebookStorageSnapshot } from '../../notebook/notebook_state.js';
import type { NotebookState } from '../../notebook/notebook_state.js';
import type { ConnectionState } from '../../connection/connection_state.js';
import type { StorageWriter } from './storage_writer.js';
import {
    STORAGE_NOTEBOOK_FOLDER,
    STORAGE_SCRIPT_DRAFT,
    STORAGE_SCRIPT_FUNCTIONS,
    STORAGE_SCRIPT_SCHEMA,
} from './storage_backend.js';

const LOG_CTX = 'native_session_sync';

interface SessionReloadDecision {
    reload: boolean;
    discardPendingWrites: boolean;
}

async function confirmExternalReload(hasPendingWrites: boolean): Promise<SessionReloadDecision> {
    const { confirm } = await import('@tauri-apps/plugin-dialog');
    const message = hasPendingWrites
        ? 'This session changed on disk while DashQL still has local changes waiting to be saved. Reload from disk and discard those pending local changes?'
        : 'This session changed outside DashQL. Reload it from disk?';
    const reload = await confirm(message, {
        title: 'Session changed on disk',
        kind: 'warning',
        okLabel: 'Reload',
        cancelLabel: 'Keep current',
    });
    return { reload, discardPendingWrites: reload && hasPendingWrites };
}

function isReloadedStorageKey(sessionId: string, key: string): boolean {
    return key === `${sessionId}/${STORAGE_SCRIPT_SCHEMA}`
        || key === `${sessionId}/${STORAGE_SCRIPT_FUNCTIONS}`
        || key === `${sessionId}/${STORAGE_NOTEBOOK_FOLDER}`
        || key.startsWith(`${sessionId}/${STORAGE_NOTEBOOK_FOLDER}/`);
}

function snapshotMatchesCompletedWrite(
    sessionId: string,
    snapshot: NotebookStorageSnapshot,
    schema: string | null,
    functions: string | null,
    connection: ConnectionState | undefined,
    notebook: NotebookState | undefined,
    writer: StorageWriter,
): boolean {
    const diskFiles = new Map<string, string | null>();
    const memoryFiles = new Map<string, string | null>();
    diskFiles.set(`${sessionId}/${STORAGE_SCRIPT_SCHEMA}`, schema);
    diskFiles.set(`${sessionId}/${STORAGE_SCRIPT_FUNCTIONS}`, functions);
    diskFiles.set(`${sessionId}/${STORAGE_NOTEBOOK_FOLDER}/${STORAGE_SCRIPT_DRAFT}`, snapshot.draft ?? '');
    if (connection) {
        memoryFiles.set(`${sessionId}/${STORAGE_SCRIPT_SCHEMA}`, catalogFileMatchesStorage(connection.catalogRelationScript, null)
            ? null
            : connection.catalogRelationScript.toString());
        memoryFiles.set(`${sessionId}/${STORAGE_SCRIPT_FUNCTIONS}`, catalogFileMatchesStorage(connection.catalogFunctionScript, null)
            ? null
            : connection.catalogFunctionScript.toString());
    }
    if (notebook) {
        memoryFiles.set(
            `${sessionId}/${STORAGE_NOTEBOOK_FOLDER}/${STORAGE_SCRIPT_DRAFT}`,
            notebook.scripts[notebook.uncommittedScriptId]?.script.toString() ?? '',
        );
        for (const script of Object.values(notebook.scripts)) {
            if (script.folderName && script.fileName) {
                memoryFiles.set(`${sessionId}/${STORAGE_NOTEBOOK_FOLDER}/${script.folderName}/${script.fileName}`, script.script.toString());
            }
        }
    }
    for (const page of snapshot.pages) {
        for (const script of page.scripts) {
            diskFiles.set(`${sessionId}/${STORAGE_NOTEBOOK_FOLDER}/${page.name}/${script.name}`, script.sql);
        }
    }
    let divergenceFound = false;
    for (const path of new Set([...diskFiles.keys(), ...memoryFiles.keys()])) {
        const disk = diskFiles.get(path) ?? null;
        const memory = memoryFiles.get(path) ?? null;
        if (disk === memory) {
            continue;
        }
        divergenceFound = true;
        if (writer.getCompletedFileContent(path) !== disk) {
            return false;
        }
    }
    return divergenceFound;
}

/// Native-only synchronization boundary. It owns watcher setup, conflict prompting and storage
/// coordination, then delegates notebook reconciliation to the notebook domain.
export const NativeSessionSync: React.FC = () => {
    const logger = useLogger();
    const [reader, writer] = useStorage();
    const [connectionRegistry, setConnectionRegistry] = useConnectionRegistry();
    const [notebookRegistry, setNotebookRegistry] = useNotebookRegistry();
    const connectionRegistryRef = React.useRef(connectionRegistry);
    const notebookRegistryRef = React.useRef(notebookRegistry);
    connectionRegistryRef.current = connectionRegistry;
    notebookRegistryRef.current = notebookRegistry;
    const queuedRef = React.useRef(new Set<string>());
    const processingRef = React.useRef(false);
    const serviceRef = React.useRef<NativeSessionSyncService | null>(null);

    const reloadSession = React.useEffectEvent(async (sessionId: string) => {
        writer.pauseSession(sessionId);
        try {
            // A write that started before the watcher event must finish before the stable disk read.
            await writer.settle();
            const [schema, functions, pages, draft] = await Promise.all([
                reader.backend.loadSessionSchema(sessionId),
                reader.backend.loadSessionFunctions(sessionId),
                reader.backend.loadNotebookPages(sessionId),
                reader.backend.loadNotebookScriptDraft(sessionId),
            ]);
            const snapshot: NotebookStorageSnapshot = { pages, draft };
            const connection = connectionRegistryRef.current.connectionMap.get(sessionId);
            const currentNotebook = notebookRegistryRef.current.notebookMap.get(sessionId);
            const notebookUnchanged = currentNotebook != null && notebookMatchesStorageSnapshot(currentNotebook, snapshot);
            const catalogUnchanged = connection != null && connectionCatalogMatchesStorage(connection, schema, functions);
            if (notebookUnchanged && catalogUnchanged) {
                return;
            }

            // A delayed watcher event for our own completed write can arrive after a newer local edit
            // is already pending. The completed snapshot identifies that event without suppressing a
            // genuinely different external version.
            if (snapshotMatchesCompletedWrite(sessionId, snapshot, schema, functions, connection, currentNotebook, writer)) {
                return;
            }

            const isReloadedKey = (key: string) => isReloadedStorageKey(sessionId, key);
            const promptGeneration = writer.getSessionWriteGeneration(sessionId, isReloadedKey);
            const pendingKeys = writer.getPendingKeysForSession(sessionId, isReloadedKey);
            let decision = await confirmExternalReload(pendingKeys.length > 0);
            if (!decision.reload) {
                return;
            }
            // The editor remains interactive while the native dialog is open. If a local edit was
            // queued during a clean-file prompt, require the explicit destructive confirmation too.
            const pendingAfterPrompt = writer.getPendingKeysForSession(sessionId, isReloadedKey);
            if (pendingKeys.length === 0 && pendingAfterPrompt.length > 0) {
                decision = await confirmExternalReload(true);
                if (!decision.reload) {
                    return;
                }
            }
            if (writer.getSessionWriteGeneration(sessionId, isReloadedKey) !== promptGeneration) {
                // The generation changed while the dialog was open. Requeue and take a fresh disk
                // snapshot instead of applying a stale destructive decision.
                queuedRef.current.add(sessionId);
                return;
            }
            if (decision.discardPendingWrites) {
                writer.cancelPendingWritesForSession(sessionId, isReloadedKey);
            }
            const latestConnection = connectionRegistryRef.current.connectionMap.get(sessionId);
            const latestNotebook = notebookRegistryRef.current.notebookMap.get(sessionId);
            const catalogChanged = latestConnection != null
                ? replaceConnectionCatalogFromStorage(latestConnection, schema, functions)
                : false;
            if (catalogChanged) {
                setConnectionRegistry(registry => ({ ...registry }));
            }
            if (latestNotebook) {
                const reloadedNotebook = replaceNotebookFromStorage(latestNotebook, snapshot, logger, catalogChanged);
                setNotebookRegistry(registry => {
                    // Do not overwrite a notebook that was replaced by another lifecycle operation
                    // while the native confirmation dialog was open.
                    if (registry.notebookMap.get(sessionId) !== latestNotebook) {
                        return registry;
                    }
                    registry.notebookMap.set(sessionId, reloadedNotebook);
                    return { ...registry };
                });
            }
            logger.info('reloaded externally changed session', { sessionId }, LOG_CTX);
        } catch (error) {
            logger.error('failed to reload externally changed session', {
                sessionId,
                error: stringifyError(error),
            }, LOG_CTX);
        } finally {
            writer.resumeSession(sessionId);
        }
    });

    const enqueueReload = React.useEffectEvent((sessionId: string) => {
        queuedRef.current.add(sessionId);
        if (processingRef.current) {
            return;
        }
        processingRef.current = true;
        void (async () => {
            while (queuedRef.current.size > 0) {
                const next = queuedRef.current.values().next().value as string;
                queuedRef.current.delete(next);
                await reloadSession(next);
            }
            processingRef.current = false;
        })();
    });

    React.useEffect(() => {
        if (!isNativePlatform()) {
            return;
        }
        const service = new NativeSessionSyncService(logger, enqueueReload);
        serviceRef.current = service;
        return () => {
            service.close();
            if (serviceRef.current === service) {
                serviceRef.current = null;
            }
        };
    }, [logger, enqueueReload]);

    React.useEffect(() => {
        if (!isNativePlatform() || !serviceRef.current) {
            return;
        }
        const sessions = [...connectionRegistry.connectionMap.keys()]
            .map(sessionId => nativeSessionWatchForLocation(sessionId, reader.getSessionLocation(sessionId)))
            .filter((watch): watch is NonNullable<typeof watch> => watch != null);
        void serviceRef.current.reconcile(sessions);
    }, [connectionRegistry, reader]);

    return null;
};
