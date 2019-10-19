import './status_bar.scss';
import * as React from 'react';
import * as Model from '../model';
import LogViewer from './log_viewer';
import { connect } from 'react-redux';

interface IStatusBarProps {
    logWarnings: number;
}

interface IStatusBarState {
    logsOpen: boolean;
}

export class StatusBar extends React.Component<IStatusBarProps, IStatusBarState> {
    constructor(props: IStatusBarProps) {
        super(props);
        this.state = {
            logsOpen: false
        };
        this.toggleLogViewer = this.toggleLogViewer.bind(this);
    }

    public render() {
        return (
            <div className="statusbar">
                <div />
                <div className="statusbar_right">
                    <div className="statusbar_bean">
                        <b>0&nbsp;</b>&nbsp;tasks
                    </div>
                    <div className="statusbar_bean">
                        <b>0&nbsp;</b>&nbsp;tables
                    </div>
                    <div className="statusbar_bean">
                        <b>0&nbsp;B</b>&nbsp;cached
                    </div>
                    <div
                        className={'statusbar_bean' + (this.state.logsOpen ? ' statusbar_logstats_active' : '')}
                        onClick={this.toggleLogViewer}
                    >
                        <b>{this.props.logWarnings}</b>&nbsp;warnings
                    </div>
                    {
                        this.state.logsOpen && (
                        <div className="statusbar_logviewer">
                            <LogViewer close={this.toggleLogViewer} />
                        </div>
                        )
                    }
                </div>
            </div>
        );
    }

    protected toggleLogViewer() {
        this.setState((s) => ({ ...s, logsOpen: !s.logsOpen }));
    }
}

// Map state to props
function mapStateToProps(state: Model.RootState) {
    return {
        logWarnings: state.logWarnings,
    };
}
// Map llvm explorer dispatchs
function mapDispatchToProps(dispatch: Model.RootState) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(StatusBar);
