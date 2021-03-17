import * as React from 'react';
import * as model from '../model';
import * as core from '@dashql/core';
import { connect } from 'react-redux';
import { RouteComponentProps, withRouter } from 'react-router';
import axios from 'axios';

interface Props {
    gist?: string;

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
    request: string | null;
    status: ScriptLoaderStatus;
    error: any | null;
}

class ScriptLoader extends React.Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = ScriptLoader.getDerivedStateFromProps(props, {
            request: null, 
            status: ScriptLoaderStatus.SUCCEEDED,
            error: false,
        });
    }

    static getDerivedStateFromProps(nextProps: Props, prevState: State) {
        let request = null;
        console.log(nextProps);
        if (nextProps.gist) {
            request = `https://gist.githubusercontent.com/ankoh/${nextProps.gist}/raw`;
        }
        if (request == prevState.request) {
            return prevState;
        } else {
            return {
                request,
                status: ScriptLoaderStatus.PENDING,
                error: null,
            };
        }
    }

    async loadScriptFromURL(url: string, name: string) {
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
                text,
                modified: false,
                lineCount: core.utils.countLines(text),
                bytes: core.utils.estimateUTF16Length(text),
                fileName: name || '-',
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
        this.loadScriptFromURL(this.state.request!, `gist://${this.props.gist}`);
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

export default connect(mapStateToProps, mapDispatchToProps)(ScriptLoader);