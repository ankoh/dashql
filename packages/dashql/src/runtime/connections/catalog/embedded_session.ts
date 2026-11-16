import type * as core from '../../../core/index.js';
import type { Runtime } from '../../runtime.js';
import { newDefaultHyperWasmConnection } from '../../../platform/connections/connection_params.js';

/// A connection of a runtime to the embedded Hyper that the host runs statements on, e.g. the shell. The statements
/// run with `runtime.execute` on the connection, the query executor tells the catalog loader about the relations they
/// touched, temporary tables and attached databases too.
export interface EmbeddedSession {
    connectionId: string;
    /// The catalog of the connection, the catalog loader of the runtime fills it
    catalog: core.DashQLCatalog;
    /// Stop the connection, its channel closes the session of the embedded Hyper. The runtime keeps the connection, a
    /// later session sets it up again. A session that a later one replaced leaves the connection to it.
    close(): void;
}

/// Set up a connection to the embedded Hyper by its id, the platform connects its channel. The connection is created
/// unless the runtime holds it, e.g. from a session that was closed. The session leases the connection, a later session
/// takes it over (`openSession` of the runtime). Resolves once its catalog settled.
export async function connectEmbeddedSession(runtime: Runtime, connectionId: string): Promise<EmbeddedSession> {
    const lease = runtime.openSession(connectionId);
    if (runtime.connection(connectionId) == null) runtime.createConnection(newDefaultHyperWasmConnection(), connectionId);
    const close = () => runtime.closeSession(connectionId, lease);
    try {
        const outcome = await runtime.setupConnection(connectionId);
        if (outcome.status !== 'succeeded') throw new Error(outcome.message ?? `the setup of the connection ${outcome.status}`);
        const catalog = runtime.catalog(connectionId);
        if (catalog == null) throw new Error('the connection to the embedded Hyper has no catalog');
        await runtime.settleCatalog(connectionId);
        return { connectionId, catalog, close };
    } catch (error) {
        close();
        throw error;
    }
}
