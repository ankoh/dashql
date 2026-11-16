import * as React from 'react';

import { SalesforceApiClient, SalesforceApiClientInterface } from '@ankoh/dashql-platform/connections/salesforce/salesforce_api_client';
import { SalesforceAPIClientMock } from '@ankoh/dashql-platform/connections/salesforce/salesforce_api_client_mock';
import type { SalesforceConnectorConfig } from '@ankoh/dashql-platform/connections/connector_configs';
import { useAppConfig } from '../../config/app_config.js';
import { useHttpClient } from '../../platform/http/http_client_provider.js';
import { useLogger } from '../../platform/logger/logger_provider.js';

/// The mock of Salesforce that the config of the app chose, the setups run without an OAuth flow and without requests
export interface SalesforceMock {
    api: SalesforceApiClientInterface;
    config: SalesforceConnectorConfig;
}

const API_CTX = React.createContext<SalesforceApiClientInterface | null>(null);
const MOCK_CTX = React.createContext<SalesforceMock | null>(null);

interface Props {
    children: React.ReactElement;
}

/// The API of Salesforce of the app: the client over the HTTP client, or the mock that the config chose. The runtime
/// sets up the connections, the API answers the metadata of the mock.
export const SalesforceConnector: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const config = useAppConfig();
    const connectorConfig = config?.connectors?.salesforce;
    const httpClient = useHttpClient();

    const [api, mock] = React.useMemo((): [SalesforceApiClientInterface | null, SalesforceMock | null] => {
        if (!connectorConfig) {
            return [null, null];
        } else if (connectorConfig.mock?.enabled) {
            const api = new SalesforceAPIClientMock(connectorConfig.mock);
            return [api, { api, config: connectorConfig }];
        } else if (!httpClient) {
            return [null, null];
        } else {
            return [new SalesforceApiClient(logger, httpClient), null];
        }
    }, [connectorConfig, httpClient]);

    return (
        <API_CTX.Provider value={api}>
            <MOCK_CTX.Provider value={mock}>
                {props.children}
            </MOCK_CTX.Provider>
        </API_CTX.Provider>
    );
};

export const useSalesforceAPI = (): SalesforceApiClientInterface => React.useContext(API_CTX)!;
/// The mock of Salesforce, null without
export const useSalesforceMock = (): SalesforceMock | null => React.useContext(MOCK_CTX);
