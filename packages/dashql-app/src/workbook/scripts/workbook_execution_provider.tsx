import * as React from 'react';

import { useConnectionRegistry } from '../../connections/connection_registry.js';
import { useCancelQuery, useQueryExecutor } from '../../connections/query_executor.js';
import { useWorkbookScriptsDispatch, useWorkbookScriptsRegistry, useWorkbookScriptsRegistryReader, type ModifyWorkbookScripts } from './workbook_scripts_registry.js';
import { isWorkbookExecutionRunning, subscribeWorkbookExecutions, type WorkbookExecutionState } from '@ankoh/dashql-sdk/workbook/scripts/workbook_execution';
import { useComputeDatabase } from '../../compute/compute_connection_provider.js';
import { registerScriptRunServices } from '@ankoh/dashql-sdk/workbook/scripts/script_run';
import { useQueryResultCache } from '../../storage/query_result_cache_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import {
    WorkbookExecutionService,
    workbookExecutionIsBusy,
    type WorkbookExecutionDependencies,
    type WorkbookExecutionOptions,
} from '@ankoh/dashql-sdk/workbook/scripts/workbook_execution_service';

// The runs of workbooks are a service of the SDK (packages/dashql-sdk/src/workbook/scripts/workbook_execution_service.ts),
// this module binds it to React
export { workbookExecutionIsBusy, type WorkbookExecutionOptions } from '@ankoh/dashql-sdk/workbook/scripts/workbook_execution_service';

interface ExecutionContext {
    states: Map<string, WorkbookExecutionState>;
    /// Can a run start? A run reads the cached results and the results of the queries with the compute database, a
    /// run starts once it is set up
    ready: boolean;
    start: (workbookId: string, modify: ModifyWorkbookScripts, options?: WorkbookExecutionOptions) => void;
    stop: (workbookId: string) => void;
}

const CONTEXT = React.createContext<ExecutionContext | null>(null);

/// The run of a workbook. `busy` while the whole workbook runs, `runActive` while any run holds the workbook, a run of
/// the workbook or of one of its scripts: the workbook starts no other run then.
export function useWorkbookExecution(workbookId: string) {
    const context = React.useContext(CONTEXT);
    const state = context?.states.get(workbookId) ?? null;
    const start = context?.start;
    const stop = context?.stop;
    const held = React.useSyncExternalStore(subscribeWorkbookExecutions, () => isWorkbookExecutionRunning(workbookId));
    return React.useMemo(() => {
        const busy = workbookExecutionIsBusy(state);
        return {
            state,
            busy,
            ready: context?.ready ?? false,
            runActive: busy || held,
            start: (modify: ModifyWorkbookScripts, options?: WorkbookExecutionOptions) => start?.(workbookId, modify, options),
            stop: () => stop?.(workbookId),
        };
    }, [state, held, start, stop, workbookId, context?.ready]);
}

export function WorkbookExecutionProvider(props: React.PropsWithChildren) {
    const [registry] = useWorkbookScriptsRegistry();
    // The registry as the last update left it, also before the next render
    const readRegistry = useWorkbookScriptsRegistryReader();
    const [connections] = useConnectionRegistry();
    const executeQuery = useQueryExecutor();
    const cancelQuery = useCancelQuery();
    const computeDb = useComputeDatabase();
    const queryResultCache = useQueryResultCache();
    const logger = useLogger();
    const dispatchWorkbookScripts = useWorkbookScriptsDispatch();

    // The provider re-renders with every registry change, a run reads the latest registries when it starts
    const latest = React.useRef({ registry, connections });
    latest.current = { registry, connections };
    const deps = React.useMemo<WorkbookExecutionDependencies>(() => ({
        logger,
        readWorkbooks: () => readRegistry?.() ?? latest.current.registry,
        readConnections: () => latest.current.connections,
        executeQuery,
        cancelQuery,
        dispatchWorkbookScripts,
        computeDatabase: computeDb,
        resultCache: queryResultCache,
    }), [logger, readRegistry, executeQuery, cancelQuery, dispatchWorkbookScripts, computeDb, queryResultCache]);
    const [service] = React.useState(() => new WorkbookExecutionService(deps));
    // During the render, a run that a handler starts reads the dependencies of this render
    service.setDependencies(deps);

    React.useEffect(() => () => service.stopAll(), [service]);
    React.useEffect(() => service.followRegistries(registry, connections), [service, registry, connections, deps]);

    // A layout effect, the passive effects of the children read the services, e.g. the cache indicators of the
    // cards. React runs passive effects child first and a registry change unregisters the services before it
    // registers them again: with a passive effect the children would plan with the plain services that cache
    // nothing in between.
    React.useLayoutEffect(() => {
        const instances = new Set([...registry.workbookScriptsMap.values()].map(workbook => workbook.instance));
        for (const instance of instances) registerScriptRunServices(instance, service.scriptRunServices);
        return () => {
            for (const instance of instances) registerScriptRunServices(instance, null);
        };
    }, [registry, service]);

    const states = React.useSyncExternalStore(service.states.subscribe, service.states.get);
    const ready = computeDb != null;
    const value = React.useMemo<ExecutionContext>(() => ({ states, ready, start: service.start, stop: service.stop }), [states, ready, service]);

    return <CONTEXT.Provider value={value}>
        {props.children}
    </CONTEXT.Provider>;
}
