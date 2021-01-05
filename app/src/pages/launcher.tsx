import * as Immutable from "immutable";
import * as React from "react";
import { AppState, Dispatch, LaunchStep, LaunchStepInfo, DEFAULT_LAUNCH_STEPS } from '../model';
import { StatusIndicator } from '../components';
import { connect } from 'react-redux';

import logo from '../../public/logo/preliminary.png';

import styles from './launcher.module.css';

interface Props {
    launchComplete: boolean;
    launchSteps: Immutable.Map<LaunchStep, LaunchStepInfo>;
    children: JSX.Element,
}

class Launcher extends React.Component<Props> {
    public renderStep(s: LaunchStep) {
        const info = this.props.launchSteps.get(s);
        if (!info) {
            return null;
        }
        return (
            <div key={s as number} className={styles.step}>
                <div className={styles.step_status}>
                    <StatusIndicator width="14px" height="14px" status={info.status} />
                </div>
                <div className={styles.step_name}>
                    {info.label}
                </div>
            </div>
        );
    }

    public render() {
        if (this.props.launchComplete) {
            return this.props.children;
        }
        return (
            <div className={styles.launcher}>
                <div className={styles.inner}>
                    <div className={styles.logo}>
                        <img src={logo} />
                    </div>
                    <div className={styles.title}>
                        DashQL
                    </div>
                    <div className={styles.steps}>
                        {DEFAULT_LAUNCH_STEPS.map(s => this.renderStep(s))}
                    </div>
                </div>
            </div>
        )
    }
}

const mapStateToProps = (state: AppState) => ({
    launchComplete: state.launchComplete,
    launchSteps: state.launchSteps,
});

const mapDispatchToProps = (_dispatch: Dispatch) => ({
});

export default connect(mapStateToProps, mapDispatchToProps)(Launcher);

