import type { Logger } from '../../platform/logger/logger.js';
import { stringifyError } from '../../platform/logger/logger.js';
import { Store, UpdateQueue, type UpdateScheduler } from '../../store/store.js';
import {
    DEBOUNCE_DURATION_WORKBOOK_WRITE,
    groupWorkbookScriptListWrites,
    groupWorkbookManifestWrites,
    groupWorkbookWrites,
    REPLACE_WORKBOOK_SCRIPTS,
    WRITE_WORKBOOK_MANIFEST,
    WRITE_WORKBOOK_SCRIPTS,
    type StorageWriter,
} from '../../storage/storage_writer.js';
import { workbookConnectionFromState, type ConnectionReferences } from '../../connections/connection_registry_state.js';
import type { ConnectionState } from '../../connections/connection_state.js';
import { destroyWorkbookScripts, newScriptConnection, scriptConnectionOf, workbookConnectionIds, workbookScriptListWrite, type WorkbookScripts, type WorkbookScriptsAction } from './workbook_scripts.js';
import { createEmptyMetadata } from './script_types.js';
import {
    addWorkbookScriptsForConnection,
    applyConnectionWorkbookScriptsAction,
    copyWorkbookScriptsRegistry,
    dispatchWorkbookScriptsAction,
    removeWorkbookScriptsFromRegistry,
    workbookConnectionReferences,
    workbookReplacement,
    type WorkbookScriptsRegistry,
} from './workbook_scripts_registry_state.js';

const LOG_CTX = 'workbook_scripts_registry';

export interface WorkbookScriptsRegistryDependencies {
    logger: Logger;
    storageWriter: StorageWriter;
}

/// The empty registry of workbook scripts
export function emptyWorkbookScriptsRegistry(): WorkbookScriptsRegistry {
    return { workbookScriptsMap: new Map(), workbookScriptsByConnection: new Map(), invalidWorkbooks: new Map() };
}

/// Holds the scripts of the workbooks. Reducing them mutates Wasm objects and schedules storage writes, the store runs
/// every update once, and the actions of all callers are applied in order through one queue.
export class WorkbookScriptsRegistryService {
    readonly store: Store<WorkbookScriptsRegistry>;
    readonly queue: UpdateQueue<WorkbookScriptsRegistry>;
    /// The connections that the workbooks use, the connection layer reads them from here
    readonly references: ConnectionReferences;
    protected readonly deps: WorkbookScriptsRegistryDependencies;

    constructor(deps: WorkbookScriptsRegistryDependencies, scheduler: UpdateScheduler) {
        this.deps = deps;
        this.store = new Store(emptyWorkbookScriptsRegistry());
        this.queue = new UpdateQueue(this.store, scheduler);
        this.references = workbookConnectionReferences(this.store);
    }

    /// Apply an action to the scripts of a workbook
    dispatch = (workbookId: string, action: WorkbookScriptsAction): Promise<WorkbookScripts | null> =>
        dispatchWorkbookScriptsAction(this.queue, this.deps.storageWriter, this.deps.logger, workbookId, action);

    /// Apply an action to the scripts of every workbook on a connection, resolves once it was applied
    dispatchConnection = (connectionId: string, action: WorkbookScriptsAction): Promise<void> => new Promise<void>(resolve => {
        const { storageWriter, logger } = this.deps;
        this.queue.push(prev => {
            const reg = applyConnectionWorkbookScriptsAction(prev, connectionId, action, storageWriter, logger);
            resolve();
            return reg;
        });
    });

    /// Register the scripts of a new workbook and write them
    allocate = (state: WorkbookScripts): [string, WorkbookScripts] => {
        const workbookId = state.workbookId;
        const scripts: WorkbookScripts = { ...state };
        this.store.update(prev => {
            const connectorInfo = newScriptConnection(scripts, null)?.connectorInfo;
            if (scripts.workbookMetadata.originalFileName == "" && connectorInfo != null) {
                scripts.workbookMetadata.originalFileName = `${connectorInfo.names.fileShort}`;
            }
            const reg = copyWorkbookScriptsRegistry(prev);
            for (const connectionId of workbookConnectionIds(scripts)) {
                addWorkbookScriptsForConnection(reg, connectionId, workbookId);
            }
            reg.workbookScriptsMap.set(workbookId, scripts);
            return reg;
        });
        const storage = this.deps.storageWriter;
        storage.write(groupWorkbookWrites(workbookId), {
            type: REPLACE_WORKBOOK_SCRIPTS,
            value: workbookReplacement(scripts),
        }, DEBOUNCE_DURATION_WORKBOOK_WRITE);
        // Scheduled after the workbook file is written, the script list has a single writer
        storage.write(groupWorkbookScriptListWrites(workbookId), {
            type: WRITE_WORKBOOK_SCRIPTS,
            value: [workbookId, workbookScriptListWrite(scripts)],
        }, DEBOUNCE_DURATION_WORKBOOK_WRITE);
        return [workbookId, scripts];
    };

    /// Create a workbook without scripts on a connection and write its first manifest. A new workbook starts without
    /// scripts, the feed greets it with the landing prompt of the composer.
    create = (connection: ConnectionState, name: string, ephemeral: boolean): WorkbookScripts => {
        const workbookId = crypto.randomUUID();
        const [, scripts] = this.allocate({
            workbookMetadata: { ...createEmptyMetadata(), ...(ephemeral ? { ephemeral } : {}) },
            instance: connection.instance,
            workbookId,
            name,
            pendingConnection: scriptConnectionOf(connection),
            scripts: {},
            scriptRefs: {},
            scriptOrder: [],
        });
        void this.deps.storageWriter.write(
            groupWorkbookManifestWrites(workbookId),
            { type: WRITE_WORKBOOK_MANIFEST, value: [workbookId, [workbookConnectionFromState(connection)], { ephemeral }] },
        );
        return scripts;
    };

    /// Delete the scripts of a workbook and free their Wasm.
    ///
    /// Workbook scripts share the catalog of their connection and own every script they create. destroyWorkbookScripts()
    /// drops the scripts from the shared catalog and frees them, so it MUST run while that catalog is alive, i.e. before
    /// the connection is deleted (DELETE_CONNECTION destroys the catalog). The Wasm goes synchronously here, the removal
    /// from the registry is a pure update.
    delete = (workbookId: string): void => {
        // The store holds the latest registry, a rendered snapshot may miss the latest scripts of the workbook
        const scripts = this.store.current.workbookScriptsMap.get(workbookId);
        if (scripts) destroyWorkbookScripts(scripts);
        this.store.update(prev => removeWorkbookScriptsFromRegistry(prev, workbookId));
    };

    /// Delete the files of a workbook that was refused a load and drop it from the list
    deleteInvalid = async (workbookId: string): Promise<void> => {
        try {
            await this.deps.storageWriter.deleteWorkbook(workbookId);
        } catch (error) {
            this.deps.logger.error('Failed to delete invalid workbook', { workbookId, error: stringifyError(error) }, LOG_CTX);
        }
        this.store.update(reg => {
            if (!reg.invalidWorkbooks.has(workbookId)) return reg;
            const invalidWorkbooks = new Map(reg.invalidWorkbooks);
            invalidWorkbooks.delete(workbookId);
            return { ...reg, invalidWorkbooks };
        });
    };

    /// Stop applying queued updates
    dispose(): void {
        this.queue.dispose();
    }
}
