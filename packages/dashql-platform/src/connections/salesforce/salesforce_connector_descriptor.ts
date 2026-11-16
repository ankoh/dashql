import type { ConnectorDescriptor } from '../connector_descriptor.js';
import { CONNECTOR_INFOS, ConnectorType } from '../connector_info.js';
import { HYPER_CLOUD_DEFAULT_DATABASE_NAME } from './salesforce_catalog_update.js';
import { SALESFORCE_CLIENT_FUNCTIONS } from './salesforce_client_functions.js';

/// Salesforce Data Cloud connections
export const SALESFORCE_CONNECTOR_DESCRIPTOR: ConnectorDescriptor<'salesforce'> = {
    info: CONNECTOR_INFOS[ConnectorType.SALESFORCE_DATA_CLOUD],
    paramsKey: 'salesforce',
    defaultParams: () => ({ instanceUrl: '', appConsumerKey: '', appConsumerSecret: '', login: '' }),
    withoutDraftRows: params => params,
    // Keep instanceUrl, appConsumerKey and the login hint; drop the connected-app secret.
    sanitizeForSharing: (params, withLoginHint) => ({ ...params, appConsumerSecret: "", ...(withLoginHint ? {} : { login: "" }) }),
    loginHint: params => params.login || null,
    maxConcurrentQueries: () => 1,
    catalogIsDurable: () => true,
    readsAttachments: () => false,
    clientFunctions: SALESFORCE_CLIENT_FUNCTIONS,
};

/// Database.com connections, they behave like Salesforce Data Cloud connections for now
export const DBCOM_CONNECTOR_DESCRIPTOR: ConnectorDescriptor<'dbcom'> = {
    ...SALESFORCE_CONNECTOR_DESCRIPTOR,
    info: CONNECTOR_INFOS[ConnectorType.DBCOM],
    paramsKey: 'dbcom',
    defaultParams: () => ({ ...SALESFORCE_CONNECTOR_DESCRIPTOR.defaultParams(), databaseName: HYPER_CLOUD_DEFAULT_DATABASE_NAME }),
    // It isn't known whether Database.com has the Data 360 API
    clientFunctions: undefined,
};
