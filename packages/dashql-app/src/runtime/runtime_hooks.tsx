import * as React from 'react';
import type * as arrow from 'apache-arrow';
import type * as core from '@ankoh/dashql';

import { createRuntime, type ChannelConnector, type Runtime } from '@ankoh/dashql/runtime/runtime';
import type { StoreView } from '@ankoh/dashql/runtime/store/runtime_store';
import type { ConnectionState } from '@ankoh/dashql/platform/connections/connection_state';
import type { QueryExecutionProgress, QueryExecutionState } from '@ankoh/dashql/platform/query/query_execution_state';
import { stringifyError } from '@ankoh/dashql/platform/platform/logger/logger';
import type { ScriptData, ScriptDataMap, WorkbookScripts } from '@ankoh/dashql/platform/workbook/scripts/workbook_scripts';
import { workbookExecutionIsBusy } from '@ankoh/dashql/platform/workbook/scripts/workbook_execution';

import { useLogger } from '../platform/logger/logger_provider.js';
import { useEmbeddedDatabaseSetup } from '../platform/database/embedded_database_provider.js';
import { useHttpClient } from '../platform/http/http_client_provider.js';
import { FRAME_UPDATE_SCHEDULER } from '../utils/store_hooks.js';
import { useDashQLCore } from './core_provider.js';

// The hooks of the runtime (docs/design/dashql_runtime.md). A component reads the view of a slice, which renders it
// again when that slice changes and no other, dispatches an action to a slice and resolves the tables of a view by
// their handles. The views come from the store of the runtime, never from the module. The commands are methods of the
// runtime (`useRuntime()`), the hooks below that call them resolve the runtime when their function is called: a test
// may render a component without a runtime as long as it doesn't call them.

const LOG_CTX = 'runtime';

const RUNTIME_CTX = React.createContext<Runtime | null>(null);

/// Provide a runtime to the components below, the RuntimeProvider provides the one of the app
export const RuntimeContextProvider = RUNTIME_CTX.Provider;

/// The runtime of the provider above: its commands, its store and its platform. Throws without one.
export function useRuntime(): Runtime {
    const runtime = React.useContext(RUNTIME_CTX);
    if (runtime == null) throw new Error('the runtime needs a RuntimeProvider or a StandaloneRuntime');
    return runtime;
}

/// The runtime of the provider above, null without one. Hooks that call the runtime only when their function is
/// called use it, a test may render a component without a runtime as long as it doesn't call them.
export function useOptionalRuntime(): Runtime | null {
    return React.useContext(RUNTIME_CTX);
}

/// A runtime that a component creates and owns. The first render creates it, the component keeps it in a ref, and the
/// runtime is destroyed in a task after the cleanup of the effect unless the effect runs again before: StrictMode,
/// which runs the cleanup and the effect once more, and Fast Refresh, which runs the effects again and keeps the refs,
/// keep the same runtime instead of leaving the app on a destroyed one.
export function useOwnedRuntime(create: () => Runtime): Runtime {
    const logger = useLogger();
    const latestLogger = React.useRef(logger);
    latestLogger.current = logger;
    // The runtime of the component and the timer that destroys it after a cleanup
    const owned = React.useRef<{ runtime: Runtime; release: ReturnType<typeof setTimeout> | null } | null>(null);
    if (owned.current == null) owned.current = { runtime: create(), release: null };
    React.useEffect(() => {
        const held = owned.current;
        if (held == null) return;
        if (held.release != null) {
            clearTimeout(held.release);
            held.release = null;
        }
        return () => {
            held.release = setTimeout(() => {
                if (owned.current === held) owned.current = null;
                void held.runtime.destroy().catch(error => {
                    latestLogger.current.error('Failed to stop the runtime', { error: stringifyError(error) }, LOG_CTX);
                });
            }, 0);
        };
    }, []);
    return owned.current.runtime;
}

const NO_SUBSCRIPTION = () => () => { };
const NO_VIEW = () => null;

/// The view of a slice, null without one: the view as the runtime returns it, or the projection of the store for the
/// workbooks, the scripts and the derived views. The component renders again when the slice changes.
export function useView<K extends core.ViewKind>(kind: K, id: core.ViewId<K> | null | undefined): StoreView<K> | null {
    const runtime = React.useContext(RUNTIME_CTX);
    const store = runtime?.store ?? null;
    const subscribe = React.useMemo(
        () => store == null || id == null ? NO_SUBSCRIPTION : (listener: () => void) => store.subscribe(kind, id, listener),
        [store, kind, id],
    );
    const getSnapshot = React.useMemo(
        (): () => StoreView<K> | null => store == null || id == null ? NO_VIEW : () => store.get(kind, id),
        [store, kind, id],
    );
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/// The views of every slice of a kind by id, in the order the runtime registered them. The component renders again
/// when any slice of the kind changes: only views that show all of them use it.
function useAll<K extends core.ViewKind>(kind: K): ReadonlyMap<core.ViewId<K>, StoreView<K>> {
    const runtime = React.useContext(RUNTIME_CTX);
    const store = runtime?.store ?? null;
    const subscribe = React.useMemo(() => store == null ? NO_SUBSCRIPTION : (listener: () => void) => store.subscribeKind(kind, listener), [store, kind]);
    const getSnapshot = React.useCallback(() => store?.all(kind) ?? NO_SLICES, [store, kind]);
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot) as ReadonlyMap<core.ViewId<K>, StoreView<K>>;
}
const NO_SLICES: ReadonlyMap<never, never> = new Map<never, never>();

/// Dispatch actions to a slice. The runtime is resolved when the function is called, it logs an action that it refuses.
export function useDispatch(target: core.Target | null): (action: core.RuntimeAction) => core.DispatchOutcome {
    const runtime = React.useContext(RUNTIME_CTX);
    const key = target == null ? null : JSON.stringify(target);
    return React.useCallback((action: core.RuntimeAction) => {
        if (runtime == null) throw new Error('the runtime needs a RuntimeProvider or a StandaloneRuntime');
        if (key == null) return { ok: false, changed: false, error: 'no target', id: null };
        return runtime.dispatch(JSON.parse(key) as core.Target, action);
    }, [runtime, key]);
}

/// An Arrow table of the runtime by its handle, null without one. A handle names one table for as long as it lives.
export function useTable(handle: number | null | undefined): arrow.Table | null {
    const runtime = React.useContext(RUNTIME_CTX);
    return runtime?.table(handle) ?? null;
}

// The workbooks

/// A workbook, it renders again when the workbook changes, not with the keystrokes of its scripts
export const useWorkbook = (workbookId: string | null | undefined): WorkbookScripts | null => useView('workbook', workbookId);
/// A script of a workbook by its key
export const useScript = (scriptKey: number | null | undefined): ScriptData | null => useView('script', scriptKey);
/// What the runtime derives from the scripts of a workbook: the checked references, the dataflow and the inputs
export const useWorkbookDerived = (workbookId: string | null | undefined) => useView('workbookDerived', workbookId);
/// The list of the workbooks: their ids in the order they were registered with their names, and the workbooks that were
/// refused a load
export const useWorkbookList = (): core.WorkbookListView | null => useView('workbookList', 'root');
/// The workbooks by id, in the order they were registered. The component renders again when a workbook changes, not
/// with the changes of the scripts.
export const useWorkbooks = (): ReadonlyMap<string, WorkbookScripts> => useAll('workbook');

/// The scripts of a workbook by key. The component renders again when a script of the workbook changes, e.g. with
/// every keystroke: only the views that show all scripts at once use it.
export function useWorkbookScriptMap(workbookId: string | null | undefined): ScriptDataMap {
    const runtime = React.useContext(RUNTIME_CTX);
    const store = runtime?.store ?? null;
    const cache = React.useRef<{ keys: readonly number[] | null; scripts: (ScriptData | null)[]; map: ScriptDataMap }>({ keys: null, scripts: [], map: {} });
    const subscribe = React.useMemo(() => {
        if (store == null || workbookId == null) return NO_SUBSCRIPTION;
        return (listener: () => void) => {
            const unsubscribeWorkbook = store.subscribe('workbook', workbookId, listener);
            const unsubscribeScripts = store.subscribeKind('script', listener);
            return () => {
                unsubscribeWorkbook();
                unsubscribeScripts();
            };
        };
    }, [store, workbookId]);
    const getSnapshot = React.useCallback((): ScriptDataMap => {
        const keys = workbookId == null ? null : store?.get('workbook', workbookId)?.scriptKeys ?? null;
        const scripts = (keys ?? []).map(key => store?.get('script', key) ?? null);
        const held = cache.current;
        if (held.keys === keys && held.scripts.length === scripts.length && scripts.every((script, i) => script === held.scripts[i])) {
            return held.map;
        }
        const map: ScriptDataMap = {};
        for (const script of scripts) {
            if (script != null) map[script.scriptKey] = script;
        }
        cache.current = { keys, scripts, map };
        return map;
    }, [store, workbookId]);
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

// The connections

/// The view of a connection, it renders again when the connection changes: when it is set up, saved or refreshed and
/// when a query starts or finishes, not with the progress of a query
export const useConnection = (connectionId: string | null | undefined): ConnectionState | null => useView('connection', connectionId) as ConnectionState | null;
/// The catalog of a connection, null while the runtime holds no such connection. The component renders again when the
/// connection changes and gets a new catalog when the connection got a new one (`catalogId`). A held catalog stays
/// readable after its connection went.
export function useCatalog(connectionId: string | null | undefined): core.DashQLCatalog | null {
    const runtime = React.useContext(RUNTIME_CTX);
    const catalogId = useConnection(connectionId)?.catalogId ?? null;
    return React.useMemo(
        () => runtime == null || connectionId == null || catalogId == null ? null : runtime.catalog(connectionId),
        [runtime, connectionId, catalogId],
    );
}
/// The list of the connections: the ids in the order they were registered, whether they are listed next to the
/// workbooks and their ordinals, and the ids by connector
export const useConnectionList = (): core.ConnectionListView | null => useView('connectionList', 'root');
/// The connections by id, in the order they were registered. The component renders again when a connection changes.
export const useConnections = (): ReadonlyMap<string, ConnectionState> => useAll('connection') as ReadonlyMap<string, ConnectionState>;

/// The views of some connections, e.g. the `connectionIds` of a workbook, null while one of them is unknown or without
/// ids. The list keeps its identity while these connections are unchanged, consumers depend on it in effects: a query
/// on another connection renders the component but returns the same list.
export function useConnectionViews(connectionIds: readonly string[] | null | undefined): ConnectionState[] | null {
    const connections = useConnections();
    let resolved: ConnectionState[] | null = null;
    if (connectionIds != null && connectionIds.length > 0) {
        const views = connectionIds.map(connectionId => connections.get(connectionId));
        if (views.every(view => view != null)) resolved = views as ConnectionState[];
    }
    const latest = React.useRef(resolved);
    const same = latest.current === resolved || (latest.current != null && resolved != null
        && latest.current.length === resolved.length && latest.current.every((connection, i) => connection === resolved[i]));
    if (!same) latest.current = resolved;
    return latest.current;
}

// The queries

/// The view of a query, it renders again when the query changes and no other
export const useQuery = (queryId: number | null | undefined): QueryExecutionState | null => useView('query', queryId) as QueryExecutionState | null;
/// The queries of all histories, it renders again when any query changes, e.g. for the viewer of the query history
export const useAllQueries = (): ReadonlyMap<number, QueryExecutionState> => useAll('query') as ReadonlyMap<number, QueryExecutionState>;

/// The latest progress of a query with its structured progress, the store projects it once per change of the query
export function useQueryProgress(query: QueryExecutionState | null | undefined): QueryExecutionProgress | null {
    return query?.progress ?? null;
}

/// The result table of a query, null without one
export function useQueryResultTable(query: QueryExecutionState | null | undefined): arrow.Table | null {
    return useTable(query?.resultTable?.id ?? null);
}

/// Show the profile of a query while the component is mounted: the connector then fetches the plan and its
/// statistics (Trino). Without a runtime nothing is fetched.
export function useQueryProfileDetail(queryId: number | null, enabled = true) {
    const runtime = React.useContext(RUNTIME_CTX);
    React.useEffect(() => {
        if (!enabled || queryId == null || runtime == null) return;
        return runtime.watchProfile(queryId);
    }, [runtime, queryId, enabled]);
}

// The computations

/// The view of the computation of a result
export const useComputation = (tableId: number | null | undefined) => useView('computation', tableId);
/// Dispatch actions to the computation of a result
export const useComputationDispatch = (tableId: number | null | undefined) => useDispatch(tableId == null ? null : { computation: tableId });

// The runs

/// The options of a run of a workbook
export interface WorkbookExecutionOptions {
    /// Run the scripts that a change of these inputs affects. A run that holds the workbook stops, the run starts
    /// once the workbook is free, with the inputs of every change since.
    inputs?: readonly string[];
}

/// Is the compute database of the runtime ready? The runs, the computations and the query result cache wait for it.
export function useComputeReady(): boolean {
    const runtime = React.useContext(RUNTIME_CTX);
    const database = runtime?.computeDatabase ?? null;
    const subscribe = React.useMemo(() => database == null ? NO_SUBSCRIPTION : (listener: () => void) => database.subscribe(listener), [database]);
    const getSnapshot = React.useCallback(() => database?.ready ?? false, [database]);
    return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/// The run of a workbook from its `run` slice. `busy` while the whole workbook runs, `runActive` while any run holds
/// the workbook, a run of the workbook or of one of its scripts: the workbook starts no other run then. A run reads the
/// cached results and the results of the queries with the compute database, a run is `ready` once the compute database
/// of the runtime is (`useComputeReady`).
export function useWorkbookExecution(workbookId: string) {
    const runtime = React.useContext(RUNTIME_CTX);
    const logger = useLogger();
    const run = useView('run', workbookId);
    const ready = useComputeReady();
    const state = run?.state ?? null;
    const held = run?.held != null;
    return React.useMemo(() => {
        const busy = workbookExecutionIsBusy(state);
        return {
            state,
            busy,
            ready,
            runActive: busy || held,
            start: (options?: WorkbookExecutionOptions) => {
                if (runtime == null) return;
                // A failed statement and a failed plan show on their scripts, a run that fails otherwise shows as an error
                const failed = (error: unknown) => logger.error('The run of the workbook failed', { workbookId, error: stringifyError(error) }, 'workbook_execution');
                runtime.runWorkbook(workbookId, { inputs: options?.inputs == null ? undefined : [...options.inputs] }).then(result => {
                    const failure = result.outcome.failure;
                    if (failure != null && failure.kind === 'error' && failure.queryId == null) failed(result.error);
                }, failed);
            },
            stop: () => runtime?.stopRun(workbookId),
        };
    }, [state, held, runtime, workbookId, ready, logger]);
}

/// Run a script of a workbook with the scripts it references, a refresh reads no cached results. Resolves once the run
/// ended, a failure shows on the script.
export type ScriptRun = (workbookId: string, scriptKey: number, options?: { refresh?: boolean }) => Promise<void>;

/// The runs of single scripts of the runtime, null without a runtime
export function useScriptRun(): ScriptRun | null {
    const runtime = React.useContext(RUNTIME_CTX);
    const logger = useLogger();
    return React.useMemo(() => runtime == null ? null : async (workbookId, scriptKey, options = {}) => {
        try {
            await runtime.runScript(workbookId, scriptKey, { refresh: options.refresh });
        } catch (error) {
            logger.warn('Workbook script run failed', { workbookId, scriptKey: scriptKey.toString(), error: stringifyError(error) }, 'workbook_execution');
        }
    }, [runtime, logger]);
}

/// A runtime without the storage of the app, e.g. of the shell of Hyper, on the embedded database and the HTTP client of
/// the providers above it. It is created once the core of the provider above is there, without one the core that the
/// package instantiated already, and it goes with the component. `channels` connects the channels of its connections,
/// e.g. the embedded Hyper of the shell.
export function StandaloneRuntime(props: { channels?: ChannelConnector; children?: React.ReactNode }) {
    const core = useDashQLCore();
    if (core == null) return null;
    return <StandaloneRuntimeOf core={core} channels={props.channels}>{props.children}</StandaloneRuntimeOf>;
}

function StandaloneRuntimeOf(props: { core: core.DashQL; channels?: ChannelConnector; children?: React.ReactNode }) {
    const logger = useLogger();
    const http = useHttpClient();
    const setupEmbeddedDatabase = useEmbeddedDatabaseSetup();
    const runtime = useOwnedRuntime(() => createRuntime({
        logger,
        scheduler: FRAME_UPDATE_SCHEDULER,
        core: props.core,
        http,
        computeDatabase: setupEmbeddedDatabase == null ? null : () => setupEmbeddedDatabase('compute'),
        channels: props.channels,
    }));
    return <RuntimeContextProvider value={runtime}>{props.children}</RuntimeContextProvider>;
}
