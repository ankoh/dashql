import React from 'react';
import Immutable from 'immutable';
import * as model from '.';
import * as utils from '../utils';
import { Script, ScriptOriginType } from './script';

export interface ScriptRegistry {
    local: Immutable.Map<string, Script>;
    gistsOwned: Immutable.Map<string, Script>;
    gistsStarred: Immutable.Map<string, Script>;
}

export const initialScriptRegistry: ScriptRegistry = {
    local: Immutable.Map<string, Script>(),
    gistsOwned: Immutable.Map<string, Script>(),
    gistsStarred: Immutable.Map<string, Script>(),
};

export const CREATE_BLANK_SCRIPT = Symbol('CREATE_BLANK');
export const SAVE_SCRIPT = Symbol('SAVE_SCRIPT');

export type ScriptRegistryAction =
    | model.Action<typeof SAVE_SCRIPT, Script>
    | model.Action<typeof CREATE_BLANK_SCRIPT, undefined>;

export const generateLocalFileName = (state: ScriptRegistry): string => {
    let name: string;
    do {
        name = `${utils.generateRandomHexString(8)}.dashql`;
    } while (state.local.has(name));
    return name;
};

export const generateBlankScript = (state: ScriptRegistry): Script => ({
    origin: {
        originType: ScriptOriginType.LOCAL,
        fileName: generateLocalFileName(state),
    },
    description: '',
    text: '',
    modified: false,
    lineCount: 1,
    bytes: 0,
});

export const forkLocal = (state: ScriptRegistry, script: Script): Script => ({
    ...script,
    origin: {
        originType: ScriptOriginType.LOCAL,
        fileName: generateLocalFileName(state),
    },
});

export const reduceScriptRegistry = (ctx: ScriptRegistry, action: ScriptRegistryAction): ScriptRegistry => {
    switch (action.type) {
        case CREATE_BLANK_SCRIPT: {
            const script = generateBlankScript(ctx);
            return { ...ctx, local: ctx.local.set(script.origin.fileName, script) };
        }
        case SAVE_SCRIPT: {
            const next = { ...ctx };
            switch (action.data.origin.originType) {
                case ScriptOriginType.GITHUB_GIST:
                    next.gistsOwned = next.gistsOwned.set(action.data.origin.githubGistName, action.data);
                    break;
                case ScriptOriginType.LOCAL:
                    next.gistsOwned = next.gistsOwned.set(action.data.origin.fileName, action.data);
                    break;
            }
            return next;
        }
    }
};

const accountScriptsCtx = React.createContext<ScriptRegistry>(initialScriptRegistry);
const accountScriptsDispatchCtx = React.createContext<model.Dispatch<ScriptRegistryAction>>(() => {});

type Props = {
    children: React.ReactElement;
};

export const ScriptRegistryProvider: React.FC<Props> = (props: Props) => {
    const [s, d] = React.useReducer(reduceScriptRegistry, initialScriptRegistry);
    return (
        <accountScriptsCtx.Provider value={s}>
            <accountScriptsDispatchCtx.Provider value={d}>{props.children}</accountScriptsDispatchCtx.Provider>
        </accountScriptsCtx.Provider>
    );
};

export const useScriptRegistry = (): ScriptRegistry => React.useContext(accountScriptsCtx);
export const useScriptRegistryDispatch = (): model.Dispatch<ScriptRegistryAction> =>
    React.useContext(accountScriptsDispatchCtx);
