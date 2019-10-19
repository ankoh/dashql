import * as React from 'react';
import * as Model from '../model';
import { connect } from 'react-redux';
import { RectangleWaveSpinner } from './spinners';
import {
    StatusWarningIcon,
    StatusFailedIcon,
    StatusRunningIcon,
    StatusScheduledIcon,
    StatusSucceededIcon,
} from '../svg/icons';

import './launcher.scss';

interface ILauncherProps {
    progress: Model.LaunchProgress;
}

interface ILauncherState {
    spinner: number;
};

class Launcher extends React.Component<ILauncherProps, ILauncherState> {
    constructor(props: ILauncherProps) {
        super(props);
        this.state = {
            spinner: 0,
        };
    }

    public loop() {
        let self = this;
        setTimeout(function() {
            self.setState({ spinner: (self.state.spinner + 1) % 2 });
            self.loop();
        }, 1000);
    }

    public componentDidMount() {
        this.loop();
    }

    public renderProgressStepStatus(status: Model.LaunchProgressStatus) {
        return (
            <div className="launcher_progress_step_status">
            </div>
        );
    }

    public renderProgressStep(name: String, status: Model.LaunchProgressStatus) {
        let statusIcon: any;
        switch (status) {
            case Model.LaunchProgressStatus.PENDING:
                statusIcon = <StatusScheduledIcon fill="#48F4C1" />;
                break;
            case Model.LaunchProgressStatus.COMPLETED:
                statusIcon = <StatusSucceededIcon fill="#48F4C1" />;
                break;
            case Model.LaunchProgressStatus.FAILED:
                statusIcon = <StatusFailedIcon fill="#48F4C1" />;
                break;
            case Model.LaunchProgressStatus.STARTED:
                statusIcon = <StatusRunningIcon fill="#48F4C1" />;
                break;
            case Model.LaunchProgressStatus.WARNING:
                statusIcon = <StatusWarningIcon fill="#48F4C1" />;
                break;
            default:
                statusIcon = <div />;
        }
        return (
            <div className="launcher_progress_step">
                <div className="launcher_progress_step_status">
                    {statusIcon}
                </div>
                <div className="launcher_progress_step_name">
                    {name}
                </div>
            </div>
        );
    }

    public renderProgress() {
        return (
            <div className="launcher_progress">
                {this.renderProgressStep("Configure application", this.props.progress.app_configured)}
                {this.renderProgressStep("Compile core module", this.props.progress.core_instantiated)}
                {this.renderProgressStep("Check build version", this.props.progress.version_checked)}
            </div>
        );
    }

    public render() {
        return (
            <div className="launcher">
                <div className="launcher_container">
                    <div className="launcher_logo">
                        <img src="/img/logo_600.png" alt="Logo" />
                    </div>
                    <div className="launcher_header">
                        Tigon Analytics
                    </div>
                    <div className="launcher_build">
                        Build: <span className="launcher_build_commit">f90db02</span>
                    </div>
                    {this.renderProgress()}
                </div>
                <div className="launcher_spinner">
                    <RectangleWaveSpinner />
                </div>
            </div>
        );
    }
}

function mapStateToProps(state: Model.RootState) {
    return {
        progress: state.launchProgress
    };
}
function mapDispatchToProps(dispatch: Model.Dispatch) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(Launcher);
