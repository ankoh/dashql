import React from 'react';
import axios from 'axios';
import config_url from '../static/config.json';
import { Status, LazySetup } from './model';

export interface AppFeatures {
    scriptStatistics?: boolean;
    cloudService?: boolean;
    userAccount?: boolean;
    editorControls?: boolean;
}

export interface AppConfig {
    features?: AppFeatures;
    program?: string;
}

// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
export function isAppConfig(object: any): object is AppConfig {
    return true;
    //return object.program !== undefined;
}

export const initialAppConfig: AppConfig = {
    features: undefined,
    program: undefined,
};

const configCtx = React.createContext<LazySetup<AppConfig>>(null);
const reconfigureCtx = React.createContext<(config: AppConfig) => void>(null);

type Props = {
    children: React.ReactElement;
};

export const AppConfigResolver: React.FC<Props> = (props: Props) => {
    const [config, setConfig] = React.useState<LazySetup<AppConfig>>({
        status: Status.NONE,
        value: null,
        error: null,
    });
    const started = React.useRef<boolean>(false);
    if (!started.current) {
        started.current = true;
        const resolve = async (): Promise<void> => {
            setConfig({
                status: Status.RUNNING,
                value: null,
                error: null,
            });
            try {
                const resp = await axios.get(config_url as string);
                if (isAppConfig(resp.data)) {
                    setConfig({
                        status: Status.COMPLETED,
                        value: resp as AppConfig,
                        error: null,
                    });
                } else {
                    setConfig({
                        status: Status.FAILED,
                        value: null,
                        error: null,
                    });
                }
            } catch (_) {
                setConfig({
                    status: Status.FAILED,
                    value: null,
                    error: null,
                });
            }
        };
        resolve();
    }
    const reconfigure = (next: AppConfig) =>
        setConfig({
            status: Status.COMPLETED,
            value: next,
            error: null,
        });
    return (
        <configCtx.Provider value={config}>
            <reconfigureCtx.Provider value={reconfigure}>{props.children}</reconfigureCtx.Provider>
        </configCtx.Provider>
    );
};

export const useAppConfig = (): LazySetup<AppConfig> => React.useContext(configCtx);
export const useAppReconfigure = (): ((config: AppConfig) => void) => React.useContext(reconfigureCtx);
