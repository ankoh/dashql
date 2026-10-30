import * as React from 'react';

import { ConnectorConfigs, readConnectorConfigs } from '../connections/connector_configs.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { Logger } from '../../platform/logger/logger.js';
import { createTrace } from '../../platform/logger/trace_context.js';
import { AppFlavor, applyFlavorSettings } from '../flavor/flavors.js';
import { useAppFlavor } from '../flavor/flavor_provider.js';

const CONFIG_URL = new URL('../../../static/config.json', import.meta.url);

export interface AppSettings {
    pauseAfterAppSetup?: boolean;
    enableTableColumnPlots?: boolean;
    experimental_dashboards?: boolean;
    experimental_file_attachments?: boolean;
    /// Run the embedded HyperDB on its experimental wasm backend, applied by a restart of the app.
    /// A hyperdb-wasm without the backend starts on the default backend.
    experimental_wasm_backend?: boolean;
    narrowScreenLayout?: boolean;
    /// Lay out the app like the desktop app on macOS, with placeholders of the traffic lights, to check the layout in the browser
    macWindowLayout?: boolean;
    /// Show the labels of the buttons in a wide rail on the left
    navRailWide?: boolean;
    scriptDebugMode?: boolean;
    tableDebugMode?: boolean;
    formattingDebugMode?: boolean;
    keywordCase?: 'lower' | 'upper';
    /// Force the OAuth identity provider to re-prompt for login instead of silently reusing an
    /// existing browser session. Adds `prompt=login` to the authorization request.
    forceReLogin?: boolean;
    minLogLevel?: number;
    /// The id of the app flavor, the flavor query parameter of the url wins
    flavor?: string;
    /// The sessions whose scripts agents may read, edit and run through the local agent server
    agentSessions?: string[];
    /// The port of the local agent server, the build's default if unset
    agentPort?: number;
    /// The harness that runs the requests of the agent, the default harness of the agent server if unset
    agentHarness?: string;
    /// The model of the harness's requests, one of the models of the harness, the harness's own default if unset
    agentModel?: string;
    /// The effort of the harness's requests, one of the efforts of the harness, the harness's own default if unset
    agentEffort?: string;
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
    } catch (e: any) {
        console.error(e);
        throw e;
    }
};

type ReconfigureStateFn = (res: AppConfig | null) => (AppConfig | null);
const RECONFIGURE_CTX = React.createContext<((config: ReconfigureStateFn) => void) | null>(null);
const CONFIG_CTX = React.createContext<AppConfig | null>(null);
const CONFIG_TRACE_ID_CTX = React.createContext<number | null>(null);

type Props = {
    children: React.ReactElement;
};

export const AppConfigProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const flavor = useAppFlavor();
    const configPromise = React.useRef<Promise<AppConfigResult>>(null);
    const [config, setConfig] = React.useState<AppConfig | null>(null);
    const [traceId, setTraceId] = React.useState<number | null>(null);

    React.useEffect(() => {
        if (!configPromise.current) {
            configPromise.current = downloadAppConfig(logger, flavor);
            configPromise.current.then(result => {
                setConfig(result.config);
                setTraceId(result.traceId);
            }).catch(() => {
                setConfig(null);
                setTraceId(null);
            });
        }
    }, []);

    const reconfigure = React.useCallback((mapper: ReconfigureStateFn) => {
        logger.info(`Reconfiguring application`, {}, "app_config");
        setConfig(c => mapper(c));
    }, []);

    return (
        <CONFIG_CTX.Provider value={config}>
            <CONFIG_TRACE_ID_CTX.Provider value={traceId}>
                <RECONFIGURE_CTX.Provider value={reconfigure}>{props.children}</RECONFIGURE_CTX.Provider>
            </CONFIG_TRACE_ID_CTX.Provider>
        </CONFIG_CTX.Provider>
    );
};

export const useAppConfig = (): AppConfig | null => React.useContext(CONFIG_CTX);
export const useAppConfigTraceId = (): number | null => React.useContext(CONFIG_TRACE_ID_CTX);
export const useAppReconfigure = (): ((config: ReconfigureStateFn) => void) => React.useContext(RECONFIGURE_CTX)!;
