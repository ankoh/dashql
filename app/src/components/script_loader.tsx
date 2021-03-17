import * as React from 'react';
import * as model from '../model';
import * as core from '@dashql/core';
import { connect } from 'react-redux';
import axios from 'axios';
import { RouteComponentProps, withRouter } from 'react-router';

interface MatchParams {
    gist?: string;
}

interface Props extends RouteComponentProps<MatchParams> {
    progressComponent?: (progress: number) => React.ReactElement;
    errorComponent?: (error: string) => React.ReactElement;
    children: React.ReactElement;

    updateScript: (script: core.model.Script) => void;
}

enum ScriptLoaderStatus {
    PENDING,
    IN_FLIGHT,
    FAILED,
    SUCCEEDED,
}

interface State {
    requestURL: string | null;
    requestURI: string | null;
    status: ScriptLoaderStatus;
    error: any | null;
}

class ScriptLoader extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = ScriptLoader.getDerivedStateFromProps(props, {
            requestURL: null, 
            requestURI: null, 
            status: ScriptLoaderStatus.SUCCEEDED,
            error: false,
        });
    }

    static getDerivedStateFromProps(nextProps: Props, prevState: State) {
        const gist = new URLSearchParams(nextProps.location.search).get("gist") || undefined;
        let requestURL = null;
        let requestURI = null;
        if (gist) {
            requestURI = `gist://${gist}`;
            requestURL = `https://gist.githubusercontent.com/ankoh/${gist}/raw`;
        }
        if (requestURI == prevState.requestURI) {
            return prevState;
        } else {
            return {
                requestURL,
                requestURI,
                status: ScriptLoaderStatus.PENDING,
                error: null,
            };
        }
    }

    async loadScriptFromURL(url: string, uri: string) {
        this.setState({
            status: ScriptLoaderStatus.IN_FLIGHT,
            error: null,
        });
        try {
            console.log(url);
            const resp = await axios.get(url);
            if (resp.status != 200) {
                console.error(`Loading from URL ${url} failed with error: ${resp.statusText}`);
                this.setState({
                    status: ScriptLoaderStatus.FAILED,
                    error: resp.statusText,
                });
                return;
            }
            const text = resp.data as string;
            this.setState({
                status: ScriptLoaderStatus.SUCCEEDED,
                error: null,
            });
            this.props.updateScript({
                text, uri,
                modified: false,
                lineCount: core.utils.countLines(text),
                bytes: core.utils.estimateUTF16Length(text),
            });
        } catch (e) {
            this.setState({
                status: ScriptLoaderStatus.FAILED,
                error: e,
            });
            return;
        }
    }

    loadScript() {
        if (this.state.status != ScriptLoaderStatus.PENDING)
            return;
        this.loadScriptFromURL(this.state.requestURL!, this.state.requestURI!);
    }

    componentDidMount() {
        this.loadScript();
    }

    componentDidUpdate() {
        this.loadScript();
    }

    public render() {
        switch (this.state.status) {
            case ScriptLoaderStatus.PENDING:
                return <div />;
            case ScriptLoaderStatus.FAILED:
                return this.props.errorComponent?.(this.state.error) || <div />;
            case ScriptLoaderStatus.IN_FLIGHT:
                return this.props.progressComponent?.(0.0) || <div />;
            case ScriptLoaderStatus.SUCCEEDED:
                return this.props.children;
        }
    }
}

const mapStateToProps = (state: model.AppState) => ({
    script: state.core.script,
    program: state.core.program || new core.model.Program(),
});

const mapDispatchToProps = (dispatch: model.Dispatch) => ({
    updateScript: (script: core.model.Script) =>
        model.mutate(dispatch, {
            type: core.model.StateMutationType.SET_SCRIPT,
            data: script,
        }),
});

export default connect(mapStateToProps, mapDispatchToProps)(withRouter(ScriptLoader));