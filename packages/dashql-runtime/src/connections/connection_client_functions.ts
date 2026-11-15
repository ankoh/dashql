import type { HttpClient } from '../platform/http/http_client.js';
import type { Logger } from '../platform/logger/logger.js';
import type { QueryExecutionResponseStream } from '../query/query_execution_state.js';
import { ClientFunctionResultStream } from './clfn/clfn_result_stream.js';
import { explainClientFunctionCall, runClientFunctionCall } from './clfn/clfn_runtime.js';
import { ClientFunctionError, type ClientFunctionCallDescription } from './clfn/clfn_spec.js';
import type { ConnectionStateDetailsVariant } from './connection_state_details.js';
import { connectorOfDetails } from './connector_descriptor.js';

// The client functions of a connection are registered on its catalog by the catalog loader of the Rust runtime
// (`dashql_core_runtime::catalog_loader::service`, `clfn/connection.rs`).

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
