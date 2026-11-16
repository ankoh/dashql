import type * as core from '@ankoh/dashql';
import type { Runtime } from '@ankoh/dashql/runtime/runtime';
import type { QueryMetadata } from '@ankoh/dashql/platform/query/query_execution_state';
import type { ConnectionParams } from '@ankoh/dashql/platform/connections/connection_params';
import { ConnectionHealth, setupStepAction, type ConnectionState } from '@ankoh/dashql/platform/connections/connection_state';
import { createTestConnection, reduceTestConnection } from '@ankoh/dashql/runtime/testing/connection_fixtures';

/// A connection of a test of the app, created in the runtime of the app
export interface TestConnectionSpec {
    connectionId: string;
    params: ConnectionParams;
    name?: string;
    active?: boolean;
    /// The health, not started by default. An online connection gets a channel.
    health?: ConnectionHealth;
    /// The error of a failed connection
    error?: string;
    /// The channel of an online connection, one that only closes by default
    channel?: object;
}

/// Create a connection of a test in the runtime of the app with a health, returns its view
export function addTestConnection(runtime: Runtime, spec: TestConnectionSpec): ConnectionState {
    const online = spec.health === ConnectionHealth.ONLINE;
    const created = createTestConnection(runtime, {
        connectionId: spec.connectionId,
        params: spec.params,
        name: spec.name,
        active: spec.active,
        channel: online ? (spec.channel ?? { close: () => { } }) : undefined,
    });
    return setTestConnectionHealth(runtime, created.connectionId, spec.health ?? ConnectionHealth.NOT_STARTED, spec.error) ?? created;
}

/// Bring a connection of a test to a health, returns its view
export function setTestConnectionHealth(runtime: Runtime, connectionId: string, health: ConnectionHealth, error?: string): ConnectionState | null {
    const current = runtime.connection(connectionId);
    if (current == null || current.connectionHealth === health) return current;
    const state = { connectionId };
    switch (health) {
        case ConnectionHealth.ONLINE:
            return reduceTestConnection(runtime, state, setupStepAction('HEALTH_CHECK_SUCCEEDED'));
        case ConnectionHealth.FAILED:
            return reduceTestConnection(runtime, state, setupStepAction('HEALTH_CHECK_FAILED', { message: error ?? 'failed' }));
        case ConnectionHealth.CONNECTING:
            return reduceTestConnection(runtime, state, setupStepAction('HEALTH_CHECK_STARTED'));
        default:
            return current;
    }
}

/// Track a query of a test in a history of the runtime: a connection or a history without one. A finished query
/// succeeded. Returns its id.
export function trackTestQuery(runtime: Runtime, target: core.Target, text: string, metadata: QueryMetadata, finished: boolean): number {
    const tracked = runtime.dispatch(target, { kind: 'trackQuery', value: { traceId: 1, text, metadata: metadata as core.QueryMetadataView } });
    if (!tracked.ok || typeof tracked.id !== 'number') throw new Error(tracked.error ?? 'the query was not tracked');
    const queryId = tracked.id;
    runtime.dispatch(target, { kind: 'queryRunning', value: { queryId } });
    if (finished) runtime.dispatch(target, { kind: 'querySucceeded', value: { queryId } });
    runtime.flush();
    return queryId;
}

/// Add the connections of fakes of a test to the runtime: their ids, params, names and health
export function addTestConnections(runtime: Runtime, connections: readonly Pick<ConnectionState, 'connectionId' | 'params' | 'connectionHealth' | 'name' | 'active'>[]): ConnectionState[] {
    return connections.map(connection => addTestConnection(runtime, {
        connectionId: connection.connectionId,
        params: connection.params,
        name: connection.name ?? undefined,
        active: connection.active,
        health: connection.connectionHealth,
    }));
}
