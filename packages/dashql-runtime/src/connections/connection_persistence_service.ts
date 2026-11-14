import {
    groupConnectionEntryWrites,
    groupWorkbookConnectionCopyWrites,
    PATCH_WORKBOOK_CONNECTION,
    WRITE_CONNECTION_ENTRY,
    type StorageWriteResult,
    type StorageWriter,
} from '../storage/storage_writer.js';
import { COMMIT_CONNECTION_PARAMS, type ConnectionState } from './connection_state.js';
import {
    connectionEntryFromState,
    workbookConnectionFromState,
    type ConnectionReferences,
    type ConnectionRegistry,
    type DynamicConnectionDispatch,
} from './connection_registry_state.js';
import { connectionParamsWithoutDraftRows, type ConnectionParams } from './connection_params.js';
import type { WorkbookConnection } from '../storage/storage_backend.js';
import { Store } from '../store/store.js';

/// The copy of a connection with saved params that the workbooks store
function workbookCopy(connection: ConnectionState, params: ConnectionParams): WorkbookConnection {
    return { ...workbookConnectionFromState(connection), params };
}

/// The outcome of writing a workbook's copy of the connection params
export interface WorkbookCopySaveResult {
    /// The workbook
    workbookId: string;
    /// The outcome of the write
    result: StorageWriteResult;
}

/// The outcome of saving a connection
export interface ConnectionSaveResult {
    /// The saved params
    params: ConnectionParams;
    /// The outcome of writing the app manifest, the connection is saved if it was written
    manifest: StorageWriteResult;
    /// The outcomes of writing the copies in the workbooks that reference the connection
    workbooks: WorkbookCopySaveResult[];
}

/// Did saving persist the connection everywhere?
export function connectionSaveSucceeded(result: ConnectionSaveResult): boolean {
    return result.manifest.status === 'written' && result.workbooks.every(n => n.result.status === 'written');
}

/// The workbooks whose copies were not written
export function failedWorkbookCopies(result: ConnectionSaveResult): WorkbookCopySaveResult[] {
    return result.workbooks.filter(n => n.result.status !== 'written');
}

/// The state of saving a connection
export interface ConnectionSaveState {
    /// Is the connection being saved?
    saving: boolean;
    /// The outcome of the last save, if any
    result: ConnectionSaveResult | null;
}

/// What saving connections needs
export interface ConnectionPersistenceDependencies {
    storageWriter: StorageWriter;
    /// The latest connection registry
    readConnections: () => Pick<ConnectionRegistry, 'connections'>;
    /// The workbooks that reference the connections
    references: ConnectionReferences;
    dispatchConnection: DynamicConnectionDispatch;
}

/// Saves connections.
///
/// The app manifest is the source of truth for connections, every workbook that references a
/// connection keeps a copy of its params. Saving writes the manifest first and the copies after, so a
/// partial failure heals forward: the next load rewrites stale copies from the manifest.
export class ConnectionPersistenceService {
    private deps: ConnectionPersistenceDependencies;
    /// The save states of connections (connectionId -> state)
    readonly states = new Store<Map<string, ConnectionSaveState>>(new Map());

    constructor(deps: ConnectionPersistenceDependencies) {
        this.deps = deps;
    }

    /// Replace the dependencies
    setDependencies(deps: ConnectionPersistenceDependencies): void {
        this.deps = deps;
    }

    private setState(connectionId: string, state: ConnectionSaveState): void {
        this.states.update(prev => new Map(prev).set(connectionId, state));
    }

    private async writeWorkbookCopies(copy: WorkbookConnection, workbookIds: string[]): Promise<WorkbookCopySaveResult[]> {
        const { storageWriter } = this.deps;
        return await Promise.all(workbookIds.map(async workbookId => ({
            workbookId,
            result: await storageWriter.writeDurable(
                groupWorkbookConnectionCopyWrites(workbookId, copy.connectionId),
                { type: PATCH_WORKBOOK_CONNECTION, value: [workbookId, copy] },
            ),
        })));
    }

    /// Save the draft of a connection, or the given params
    save = async (connectionId: string, saved?: ConnectionParams): Promise<ConnectionSaveResult> => {
        const { storageWriter, references, dispatchConnection: dispatch } = this.deps;
        const connection = this.deps.readConnections().connections.get(connectionId);
        if (connection == null) {
            throw new Error(`no connection registered with id ${connectionId}`);
        }
        const params = connectionParamsWithoutDraftRows(saved ?? connection.paramsDraft ?? connection.params);
        this.setState(connectionId, { saving: true, result: null });
        try {
            // Write the source of truth first, the same key replaces pending draft writes
            const manifest = await storageWriter.writeDurable(
                groupConnectionEntryWrites(connectionId),
                { type: WRITE_CONNECTION_ENTRY, value: { ...connectionEntryFromState({ ...connection, paramsDraft: undefined }), params } },
            );
            if (manifest.status !== 'written') {
                const result: ConnectionSaveResult = { params, manifest, workbooks: [] };
                this.setState(connectionId, { saving: false, result });
                return result;
            }
            dispatch(connectionId, { type: COMMIT_CONNECTION_PARAMS, value: params });
            const workbookIds = [...references.workbooksOf(connectionId)];
            const result: ConnectionSaveResult = { params, manifest, workbooks: await this.writeWorkbookCopies(workbookCopy(connection, params), workbookIds) };
            this.setState(connectionId, { saving: false, result });
            return result;
        } catch (error) {
            const result: ConnectionSaveResult = { params, manifest: { status: 'failed', error }, workbooks: [] };
            this.setState(connectionId, { saving: false, result });
            return result;
        }
    };

    /// Write the copies of workbooks again
    retry = async (connectionId: string, workbookIds: string[]): Promise<ConnectionSaveResult | null> => {
        const last = this.states.current.get(connectionId)?.result;
        if (last == null || last.manifest.status !== 'written') return null;
        this.setState(connectionId, { saving: true, result: last });
        const connection = this.deps.readConnections().connections.get(connectionId);
        if (connection == null) return null;
        const retried = await this.writeWorkbookCopies(workbookCopy(connection, last.params), workbookIds);
        const byWorkbook = new Map(retried.map(r => [r.workbookId, r]));
        const result: ConnectionSaveResult = {
            ...last,
            workbooks: last.workbooks.map(n => byWorkbook.get(n.workbookId) ?? n),
        };
        this.setState(connectionId, { saving: false, result });
        return result;
    };
}
