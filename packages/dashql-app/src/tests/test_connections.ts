import type * as core from '@akohn/dashql';
import type { Runtime } from '@akohn/dashql/runtime/runtime';
import type { ConnectionParams } from '@akohn/dashql/platform/connections/connection_params';
import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { createTestConnection, setupTestConnection } from '@akohn/dashql/runtime/testing/connection_fixtures';

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

/// Create a connection of a test in the runtime of the app with a health, returns its view. The runtime sets up a
/// connection that isn't new with a channel of the test, see `setupTestConnection`.
export async function addTestConnection(runtime: Runtime, spec: TestConnectionSpec): Promise<ConnectionState> {
    const created = await createTestConnection(runtime, {
        connectionId: spec.connectionId,
        params: spec.params,
        name: spec.name,
        active: spec.active,
    });
    return await setTestConnectionHealth(runtime, created.connectionId, spec.health ?? ConnectionHealth.NOT_STARTED, spec.error, spec.channel) ?? created;
}

/// Bring a connection of a test to a health with a setup of the runtime, returns its view
export async function setTestConnectionHealth(runtime: Runtime, connectionId: string, health: ConnectionHealth, error?: string, channel?: object): Promise<ConnectionState | null> {
    const current = runtime.connection(connectionId);
    if (current == null || current.connectionHealth === health) return current;
    switch (health) {
        case ConnectionHealth.ONLINE:
        case ConnectionHealth.FAILED:
        case ConnectionHealth.CONNECTING:
            return await setupTestConnection(runtime, connectionId, { channel, health, error });
        default:
            return current;
    }
}

/// Run a query of a test on a connection with the query executor of the module, past the query commands that a test
/// replaces. A finished query fails before it runs, like a statement whose plan failed; an active one runs on the
/// channel of the connection until it is cancelled, e.g. on a `pendingTestChannel`. Returns its id.
export function runTestQuery(runtime: Runtime, connectionId: string, text: string, metadata: core.QueryMetadataView, finished: boolean): number {
    const failure = finished ? new Error('the query of the test ended') : undefined;
    const ticket = runtime.module.executeQuery(connectionId, { text, metadata, traceId: 1 }, failure, null);
    void ticket.done.catch(() => { });
    runtime.flush();
    return ticket.queryId;
}

/// A channel of a test whose queries run until they are cancelled
export function pendingTestChannel(): object {
    return {
        executeQuery: (_params: unknown, abort?: AbortSignal) => new Promise((_resolve, reject) => {
            abort?.addEventListener('abort', () => reject(abort.reason), { once: true });
        }),
        close: () => { },
    };
}

/// Add the connections of fakes of a test to the runtime: their ids, params, names and health
export async function addTestConnections(runtime: Runtime, connections: readonly Pick<ConnectionState, 'connectionId' | 'params' | 'connectionHealth' | 'name' | 'active'>[]): Promise<ConnectionState[]> {
    const added: ConnectionState[] = [];
    for (const connection of connections) {
        added.push(await addTestConnection(runtime, {
            connectionId: connection.connectionId,
            params: connection.params,
            name: connection.name ?? undefined,
            active: connection.active,
            health: connection.connectionHealth,
        }));
    }
    return added;
}
