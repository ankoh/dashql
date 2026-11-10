import * as React from 'react';

import { useStorageWriter } from '../storage/storage_provider.js';
import {
    groupConnectionEntryWrites,
    groupWorkbookConnectionCopyWrites,
    PATCH_WORKBOOK_CONNECTION,
    WRITE_CONNECTION_ENTRY,
    type StorageWriteResult,
} from '../storage/storage_writer.js';
import { COMMIT_CONNECTION_PARAMS, type ConnectionState } from './connection_state.js';
import {
    connectionEntryFromState,
    useConnectionReferences,
    workbookConnectionFromState,
    useConnectionDispatch,
    useConnectionRegistryStore,
} from './connection_registry.js';
import { connectionParamsWithoutDraftRows, type ConnectionParams } from './connection_params.js';
import type { WorkbookConnection } from '../storage/storage_backend.js';

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

/// The API to save connections
interface ConnectionPersistence {
    /// The save states of connections (connectionId -> state)
    states: Map<string, ConnectionSaveState>;
    /// Save the draft of a connection, or the given params
    save: (connectionId: string, params?: ConnectionParams) => Promise<ConnectionSaveResult>;
    /// Write the copies of workbooks again
    retry: (connectionId: string, workbookIds: string[]) => Promise<ConnectionSaveResult | null>;
}

const CONNECTION_PERSISTENCE_CTX = React.createContext<ConnectionPersistence | null>(null);

const IDLE_SAVE_STATE: ConnectionSaveState = { saving: false, result: null };

/// Saves connections.
///
/// The app manifest is the source of truth for connections, every workbook that references a
/// connection keeps a copy of its params. Saving writes the manifest first and the copies after, so a
/// partial failure heals forward: the next load rewrites stale copies from the manifest.
export const ConnectionPersistenceProvider: React.FC<{ children: React.ReactElement }> = (props) => {
    const storageWriter = useStorageWriter();
    const registryStore = useConnectionRegistryStore();
    const references = useConnectionReferences();
    const dispatch = useConnectionDispatch();
    const [states, setStates] = React.useState(() => new Map<string, ConnectionSaveState>());

    const setState = React.useCallback((connectionId: string, state: ConnectionSaveState) => {
        setStates(prev => new Map(prev).set(connectionId, state));
    }, []);

    const writeWorkbookCopies = React.useCallback(async (copy: WorkbookConnection, workbookIds: string[]) => {
        return await Promise.all(workbookIds.map(async workbookId => ({
            workbookId,
            result: await storageWriter.writeDurable(
                groupWorkbookConnectionCopyWrites(workbookId, copy.connectionId),
                { type: PATCH_WORKBOOK_CONNECTION, value: [workbookId, copy] },
            ),
        })));
    }, [storageWriter]);

    const save = React.useCallback(async (connectionId: string, saved?: ConnectionParams): Promise<ConnectionSaveResult> => {
        const connection = registryStore.current.connections.get(connectionId);
        if (connection == null) {
            throw new Error(`no connection registered with id ${connectionId}`);
        }
        const params = connectionParamsWithoutDraftRows(saved ?? connection.paramsDraft ?? connection.params);
        setState(connectionId, { saving: true, result: null });
        try {
            // Write the source of truth first, the same key replaces pending draft writes
            const manifest = await storageWriter.writeDurable(
                groupConnectionEntryWrites(connectionId),
                { type: WRITE_CONNECTION_ENTRY, value: { ...connectionEntryFromState({ ...connection, paramsDraft: undefined }), params } },
            );
            if (manifest.status !== 'written') {
                const result: ConnectionSaveResult = { params, manifest, workbooks: [] };
                setState(connectionId, { saving: false, result });
                return result;
            }
            dispatch(connectionId, { type: COMMIT_CONNECTION_PARAMS, value: params });
            const workbookIds = [...references.workbooksOf(connectionId)];
            const result: ConnectionSaveResult = { params, manifest, workbooks: await writeWorkbookCopies(workbookCopy(connection, params), workbookIds) };
            setState(connectionId, { saving: false, result });
            return result;
        } catch (error) {
            const result: ConnectionSaveResult = { params, manifest: { status: 'failed', error }, workbooks: [] };
            setState(connectionId, { saving: false, result });
            return result;
        }
    }, [dispatch, references, registryStore, setState, storageWriter, writeWorkbookCopies]);

    const retry = React.useCallback(async (connectionId: string, workbookIds: string[]): Promise<ConnectionSaveResult | null> => {
        const last = states.get(connectionId)?.result;
        if (last == null || last.manifest.status !== 'written') return null;
        setState(connectionId, { saving: true, result: last });
        const connection = registryStore.current.connections.get(connectionId);
        if (connection == null) return null;
        const retried = await writeWorkbookCopies(workbookCopy(connection, last.params), workbookIds);
        const byWorkbook = new Map(retried.map(r => [r.workbookId, r]));
        const result: ConnectionSaveResult = {
            ...last,
            workbooks: last.workbooks.map(n => byWorkbook.get(n.workbookId) ?? n),
        };
        setState(connectionId, { saving: false, result });
        return result;
    }, [registryStore, setState, states, writeWorkbookCopies]);

    const value = React.useMemo(() => ({ states, save, retry }), [states, save, retry]);
    return (
        <CONNECTION_PERSISTENCE_CTX.Provider value={value}>
            {props.children}
        </CONNECTION_PERSISTENCE_CTX.Provider>
    );
};

/// Save a connection and observe the save state
export function useConnectionSave(connectionId: string | null) {
    const persistence = React.useContext(CONNECTION_PERSISTENCE_CTX);
    const state = (connectionId == null ? null : persistence?.states.get(connectionId)) ?? IDLE_SAVE_STATE;
    const save = React.useCallback(async (): Promise<ConnectionSaveResult | null> => {
        if (connectionId == null || persistence == null) return null;
        return await persistence.save(connectionId);
    }, [connectionId, persistence]);
    const retry = React.useCallback(async (workbookIds: string[]): Promise<ConnectionSaveResult | null> => {
        if (connectionId == null || persistence == null) return null;
        return await persistence.retry(connectionId, workbookIds);
    }, [connectionId, persistence]);
    return { ...state, save, retry };
}

/// Save the params of any connection, e.g. of a connection that is not shown
export function useConnectionSaver(): (connectionId: string, params: ConnectionParams) => Promise<ConnectionSaveResult | null> {
    const persistence = React.useContext(CONNECTION_PERSISTENCE_CTX);
    return React.useCallback(async (connectionId: string, params: ConnectionParams) => {
        return persistence == null ? null : await persistence.save(connectionId, params);
    }, [persistence]);
}

/// Save the draft of a connection before connecting with it.
/// Resolves false if the connection must not be set up because the draft could not be saved.
export function useSaveBeforeConnect(connectionId: string | null): () => Promise<boolean> {
    const persistence = React.useContext(CONNECTION_PERSISTENCE_CTX);
    const registryStore = useConnectionRegistryStore();
    return React.useCallback(async () => {
        if (connectionId == null || persistence == null) return true;
        const connection = registryStore.current.connections.get(connectionId);
        if (connection?.paramsDraft == null) return true;
        const result = await persistence.save(connectionId);
        return result.manifest.status === 'written';
    }, [connectionId, persistence, registryStore]);
}
