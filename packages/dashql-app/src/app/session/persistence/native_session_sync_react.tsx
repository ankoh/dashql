import * as React from 'react';

import { connectionEntryFromState, registerConnection, resolveDefaultConnection, useConnectionReferences, useConnectionRegistry, type ConnectionReferences, type ConnectionRegistry } from '../../connections/connection_registry.js';
import { reindexSessionScriptConnections, useSessionScriptsRegistry } from '../scripts/session_scripts_registry.js';
import { sessionScriptsMatchStorageSnapshot, replaceSessionScriptsFromStorage, scriptConnectionOf } from '../scripts/session_scripts.js';
import { isDesktopHost } from '../../../platform/native_globals.js';
import { useLogger } from '../../../platform/logger/logger_provider.js';
import { stringifyError } from '../../../platform/logger/logger.js';
import { useStorage } from '../../storage/storage_provider.js';
import { useAppFlavor } from '../../flavor/flavor_provider.js';
import type { SessionScriptsStorageSnapshot, SessionScripts } from '../scripts/session_scripts.js';
import type { NamedFileStamp } from '../../storage/native_storage_backend.js';
import { connectionStateFromStorage, destroyUnregisteredConnection } from '../../connections/connection_restore.js';
import { resolveSessionScripts, sessionScriptsResolutionChanged } from './session_script_connections.js';
import type { ConnectionState } from '../../connections/connection_state.js';
import {
    DEBOUNCE_DURATION_SCRIPT_WRITE,
    DEBOUNCE_DURATION_SESSION_WRITE,
    groupConnectionEntryWrites,
    groupScriptWrites,
    groupSessionAttachmentListWrites,
    groupSessionScriptListWrites,
    REFRESH_SESSION_ATTACHMENTS,
    WRITE_CONNECTION_ENTRY,
    WRITE_SCRIPT,
    WRITE_SESSION_SCRIPTS,
    type StorageWriter,
} from '../../storage/storage_writer.js';
import {
    STORAGE_SCRIPTS_FOLDER,
    type ScriptData,
    type SessionData,
} from '../../storage/storage_backend.js';

const LOG_CTX = 'native_session_sync';

/// The scripts of a session as its folder holds them, resolved like the restoration of the app does.
/// A connection that the app doesn't know is created from the copy of the session file, e.g. after
/// pulling a script on a new connection. It is registered when the reload is applied and must be
/// destroyed otherwise.
export interface StoredSessionScripts {
    /// The scripts as the session scripts take them
    snapshot: SessionScriptsStorageSnapshot;
    /// The session file that describes the resolved scripts
    session: SessionData;
    /// The connections that were created from copies of the session file
    created: ConnectionState[];
}

export function readStoredSessionScripts(
    registry: ConnectionRegistry,
    references: ConnectionReferences,
    sessionId: string,
    session: SessionData,
    scripts: ScriptData[],
): StoredSessionScripts | null {
    const main = resolveDefaultConnection(registry, references, sessionId);
    if (main == null) return null;
    const created: ConnectionState[] = [];
    const resolved = resolveSessionScripts(session, scripts.map(script => script.name), main, (connectionId, copy) => {
        const known = registry.connections.get(connectionId);
        if (known != null || copy == null) return known ?? null;
        const connection = connectionStateFromStorage(main.instance, connectionId, copy);
        created.push(connection);
        return connection;
    });
    const sqlByName = new Map(scripts.map(script => [script.name, script.sql]));
    return {
        snapshot: {
            scripts: resolved.scripts.map(entry => ({
                name: entry.name,
                sql: sqlByName.get(entry.name) ?? '',
                connection: scriptConnectionOf(entry.connection),
                ...(entry.unresolvedConnectionId == null ? {} : { unresolvedConnectionId: entry.unresolvedConnectionId }),
            })),
        },
        session: resolved.session,
        created,
    };
}

interface SessionReloadDecision {
    reload: boolean;
    discardPendingWrites: boolean;
}

async function confirmExternalReload(appName: string, hasPendingWrites: boolean): Promise<SessionReloadDecision> {
    const message = hasPendingWrites
        ? `This session changed on disk while ${appName} still has local changes waiting to be saved. Reload from disk and discard those pending local changes?`
        : `This session changed outside ${appName}. Reload it from disk?`;
    const reload = await globalThis.dashqlElectron!.confirm({message, title: 'Session changed on disk'});
    return { reload, discardPendingWrites: reload && hasPendingWrites };
}

function isReloadedStorageKey(sessionId: string, key: string): boolean {
    return key === groupSessionScriptListWrites(sessionId)
        || key === `${sessionId}/${STORAGE_SCRIPTS_FOLDER}`
        || key.startsWith(`${sessionId}/${STORAGE_SCRIPTS_FOLDER}/`);
}

/// The attachments of a session as a comparable value
function attachmentListing(files: NamedFileStamp[]): string {
    return JSON.stringify(files.map(file => [file.name, file.size, file.mtimeMs]).sort());
}

/// Keep the scripts of the app over the disk: the scripts that differ on disk are written again.
/// Files that only exist on disk are left alone.
function writeKeptSessionScripts(writer: StorageWriter, sessionScripts: SessionScripts, disk: ScriptData[]): void {
    const sessionId = sessionScripts.sessionId;
    const sqlByName = new Map(disk.map(script => [script.name, script.sql]));
    for (const ref of Object.values(sessionScripts.scriptRefs)) {
        const sql = sessionScripts.scripts[ref.scriptId]?.scriptSession.getText();
        if (sql == null || sqlByName.get(ref.fileName) === sql) continue;
        void writer.write(
            groupScriptWrites(sessionId, ref.fileName),
            { type: WRITE_SCRIPT, value: [sessionId, ref.fileName, sql] },
            DEBOUNCE_DURATION_SCRIPT_WRITE,
        );
    }
}

/// Native-only synchronization boundary. Session folders are not watched, they are checked when the
/// window gets the focus and when the storage writer holds a write because a script changed outside
/// the app. A check compares the stamps of the files (size and modification time) with what the
/// native backend wrote or acknowledged, reads the files only when a stamp differs, prompts when the
/// content differs from the app and delegates the reload to the session domain.
export const NativeSessionSync: React.FC = () => {
    const logger = useLogger();
    const appName = useAppFlavor().displayName;
    const [reader, writer] = useStorage();
    const [connectionRegistry, setConnectionRegistry] = useConnectionRegistry();
    const [sessionScriptsRegistry, setSessionScriptsRegistry] = useSessionScriptsRegistry();
    const references = useConnectionReferences();
    const connectionRegistryRef = React.useRef(connectionRegistry);
    const sessionScriptsRegistryRef = React.useRef(sessionScriptsRegistry);
    connectionRegistryRef.current = connectionRegistry;
    sessionScriptsRegistryRef.current = sessionScriptsRegistry;
    const queuedRef = React.useRef(new Set<string>());
    const processingRef = React.useRef(false);
    /// The sessions that were checked once, the first check acknowledges the disk
    const checkedRef = React.useRef(new Set<string>());
    /// The sessions whose first check was requested, a failed one is retried on the next focus
    const firstCheckRequestedRef = React.useRef(new Set<string>());
    /// The attachment listing of a session at its last check
    const attachmentsRef = React.useRef(new Map<string, string>());

    const checkSession = React.useEffectEvent(async (sessionId: string) => {
        const folder = reader.sessionFolders?.nativeSessionFolder(sessionId) ?? null;
        if (folder == null) {
            return;
        }
        writer.pauseSession(sessionId);
        let stored: StoredSessionScripts | null = null;
        let registered = false;
        try {
            // A write that started before the check must finish before the stable disk read
            await writer.settle();
            const stamps = await folder.stampFolder();
            // Loading the session file mirrors the attachments into OPFS for embedded HyperDB-WASM.
            // The restoration loaded it already, later checks reload it when the attachments changed.
            let sessionFile: SessionData | null = null;
            const attachments = attachmentListing(stamps.attachments);
            const previousAttachments = attachmentsRef.current.get(sessionId);
            attachmentsRef.current.set(sessionId, attachments);
            if (previousAttachments !== undefined && previousAttachments !== attachments) {
                sessionFile = await reader.backend.loadSession(sessionId);
                // The session file lists the attachments, the write runs once the session resumes
                void writer.write(groupSessionAttachmentListWrites(sessionId), { type: REFRESH_SESSION_ATTACHMENTS, value: sessionId });
            }
            if (!checkedRef.current.has(sessionId)) {
                // The restoration read the scripts moments ago, they are what the app shows
                checkedRef.current.add(sessionId);
                folder.acknowledgeScripts(stamps.scripts);
                return;
            }
            if (folder.findExternalScriptChanges(stamps.scripts).length === 0) {
                return;
            }
            // A stamp differs, read the scripts. A file that changes after its stamp was taken has a
            // newer stamp than the acknowledged one and is checked again.
            const scripts = await reader.backend.loadScripts(sessionId);
            sessionFile ??= await reader.backend.loadSession(sessionId);
            stored = readStoredSessionScripts(connectionRegistryRef.current, references, sessionId, sessionFile, scripts);
            if (stored == null) {
                return;
            }
            const snapshot = stored.snapshot;
            const currentSessionScripts = sessionScriptsRegistryRef.current.sessionScriptsMap.get(sessionId);
            if (currentSessionScripts == null) {
                return;
            }
            if (sessionScriptsMatchStorageSnapshot(currentSessionScripts, snapshot)) {
                // Only the stamps changed, or the disk changed to what the app shows
                folder.acknowledgeScripts(stamps.scripts);
                return;
            }

            const isReloadedKey = (key: string) => isReloadedStorageKey(sessionId, key);
            const promptGeneration = writer.getSessionWriteGeneration(sessionId, isReloadedKey);
            const pendingKeys = writer.getPendingKeysForSession(sessionId, isReloadedKey);
            let decision = await confirmExternalReload(appName, pendingKeys.length > 0);
            // The editor remains interactive while the native dialog is open. If a local edit was
            // queued during a clean-file prompt, require the explicit destructive confirmation too.
            const pendingAfterPrompt = writer.getPendingKeysForSession(sessionId, isReloadedKey);
            if (decision.reload && pendingKeys.length === 0 && pendingAfterPrompt.length > 0) {
                decision = await confirmExternalReload(appName, true);
            }
            if (!decision.reload) {
                // The app version wins, it replaces the external version on disk
                folder.acknowledgeScripts(stamps.scripts);
                const latest = sessionScriptsRegistryRef.current.sessionScriptsMap.get(sessionId);
                if (latest) writeKeptSessionScripts(writer, latest, scripts);
                return;
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
            folder.acknowledgeScripts(stamps.scripts);
            // Connections that the session file brought along join the app before the scripts use them
            const created = stored.created;
            if (created.length > 0) {
                setConnectionRegistry(registry => {
                    for (const connection of created) registerConnection(registry, connection);
                    return { ...registry };
                });
                for (const connection of created) {
                    void writer.write(
                        groupConnectionEntryWrites(connection.connectionId),
                        { type: WRITE_CONNECTION_ENTRY, value: { ...connectionEntryFromState(connection), createdAt: new Date().toISOString() } },
                    );
                }
            }
            registered = true;
            // Files that were added or removed outside the app change the script list
            if (sessionScriptsResolutionChanged(sessionFile, stored.session)) {
                const { scripts, connections } = stored.session;
                void writer.write(
                    groupSessionScriptListWrites(sessionId),
                    { type: WRITE_SESSION_SCRIPTS, value: [sessionId, { scripts, connections }] },
                    DEBOUNCE_DURATION_SESSION_WRITE,
                );
            }
            const latestSessionScripts = sessionScriptsRegistryRef.current.sessionScriptsMap.get(sessionId);
            if (latestSessionScripts) {
                const reloadedSessionScripts = replaceSessionScriptsFromStorage(latestSessionScripts, snapshot, logger);
                setSessionScriptsRegistry(registry => {
                    // Do not overwrite a session that was replaced by another lifecycle operation
                    // while the native confirmation dialog was open.
                    if (registry.sessionScriptsMap.get(sessionId) !== latestSessionScripts) {
                        return registry;
                    }
                    registry.sessionScriptsMap.set(sessionId, reloadedSessionScripts);
                    reindexSessionScriptConnections(registry, latestSessionScripts, reloadedSessionScripts);
                    return { ...registry };
                });
            }
            logger.info('reloaded externally changed session', { sessionId }, LOG_CTX);
        } catch (error) {
            logger.warn('failed to check the session folder', {
                sessionId,
                error: stringifyError(error),
            }, LOG_CTX);
        } finally {
            if (!registered) {
                for (const connection of stored?.created ?? []) destroyUnregisteredConnection(connection);
            }
            writer.resumeSession(sessionId);
        }
    });

    const enqueueCheck = React.useEffectEvent((sessionId: string) => {
        queuedRef.current.add(sessionId);
        if (processingRef.current) {
            return;
        }
        processingRef.current = true;
        void (async () => {
            while (queuedRef.current.size > 0) {
                const next = queuedRef.current.values().next().value as string;
                queuedRef.current.delete(next);
                await checkSession(next);
            }
            processingRef.current = false;
        })();
    });

    const enqueueAllChecks = React.useEffectEvent(() => {
        for (const sessionId of sessionScriptsRegistryRef.current.sessionScriptsMap.keys()) {
            enqueueCheck(sessionId);
        }
    });

    // Effect events must not be dependencies, they change with every render
    React.useEffect(() => {
        if (!isDesktopHost()) {
            return;
        }
        const onFocus = () => enqueueAllChecks();
        window.addEventListener('focus', onFocus);
        const unsubscribe = writer.subscribeExternalChanges(sessionId => enqueueCheck(sessionId));
        return () => {
            window.removeEventListener('focus', onFocus);
            unsubscribe();
        };
    }, [writer]);

    // The first check of a session acknowledges its scripts, the writer checks the disk from then on
    React.useEffect(() => {
        if (!isDesktopHost()) {
            return;
        }
        for (const sessionId of sessionScriptsRegistry.sessionScriptsMap.keys()) {
            if (!firstCheckRequestedRef.current.has(sessionId)) {
                firstCheckRequestedRef.current.add(sessionId);
                enqueueCheck(sessionId);
            }
        }
    }, [sessionScriptsRegistry]);

    return null;
};
