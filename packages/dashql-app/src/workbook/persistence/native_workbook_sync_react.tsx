import * as React from 'react';
import type * as core from '@ankoh/dashql-core';

import { useConnectionRegistry, type ConnectionRegistry } from '../../connections/connection_registry.js';
import { useCoreRuntime, useView } from '../../runtime/runtime_hooks.js';
import type { CoreRuntime } from '@ankoh/dashql-runtime/core_runtime';
import { useWorkbookScriptsDispatch, useWorkbooks } from '../scripts/workbook_scripts_registry.js';
import { markWorkbookAttachmentsChanged } from '@ankoh/dashql-runtime/workbook/attachments/attachment_mounts';
import { isDesktopHost } from '../../platform/native_globals.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { stringifyError } from '@ankoh/dashql-runtime/platform/logger/logger';
import { useStorage } from '../../storage/storage_provider.js';
import { useAppFlavor } from '../../config/flavor_provider.js';
import type { NamedFileStamp } from '@ankoh/dashql-runtime/storage/native_storage_backend';
import { connectionFromStorage } from '@ankoh/dashql-runtime/connections/connection_restore';
import type { ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { findEmbeddedConnection } from '@ankoh/dashql-runtime/connections/embedded_connection';
import { isLocalHyperWasmParams } from '@ankoh/dashql-runtime/storage/workbook_validation';
import { workbookFormat } from '@ankoh/dashql-runtime/storage/workbook_format';
import {
    DEBOUNCE_DURATION_WORKBOOK_WRITE,
    groupScriptWrites,
    groupWorkbookAttachmentListWrites,
    type StorageWriter,
} from '@ankoh/dashql-runtime/storage/runtime_storage';
import {
    STORAGE_SCRIPTS_FOLDER,
    STORAGE_WORKBOOK_FILE,
    type ScriptData,
    type WorkbookConnection,
    type WorkbookData,
} from '@ankoh/dashql-runtime/storage/storage_backend';

const LOG_CTX = 'native_workbook_sync';

/// The scripts of a workbook as its folder holds them, resolved like the restore of the runtime does.
/// A connection that the app doesn't know is created from the copy of the workbook file, e.g. after
/// pulling a script on a new connection. The runtime holds it right away, it is deleted again unless the reload is
/// applied.
export interface StoredWorkbookScripts {
    /// The scripts in feed order on the connections of the runtime, as the action `replaceFromStorage` takes them
    scripts: core.StoredScriptView[];
    /// The workbook file that describes the resolved scripts
    workbook: WorkbookData;
    /// The connections that were created from copies of the workbook file
    created: ConnectionState[];
}

export function readStoredWorkbookScripts(
    runtime: CoreRuntime,
    registry: ConnectionRegistry,
    workbook: WorkbookData,
    scripts: ScriptData[],
): StoredWorkbookScripts | null {
    // Scripts on unknown connections run on the embedded database
    const embedded = findEmbeddedConnection(registry.connections.values());
    if (embedded == null) return null;
    const created: ConnectionState[] = [];
    // The format resolves the scripts, the connections cross as the JSON of their copies
    const json = (connection: ConnectionState) => JSON.stringify({ connectionId: connection.connectionId, params: connection.params });
    const resolved = workbookFormat().resolveWorkbookScripts(workbook, scripts.map(script => script.name.normalize('NFC')), {
        resolve: (connectionId, copyJson) => {
            const copy = copyJson == null ? null : JSON.parse(copyJson) as WorkbookConnection;
            const known = registry.connections.get(connectionId)
                ?? (copy != null && isLocalHyperWasmParams(copy.params) ? embedded : null);
            if (known != null || copy == null) return known == null ? null : json(known);
            const connection = runtime.createConnection(connectionFromStorage(connectionId, copy), connectionId);
            created.push(connection);
            return json(connection);
        },
        fallback: () => json(embedded),
        unresolved: () => { },
    });
    const sqlByName = new Map(scripts.map(script => [script.name.normalize('NFC'), script.sql]));
    return {
        scripts: resolved.scripts.map(entry => ({
            name: entry.name,
            sql: sqlByName.get(entry.name) ?? '',
            connectionId: entry.connectionId,
            ...(entry.unresolvedConnectionId == null ? {} : { unresolvedConnectionId: entry.unresolvedConnectionId }),
        })),
        workbook: resolved.workbook as unknown as WorkbookData,
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
    return key === `${workbookId}/${STORAGE_WORKBOOK_FILE}:scripts`
        || key === `${workbookId}/${STORAGE_SCRIPTS_FOLDER}`
        || key.startsWith(`${workbookId}/${STORAGE_SCRIPTS_FOLDER}/`);
}

/// The attachments of a workbook as a comparable value
function attachmentListing(files: NamedFileStamp[]): string {
    return JSON.stringify(files.map(file => [file.name, file.size, file.mtimeMs]).sort());
}

/// Keep the scripts of the app over the disk: the scripts that differ on disk are written again.
/// Files that only exist on disk are left alone.
function writeKeptWorkbookScripts(writer: StorageWriter, runtime: CoreRuntime, workbookId: string, disk: ScriptData[]): void {
    const sqlByName = new Map(disk.map(script => [script.name, script.sql]));
    for (const script of Object.values(runtime.workbookScripts(workbookId))) {
        const sql = script.scriptSession.getText();
        if (sqlByName.get(script.fileName) === sql) continue;
        void writer.write(
            groupScriptWrites(workbookId, script.fileName),
            { type: 'writeScript', workbookId, fileName: script.fileName, text: sql },
            DEBOUNCE_DURATION_WORKBOOK_WRITE,
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
    const [connectionRegistry] = useConnectionRegistry();
    const coreRuntime = useCoreRuntime();
    const workbooks = useWorkbooks();
    const dispatchWorkbookScripts = useWorkbookScriptsDispatch();
    const heldWorkbooks = useView('storage', 'root')?.heldWorkbooks;
    const connectionRegistryRef = React.useRef(connectionRegistry);
    const workbooksRef = React.useRef(workbooks);
    connectionRegistryRef.current = connectionRegistry;
    workbooksRef.current = workbooks;
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
                    .then(files => dispatchWorkbookScripts(workbookId, { kind: 'setWorkbookAttachments', value: { files } }))
                    .catch(error => logger.warn('Listing the attachments failed', { workbookId, error: stringifyError(error) }, LOG_CTX));
                // The workbook file lists the attachments, the write runs once the workbook resumes
                void writer.write(groupWorkbookAttachmentListWrites(workbookId), { type: 'refreshWorkbookAttachments', workbookId });
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
            stored = readStoredWorkbookScripts(coreRuntime, connectionRegistryRef.current, workbookFile, scripts);
            if (stored == null) {
                return;
            }
            if (coreRuntime.workbook(workbookId) == null) {
                return;
            }
            if (coreRuntime.matchesStoredScripts(workbookId, stored.scripts)) {
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
                writeKeptWorkbookScripts(writer, coreRuntime, workbookId, scripts);
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
            // The connections that the workbook file brought along joined the runtime, the scripts use them now. Their
            // entries join the app manifest, the runtime writes a connection only when it changes.
            registered = true;
            for (const connection of stored.created) {
                void coreRuntime.saveConnection(connection.connectionId).catch(error => {
                    logger.warn('failed to save a connection of the workbook file', {
                        connectionId: connection.connectionId,
                        error: stringifyError(error),
                    }, LOG_CTX);
                });
            }
            // Files that were added or removed outside the app change the script list
            if (workbookFormat().resolutionChanged(workbookFile, stored.workbook)) {
                const { scripts, connections } = stored.workbook;
                void writer.write(
                    `${workbookId}/${STORAGE_WORKBOOK_FILE}:scripts`,
                    { type: 'writeWorkbookScripts', workbookId, scripts, connections },
                    DEBOUNCE_DURATION_WORKBOOK_WRITE,
                );
            }
            // A workbook that another operation removed while the native confirmation dialog was open stays removed
            if (coreRuntime.workbook(workbookId) != null) {
                dispatchWorkbookScripts(workbookId, { kind: 'replaceFromStorage', value: { scripts: stored.scripts } });
            }
            logger.info('reloaded externally changed workbook', { workbookId }, LOG_CTX);
        } catch (error) {
            logger.warn('failed to check the workbook folder', {
                workbookId,
                error: stringifyError(error),
            }, LOG_CTX);
        } finally {
            if (!registered) {
                for (const connection of stored?.created ?? []) coreRuntime.dispatch({ connection: connection.connectionId }, { kind: 'deleteConnection' });
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
        for (const workbookId of workbooksRef.current.keys()) {
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
        return () => {
            window.removeEventListener('focus', onFocus);
        };
    }, []);

    // The writer holds the writes of a workbook whose script changed outside the app, a check answers it
    React.useEffect(() => {
        if (!isDesktopHost()) {
            return;
        }
        for (const workbookId of heldWorkbooks ?? []) enqueueCheck(workbookId);
    }, [heldWorkbooks]);

    // The first check of a workbook acknowledges its scripts, the writer checks the disk from then on
    React.useEffect(() => {
        if (!isDesktopHost()) {
            return;
        }
        for (const workbookId of workbooks.keys()) {
            if (!firstCheckRequestedRef.current.has(workbookId)) {
                firstCheckRequestedRef.current.add(workbookId);
                enqueueCheck(workbookId);
            }
        }
    }, [workbooks]);

    return null;
};
