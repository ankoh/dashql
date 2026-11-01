import * as React from 'react';

import { ConnectionHealth, connectionCachesQueryResults, type ConnectionState } from '../../connections/connection_state.js';
import { connectorOfDetails } from '../../connections/connector_descriptor.js';
import { useConnectionRegistry } from '../../connections/connection_registry.js';
import { useCancelQuery, useQueryExecutor } from '../../connections/query_executor.js';
import { useSessionScriptsRegistry, useSessionScriptsRegistryReader, type ModifySessionScripts } from './session_scripts_registry.js';
import { createExecutionMounts, isSessionExecutionRunning, runSessionExecution, subscribeSessionExecutions, type SessionExecutionState } from './session_execution.js';
import { useComputeDatabase } from '../../compute/compute_connection_provider.js';
import { supportsParquet } from '../../platform/hyperdb/hyperdb_parquet_export.js';
import { registerScriptRunServices, type ScriptRunServices } from './script_run.js';
import { computeQueryCacheKeyForConnection } from '../../connections/query_executor.js';
import { useQueryResultCache } from '../../storage/query_result_cache_provider.js';
import { scriptConnectionIds } from './session_scripts.js';
import { QueryType } from '../../query/query_execution_state.js';
import { useLogger } from '../../platform/logger/logger_provider.js';

/// The options of a run of a session
export interface SessionExecutionOptions {
    /// Run the scripts that a change of these inputs affects. A run that holds the session stops, the run starts
    /// once the session is free, with the inputs of every change since.
    inputs?: readonly string[];
}

interface ExecutionContext {
    states: Map<string, SessionExecutionState>;
    start: (sessionId: string, modify: ModifySessionScripts, options?: SessionExecutionOptions) => void;
    stop: (sessionId: string) => void;
}

const CONTEXT = React.createContext<ExecutionContext | null>(null);

/// The number of statements of a session run that a connection executes at once
function maxConcurrentQueries(connection: ConnectionState | undefined): number {
    return connection == null ? 1 : connectorOfDetails(connection.details).maxConcurrentQueries(connection.details.value);
}

/// Does a connection run a query? The SQLFrame queries of computations run on the compute database,
/// the connection only tracks them.
function runsQueries(connection: ConnectionState): boolean {
    for (const query of connection.queriesActive.values()) {
        if (query.queryMetadata.queryType !== QueryType.INTERNAL_SQLFRAME) return true;
    }
    return false;
}

/// The attempts to wait for a run of a session to leave its connections
const FREE_ATTEMPTS = 50;
const FREE_INTERVAL_MS = 100;

/// Wait until a session is free for a run: no run holds it and its connections are idle. Gives up after a while, a
/// connection may stay busy.
function whenSessionFree(isFree: () => boolean): Promise<boolean> {
    return new Promise(resolve => {
        let attempts = 0;
        const check = () => {
            if (isFree()) {
                resolve(true);
            } else if (++attempts > FREE_ATTEMPTS) {
                resolve(false);
            } else {
                setTimeout(check, FREE_INTERVAL_MS);
            }
        };
        check();
    });
}

export function sessionExecutionIsBusy(state: SessionExecutionState | null | undefined): boolean {
    return state?.phase === 'planning' || state?.phase === 'running' || state?.phase === 'stopping';
}

/// The run of a session. `busy` while the whole session runs, `runActive` while any run holds the session, a run of
/// the session or of one of its scripts: the session starts no other run then.
export function useSessionExecution(sessionId: string) {
    const context = React.useContext(CONTEXT);
    const state = context?.states.get(sessionId) ?? null;
    const start = context?.start;
    const stop = context?.stop;
    const held = React.useSyncExternalStore(subscribeSessionExecutions, () => isSessionExecutionRunning(sessionId));
    return React.useMemo(() => {
        const busy = sessionExecutionIsBusy(state);
        return {
            state,
            busy,
            runActive: busy || held,
            start: (modify: ModifySessionScripts, options?: SessionExecutionOptions) => start?.(sessionId, modify, options),
            stop: () => stop?.(sessionId),
        };
    }, [state, held, start, stop, sessionId]);
}

export function SessionExecutionProvider(props: React.PropsWithChildren) {
    const [registry] = useSessionScriptsRegistry();
    // The registry as the last update left it, also before the next render
    const readRegistry = useSessionScriptsRegistryReader();
    const [connections] = useConnectionRegistry();
    const executeQuery = useQueryExecutor();
    const cancelQuery = useCancelQuery();
    const computeDb = useComputeDatabase();
    const queryResultCache = useQueryResultCache();
    const logger = useLogger();
    const [states, setStates] = React.useState(new Map<string, SessionExecutionState>());
    const runs = React.useRef(new Map<string, AbortController>());
    const runningDatabases = React.useRef(new Set<string>());
    // The input changes that wait for the session, by session id
    const pendingInputs = React.useRef(new Map<string, { modify: ModifySessionScripts; inputs: Set<string> }>());

    React.useEffect(() => () => {
        for (const controller of runs.current.values()) controller.abort();
    }, []);
    React.useEffect(() => {
        for (const [id, controller] of runs.current) {
            const session = registry.sessionScriptsMap.get(id);
            if (!session || scriptConnectionIds(session).some(connectionId =>
                connections.connections.get(connectionId)?.connectionHealth !== ConnectionHealth.ONLINE)) {
                controller.abort();
            }
        }
    }, [registry, connections]);

    // The provider re-renders with every registry change.
    // Keep the context value stable and read the latest registries when an execution starts.
    const latest = React.useRef({ registry, connections, executeQuery, cancelQuery, computeDb, queryResultCache, logger });
    latest.current = { registry, connections, executeQuery, cancelQuery, computeDb, queryResultCache, logger };

    // A run of a script plans it with the scripts it references, the services read the latest registries
    const runServices = React.useMemo<ScriptRunServices>(() => ({
        createMounts: () => {
            const { computeDb, queryResultCache } = latest.current;
            return queryResultCache != null && supportsParquet(computeDb) ? createExecutionMounts(queryResultCache, computeDb) : null;
        },
        cacheKey: async (connectionId, signature) => {
            const connection = latest.current.connections.connections.get(connectionId);
            return connection == null ? null : await computeQueryCacheKeyForConnection(connection.details, signature);
        },
        cachesResults: connectionId => {
            const connection = latest.current.connections.connections.get(connectionId);
            return connection != null && connectionCachesQueryResults(connection);
        },
        get cache() { return latest.current.queryResultCache; },
        maxConcurrentQueries: connectionId => maxConcurrentQueries(latest.current.connections.connections.get(connectionId)),
        liveSession: sessionId => (readRegistry?.() ?? latest.current.registry).sessionScriptsMap.get(sessionId) ?? null,
    }), [readRegistry]);
    React.useEffect(() => {
        const instances = new Set([...registry.sessionScriptsMap.values()].map(session => session.instance));
        for (const instance of instances) registerScriptRunServices(instance, runServices);
        return () => {
            for (const instance of instances) registerScriptRunServices(instance, null);
        };
    }, [registry, runServices]);

    const startRef = React.useRef<(sessionId: string, modify: ModifySessionScripts, options?: SessionExecutionOptions) => void>(() => {});
    const start = React.useCallback((sessionId: string, modifySessionScripts: ModifySessionScripts, options?: SessionExecutionOptions) => {
        const { connections, executeQuery, cancelQuery, computeDb, queryResultCache, logger } = latest.current;
        // The registry as the last update left it, an input change starts its run right after writing its tags
        const registry = readRegistry?.() ?? latest.current.registry;
        const session = registry.sessionScriptsMap.get(sessionId);
        if (!session || session.scriptOrder.length === 0) return;
        // A run takes every connection of the session, all of them must be idle
        const connectionIds = scriptConnectionIds(session);
        const isFree = () => {
            const connections = latest.current.connections;
            return !runs.current.has(sessionId) && !isSessionExecutionRunning(sessionId) && connectionIds.every(connectionId => {
                const connection = connections.connections.get(connectionId);
                return !runningDatabases.current.has(connectionId)
                    && connection?.connectionHealth === ConnectionHealth.ONLINE
                    && !runsQueries(connection);
            });
        };
        if (options?.inputs != null) {
            const pending = pendingInputs.current.get(sessionId);
            const inputs = new Set([...(pending?.inputs ?? []), ...options.inputs]);
            if (pending != null || !isFree()) {
                // The latest values win: stop the run that holds the session and start once the session is free
                pendingInputs.current.set(sessionId, { modify: modifySessionScripts, inputs });
                runs.current.get(sessionId)?.abort();
                if (pending == null) {
                    void whenSessionFree(isFree).then(free => {
                        const next = pendingInputs.current.get(sessionId);
                        pendingInputs.current.delete(sessionId);
                        if (next != null && free) startRef.current(sessionId, next.modify, { inputs: [...next.inputs] });
                    });
                }
                return;
            }
            options = { inputs: [...inputs] };
        }
        if (!isFree()) return;
        const controller = new AbortController();
        runs.current.set(sessionId, controller);
        for (const connectionId of connectionIds) runningDatabases.current.add(connectionId);
        void runSessionExecution({
            session,
            getSession: () => (readRegistry?.() ?? latest.current.registry).sessionScriptsMap.get(sessionId) ?? null,
            inputs: options?.inputs,
            executeQuery, cancelQuery, modifySessionScripts,
            maxConcurrentQueries: connectionId => maxConcurrentQueries(connections.connections.get(connectionId)),
            // The embedded Hyper scans the results of the scripts of other connections, mounted from the compute database
            mounts: queryResultCache != null && supportsParquet(computeDb) ? createExecutionMounts(queryResultCache, computeDb) : null,
            resultKey: runServices.cacheKey,
            cachesResults: runServices.cachesResults,
            cache: queryResultCache,
            signal: controller.signal,
            logger,
            onState: state => setStates(previous => new Map(previous).set(sessionId, state)),
        }).finally(() => {
            runs.current.delete(sessionId);
            for (const connectionId of connectionIds) runningDatabases.current.delete(connectionId);
        });
    }, [runServices, readRegistry]);
    startRef.current = start;
    const stop = React.useCallback((id: string) => runs.current.get(id)?.abort(), []);
    const value = React.useMemo<ExecutionContext>(() => ({ states, start, stop }), [states, start, stop]);

    return <CONTEXT.Provider value={value}>
        {props.children}
    </CONTEXT.Provider>;
}
