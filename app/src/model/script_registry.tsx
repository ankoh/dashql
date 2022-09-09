import React from 'react';
import Immutable from 'immutable';
import * as utils from '../utils';
import { Action, Dispatch } from './action';
import { Script, ScriptMetadata, ScriptOriginType } from './script';

export interface ScriptRegistry {
    local: Immutable.Map<string, Script>;
    gistsOwned: Immutable.Map<string, ScriptMetadata>;
    gistsStarred: Immutable.Map<string, ScriptMetadata>;
}

const generateGists = (state: ScriptRegistry): ScriptRegistry => ({
    ...state,
    gistsOwned: state.gistsOwned.withMutations(m => {
        m.set('6397dfca218aaa654f99dd76ab668871', {
            origin: {
                originType: ScriptOriginType.GITHUB_GIST,
                fileName: 'helloworld.dashql',
                githubAccount: 'ankoh',
                githubGistName: '6397dfca218aaa654f99dd76ab668871',
            },
            description: '',
        });
        m.set('2fef57f8cad25fef737f1d619d3ca10a', {
            origin: {
                originType: ScriptOriginType.GITHUB_GIST,
                fileName: 'helloworld2.dashql',
                githubAccount: 'ankoh',
                githubGistName: '2fef57f8cad25fef737f1d619d3ca10a',
            },
            description: '',
        });
    }),
    gistsStarred: state.gistsStarred.withMutations(m => {
        m.set('6397dfca218aaa654f99dd76ab668871', {
            origin: {
                originType: ScriptOriginType.GITHUB_GIST,
                fileName: 'helloworld.dashql',
                githubAccount: 'ankoh',
                githubGistName: '6397dfca218aaa654f99dd76ab668871',
            },
            description: '',
        });
    }),
});

export const initialScriptRegistry: ScriptRegistry = generateGists({
    local: Immutable.Map<string, Script>(),
    gistsOwned: Immutable.Map<string, ScriptMetadata>(),
    gistsStarred: Immutable.Map<string, ScriptMetadata>(),
});

export const CREATE_BLANK_SCRIPT = Symbol('CREATE_BLANK');
export const SAVE_SCRIPT = Symbol('SAVE_SCRIPT');

export type ScriptRegistryAction = Action<typeof SAVE_SCRIPT, Script> | Action<typeof CREATE_BLANK_SCRIPT, undefined>;

export const generateLocalFileName = (state: ScriptRegistry): string => {
    let name: string;
    do {
        name = `${utils.generateRandomHexString(8)}.dashql`;
    } while (state.local.has(name));
    return name;
};

export const generateBlankScript = (state: ScriptRegistry): Script => ({
    metadata: {
        origin: {
            originType: ScriptOriginType.LOCAL,
            fileName: generateLocalFileName(state),
        },
        description: '',
    },
    text: '',
    textLineCount: 1,
    textBytes: 0,
    modified: false,
});

export const forkLocal = (state: ScriptRegistry, script: Script): Script => ({
    ...script,
    metadata: {
        ...script.metadata,
        origin: {
            originType: ScriptOriginType.LOCAL,
            fileName: generateLocalFileName(state),
        },
    },
});

export const reduceScriptRegistry = (ctx: ScriptRegistry, action: ScriptRegistryAction): ScriptRegistry => {
    switch (action.type) {
        case CREATE_BLANK_SCRIPT: {
            const script = generateBlankScript(ctx);
            return { ...ctx, local: ctx.local.set(script.metadata.origin.fileName, script) };
        }
        case SAVE_SCRIPT: {
            const next = { ...ctx };
            switch (action.data.metadata.origin.originType) {
                case ScriptOriginType.GITHUB_GIST:
                    next.gistsOwned = next.gistsOwned.set(
                        action.data.metadata.origin.githubGistName,
                        action.data.metadata,
                    );
                    break;
                case ScriptOriginType.LOCAL:
                    next.local = next.local.set(action.data.metadata.origin.fileName, action.data);
                    break;
            }
            return next;
        }
    }
};

const accountScriptsCtx = React.createContext<ScriptRegistry>(initialScriptRegistry);
const accountScriptsDispatchCtx = React.createContext<Dispatch<ScriptRegistryAction>>(() => {});

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
export const useScriptRegistryDispatch = (): Dispatch<ScriptRegistryAction> =>
    React.useContext(accountScriptsDispatchCtx);
