import React from 'react';
import Immutable from 'immutable';
import * as model from '.';
import { Script, ScriptOriginType } from './script';

export interface ScriptStore {
    local: Immutable.Map<string, Script>;
    gists: Immutable.Map<string, Script>;
}

export const initialScriptStore: ScriptStore = {
    local: Immutable.Map<string, Script>(),
    gists: Immutable.Map<string, Script>(),
};

export const SAVE_SCRIPT = Symbol('SAVE_SCRIPT');

export type ScriptStoreAction = model.Action<typeof SAVE_SCRIPT, Script>;

export const reduceScriptStore = (ctx: ScriptStore, action: ScriptStoreAction): ScriptStore => {
    switch (action.type) {
        case SAVE_SCRIPT: {
            const next = { ...ctx };
            switch (action.data.origin.originType) {
                case ScriptOriginType.GITHUB_GIST:
                    next.gists = next.gists.set(action.data.origin.githubGistName, action.data);
                    break;
                case ScriptOriginType.LOCAL:
                    next.gists = next.gists.set(action.data.origin.fileName, action.data);
                    break;
            }
            return {
                ...ctx,
            };
        }
    }
};

const accountScriptsCtx = React.createContext<ScriptStore>(initialScriptStore);
const accountScriptsDispatchCtx = React.createContext<model.Dispatch<ScriptStoreAction>>(() => {});

type Props = {
    children: React.ReactElement;
    config: ScriptStore;
};

export const AccountScriptsProvider: React.FC<Props> = (props: Props) => {
    const [s, d] = React.useReducer(reduceScriptStore, props.config);
    return (
        <accountScriptsCtx.Provider value={s}>
            <accountScriptsDispatchCtx.Provider value={d}>{props.children}</accountScriptsDispatchCtx.Provider>
        </accountScriptsCtx.Provider>
    );
};

export const useAccountScripts = (): ScriptStore => React.useContext(accountScriptsCtx);
export const useAccountScriptsDispatch = (): model.Dispatch<ScriptStoreAction> =>
    React.useContext(accountScriptsDispatchCtx);
