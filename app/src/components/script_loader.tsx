import * as React from 'react';
import * as model from '../model';
import * as utils from '../utils';
import * as examples from '../example_scripts';
import axios from 'axios';
import lz from 'lz-string';
import { useLocation } from 'react-router-dom';
import { CenteredRectangleWaveSpinner } from './spinners';
import { generateLocalFileName, Script, ScriptOriginType, useScriptRegistry } from '../model';
import { useWorkflowSession } from '../backend/workflow_session';

import styles from './script_loader.module.css';

const DEFAULT_EXAMPLE = 'hello_world';

interface Props {
    errorComponent?: (error: string) => React.ReactElement;
    children: React.ReactElement;
}

enum ScriptLoaderStatus {
    INIT,
    RESOLVING,
    LOADING,
    FAILED,
    SUCCEEDED,
}

export type ScriptLoaderFunction = () => void;
const SCRIPT_LOADER_CONTEXT = React.createContext<ScriptLoaderFunction>(null);
export const useScriptLoader = (): ScriptLoaderFunction => React.useContext(SCRIPT_LOADER_CONTEXT);

interface State {
    status: ScriptLoaderStatus;
    location: any | null;
    loadFrom: model.ScriptOrigin | null;
    loadedScript: Script | null;
    error: any | null;
}

export const ScriptLoader: React.FC<Props> = (props: Props) => {
    const location = useLocation();
    const workflowSession = useWorkflowSession();
    const scriptRegistry = useScriptRegistry();
    const [state, setState] = React.useState<State>({
        status: ScriptLoaderStatus.INIT,
        location: null,
        loadFrom: null,
        loadedScript: null,
        error: null,
    });
    const lock = React.useRef<boolean>(false);

    // Do the asynchronous load
    React.useEffect(() => {
        if (workflowSession == null) return;

        // State machine
        switch (state.status) {
            case ScriptLoaderStatus.INIT: {
                if (workflowSession.uncommittedState.programText == '') {
                    setState({
                        status: ScriptLoaderStatus.RESOLVING,
                        location: null,
                        loadFrom: null,
                        loadedScript: null,
                        error: null,
                    });
                }
                break;
            }

            case ScriptLoaderStatus.RESOLVING: {
                // URL refers to a raw script text?
                const searchParams = new URLSearchParams(location.search);
                if (searchParams.has('text')) {
                    const text = lz.decompressFromBase64(searchParams.get('text')!) || '-- Decoding failed';
                    const script: model.Script = {
                        metadata: {
                            origin: {
                                originType: ScriptOriginType.LOCAL,
                                fileName: searchParams.get('name') || generateLocalFileName(scriptRegistry),
                            },
                            description: '',
                        },
                        text,
                        textLineCount: utils.countLines(text),
                        textBytes: utils.estimateUTF16Length(text),
                        modified: false,
                    };
                    setState({
                        ...state,
                        status: ScriptLoaderStatus.LOADING,
                        location,
                        loadFrom: null,
                        loadedScript: script,
                        error: null,
                    });
                    break;
                }

                // URL refers to a GitHub gist?
                if (searchParams.has('gist')) {
                    const gist = searchParams.get('gist')!;
                    // XXX Account
                    const request = {
                        originType: model.ScriptOriginType.GITHUB_GIST,
                        fileName: gist,
                        httpURL: new URL(`https://gist.githubusercontent.com/ankoh/${gist}/raw`),
                        githubGistName: gist,
                    };
                    setState({
                        ...state,
                        status: ScriptLoaderStatus.LOADING,
                        location,
                        loadFrom: request,
                        loadedScript: null,
                        error: null,
                    });
                    break;
                }

                // URL refers to an example?
                if (searchParams.has('example')) {
                    const exampleName = searchParams.get('example')!;
                    setState({
                        ...state,
                        status: ScriptLoaderStatus.LOADING,
                        location,
                        loadFrom: {
                            originType: ScriptOriginType.EXAMPLES,
                            fileName: exampleName,
                            exampleName,
                        },
                        loadedScript: null,
                        error: null,
                    });
                    break;
                }

                // Load default example?
                if (state.loadedScript == null) {
                    setState({
                        ...state,
                        status: ScriptLoaderStatus.LOADING,
                        location,
                        loadFrom: {
                            originType: ScriptOriginType.EXAMPLES,
                            fileName: DEFAULT_EXAMPLE,
                            exampleName: DEFAULT_EXAMPLE,
                        },
                        loadedScript: null,
                        error: null,
                    });
                    break;
                }
            }

            case ScriptLoaderStatus.LOADING: {
                lock.current = true;
                // Already loaded? (might happen if cached)
                if (state.loadedScript) {
                    async () => {
                        try {
                            await workflowSession.updateProgram(state.loadedScript.text, state.loadedScript.metadata);
                            lock.current = false;
                            setState(s => ({
                                ...s,
                                status: ScriptLoaderStatus.SUCCEEDED,
                                error: null,
                            }));
                        } catch (e) {
                            lock.current = false;
                            setState(s => ({
                                ...s,
                                status: ScriptLoaderStatus.FAILED,
                                error: e,
                            }));
                        }
                    };
                    break;
                }
                // No loadFrom set?
                if (!state.loadFrom) {
                    lock.current = false;
                    console.warn('script loader loading but loadFrom is not set');
                    break;
                }
                switch (state.loadFrom.originType) {
                    case ScriptOriginType.HTTPS:
                    case ScriptOriginType.HTTP:
                        (async () => {
                            try {
                                const resp = await axios.get(state.loadFrom.httpURL.toString() || '');
                                if (resp.status != 200) {
                                    console.error(
                                        `Loading from URL ${state.loadFrom.httpURL} failed with error: ${resp.statusText}`,
                                    );
                                    lock.current = false;
                                    setState(s => ({
                                        ...s,
                                        status: ScriptLoaderStatus.FAILED,
                                        error: resp.statusText,
                                    }));
                                    return;
                                }
                                const text = resp.data as string;
                                const script: model.Script = {
                                    metadata: {
                                        origin: {
                                            originType: ScriptOriginType.HTTPS,
                                            fileName: '',
                                        },
                                        description: '',
                                    },
                                    text,
                                    textLineCount: utils.countLines(text),
                                    textBytes: utils.estimateUTF16Length(text),
                                    modified: false,
                                };
                                await workflowSession.updateProgram(text, script.metadata);
                                lock.current = false;
                                setState(s => ({
                                    ...s,
                                    status: ScriptLoaderStatus.SUCCEEDED,
                                    loadedScript: script,
                                    error: null,
                                }));
                            } catch (e) {
                                lock.current = false;
                                setState(s => ({
                                    ...s,
                                    status: ScriptLoaderStatus.FAILED,
                                    error: e,
                                }));
                            }
                        })();
                        break;

                    case ScriptOriginType.EXAMPLES: {
                        const example = examples.EXAMPLE_SCRIPT_MAP.get(state.loadFrom.exampleName!)!;
                        (async () => {
                            try {
                                const script = await examples.getScript(example);
                                await workflowSession.updateProgram(script.text, script.metadata);
                                lock.current = false;
                                setState(s => ({
                                    ...s,
                                    status: ScriptLoaderStatus.SUCCEEDED,
                                    loadedScript: script,
                                    error: null,
                                }));
                            } catch (e) {
                                lock.current = false;
                                setState(s => ({
                                    ...s,
                                    status: ScriptLoaderStatus.FAILED,
                                    error: e,
                                }));
                            }
                        })();
                        break;
                    }
                    default:
                        console.warn(`cannot load from script origin ${state.loadFrom.originType}`);
                }
            }
        }
    }, [workflowSession, state.status]);

    const loader = React.useCallback(
        (target?: model.ScriptOrigin) => {
            setState(s => {
                if (target === undefined) {
                    return {
                        ...s,
                        status: ScriptLoaderStatus.RESOLVING,
                    };
                } else {
                    return {
                        ...s,
                        status: ScriptLoaderStatus.LOADING,
                        loadFrom: target,
                        loadedScript: null,
                        error: null,
                    };
                }
            });
        },
        [setState],
    );

    let content: React.ReactElement;
    switch (state.status) {
        case ScriptLoaderStatus.INIT:
        case ScriptLoaderStatus.SUCCEEDED:
            content = props.children;
            break;
        case ScriptLoaderStatus.RESOLVING:
        case ScriptLoaderStatus.LOADING:
            content = (
                <CenteredRectangleWaveSpinner className={styles.spinner} active={true} color={'rgb(36, 41, 46)'} />
            );
            break;
        case ScriptLoaderStatus.FAILED:
            content = <div />;
            break;
    }
    return <SCRIPT_LOADER_CONTEXT.Provider value={loader}>{content}</SCRIPT_LOADER_CONTEXT.Provider>;
};

export function withScriptLoader<P>(Component: React.ComponentType<P>): React.FunctionComponent<P> {
    // eslint-disable-next-line react/display-name
    return (props: P) => {
        return (
            <ScriptLoader>
                <Component {...props} />
            </ScriptLoader>
        );
    };
}
