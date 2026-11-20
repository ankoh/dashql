import * as React from 'react';

import { ConnectorConfigs, readConnectorConfigs } from '@akohn/dashql/platform/connections/connector_configs';
import { useLogger } from '../host/logger_provider.js';
import { Logger } from '@akohn/dashql/platform/logger/logger';
import { createTrace } from '@akohn/dashql/platform/logger/trace_context';
import { AppFlavor, applyFlavorSettings } from './flavors.js';
import { useAppFlavor } from './flavor_provider.js';
import type { AppSettings } from './app_settings.js';

const CONFIG_URL = new URL('../../static/config.json', import.meta.url);

export type { AppSettings } from './app_settings.js';

export interface AppConfig {
    settings?: AppSettings;
    connectors?: ConnectorConfigs;
}

function readAppConfig(object: AppConfig): AppConfig {
    if (object.connectors) {
        object.connectors = readConnectorConfigs(object.connectors);
    }
    return object;
}

export interface AppConfigResult {
    config: AppConfig;
    traceId: number;
}

export async function downloadAppConfig(logger: Logger, flavor: AppFlavor): Promise<AppConfigResult> {
    const trace = createTrace();
    const traced = logger.withTrace(trace);
    try {
        const resp = await fetch(CONFIG_URL as unknown as string);
        const body = await resp.json();
        const config = readAppConfig(body);
        config.settings = applyFlavorSettings(config.settings, flavor);
        traced.info("Loaded app config", {}, "app_config");
        return { config, traceId: trace.traceId };
    } catch (e) {
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
    const flavor = useAppFlavor();
    const configPromise = React.useRef<Promise<AppConfigResult>>(null);
    const [config, setConfig] = React.useState<AppConfig | null>(null);

    React.useEffect(() => {
        if (!configPromise.current) {
            configPromise.current = downloadAppConfig(logger, flavor);
            configPromise.current.then(result => {
                setConfig(result.config);
            }).catch(() => {
                setConfig(null);
            });
        }
    }, [logger, flavor]);

    const reconfigure = React.useCallback((mapper: ReconfigureStateFn) => {
        logger.info(`Reconfiguring application`, {}, "app_config");
        setConfig(c => mapper(c));
    }, [logger]);

    return (
        <CONFIG_CTX.Provider value={config}>
            <RECONFIGURE_CTX.Provider value={reconfigure}>{props.children}</RECONFIGURE_CTX.Provider>
        </CONFIG_CTX.Provider>
    );
};

export const useAppConfig = (): AppConfig | null => React.useContext(CONFIG_CTX);
export const useAppReconfigure = (): ((config: ReconfigureStateFn) => void) => React.useContext(RECONFIGURE_CTX)!;
