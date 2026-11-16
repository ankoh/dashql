import * as React from 'react';

import type { SalesforceConnectorMockConfig } from '@ankoh/dashql/platform/connections/salesforce/salesforce_api_client_mock';
import { useAppConfig } from '../../config/app_config.js';

const MOCK_CTX = React.createContext<SalesforceConnectorMockConfig | null>(null);

interface Props {
    children: React.ReactElement;
}

/// The mock of Salesforce that the config of the app chose. The setups of the runtime run against it: the requests of
/// Salesforce are answered from the config, the OAuth flow returns at once and the channel is a mock of Hyper.
export const SalesforceConnector: React.FC<Props> = (props: Props) => {
    const config = useAppConfig();
    const mock = config?.connectors?.salesforce?.mock;
    const value = mock?.enabled ? mock : null;
    return <MOCK_CTX.Provider value={value}>{props.children}</MOCK_CTX.Provider>;
};

/// The mock of Salesforce that the config chose, null without
export const useSalesforceMock = (): SalesforceConnectorMockConfig | null => React.useContext(MOCK_CTX);
