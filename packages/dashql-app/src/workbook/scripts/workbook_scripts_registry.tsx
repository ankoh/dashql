import * as React from 'react';

import { forgetWorkbookScriptReferences } from './script_reference_reports.js';
import { forgetDataflowGraph } from '../dataflow/dataflow_graph.js';
import { useScriptSelection } from './script_selection.js';
import { WorkbookScripts, WorkbookScriptsAction } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { Dispatch } from '@ankoh/dashql-runtime/utils/variant';
import { storeWithoutRuntime, useStoreState } from '../../utils/store_hooks.js';
import { useOptionalRuntime } from '../../runtime/runtime_provider.js';
import { useOptionalCoreRuntime } from '../../runtime/runtime_hooks.js';
import type { ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import type { InvalidWorkbook } from '@ankoh/dashql-runtime/storage/workbook_validation';
import {
    type ModifyConnectionWorkbookScripts,
    type ModifyWorkbookScripts,
    type WorkbookScriptsRegistry,
} from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts_registry_state';
import { WorkbookScriptsRegistryService } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts_registry_service';

// The state of the registry and its reducers are in workbook_scripts_registry_state.ts, this module binds them to React
export {
    addWorkbookScriptsForConnection,
    applyConnectionWorkbookScriptsAction,
    copyWorkbookScriptsRegistry,
    dispatchWorkbookScriptsAction,
    ensureWorkbookScriptAnalyzed,
    reindexWorkbookScriptConnections,
    removeWorkbookScriptsForConnection,
    removeWorkbookScriptsFromRegistry,
    replaceWorkbookScriptsInRegistry,
    workbookConnectionReferences,
    workbookReplacement,
    type ModifyConnectionWorkbookScripts,
    type ModifyWorkbookScripts,
    type WorkbookScriptsRegistry,
} from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts_registry_state';

export type SetWorkbookScriptsRegistryAction = React.SetStateAction<WorkbookScriptsRegistry>;

// The registry is a service of the runtime (packages/dashql-runtime/src/workbook/scripts/workbook_scripts_registry_service.ts)
// that the RuntimeProvider provides. The registry changes with every editor update while its functions are stable:
// hooks that only modify the registry don't subscribe to it and don't re-render on every update.

// The hooks below resolve the service when their function is called, a test may render a component without the
// runtime as long as it doesn't call them

function useLazyWorkbooks(): () => WorkbookScriptsRegistryService {
    const runtime = useOptionalRuntime();
    return React.useCallback(() => {
        if (runtime == null) throw new Error('the workbook scripts need a RuntimeProvider');
        return runtime.workbooks;
    }, [runtime]);
}

/// The store of the registry, without a runtime one without state
function useWorkbookStore() {
    return useOptionalRuntime()?.workbooks.store ?? NO_WORKBOOK_STORE;
}
const NO_WORKBOOK_STORE = storeWithoutRuntime<WorkbookScriptsRegistry>('the workbook scripts');

export function useWorkbookScriptsRegistry(): [WorkbookScriptsRegistry, Dispatch<SetWorkbookScriptsRegistryAction>] {
    const store = useWorkbookStore();
    return [useStoreState(store), store.update];
}

/// Modify the registry without subscribing to its changes
export function useWorkbookScriptsRegistrySetter(): Dispatch<SetWorkbookScriptsRegistryAction> {
    const service = useLazyWorkbooks();
    return React.useCallback((action: SetWorkbookScriptsRegistryAction) => service().store.update(action), [service]);
}

/// Read the current registry without subscribing to its changes
export function useWorkbookScriptsRegistryReader(): () => WorkbookScriptsRegistry {
    const service = useLazyWorkbooks();
    return React.useCallback(() => service().store.current, [service]);
}

/// The workbooks that were refused a load
export interface InvalidWorkbooks {
    /// The invalid workbooks (workbookId -> reason)
    invalidWorkbooks: ReadonlyMap<string, InvalidWorkbook>;
    /// Delete the files of an invalid workbook and drop it from the list
    deleteInvalidWorkbook: (workbookId: string) => Promise<void>;
}


export function useInvalidWorkbooks(): InvalidWorkbooks {
    const service = useLazyWorkbooks();
    const reg = useStoreState(useWorkbookStore());
    const deleteInvalidWorkbook = React.useCallback((workbookId: string) => service().deleteInvalid(workbookId), [service]);
    return React.useMemo(() => ({ invalidWorkbooks: reg.invalidWorkbooks, deleteInvalidWorkbook }), [reg.invalidWorkbooks, deleteInvalidWorkbook]);
}

/// Create a workbook without scripts on a connection and write its first manifest
export function useWorkbookScriptsCreation(): (connection: ConnectionState, name: string, ephemeral: boolean) => WorkbookScripts {
    const service = useLazyWorkbooks();
    const runtime = useOptionalCoreRuntime();
    return React.useCallback((connection: ConnectionState, name: string, ephemeral: boolean) => {
        if (runtime == null) throw new Error('the workbooks need a RuntimeProvider');
        return service().create(runtime, connection, name, ephemeral);
    }, [service, runtime]);
}

/// Delete the scripts of a workbook and free their Wasm, before the connection is deleted, see
/// WorkbookScriptsRegistryService.delete. The caches of the workbook in the app go with it.
export function useWorkbookScriptsDeletion(): (workbookId: string) => void {
    const service = useLazyWorkbooks();
    const selection = useScriptSelection();
    return React.useCallback((workbookId: string) => {
        service().delete(workbookId);
        forgetWorkbookScriptReferences(workbookId);
        forgetDataflowGraph(workbookId);
        selection.forget(workbookId);
    }, [service, selection]);
}

export function useWorkbookScripts(id: string | null): [WorkbookScripts | null, ModifyWorkbookScripts] {
    const service = useLazyWorkbooks();
    const registry = useStoreState(useWorkbookStore());
    /// Wrapper to modify an individual workbook scripts collection
    const dispatch = React.useCallback((action: WorkbookScriptsAction) => {
        if (id == null) return Promise.resolve(null);
        return service().dispatch(id, action);
    }, [id, service]);
    return [id == null ? null : registry.workbookScriptsMap.get(id) ?? null, dispatch];
};

/// Modify the scripts of any workbook without subscribing to the registry
export function useWorkbookScriptsDispatch(): (id: string, action: WorkbookScriptsAction) => Promise<WorkbookScripts | null> {
    const service = useLazyWorkbooks();
    return React.useCallback((id: string, action: WorkbookScriptsAction) => service().dispatch(id, action), [service]);
}

export function useConnectionScriptsDispatch(): ModifyConnectionWorkbookScripts {
    const service = useLazyWorkbooks();
    return React.useCallback((connectionId: string, action: WorkbookScriptsAction) => service().dispatchConnection(connectionId, action), [service]);
}
