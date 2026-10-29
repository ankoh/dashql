import * as React from 'react';

import { ConnectionHealth, type ConnectionState } from '../../connections/connection_state.js';
import { connectorOfDetails } from '../../connections/connector_descriptor.js';
import { useConnectionRegistry } from '../../connections/connection_registry.js';
import { useCancelQuery, useQueryExecutor } from '../../connections/query_executor.js';
import { useSessionScriptsRegistry, type ModifySessionScripts } from './session_scripts_registry.js';
import { runSessionExecution, type SessionExecutionState } from './session_execution.js';
import { scriptConnectionIds } from './session_scripts.js';
import { QueryType } from '../../../query/query_execution_state.js';

interface ExecutionContext {
    states: Map<string, SessionExecutionState>;
    start: (sessionId: string, modify: ModifySessionScripts) => void;
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

export function sessionExecutionIsBusy(state: SessionExecutionState | null | undefined): boolean {
    return state?.phase === 'planning' || state?.phase === 'running' || state?.phase === 'stopping';
}

export function useSessionExecution(sessionId: string) {
    const context = React.useContext(CONTEXT);
    const state = context?.states.get(sessionId) ?? null;
    const start = context?.start;
    const stop = context?.stop;
    return React.useMemo(() => ({
        state,
        busy: sessionExecutionIsBusy(state),
        start: (modify: ModifySessionScripts) => start?.(sessionId, modify),
        stop: () => stop?.(sessionId),
    }), [state, start, stop, sessionId]);
}

export function SessionExecutionProvider(props: React.PropsWithChildren) {
    const [registry] = useSessionScriptsRegistry();
    const [connections] = useConnectionRegistry();
    const executeQuery = useQueryExecutor();
    const cancelQuery = useCancelQuery();
    const [states, setStates] = React.useState(new Map<string, SessionExecutionState>());
    const runs = React.useRef(new Map<string, AbortController>());
    const runningDatabases = React.useRef(new Set<string>());

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
    const latest = React.useRef({ registry, connections, executeQuery, cancelQuery });
    latest.current = { registry, connections, executeQuery, cancelQuery };

    const start = React.useCallback((sessionId: string, modifySessionScripts: ModifySessionScripts) => {
        const { registry, connections, executeQuery, cancelQuery } = latest.current;
        const session = registry.sessionScriptsMap.get(sessionId);
        if (!session || runs.current.has(sessionId) || session.scriptOrder.length === 0) return;
        // A run takes every connection of the session, all of them must be idle
        const connectionIds = scriptConnectionIds(session);
        const idle = connectionIds.every(connectionId => {
            const connection = connections.connections.get(connectionId);
            return !runningDatabases.current.has(connectionId)
                && connection?.connectionHealth === ConnectionHealth.ONLINE
                && !runsQueries(connection);
        });
        if (!idle) return;
        const controller = new AbortController();
        runs.current.set(sessionId, controller);
        for (const connectionId of connectionIds) runningDatabases.current.add(connectionId);
        void runSessionExecution({
            session,
            getSession: () => latest.current.registry.sessionScriptsMap.get(sessionId) ?? null,
            executeQuery, cancelQuery, modifySessionScripts,
            maxConcurrentQueries: connectionId => maxConcurrentQueries(connections.connections.get(connectionId)),
            signal: controller.signal,
            onState: state => setStates(previous => new Map(previous).set(sessionId, state)),
        }).finally(() => {
            runs.current.delete(sessionId);
            for (const connectionId of connectionIds) runningDatabases.current.delete(connectionId);
        });
    }, []);
    const stop = React.useCallback((id: string) => runs.current.get(id)?.abort(), []);
    const value = React.useMemo<ExecutionContext>(() => ({ states, start, stop }), [states, start, stop]);

    return <CONTEXT.Provider value={value}>
        {props.children}
    </CONTEXT.Provider>;
}
