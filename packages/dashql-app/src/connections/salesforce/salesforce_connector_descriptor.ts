import type { ConnectorDescriptor } from '../connector_descriptor.js';
import { CONNECTOR_INFOS, ConnectorType, SALESFORCE_DATA_CLOUD_CONNECTOR, SIDB_CONNECTOR } from '../connector_info.js';
import { SALESFORCE_CATALOG_DATABASE, SALESFORCE_CATALOG_SCHEMA, SIDB_DEFAULT_DATABASE_NAME } from './salesforce_catalog_update.js';
import { createSalesforceConnectionStateDetails, reduceSalesforceConnectionState } from './salesforce_connection_state.js';
import { queryParam, requireChannel } from '../query_channel.js';
import { loadClientFunctionSpec } from '../clfn/clfn_specs.js';

/// Salesforce Data Cloud connections
export const SALESFORCE_CONNECTOR_DESCRIPTOR: ConnectorDescriptor<'salesforce'> = {
    info: CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD],
    paramsKey: 'salesforce',
    detailsType: SALESFORCE_DATA_CLOUD_CONNECTOR,
    defaultParams: () => ({ instanceUrl: '', appConsumerKey: '', appConsumerSecret: '', login: '' }),
    createDetails: createSalesforceConnectionStateDetails,
    reduce: reduceSalesforceConnectionState,
    withoutDraftRows: params => params,
    // Keep instanceUrl, appConsumerKey and the login hint; drop the connected-app secret.
    sanitizeForSharing: (params, withLoginHint) => ({ ...params, appConsumerSecret: "", ...(withLoginHint ? {} : { login: "" }) }),
    loginHint: params => params.login || null,
    // The login stays out, another user of the same org reuses the cached results
    cacheSignature: params => ({
        case: "salesforce",
        instanceUrl: params.instanceUrl,
        appConsumerKey: params.appConsumerKey,
    }),
    catalogNameDefaults: () => ({ databaseName: SALESFORCE_CATALOG_DATABASE, schemaName: SALESFORCE_CATALOG_SCHEMA }),
    executeQuery: (details, args, abort) => requireChannel(args.channelOverride?.type === 'salesforce' ? args.channelOverride.channel : details.channel, 'Salesforce')
        .executeQuery(queryParam(args), abort),
    maxConcurrentQueries: () => 1,
    catalogIsDurable: () => true,
    readsAttachments: () => false,
    clientFunctions: { loadSpec: () => loadClientFunctionSpec('d360-api') },
};

/// SIDB connections, they behave like Salesforce Data Cloud connections for now
export const SIDB_CONNECTOR_DESCRIPTOR: ConnectorDescriptor<'sidb'> = {
    ...SALESFORCE_CONNECTOR_DESCRIPTOR,
    info: CONNECTOR_INFOS[ConnectorType.SIDB],
    paramsKey: 'sidb',
    detailsType: SIDB_CONNECTOR,
    defaultParams: () => ({ ...SALESFORCE_CONNECTOR_DESCRIPTOR.defaultParams(), databaseName: SIDB_DEFAULT_DATABASE_NAME }),
    // It isn't known whether SIDB has the Data 360 API
    clientFunctions: undefined,
    cacheSignature: params => ({
        ...SALESFORCE_CONNECTOR_DESCRIPTOR.cacheSignature(params) as object,
        case: "sidb",
        databaseName: params.databaseName || SIDB_DEFAULT_DATABASE_NAME,
    }),
    executeQuery: (details, args, abort) => requireChannel(args.channelOverride?.type === 'salesforce' ? args.channelOverride.channel : details.channel, 'SIDB')
        .executeQuery(queryParam(args), abort),
};
