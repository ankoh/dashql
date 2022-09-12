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

const DEFAULT_EXAMPLE = 'demo_btw';

interface Props {
    errorComponent?: (error: string) => React.ReactElement;
    children: React.ReactElement;
}

enum ScriptLoaderProgress {
    REFRESH,
    LOADING,
    FAILED,
    SUCCEEDED,
}

interface State {
    location: any | null;
    task: ScriptLoaderProgress;
    loadFrom: model.ScriptOrigin | null;
    loadedScript: Script | null;
    error: any | null;
}

export const ScriptLoader: React.FC<Props> = (props: Props) => {
    const location = useLocation();
    const workflowSession = useWorkflowSession();
    const scriptRegistry = useScriptRegistry();
    const [state, setState] = React.useState<State>({
        location: null,
        task: ScriptLoaderProgress.REFRESH,
        loadFrom: null,
        loadedScript: null,
        error: null,
    });

    // Find script in the location data
    React.useEffect(() => {
        if (workflowSession == null) return;
        if (state.task != ScriptLoaderProgress.REFRESH) return;
        const searchParams = new URLSearchParams(location.search);

        console.log('REFRESH');

        // URL refers to a raw script text?
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
                location,
                task: ScriptLoaderProgress.LOADING,
                loadFrom: null,
                loadedScript: script,
                error: null,
            });
            return;
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
                location,
                task: ScriptLoaderProgress.LOADING,
                loadFrom: request,
                loadedScript: null,
                error: null,
            });
            return;
        }

        // URL refers to an example?
        if (searchParams.has('example')) {
            const exampleName = searchParams.get('example')!;
            console.log('SET EXAMPLE');
            setState({
                ...state,
                location,
                task: ScriptLoaderProgress.LOADING,
                loadFrom: {
                    originType: ScriptOriginType.EXAMPLES,
                    fileName: exampleName,
                    exampleName,
                },
                loadedScript: null,
                error: null,
            });
            return;
        }

        // Load default example?
        if (state.loadedScript == null) {
            setState({
                ...state,
                location,
                task: ScriptLoaderProgress.LOADING,
                loadFrom: {
                    originType: ScriptOriginType.EXAMPLES,
                    fileName: DEFAULT_EXAMPLE,
                    exampleName: DEFAULT_EXAMPLE,
                },
                loadedScript: null,
                error: null,
            });
            return;
        }
    }, [state.task, workflowSession]);

    // Do the asynchronous load
    React.useEffect(() => {
        // Not loading?
        if (state.task != ScriptLoaderProgress.LOADING) return;
        console.log('LOADING');
        // Already loaded? (might happen if cached)
        if (state.loadedScript) {
            async () => {
                try {
                    console.log('UPDATE PROGRAM');
                    await workflowSession.updateProgram(state.loadedScript.text);
                    setState(s => ({
                        ...s,
                        task: ScriptLoaderProgress.SUCCEEDED,
                        error: null,
                    }));
                } catch (e) {
                    setState(s => ({
                        ...s,
                        task: ScriptLoaderProgress.FAILED,
                        error: e,
                    }));
                    return;
                }
            };
            return;
        }
        // No loadFrom set?
        if (!state.loadFrom) {
            console.warn('script loader loading but loadFrom is not set');
            return;
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
                            setState(s => ({
                                ...s,
                                task: ScriptLoaderProgress.FAILED,
                                error: resp.statusText,
                            }));
                            return;
                        }
                        const text = resp.data as string;
                        console.log('UPDATE PROGRAM');
                        await workflowSession.updateProgram(text);
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
                        setState(s => ({
                            ...s,
                            task: ScriptLoaderProgress.SUCCEEDED,
                            loadedScript: script,
                            error: null,
                        }));
                    } catch (e) {
                        setState(s => ({
                            ...s,
                            task: ScriptLoaderProgress.FAILED,
                            error: e,
                        }));
                        return;
                    }
                })();
                break;

            case ScriptOriginType.EXAMPLES: {
                const example = examples.EXAMPLE_SCRIPT_MAP.get(state.loadFrom.exampleName!)!;
                (async () => {
                    try {
                        const script = await examples.getScript(example);
                        console.log('UPDATE PROGRAM');
                        await workflowSession.updateProgram(script.text);
                        setState(s => ({
                            ...s,
                            task: ScriptLoaderProgress.SUCCEEDED,
                            loadedScript: script,
                            error: null,
                        }));
                    } catch (e) {
                        setState(s => ({
                            ...s,
                            task: ScriptLoaderProgress.FAILED,
                            error: e,
                        }));
                        return;
                    }
                })();
                break;
            }
            default:
                console.warn(`cannot load from script origin ${state.loadFrom.originType}`);
        }
    }, [state.task, state.loadFrom]);

    switch (state.task) {
        case ScriptLoaderProgress.REFRESH:
        case ScriptLoaderProgress.LOADING:
            return <CenteredRectangleWaveSpinner className={styles.spinner} active={true} color={'rgb(36, 41, 46)'} />;
        case ScriptLoaderProgress.FAILED:
            return <div />;
        case ScriptLoaderProgress.SUCCEEDED:
            return props.children;
    }
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
