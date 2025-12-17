import * as React from 'react';

import { ConnectorConfigs, readConnectorConfigs } from './connection/connector_configs.js';
import { useLogger } from './platform/logger_provider.js';
import { Logger } from './platform/logger.js';
import { awaitAndSetOrNull } from './utils/result.js';

const CONFIG_URL = new URL('../static/config.json', import.meta.url);

export interface AppSettings {
    showCompletionDetails?: boolean;
    interfaceDebugMode?: boolean;
    setupDemoConnection?: boolean;
    pauseAfterAppSetup?: boolean;
}

export interface AppConfig {
    settings?: AppSettings;
    connectors?: ConnectorConfigs;
}

function readAppConfig(object: Record<string, object>): AppConfig {
    if (object.connectors) {
        object.connectors = readConnectorConfigs(object.connectors);
    }
    return object as AppConfig;
}

export async function downloadAppConfig(logger: Logger): Promise<AppConfig> {
    try {
        const resp = await fetch(CONFIG_URL as unknown as string);
        const body = await resp.json();
        const config = readAppConfig(body);
        logger.info("loaded app config", {}, "app_config");
        return config;
    } catch (e: any) {
        console.error(e);
        throw e;
    }
};

type ReconfigureStateFn = (res: AppConfig | null) => (AppConfig | null);
const RECONFIGURE_CTX = React.createContext<((config: ReconfigureStateFn) => void) | null>(null);
const CONFIG_CTX = React.createContext<AppConfig | null>(null);

type Props = {
    children: React.ReactElement;
};

export const AppConfigProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const configPromise = React.useRef<Promise<AppConfig>>(null);
    const [config, setConfig] = React.useState<AppConfig | null>(null);

    React.useEffect(() => {
        if (!configPromise.current) {
            configPromise.current = downloadAppConfig(logger);
            awaitAndSetOrNull(configPromise.current, setConfig);
        }
    }, []);

    const reconfigure = React.useCallback((mapper: ReconfigureStateFn) => {
        logger.info(`reconfigure application`, {}, "app_config");
        setConfig(c => mapper(c));
    }, []);

    return (
        <CONFIG_CTX.Provider value={config}>
            <RECONFIGURE_CTX.Provider value={reconfigure}>{props.children}</RECONFIGURE_CTX.Provider>
        </CONFIG_CTX.Provider>
    );
};

export const useAppConfig = (): AppConfig | null => React.useContext(CONFIG_CTX);
export const useAppReconfigure = (): ((config: ReconfigureStateFn) => void) => React.useContext(RECONFIGURE_CTX)!;
