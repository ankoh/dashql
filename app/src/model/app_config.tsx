import * as d from '@duckdb/duckdb-wasm';
import React from 'react';
import axios from 'axios';
import config_url from '../../static/config.json';
import { Resolvable, ResolvableStatus } from './resolvable_status';

export interface AppFeatures {
    cloudService?: boolean;
    userAccount?: boolean;
    exampleCatalog?: boolean;
    systemInfo?: boolean;
}

export interface AppConfig {
    features?: AppFeatures;
    program?: string;
    database?: d.DuckDBConfig;
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function isAppConfig(object: any): object is AppConfig {
    return true;
    //return object.program !== undefined;
}

const configCtx = React.createContext<Resolvable<AppConfig>>(null);
const reconfigureCtx = React.createContext<(config: AppConfig) => void>(null);

type Props = {
    children: React.ReactElement;
};

export const AppConfigResolver: React.FC<Props> = (props: Props) => {
    const [config, setConfig] = React.useState<Resolvable<AppConfig>>(
        new Resolvable<AppConfig, null>(ResolvableStatus.NONE, null),
    );
    const started = React.useRef<boolean>(false);
    if (!started.current) {
        started.current = true;
        const resolve = async (): Promise<void> => {
            setConfig(c => c.updateProgress(null));
            try {
                const resp = await axios.get(config_url as string);
                if (isAppConfig(resp.data)) {
                    setConfig(c => c.completeWith(resp.data as AppConfig));
                } else {
                    setConfig(c => c.failWith('invalid app config'));
                }
            } catch (e: any) {
                setConfig(c => c.failWith(e));
            }
        };
        resolve();
    }
    const reconfigure = (next: AppConfig) => setConfig(c => c.completeWith(next));
    return (
        <configCtx.Provider value={config}>
            <reconfigureCtx.Provider value={reconfigure}>{props.children}</reconfigureCtx.Provider>
        </configCtx.Provider>
    );
};

export const useAppConfig = (): Resolvable<AppConfig> => React.useContext(configCtx);
export const useAppReconfigure = (): ((config: AppConfig) => void) => React.useContext(reconfigureCtx);
