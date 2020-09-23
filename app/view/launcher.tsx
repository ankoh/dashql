import * as React from 'react';
import * as Store from '../store';
import { connect } from 'react-redux';
import { RectangleWaveSpinner } from './spinners';
import {
    StatusWarningIcon,
    StatusFailedIcon,
    StatusRunningIcon,
    StatusScheduledIcon,
    StatusSucceededIcon,
} from '../svg/icons';

import styles from './launcher.module.scss';

interface ILauncherProps {
    progress: Store.LaunchProgress;
}

interface ILauncherState {
    spinner: number;
}

class Launcher extends React.Component<ILauncherProps, ILauncherState> {
    constructor(props: ILauncherProps) {
        super(props);
        this.state = {
            spinner: 0,
        };
    }

    public loop() {
        let self = this;
        setTimeout(function () {
            self.setState({ spinner: (self.state.spinner + 1) % 2 });
            self.loop();
        }, 1000);
    }

    public componentDidMount() {
        this.loop();
    }

    public renderProgressStepStatus(status: Store.LaunchProgressStatus) {
        return <div className={styles.launcher_progress_step_status}></div>;
    }

    public renderProgressStep(
        name: String,
        status: Store.LaunchProgressStatus,
    ) {
        let statusIcon: any;
        switch (status) {
            case Store.LaunchProgressStatus.PENDING:
                statusIcon = <StatusScheduledIcon fill="#48F4C1" />;
                break;
            case Store.LaunchProgressStatus.COMPLETED:
                statusIcon = <StatusSucceededIcon fill="#48F4C1" />;
                break;
            case Store.LaunchProgressStatus.FAILED:
                statusIcon = <StatusFailedIcon fill="#48F4C1" />;
                break;
            case Store.LaunchProgressStatus.STARTED:
                statusIcon = <StatusRunningIcon fill="#48F4C1" />;
                break;
            case Store.LaunchProgressStatus.WARNING:
                statusIcon = <StatusWarningIcon fill="#48F4C1" />;
                break;
            default:
                statusIcon = <div />;
        }
        return (
            <div className={styles.launcher_progress_step}>
                <div className={styles.launcher_progress_step_status}>
                    {statusIcon}
                </div>
                <div className={styles.launcher_progress_step_name}>{name}</div>
            </div>
        );
    }

    public renderProgress() {
        return (
            <div className={styles.launcher_progress}>
                {this.renderProgressStep(
                    'Configure application',
                    this.props.progress.app_configured,
                )}
                {this.renderProgressStep(
                    'Check releases',
                    this.props.progress.version_checked,
                )}
                {this.renderProgressStep(
                    'Compile core module',
                    this.props.progress.core_instantiated,
                )}
            </div>
        );
    }

    public render() {
        return (
            <div className={styles.launcher}>
                <div className={styles.launcher_container}>
                    <div className={styles.launcher_logo}>
                        <img src="/img/logo_600.png" alt="Logo" />
                    </div>
                    <div className={styles.launcher_header}>
                        DashQL Analytics
                    </div>
                    <div className={styles.launcher_build}>
                        Build:{' '}
                        <span className={styles.launcher_build_commit}>
                            f90db02
                        </span>
                    </div>
                    {this.renderProgress()}
                </div>
                <div className={styles.launcher_spinner}>
                    <RectangleWaveSpinner active={true} />
                </div>
            </div>
        );
    }
}

function mapStateToProps(state: Store.RootState) {
    return {
        progress: state.launchProgress,
    };
}
function mapDispatchToProps(dispatch: Store.Dispatch) {
    return {};
}

export default connect(mapStateToProps, mapDispatchToProps)(Launcher);
