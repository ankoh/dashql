import type * as core from '../../../core/index.js';
import type { Runtime } from '../../runtime.js';
import type { EmbeddedConnection } from '../../../platform/platform/database/embedded_database.js';
import type { EmbeddedHyperDatabaseChannel } from '../../../platform/connections/embedded/embedded_database_channel.js';
import { newDefaultHyperWasmConnection } from '../../../platform/connections/connection_params.js';

/// How long a statement waits for the catalog at most, the catalog loader of a connection that went offline answers
/// nothing
const SETTLE_TIMEOUT_MS = 10000;

/// Has the catalog loader answered the relations that statements touched, with no update running?
function catalogSettled(runtime: Runtime, connectionId: string): boolean {
    const updates = runtime.connection(connectionId)?.catalogUpdates;
    return updates == null || (updates.touchedRelations.length === 0 && updates.tasksRunning.length === 0);
}

/// Resolve once the catalog of a connection settled: no update runs and every relation that statements touched is
/// answered. Resolves after the timeout as well, a catalog that doesn't follow never fails a statement.
export function waitForCatalog(runtime: Runtime, connectionId: string, timeoutMs = SETTLE_TIMEOUT_MS): Promise<void> {
    if (catalogSettled(runtime, connectionId)) return Promise.resolve();
    return new Promise(resolve => {
        let unsubscribe = () => { };
        const done = () => {
            clearTimeout(timer);
            unsubscribe();
            resolve();
        };
        const timer = setTimeout(done, timeoutMs);
        unsubscribe = runtime.store.subscribe('connection', connectionId, () => {
            if (catalogSettled(runtime, connectionId)) done();
        });
        // The loader may have answered between the check and the subscription
        if (catalogSettled(runtime, connectionId)) done();
    });
}

/// Let the catalog of a connection follow a statement that the host ran on the connection itself, e.g. a statement
/// of the shell: the catalog loader asks the connection about the relations that the statement touched, like after a
/// statement of the query executor. Also after a failure, a statement of many may have run. Resolves once the catalog
/// settled.
export async function followStatement(runtime: Runtime, connectionId: string, statement: string, timeoutMs = SETTLE_TIMEOUT_MS): Promise<void> {
    const core = runtime.core;
    if (core == null) return;
    const names = core.touchedRelations(statement).map(name => ({
        databaseName: String(name.databaseName ?? '') || null,
        schemaName: String(name.schemaName ?? '') || null,
        tableName: String(name.tableName ?? '') || null,
    }));
    if (names.length === 0) return;
    runtime.dispatch({ connection: connectionId }, { kind: 'relationsTouched', value: { names } });
    await waitForCatalog(runtime, connectionId, timeoutMs);
}

/// A connection of a runtime to the embedded Hyper whose session the host uses for statements of its own, e.g. the
/// shell. The catalog loader sees what they did, temporary tables and attached databases too.
export interface EmbeddedSession {
    connectionId: string;
    /// The session of the statements of the host, they take their turns with the queries of the runtime
    session: EmbeddedConnection;
    /// The catalog of the connection, the catalog loader of the runtime fills it
    catalog: core.DashQLCatalog;
    /// Let the catalog follow a statement that ran on the session, see `followStatement`
    follow(statement: string): Promise<void>;
    /// Stop the connection, its channel closes the session. The runtime keeps the connection to the embedded Hyper, a
    /// later session sets it up again. A session that a later one replaced leaves the connection to it.
    close(): void;
}

/// The latest session of a connection by runtime, an earlier session that closes leaves the connection alone, e.g. a
/// shell that unmounts while its successor sets up
const LATEST_SESSIONS = new WeakMap<Runtime, Map<string, number>>();

/// Set up a connection to the embedded Hyper by its id, the platform connects its channel. The connection is created
/// unless the runtime holds it, e.g. from a session that was closed. Resolves once its catalog is loaded.
export async function connectEmbeddedSession(runtime: Runtime, connectionId: string): Promise<EmbeddedSession> {
    let latest = LATEST_SESSIONS.get(runtime);
    if (latest == null) {
        latest = new Map();
        LATEST_SESSIONS.set(runtime, latest);
    }
    const generation = (latest.get(connectionId) ?? 0) + 1;
    latest.set(connectionId, generation);
    if (runtime.connection(connectionId) == null) runtime.createConnection(newDefaultHyperWasmConnection(), connectionId);
    const close = () => {
        if (latest.get(connectionId) !== generation) return;
        runtime.dispatch({ connection: connectionId }, { kind: 'resetConnection' });
    };
    try {
        const outcome = await runtime.setupConnection(connectionId);
        if (outcome.status !== 'succeeded') throw new Error(outcome.message ?? `the setup of the connection ${outcome.status}`);
        const channel = runtime.channel<EmbeddedHyperDatabaseChannel>(runtime.connection(connectionId));
        const catalog = runtime.catalog(connectionId);
        if (channel == null || catalog == null) throw new Error('the connection to the embedded Hyper has no channel');
        await waitForCatalog(runtime, connectionId);
        return {
            connectionId,
            session: channel.session(),
            catalog,
            follow: statement => followStatement(runtime, connectionId, statement),
            close,
        };
    } catch (error) {
        close();
        throw error;
    }
}
