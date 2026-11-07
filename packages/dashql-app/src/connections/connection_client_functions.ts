import type { DashQLCatalog } from '@ankoh/dashql-core';

import type { HttpClient } from '../platform/http/http_client.js';
import type { Logger } from '../platform/logger/logger.js';
import type { QueryExecutionResponseStream } from '../query/query_execution_state.js';
import { ClientFunctionResultStream } from './clfn/clfn_result_stream.js';
import { explainClientFunctionCall, runClientFunctionCall } from './clfn/clfn_runtime.js';
import { ClientFunctionError, type ClientFunctionCallDescription } from './clfn/clfn_spec.js';
import type { ConnectionStateDetailsVariant } from './connection_state_details.js';
import type { ConnectionState } from './connection_state.js';
import { connectorOfDetails, type ClientFunctionBinding } from './connector_descriptor.js';

const LOG_CTX = 'connection_client_functions';

/// What a catalog holds of a binding
interface Registration {
    /// The binding
    binding: ClientFunctionBinding;
    /// The namespace, null while the spec loads or if it failed to load
    namespace: string | null;
}
/// The registrations of the catalogs. A catalog belongs to one connection, and clearing it keeps its specs.
const REGISTRATIONS = new WeakMap<DashQLCatalog, Registration>();

/// Make the catalog of a connection hold the client functions of its connector.
/// `onDidUpdate` is called when they changed, the scripts of the connection are then outdated.
export function ensureConnectionClientFunctions(
    connections: ReadonlyMap<string, ConnectionState>,
    connectionId: string,
    onDidUpdate: (connectionId: string) => void,
    logger: Logger,
): void {
    const connection = connections.get(connectionId);
    if (connection == null) return;
    const { catalog } = connection;
    const binding = connectorOfDetails(connection.details).clientFunctions ?? null;
    const registered = REGISTRATIONS.get(catalog) ?? null;
    if ((registered?.binding ?? null) === binding) return;

    // The connection switched its connector
    if (registered != null) {
        REGISTRATIONS.delete(catalog);
        if (registered.namespace != null) {
            catalog.dropClientFunctions(registered.namespace);
            onDidUpdate(connectionId);
        }
    }
    if (binding == null) return;

    const registration: Registration = { binding, namespace: null };
    REGISTRATIONS.set(catalog, registration);
    void (async () => {
        try {
            const spec = await binding.loadSpec();
            // The connection may be gone by now, or have switched its connector
            if (connections.get(connectionId)?.catalog !== catalog || REGISTRATIONS.get(catalog) !== registration) return;
            registration.namespace = catalog.registerClientFunctions(JSON.stringify(spec));
            onDidUpdate(connectionId);
        } catch (error) {
            // It stays unregistered: a script then gets no checks and no completion, and a call goes to the backend
            logger.error('Failed to register client functions', { connectionId, error: String(error) }, LOG_CTX);
        }
    })();
}

/// What the client function calls of the app use
export interface ClientFunctionServices {
    http: HttpClient;
    logger: Logger;
}

/// Execute a client function call of a connection. The result is complete once the stream exists: a call with several
/// pages has its pages by then, and `EXPLAIN` has sent nothing.
export async function executeConnectionClientFunction(
    details: ConnectionStateDetailsVariant,
    description: ClientFunctionCallDescription,
    services: ClientFunctionServices,
    abort?: AbortSignal,
): Promise<QueryExecutionResponseStream> {
    const connector = connectorOfDetails(details);
    const binding = connector.clientFunctions;
    if (binding == null) {
        throw new ClientFunctionError(`${connector.info.names.displayLong} connections have no client functions`);
    }
    const spec = await binding.loadSpec();
    if (spec.namespace !== description.namespace) {
        throw new ClientFunctionError(`${connector.info.names.displayLong} connections have no client functions in ${description.namespace}`);
    }
    const variables = () => binding.variables(details.value);
    const result = description.explain
        ? await explainClientFunctionCall(spec, description, { variables })
        : await runClientFunctionCall(spec, description, {
            http: services.http,
            resolveHost: host => binding.resolveHost(details.value, host),
            variables,
        }, abort);
    return new ClientFunctionResultStream(services.logger, result);
}
