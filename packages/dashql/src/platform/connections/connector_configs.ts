import * as connection from '@akohn/dashql-jsonschema/connection.js';

import { SalesforceConnectorMockConfig } from './salesforce/salesforce_api_client_mock.js';

export interface SalesforceConnectorConfig {
    /// The connector auth config
    auth?: connection.SalesforceOAuthConfig;
    /// The mock config
    mock?: SalesforceConnectorMockConfig;
}

/// The configs of the connectors that have one
export interface ConnectorConfigs {
    /// The config for the Salesforce Data Cloud connector
    salesforce?: SalesforceConnectorConfig;
}
