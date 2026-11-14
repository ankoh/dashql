import * as React from 'react';

import { connectionEntryFromState, registerConnection, useConnectionRegistry, type ConnectionRegistry } from '../../connections/connection_registry.js';
import { replaceWorkbookScriptsInRegistry, useWorkbookScriptsDispatch, useWorkbookScriptsRegistry } from '../scripts/workbook_scripts_registry.js';
import { workbookScriptsMatchStorageSnapshot, replaceWorkbookScriptsFromStorage, scriptConnectionOf, SET_WORKBOOK_ATTACHMENTS } from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts';
import { markWorkbookAttachmentsChanged } from '@ankoh/dashql-sdk/workbook/attachments/attachment_mounts';
import { isDesktopHost } from '@ankoh/dashql-sdk/platform/native_globals';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { stringifyError } from '@ankoh/dashql-sdk/platform/logger/logger';
import { useStorage } from '../../storage/storage_provider.js';
import { useAppFlavor } from '../../config/flavor_provider.js';
import type { WorkbookScriptsStorageSnapshot, WorkbookScripts } from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts';
import type { NamedFileStamp } from '../../storage/native_storage_backend.js';
import { connectionStateFromStorage, destroyUnregisteredConnection } from '../../connections/connection_restore.js';
import { resolveWorkbookScripts, workbookScriptsResolutionChanged } from './workbook_script_connections.js';
import type { ConnectionState } from '@ankoh/dashql-sdk/connections/connection_state';
import { findEmbeddedConnection } from '../../connections/embedded_connection.js';
import { isLocalHyperWasmParams } from '@ankoh/dashql-sdk/storage/workbook_validation';
import {
    DEBOUNCE_DURATION_SCRIPT_WRITE,
    DEBOUNCE_DURATION_WORKBOOK_WRITE,
    groupConnectionEntryWrites,
    groupScriptWrites,
    groupWorkbookAttachmentListWrites,
    groupWorkbookScriptListWrites,
    REFRESH_WORKBOOK_ATTACHMENTS,
    WRITE_CONNECTION_ENTRY,
    WRITE_SCRIPT,
    WRITE_WORKBOOK_SCRIPTS,
    type StorageWriter,
} from '@ankoh/dashql-sdk/storage/storage_writer';
import {
    STORAGE_SCRIPTS_FOLDER,
    type ScriptData,
    type WorkbookData,
} from '@ankoh/dashql-sdk/storage/storage_backend';

const LOG_CTX = 'native_workbook_sync';

/// The scripts of a workbook as its folder holds them, resolved like the restoration of the app does.
/// A connection that the app doesn't know is created from the copy of the workbook file, e.g. after
/// pulling a script on a new connection. It is registered when the reload is applied and must be
/// destroyed otherwise.
export interface StoredWorkbookScripts {
    /// The scripts as the workbook scripts take them
    snapshot: WorkbookScriptsStorageSnapshot;
    /// The workbook file that describes the resolved scripts
    workbook: WorkbookData;
    /// The connections that were created from copies of the workbook file
    created: ConnectionState[];
}

export function readStoredWorkbookScripts(
    registry: ConnectionRegistry,
    workbook: WorkbookData,
    scripts: ScriptData[],
): StoredWorkbookScripts | null {
    // Scripts on unknown connections run on the embedded database
    const embedded = findEmbeddedConnection(registry.connections.values());
    if (embedded == null) return null;
    const created: ConnectionState[] = [];
    const resolved = resolveWorkbookScripts(workbook, scripts.map(script => script.name), () => embedded, (connectionId, copy) => {
        const known = registry.connections.get(connectionId)
            ?? (copy != null && isLocalHyperWasmParams(copy.params) ? embedded : null);
        if (known != null || copy == null) return known ?? null;
        const connection = connectionStateFromStorage(embedded.instance, connectionId, copy);
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
        workbook: resolved.workbook,
        created,
    };
}

interface WorkbookReloadDecision {
    reload: boolean;
    discardPendingWrites: boolean;
}

async function confirmExternalReload(appName: string, hasPendingWrites: boolean): Promise<WorkbookReloadDecision> {
    const message = hasPendingWrites
        ? `This workbook changed on disk while ${appName} still has local changes waiting to be saved. Reload from disk and discard those pending local changes?`
        : `This workbook changed outside ${appName}. Reload it from disk?`;
    const reload = await globalThis.dashqlElectron!.confirm({message, title: 'Workbook changed on disk'});
    return { reload, discardPendingWrites: reload && hasPendingWrites };
}

function isReloadedStorageKey(workbookId: string, key: string): boolean {
    return key === groupWorkbookScriptListWrites(workbookId)
        || key === `${workbookId}/${STORAGE_SCRIPTS_FOLDER}`
        || key.startsWith(`${workbookId}/${STORAGE_SCRIPTS_FOLDER}/`);
}

/// The attachments of a workbook as a comparable value
function attachmentListing(files: NamedFileStamp[]): string {
    return JSON.stringify(files.map(file => [file.name, file.size, file.mtimeMs]).sort());
}

/// Keep the scripts of the app over the disk: the scripts that differ on disk are written again.
/// Files that only exist on disk are left alone.
function writeKeptWorkbookScripts(writer: StorageWriter, workbookScripts: WorkbookScripts, disk: ScriptData[]): void {
    const workbookId = workbookScripts.workbookId;
    const sqlByName = new Map(disk.map(script => [script.name, script.sql]));
    for (const ref of Object.values(workbookScripts.scriptRefs)) {
        const sql = workbookScripts.scripts[ref.scriptId]?.scriptSession.getText();
        if (sql == null || sqlByName.get(ref.fileName) === sql) continue;
        void writer.write(
            groupScriptWrites(workbookId, ref.fileName),
            { type: WRITE_SCRIPT, value: [workbookId, ref.fileName, sql] },
            DEBOUNCE_DURATION_SCRIPT_WRITE,
        );
    }
}

/// Native-only synchronization boundary. Workbook folders are not watched, they are checked when the
/// window gets the focus and when the storage writer holds a write because a script changed outside
/// the app. A check compares the stamps of the files (size and modification time) with what the
/// native backend wrote or acknowledged, reads the files only when a stamp differs, prompts when the
/// content differs from the app and delegates the reload to the workbook domain.
export const NativeWorkbookSync: React.FC = () => {
    const logger = useLogger();
    const appName = useAppFlavor().displayName;
    const [reader, writer] = useStorage();
    const [connectionRegistry, setConnectionRegistry] = useConnectionRegistry();
    const [workbookScriptsRegistry, setWorkbookScriptsRegistry] = useWorkbookScriptsRegistry();
    const dispatchWorkbookScripts = useWorkbookScriptsDispatch();
    const connectionRegistryRef = React.useRef(connectionRegistry);
    const workbookScriptsRegistryRef = React.useRef(workbookScriptsRegistry);
    connectionRegistryRef.current = connectionRegistry;
    workbookScriptsRegistryRef.current = workbookScriptsRegistry;
    const queuedRef = React.useRef(new Set<string>());
    const processingRef = React.useRef(false);
    /// The workbooks that were checked once, the first check acknowledges the disk
    const checkedRef = React.useRef(new Set<string>());
    /// The workbooks whose first check was requested, a failed one is retried on the next focus
    const firstCheckRequestedRef = React.useRef(new Set<string>());
    /// The attachment listing of a workbook at its last check
    const attachmentsRef = React.useRef(new Map<string, string>());

    const checkWorkbook = React.useEffectEvent(async (workbookId: string) => {
        const folder = reader.workbookFolders?.nativeWorkbookFolder(workbookId) ?? null;
        if (folder == null) {
            return;
        }
        writer.pauseWorkbook(workbookId);
        let stored: StoredWorkbookScripts | null = null;
        let registered = false;
        try {
            // A write that started before the check must finish before the stable disk read
            await writer.settle();
            const stamps = await folder.stampFolder();
            // Loading the workbook file mirrors the attachments into OPFS for embedded HyperDB-WASM.
            // The restoration loaded it already, later checks reload it when the attachments changed.
            let workbookFile: WorkbookData | null = null;
            const attachments = attachmentListing(stamps.attachments);
            const previousAttachments = attachmentsRef.current.get(workbookId);
            if (previousAttachments !== undefined && previousAttachments !== attachments) {
                workbookFile = await reader.backend.loadWorkbook(workbookId);
                // The scripts read the mirrored attachments, the mount looks them up again
                markWorkbookAttachmentsChanged(workbookId);
                void reader.backend.listDataFiles(workbookId)
                    .then(files => dispatchWorkbookScripts(workbookId, { type: SET_WORKBOOK_ATTACHMENTS, value: files }))
                    .catch(error => logger.warn('Listing the attachments failed', { workbookId, error: stringifyError(error) }, LOG_CTX));
                // The workbook file lists the attachments, the write runs once the workbook resumes
                void writer.write(groupWorkbookAttachmentListWrites(workbookId), { type: REFRESH_WORKBOOK_ATTACHMENTS, value: workbookId });
            }
            // A change is remembered once it was handled, a failed read is retried by the next check
            attachmentsRef.current.set(workbookId, attachments);
            if (!checkedRef.current.has(workbookId)) {
                // The restoration read the scripts moments ago, they are what the app shows
                checkedRef.current.add(workbookId);
                folder.acknowledgeScripts(stamps.scripts);
                return;
            }
            if (folder.findExternalScriptChanges(stamps.scripts).length === 0) {
                return;
            }
            // A stamp differs, read the scripts. A file that changes after its stamp was taken has a
            // newer stamp than the acknowledged one and is checked again.
            const scripts = await reader.backend.loadScripts(workbookId);
            workbookFile ??= await reader.backend.loadWorkbook(workbookId);
            stored = readStoredWorkbookScripts(connectionRegistryRef.current, workbookFile, scripts);
            if (stored == null) {
                return;
            }
            const snapshot = stored.snapshot;
            const currentWorkbookScripts = workbookScriptsRegistryRef.current.workbookScriptsMap.get(workbookId);
            if (currentWorkbookScripts == null) {
                return;
            }
            if (workbookScriptsMatchStorageSnapshot(currentWorkbookScripts, snapshot)) {
                // Only the stamps changed, or the disk changed to what the app shows
                folder.acknowledgeScripts(stamps.scripts);
                return;
            }

            const isReloadedKey = (key: string) => isReloadedStorageKey(workbookId, key);
            const promptGeneration = writer.getWorkbookWriteGeneration(workbookId, isReloadedKey);
            const pendingKeys = writer.getPendingKeysForWorkbook(workbookId, isReloadedKey);
            let decision = await confirmExternalReload(appName, pendingKeys.length > 0);
            // The editor remains interactive while the native dialog is open. If a local edit was
            // queued during a clean-file prompt, require the explicit destructive confirmation too.
            const pendingAfterPrompt = writer.getPendingKeysForWorkbook(workbookId, isReloadedKey);
            if (decision.reload && pendingKeys.length === 0 && pendingAfterPrompt.length > 0) {
                decision = await confirmExternalReload(appName, true);
            }
            if (!decision.reload) {
                // The app version wins, it replaces the external version on disk
                folder.acknowledgeScripts(stamps.scripts);
                const latest = workbookScriptsRegistryRef.current.workbookScriptsMap.get(workbookId);
                if (latest) writeKeptWorkbookScripts(writer, latest, scripts);
                return;
            }
            if (writer.getWorkbookWriteGeneration(workbookId, isReloadedKey) !== promptGeneration) {
                // The generation changed while the dialog was open. Requeue and take a fresh disk
                // snapshot instead of applying a stale destructive decision.
                queuedRef.current.add(workbookId);
                return;
            }
            if (decision.discardPendingWrites) {
                writer.cancelPendingWritesForWorkbook(workbookId, isReloadedKey);
            }
            folder.acknowledgeScripts(stamps.scripts);
            // Connections that the workbook file brought along join the app before the scripts use them
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
            if (workbookScriptsResolutionChanged(workbookFile, stored.workbook)) {
                const { scripts, connections } = stored.workbook;
                void writer.write(
                    groupWorkbookScriptListWrites(workbookId),
                    { type: WRITE_WORKBOOK_SCRIPTS, value: [workbookId, { scripts, connections }] },
                    DEBOUNCE_DURATION_WORKBOOK_WRITE,
                );
            }
            const latestWorkbookScripts = workbookScriptsRegistryRef.current.workbookScriptsMap.get(workbookId);
            if (latestWorkbookScripts) {
                const reloadedWorkbookScripts = replaceWorkbookScriptsFromStorage(latestWorkbookScripts, snapshot, logger);
                setWorkbookScriptsRegistry(registry => {
                    // Do not overwrite a workbook that was replaced by another lifecycle operation
                    // while the native confirmation dialog was open.
                    if (registry.workbookScriptsMap.get(workbookId) !== latestWorkbookScripts) {
                        return registry;
                    }
                    return replaceWorkbookScriptsInRegistry(registry, latestWorkbookScripts, reloadedWorkbookScripts);
                });
            }
            logger.info('reloaded externally changed workbook', { workbookId }, LOG_CTX);
        } catch (error) {
            logger.warn('failed to check the workbook folder', {
                workbookId,
                error: stringifyError(error),
            }, LOG_CTX);
        } finally {
            if (!registered) {
                for (const connection of stored?.created ?? []) destroyUnregisteredConnection(connection);
            }
            writer.resumeWorkbook(workbookId);
        }
    });

    const enqueueCheck = React.useEffectEvent((workbookId: string) => {
        queuedRef.current.add(workbookId);
        if (processingRef.current) {
            return;
        }
        processingRef.current = true;
        void (async () => {
            while (queuedRef.current.size > 0) {
                const next = queuedRef.current.values().next().value as string;
                queuedRef.current.delete(next);
                await checkWorkbook(next);
            }
            processingRef.current = false;
        })();
    });

    const enqueueAllChecks = React.useEffectEvent(() => {
        for (const workbookId of workbookScriptsRegistryRef.current.workbookScriptsMap.keys()) {
            enqueueCheck(workbookId);
        }
    });

    // Effect events must not be dependencies, they change with every render
    React.useEffect(() => {
        if (!isDesktopHost()) {
            return;
        }
        const onFocus = () => enqueueAllChecks();
        window.addEventListener('focus', onFocus);
        const unsubscribe = writer.subscribeExternalChanges(workbookId => enqueueCheck(workbookId));
        return () => {
            window.removeEventListener('focus', onFocus);
            unsubscribe();
        };
    }, [writer]);

    // The first check of a workbook acknowledges its scripts, the writer checks the disk from then on
    React.useEffect(() => {
        if (!isDesktopHost()) {
            return;
        }
        for (const workbookId of workbookScriptsRegistry.workbookScriptsMap.keys()) {
            if (!firstCheckRequestedRef.current.has(workbookId)) {
                firstCheckRequestedRef.current.add(workbookId);
                enqueueCheck(workbookId);
            }
        }
    }, [workbookScriptsRegistry]);

    return null;
};
