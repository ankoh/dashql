import React from 'react';
import * as model from '.';

export interface AppFeatures {
    scriptStatistics?: boolean;
    cloudService?: boolean;
    userAccount?: boolean;
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

export const UPDATE_CONFIG = Symbol('UPDATE_CONFIG');

export type AppConfigAction = model.Action<typeof UPDATE_CONFIG, Partial<AppConfig>>;

export const reduceAppConfig = (ctx: AppConfig, action: AppConfigAction): AppConfig => {
    switch (action.type) {
        case UPDATE_CONFIG:
            return {
                ...ctx,
                ...action.data,
            };
    }
};

const stateCtx = React.createContext<AppConfig>(initialAppConfig);
const dispatchCtx = React.createContext<model.Dispatch<AppConfigAction>>(() => {});

type Props = {
    children: React.ReactElement;
    config: AppConfig;
};

export const AppConfigProvider: React.FC<Props> = (props: Props) => {
    const [s, d] = React.useReducer(reduceAppConfig, props.config);
    return (
        <stateCtx.Provider value={s}>
            <dispatchCtx.Provider value={d}>{props.children}</dispatchCtx.Provider>
        </stateCtx.Provider>
    );
};

export const useAppConfig = (): AppConfig => React.useContext(stateCtx);
export const useAppConfigDispatch = (): model.Dispatch<AppConfigAction> => React.useContext(dispatchCtx);
