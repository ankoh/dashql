import * as React from 'react';

import type * as core from '@ankoh/dashql';
import type { ConnectionParams } from '@ankoh/dashql/platform/connections/connection_params';
import { writeResultOf, type StorageWriteResult } from '@ankoh/dashql/runtime/storage/runtime_storage';
import { useConnection, useOptionalRuntime } from '../runtime/runtime_hooks.js';

// Saving a connection is a command of the runtime (docs/wip/runtime_api.md), the view of the connection shows the save
// while it runs. This module turns the outcomes into what the settings show.

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

/// The state of saving a connection
export interface ConnectionSaveState {
    /// Is the connection being saved?
    saving: boolean;
    /// The outcome of the last save, if any
    result: ConnectionSaveResult | null;
}

/// Did saving persist the connection everywhere?
export function connectionSaveSucceeded(result: ConnectionSaveResult): boolean {
    return result.manifest.status === 'written' && result.workbooks.every(n => n.result.status === 'written');
}

/// The workbooks whose copies were not written
export function failedWorkbookCopies(result: ConnectionSaveResult): WorkbookCopySaveResult[] {
    return result.workbooks.filter(n => n.result.status !== 'written');
}

/// The outcome of a save of the runtime with the write results of the storage
function saveResultOf(outcome: core.ConnectionSaveOutcome): ConnectionSaveResult {
    return {
        params: outcome.params as ConnectionParams,
        manifest: writeResultOf(outcome.manifest),
        workbooks: outcome.workbooks.map(copy => ({ workbookId: copy.workbookId, result: writeResultOf(copy.result) })),
    };
}

const IDLE_SAVE_STATE: ConnectionSaveState = { saving: false, result: null };
/// The save states of the outcomes of the runtime, a view that didn't change keeps its object
const SAVE_STATES = new WeakMap<core.ConnectionSaveView, ConnectionSaveState>();

/// Save a connection and observe the save state
export function useConnectionSave(connectionId: string | null) {
    const runtime = useOptionalRuntime();
    const view = useConnection(connectionId)?.save ?? null;
    let state = IDLE_SAVE_STATE;
    if (view != null) {
        state = SAVE_STATES.get(view) ?? { saving: view.saving, result: view.outcome == null ? null : saveResultOf(view.outcome) };
        SAVE_STATES.set(view, state);
    }
    const save = React.useCallback(async (): Promise<ConnectionSaveResult | null> => {
        if (connectionId == null || runtime == null) return null;
        return saveResultOf(await runtime.saveConnection(connectionId));
    }, [connectionId, runtime]);
    const retry = React.useCallback(async (workbookIds: string[]): Promise<ConnectionSaveResult | null> => {
        if (connectionId == null || runtime == null) return null;
        const retried = await runtime.retrySave(connectionId, workbookIds);
        return retried == null ? null : saveResultOf(retried);
    }, [connectionId, runtime]);
    return { ...state, save, retry };
}

/// Save the params of any connection, e.g. of a connection that is not shown
export function useConnectionSaver(): (connectionId: string, params: ConnectionParams) => Promise<ConnectionSaveResult | null> {
    const runtime = useOptionalRuntime();
    return React.useCallback(async (connectionId: string, params: ConnectionParams) => {
        return runtime == null ? null : saveResultOf(await runtime.saveConnection(connectionId, params));
    }, [runtime]);
}

/// Save the draft of a connection before connecting with it.
/// Resolves false if the connection must not be set up because the draft could not be saved.
export function useSaveBeforeConnect(connectionId: string | null): () => Promise<boolean> {
    const runtime = useOptionalRuntime();
    return React.useCallback(async () => {
        if (connectionId == null || runtime == null) return true;
        const connection = runtime.connection(connectionId);
        if (connection?.paramsDraft == null) return true;
        const result = await runtime.saveConnection(connectionId);
        return result.manifest.status === 'written';
    }, [connectionId, runtime]);
}
