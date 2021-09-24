import * as React from 'react';
import * as model from '../model';
import * as utils from '../utils';
import * as examples from '../example_scripts';
import axios from 'axios';
import lz from 'lz-string';
import { useLocation } from 'react-router-dom';
import { CenteredRectangleWaveSpinner } from './spinners';
import { generateLocalFileName, ScriptOriginType, useProgramContext, useScriptRegistry } from '../model';
import { useAnalyzer } from '../analyzer';

import styles from './script_loader.module.css';

const DEFAULT_EXAMPLE = 'demo_vaccination_germany';

interface Props {
    errorComponent?: (error: string) => React.ReactElement;
    children: React.ReactElement;
}

enum ScriptLoaderStatus {
    PENDING,
    IN_FLIGHT,
    FAILED,
    SUCCEEDED,
}

interface State {
    location: any | null;
    status: ScriptLoaderStatus;
    request: model.ScriptOrigin | null;
    error: any | null;
}

export const ScriptLoader: React.FC<Props> = (props: Props) => {
    const analyzer = useAnalyzer();
    const location = useLocation();
    const scriptRegistry = useScriptRegistry();
    const programContext = useProgramContext();
    const programContextDispatch = model.useProgramContextDispatch();
    const [state, setState] = React.useState<State>({
        location: null,
        status: ScriptLoaderStatus.PENDING,
        request: null,
        error: null,
    });

    React.useEffect(() => {
        if (location == state.location) return;
        const searchParams = new URLSearchParams(location.search);

        // URL refers to a raw script text?
        if (searchParams.has('text')) {
            const text = lz.decompressFromBase64(searchParams.get('text')!) || '-- Decoding failed';
            const program = analyzer.parseProgram(text);
            const script: model.Script = {
                origin: {
                    originType: ScriptOriginType.LOCAL,
                    fileName: searchParams.get('name') || generateLocalFileName(scriptRegistry),
                },
                text,
                description: '',
                modified: false,
                lineCount: utils.countLines(text),
                bytes: utils.estimateUTF16Length(text),
            };
            programContextDispatch({
                type: model.REPLACE_PROGRAM,
                data: [program, script],
            });
            setState({
                ...state,
                location,
                status: ScriptLoaderStatus.SUCCEEDED,
                request: null,
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
                status: ScriptLoaderStatus.PENDING,
                request: request,
                error: null,
            });
            return;
        }

        // URL refers to an example?
        if (searchParams.has('example')) {
            const exampleName = searchParams.get('example')!;
            setState({
                ...state,
                location,
                status: ScriptLoaderStatus.PENDING,
                request: {
                    originType: ScriptOriginType.EXAMPLES,
                    fileName: exampleName,
                    exampleName,
                },
                error: null,
            });
            return;
        }

        // Load default example?
        if (programContext.script == null) {
            setState({
                ...state,
                location,
                status: ScriptLoaderStatus.PENDING,
                request: {
                    originType: ScriptOriginType.EXAMPLES,
                    fileName: DEFAULT_EXAMPLE,
                    exampleName: DEFAULT_EXAMPLE,
                },
                error: null,
            });
            return;
        }

        // Otherwise assume that everything is fine
        setState({
            ...state,
            location,
            status: ScriptLoaderStatus.SUCCEEDED,
            request: null,
            error: null,
        });
    }, [state.location]);

    // Do the asynchronous load
    React.useEffect(() => {
        if (state.status != ScriptLoaderStatus.PENDING || !state.request) return;

        switch (state.request.originType) {
            case ScriptOriginType.HTTPS:
            case ScriptOriginType.HTTP:
                (async () => {
                    setState(s => ({
                        ...s,
                        status: ScriptLoaderStatus.IN_FLIGHT,
                        error: null,
                    }));
                    try {
                        const resp = await axios.get(state.request.httpURL.toString() || '');
                        if (resp.status != 200) {
                            console.error(
                                `Loading from URL ${state.request.httpURL} failed with error: ${resp.statusText}`,
                            );
                            setState(s => ({
                                ...s,
                                status: ScriptLoaderStatus.FAILED,
                                error: resp.statusText,
                            }));
                            return;
                        }
                        const text = resp.data as string;
                        const program = analyzer.parseProgram(text);
                        const script: model.Script = {
                            origin: {
                                originType: ScriptOriginType.HTTPS,
                                fileName: '',
                            },
                            text,
                            description: '',
                            modified: false,
                            lineCount: utils.countLines(text),
                            bytes: utils.estimateUTF16Length(text),
                        };
                        programContextDispatch({
                            type: model.REPLACE_PROGRAM,
                            data: [program, script],
                        });
                        setState(s => ({
                            ...s,
                            status: ScriptLoaderStatus.SUCCEEDED,
                            error: null,
                        }));
                    } catch (e) {
                        setState(s => ({
                            ...s,
                            status: ScriptLoaderStatus.FAILED,
                            error: e,
                        }));
                        return;
                    }
                })();
                break;

            case ScriptOriginType.EXAMPLES: {
                const example = examples.EXAMPLE_SCRIPT_MAP.get(state.request.exampleName!)!;
                (async () => {
                    setState(s => ({
                        ...s,
                        status: ScriptLoaderStatus.IN_FLIGHT,
                        error: null,
                    }));
                    try {
                        const script = await examples.getScript(example);
                        const program = analyzer.parseProgram(script.text);
                        programContextDispatch({
                            type: model.REPLACE_PROGRAM,
                            data: [program, script],
                        });
                        setState(s => ({
                            ...s,
                            status: ScriptLoaderStatus.SUCCEEDED,
                            error: null,
                        }));
                    } catch (e) {
                        setState(s => ({
                            ...s,
                            status: ScriptLoaderStatus.FAILED,
                            error: e,
                        }));
                        return;
                    }
                })();
                break;
            }
        }
    }, [state.status, state.request]);

    switch (state.status) {
        case ScriptLoaderStatus.IN_FLIGHT:
        case ScriptLoaderStatus.PENDING:
            return <CenteredRectangleWaveSpinner className={styles.spinner} active={true} color={'rgb(36, 41, 46)'} />;
        case ScriptLoaderStatus.FAILED:
            return <div />;
        case ScriptLoaderStatus.SUCCEEDED:
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
