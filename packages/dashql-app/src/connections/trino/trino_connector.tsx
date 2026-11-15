import * as React from 'react';

import { useLogger } from '../../platform/logger/logger_provider.js';
import { useAppConfig } from '../../config/app_config.js';
import { useHttpClient } from '../../platform/http/http_client_provider.js';
import { createTrinoSetup, TrinoSetupApi } from '@ankoh/dashql-runtime/connections/trino/trino_connection_setup';
import { usePlatformType } from '../../platform/platform_type.js';
import { usePlatformEventListener } from '../../platform/events/event_listener_provider.js';
import { AppOAuthFlow } from '../../oauth/app_oauth_flow.js';

export const SETUP_CTX = React.createContext<TrinoSetupApi | null>(null);

interface Props {
    children: React.ReactElement;
}

export const TrinoConnector: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const config = useAppConfig();
    const httpClient = useHttpClient();
    const platformType = usePlatformType();
    const appEvents = usePlatformEventListener();
    const connectorConfig = config?.connectors?.trino;
    const forceReLogin = config?.settings?.forceReLogin ?? false;

    const setup = React.useMemo(() => {
        if (!connectorConfig) {
            return null;
        }
        return createTrinoSetup(logger, httpClient, new AppOAuthFlow(appEvents, platformType), forceReLogin);
    }, [connectorConfig, httpClient, platformType, appEvents, forceReLogin]);

    return (
        <SETUP_CTX.Provider value={setup}>
            {props.children}
        </SETUP_CTX.Provider>
    );
}

export const useTrinoSetup = (): TrinoSetupApi => React.useContext(SETUP_CTX)!;
