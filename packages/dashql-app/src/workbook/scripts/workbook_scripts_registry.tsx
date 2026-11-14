import * as React from 'react';

import { forgetWorkbookScriptReferences } from './script_reference_reports.js';
import { forgetDataflowGraph } from '../dataflow/dataflow_graph.js';
import { WorkbookScripts, WorkbookScriptsAction } from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts';
import { Dispatch } from '@ankoh/dashql-sdk/utils/variant';
import { UpdateQueue } from '@ankoh/dashql-sdk/store/store';
import { FRAME_UPDATE_SCHEDULER, useStoreState } from '../../utils/store_hooks.js';
import { useStorageWriter } from '../../storage/storage_provider.js';
import { ConnectionReferencesProvider } from '../../connections/connection_registry.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import type { InvalidWorkbook } from '@ankoh/dashql-sdk/storage/workbook_validation';
import {
    type ModifyConnectionWorkbookScripts,
    type ModifyWorkbookScripts,
    type WorkbookScriptsAllocator,
    type WorkbookScriptsRegistry,
} from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts_registry_state';
import { WorkbookScriptsRegistryService } from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts_registry_service';

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
    type WorkbookScriptsAllocator,
    type WorkbookScriptsRegistry,
} from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts_registry_state';

export type SetWorkbookScriptsRegistryAction = React.SetStateAction<WorkbookScriptsRegistry>;


// The registry changes with every editor update while the setter is stable.
// Hooks that only modify the registry subscribe to the setter context and don't re-render on every update.
const WORKBOOK_SCRIPTS_REGISTRY_CTX = React.createContext<WorkbookScriptsRegistry | null>(null);
const WORKBOOK_SCRIPTS_REGISTRY_SETTER_CTX = React.createContext<Dispatch<SetWorkbookScriptsRegistryAction> | null>(null);
// Reads the current registry without subscribing to its changes
const WORKBOOK_SCRIPTS_REGISTRY_READER_CTX = React.createContext<(() => WorkbookScriptsRegistry) | null>(null);
// The workbook script actions of all components are applied in order through one queue
const WORKBOOK_SCRIPTS_REGISTRY_QUEUE_CTX = React.createContext<UpdateQueue<WorkbookScriptsRegistry> | null>(null);
const WORKBOOK_SCRIPTS_REGISTRY_SERVICE_CTX = React.createContext<WorkbookScriptsRegistryService | null>(null);

type Props = {};

export const WorkbookScriptsRegistryProvider: React.FC<React.PropsWithChildren<Props>> = (props: React.PropsWithChildren<Props>) => {
    const logger = useLogger();
    const storageWriter = useStorageWriter();
    const deps = { logger, storageWriter };
    const [service] = React.useState(() => new WorkbookScriptsRegistryService(deps, FRAME_UPDATE_SCHEDULER));
    service.setDependencies(deps);
    React.useEffect(() => () => service.dispose(), [service]);
    const store = service.store;
    const reg = useStoreState(store);
    // The scripts own the references to their connections, the connection layer reads them from here
    return (
        <WORKBOOK_SCRIPTS_REGISTRY_SERVICE_CTX.Provider value={service}>
            <ConnectionReferencesProvider value={service.references}>
                <WORKBOOK_SCRIPTS_REGISTRY_QUEUE_CTX.Provider value={service.queue}>
                    <WORKBOOK_SCRIPTS_REGISTRY_READER_CTX.Provider value={store.get}>
                        <WORKBOOK_SCRIPTS_REGISTRY_SETTER_CTX.Provider value={store.update}>
                            <WORKBOOK_SCRIPTS_REGISTRY_CTX.Provider value={reg}>
                                {props.children}
                            </WORKBOOK_SCRIPTS_REGISTRY_CTX.Provider>
                        </WORKBOOK_SCRIPTS_REGISTRY_SETTER_CTX.Provider>
                    </WORKBOOK_SCRIPTS_REGISTRY_READER_CTX.Provider>
                </WORKBOOK_SCRIPTS_REGISTRY_QUEUE_CTX.Provider>
            </ConnectionReferencesProvider>
        </WORKBOOK_SCRIPTS_REGISTRY_SERVICE_CTX.Provider>
    );
};

export function useWorkbookScriptsRegistry(): [WorkbookScriptsRegistry, Dispatch<SetWorkbookScriptsRegistryAction>] {
    return [React.useContext(WORKBOOK_SCRIPTS_REGISTRY_CTX)!, React.useContext(WORKBOOK_SCRIPTS_REGISTRY_SETTER_CTX)!];
}

/// Modify the registry without subscribing to its changes
export function useWorkbookScriptsRegistrySetter(): Dispatch<SetWorkbookScriptsRegistryAction> {
    return React.useContext(WORKBOOK_SCRIPTS_REGISTRY_SETTER_CTX)!;
}

/// Read the current registry without subscribing to its changes
export function useWorkbookScriptsRegistryReader(): () => WorkbookScriptsRegistry {
    return React.useContext(WORKBOOK_SCRIPTS_REGISTRY_READER_CTX)!;
}

/// The workbooks that were refused a load
export interface InvalidWorkbooks {
    /// The invalid workbooks (workbookId -> reason)
    invalidWorkbooks: ReadonlyMap<string, InvalidWorkbook>;
    /// Delete the files of an invalid workbook and drop it from the list
    deleteInvalidWorkbook: (workbookId: string) => Promise<void>;
}

/// The service that holds the workbook scripts
export function useWorkbookScriptsRegistryService(): WorkbookScriptsRegistryService {
    return React.useContext(WORKBOOK_SCRIPTS_REGISTRY_SERVICE_CTX)!;
}

export function useInvalidWorkbooks(): InvalidWorkbooks {
    const reg = React.useContext(WORKBOOK_SCRIPTS_REGISTRY_CTX)!;
    const service = useWorkbookScriptsRegistryService();
    const deleteInvalidWorkbook = React.useCallback((workbookId: string) => service.deleteInvalid(workbookId), [service]);
    return React.useMemo(() => ({ invalidWorkbooks: reg.invalidWorkbooks, deleteInvalidWorkbook }), [reg.invalidWorkbooks, deleteInvalidWorkbook]);
}

// The hooks below resolve the service when their function is called, a test may render a component without the
// provider as long as it doesn't call them

export function useWorkbookScriptsAllocator(): WorkbookScriptsAllocator {
    const service = useWorkbookScriptsRegistryService();
    return React.useCallback((scripts: WorkbookScripts) => service.allocate(scripts), [service]);
}

/// Delete the scripts of a workbook and free their Wasm, before the connection is deleted, see
/// WorkbookScriptsRegistryService.delete. The caches of the workbook in the app go with it.
export function useWorkbookScriptsDeletion(): (workbookId: string) => void {
    const service = useWorkbookScriptsRegistryService();
    return React.useCallback((workbookId: string) => {
        service.delete(workbookId);
        forgetWorkbookScriptReferences(workbookId);
        forgetDataflowGraph(workbookId);
    }, [service]);
}

export function useWorkbookScripts(id: string | null): [WorkbookScripts | null, ModifyWorkbookScripts] {
    const registry = React.useContext(WORKBOOK_SCRIPTS_REGISTRY_CTX)!;
    const service = useWorkbookScriptsRegistryService();
    /// Wrapper to modify an individual workbook scripts collection
    const dispatch = React.useCallback((action: WorkbookScriptsAction) => {
        if (id == null) return Promise.resolve(null);
        return service.dispatch(id, action);
    }, [id, service]);
    return [id == null ? null : registry.workbookScriptsMap.get(id) ?? null, dispatch];
};

/// Modify the scripts of any workbook without subscribing to the registry
export function useWorkbookScriptsDispatch(): (id: string, action: WorkbookScriptsAction) => Promise<WorkbookScripts | null> {
    const service = useWorkbookScriptsRegistryService();
    return React.useCallback((id: string, action: WorkbookScriptsAction) => service.dispatch(id, action), [service]);
}

export function useConnectionScriptsDispatch(): ModifyConnectionWorkbookScripts {
    const service = useWorkbookScriptsRegistryService();
    return React.useCallback((connectionId: string, action: WorkbookScriptsAction) => service.dispatchConnection(connectionId, action), [service]);
}
