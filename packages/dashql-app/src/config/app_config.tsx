import * as React from 'react';

import type { ConnectorConfigs } from '@akohn/dashql/platform/connections/connector_configs';
import { useLogger } from '../host/logger_provider.js';
import { Logger, stringifyError } from '@akohn/dashql/platform/logger/logger';
import { createTrace } from '@akohn/dashql/platform/logger/trace_context';
import type { AppSettings } from './app_settings.js';

const CONFIG_URL = new URL('../../static/config.json', import.meta.url);

export type { AppSettings } from './app_settings.js';

export interface AppConfig {
    settings?: AppSettings;
    connectors?: ConnectorConfigs;
}

export interface AppConfigResult {
    config: AppConfig;
    traceId: number;
}

export async function downloadAppConfig(logger: Logger): Promise<AppConfigResult> {
    const trace = createTrace();
    const traced = logger.withTrace(trace);
    const resp = await fetch(CONFIG_URL as unknown as string);
    if (!resp.ok) {
        throw new Error(`Loading ${CONFIG_URL.pathname} failed with status ${resp.status}`);
    }
    const config = await resp.json() as AppConfig;
    traced.info("Loaded app config", {}, "app_config");
    return { config, traceId: trace.traceId };
};

type ReconfigureStateFn = (res: AppConfig | null) => (AppConfig | null);
const RECONFIGURE_CTX = React.createContext<((config: ReconfigureStateFn) => void) | null>(null);
const CONFIG_CTX = React.createContext<AppConfig | null>(null);
const CONFIG_ERROR_CTX = React.createContext<string | null>(null);

type Props = {
    children: React.ReactElement;
};

export const AppConfigProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const configPromise = React.useRef<Promise<AppConfigResult>>(null);
    const [config, setConfig] = React.useState<AppConfig | null>(null);
    const [error, setError] = React.useState<string | null>(null);

    React.useEffect(() => {
        if (!configPromise.current) {
            configPromise.current = downloadAppConfig(logger);
            configPromise.current.then(result => {
                setConfig(result.config);
            }).catch(e => {
                logger.error("Failed to load the app config", { error: stringifyError(e) }, "app_config");
                setError(`App config: ${stringifyError(e)}`);
            });
        }
    }, [logger]);

    // The log level of the settings applies from the start, e.g. to the debug log of the setup of the embedded Hyper
    const minLogLevel = config?.settings?.minLogLevel ?? null;
    React.useEffect(() => {
        if (minLogLevel != null) logger.buffer.setMinLogLevel(minLogLevel);
    }, [minLogLevel, logger]);

    const reconfigure = React.useCallback((mapper: ReconfigureStateFn) => {
        logger.info(`Reconfiguring application`, {}, "app_config");
        setConfig(c => mapper(c));
    }, [logger]);

    return (
        <CONFIG_CTX.Provider value={config}>
            <CONFIG_ERROR_CTX.Provider value={error}>
                <RECONFIGURE_CTX.Provider value={reconfigure}>{props.children}</RECONFIGURE_CTX.Provider>
            </CONFIG_ERROR_CTX.Provider>
        </CONFIG_CTX.Provider>
    );
};

export const useAppConfig = (): AppConfig | null => React.useContext(CONFIG_CTX);
/// Why the app config failed to load, null while it did not fail. The app stays on its loading page without it.
export const useAppConfigError = (): string | null => React.useContext(CONFIG_ERROR_CTX);
export const useAppReconfigure = (): ((config: ReconfigureStateFn) => void) => React.useContext(RECONFIGURE_CTX)!;
