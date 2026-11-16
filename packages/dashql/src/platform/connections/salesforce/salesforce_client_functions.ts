import type { ClientFunctionBinding } from '../connector_descriptor.js';
import { loadClientFunctionSpec } from '../clfn/clfn_specs.js';

/// The Data 360 API on Salesforce connections, see extensions/d360-api/clfn/docs/overview.md. The runtime of the core
/// sends the calls to the hosts of the connection (`salesforce/client_functions.rs` of `dashql_core_runtime`).
export const SALESFORCE_CLIENT_FUNCTIONS: ClientFunctionBinding = {
    loadSpec: () => loadClientFunctionSpec('d360-api'),
};
