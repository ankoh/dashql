import * as React from 'react';
import * as core from '@dashql/core';
import axios from 'axios';
import { useLocation } from 'react-router-dom';

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
    requestURI: [core.model.ScriptURIPrefix, string] | null;
    status: ScriptLoaderStatus;
    error: any | null;
}

export const ScriptLoader: React.FC<Props> = (props: Props) => {
    const location = useLocation();
    const programContextDispatch = core.model.useProgramContextDispatch();
    const [state, setState] = React.useState<State>({
        requestURL: null,
        requestURI: null,
        status: ScriptLoaderStatus.SUCCEEDED,
        error: null,
    });

    const gist = new URLSearchParams(location.search).get('gist') || undefined;
    let requestURI: [core.model.ScriptURIPrefix, string] | null = null;
    let requestURL: string | null = null;
    if (gist) {
        requestURI = [core.model.ScriptURIPrefix.GITHUB_GIST, gist];
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

    const loadScriptFromURL = async (url: string, uri: [core.model.ScriptURIPrefix, string]) => {
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
            setState({
                ...state,
                status: ScriptLoaderStatus.SUCCEEDED,
                error: null,
            });
            programContextDispatch({
                type: core.model.SET_SCRIPT,
                data: {
                    text,
                    uriPrefix: uri[0],
                    uriName: uri[1],
                    modified: false,
                    lineCount: core.utils.countLines(text),
                    bytes: core.utils.estimateUTF16Length(text),
                },
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
            return <div />;
        case ScriptLoaderStatus.FAILED:
            return props.errorComponent?.(state.error) || <div />;
        case ScriptLoaderStatus.IN_FLIGHT:
            return props.progressComponent?.(0.0) || <div />;
        case ScriptLoaderStatus.SUCCEEDED:
            return props.children;
    }
};
