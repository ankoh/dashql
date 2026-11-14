import type { ClientFunctionBinding } from '../connector_descriptor.js';
import { ClientFunctionError } from '../clfn/clfn_spec.js';
import { loadClientFunctionSpec } from '../clfn/clfn_specs.js';
import { requireChannel } from '../query_channel.js';
import type { SalesforceConnectionStateDetails } from './salesforce_connection_state.js';

/// The API version of the Data 360 spec
const DATA_360_API_VERSION = '68.0';

/// The host and the token of a request
function target(instanceUrl: string | undefined, token: string | undefined, host: string) {
    if (!instanceUrl || !token) {
        throw new ClientFunctionError(`the Salesforce connection has no URL or token for the host ${host}`);
    }
    return {
        baseUrl: new URL(instanceUrl),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    };
}

/// The Data 360 API on Salesforce connections, see extensions/d360-api/clfn/docs/overview.md.
///
/// The sources conflict on `connect`. It takes the core host and token, as the metadata calls of the connection do,
/// until a check on an org settles it.
export const SALESFORCE_CLIENT_FUNCTIONS: ClientFunctionBinding<SalesforceConnectionStateDetails> = {
    loadSpec: () => loadClientFunctionSpec('d360-api'),
    variables: () => ({ api_version: DATA_360_API_VERSION }),
    resolveHost: async (details, host) => {
        const { coreToken, dataCloudToken } = requireChannel(details.channel, 'Salesforce');
        switch (host) {
            case 'core':
            case 'connect':
                return target(coreToken.instanceUrl, coreToken.accessToken, host);
            case 'tenant':
                // The service would only answer with a 401
                if (Date.parse(dataCloudToken.expiresAt) <= Date.now()) {
                    throw new ClientFunctionError('the Data 360 token of the Salesforce connection has expired, connect again');
                }
                return target(dataCloudToken.instanceUrl, dataCloudToken.jwt?.raw, host);
            default:
                throw new ClientFunctionError(`Salesforce connections have no host ${host}`);
        }
    },
};
