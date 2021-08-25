import * as React from 'react';
import * as model from '../model';
import * as utils from '../utils';
import axios from 'axios';
import { useLocation } from 'react-router-dom';
import { RectangleWaveSpinner } from './spinners';
import { ScriptOriginType } from '../model';
import { useAnalyzer } from '../analyzer';

import styles from './script_loader.module.css';

interface Props {
    progressComponent?: (progress: number) => React.ReactElement;
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
    requestURL: string | null;
    requestURI: [model.ScriptOriginType, string] | null;
    status: ScriptLoaderStatus;
    error: any | null;
}

export const ScriptLoader: React.FC<Props> = (props: Props) => {
    const analyzer = useAnalyzer();
    const location = useLocation();
    const programContextDispatch = model.useProgramContextDispatch();
    const [state, setState] = React.useState<State>({
        requestURL: null,
        requestURI: null,
        status: ScriptLoaderStatus.SUCCEEDED,
        error: null,
    });

    const gist = new URLSearchParams(location.search).get('gist') || undefined;
    let requestURI: [model.ScriptOriginType, string] | null = null;
    let requestURL: string | null = null;
    if (gist) {
        requestURI = [model.ScriptOriginType.GITHUB_GIST, gist];
        requestURL = `https://gist.githubusercontent.com/ankoh/${gist}/raw`;
    }
    if (requestURI && (requestURI[0] != state.requestURI?.[0] || requestURI[1] != state.requestURI?.[1])) {
        setState({
            ...state,
            requestURL: requestURL,
            requestURI: requestURI,
            status: ScriptLoaderStatus.PENDING,
            error: null,
        });
    }

    const loadScriptFromURL = async (url: string, uri: [model.ScriptOriginType, string]) => {
        setState({
            ...state,
            status: ScriptLoaderStatus.IN_FLIGHT,
            error: null,
        });
        try {
            const resp = await axios.get(url);
            if (resp.status != 200) {
                console.error(`Loading from URL ${url} failed with error: ${resp.statusText}`);
                setState({
                    ...state,
                    status: ScriptLoaderStatus.FAILED,
                    error: resp.statusText,
                });
                return;
            }
            const text = resp.data as string;
            const program = analyzer.parseProgram(text);
            const script: model.Script = {
                origin: {
                    originType: ScriptOriginType.HTTPS,
                    fileName: '',
                    exampleName: null,
                    httpURL: null,
                    githubAccount: null,
                    githubGistName: null,
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
                status: ScriptLoaderStatus.SUCCEEDED,
                error: null,
            });
        } catch (e) {
            setState({
                ...state,
                status: ScriptLoaderStatus.FAILED,
                error: e,
            });
            return;
        }
    };

    React.useEffect(() => {
        if (state.status != ScriptLoaderStatus.PENDING) return;
        loadScriptFromURL(state.requestURL!, state.requestURI!);
    }, [state.status]);

    switch (state.status) {
        case ScriptLoaderStatus.PENDING:
            return (
                <div className={styles.spinner_container}>
                    <RectangleWaveSpinner className={styles.spinner} active={true} color={'rgb(36, 41, 46)'} />
                </div>
            );
        case ScriptLoaderStatus.FAILED:
            return props.errorComponent?.(state.error) || <div />;
        case ScriptLoaderStatus.IN_FLIGHT:
            return props.progressComponent?.(0.0) || <div />;
        case ScriptLoaderStatus.SUCCEEDED:
            return props.children;
    }
};
