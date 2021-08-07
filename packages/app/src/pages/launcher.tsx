import * as React from 'react';
import { AppState, LaunchStep, LaunchStepInfo, DEFAULT_LAUNCH_STEPS } from '../model';
import { StatusIndicator } from '../components';
import { useSelector } from 'react-redux';

import logo from '../../static/svg/logo/logo.svg';

import styles from './launcher.module.css';

interface Props {
    children: JSX.Element;
}

const renderStep = (s: LaunchStep, i: LaunchStepInfo) => (
    <div key={s as number} className={styles.step}>
        <div className={styles.step_status}>
            <StatusIndicator width="14px" height="14px" status={i.status} />
        </div>
        <div className={styles.step_name}>{i.label}</div>
    </div>
);

export const Launcher: React.FC<Props> = (props: Props) => {
    const { complete, steps } = useSelector((state: AppState) => ({
        complete: state.launchComplete,
        steps: state.launchSteps,
    }));
    if (complete) return props.children;
    return (
        <div className={styles.launcher}>
            <div className={styles.inner}>
                <div className={styles.logo}>
                    <img src={logo} />
                </div>
                <div className={styles.title}>DashQL</div>
                <div className={styles.steps}>{DEFAULT_LAUNCH_STEPS.map(s => renderStep(s, steps.get(s)!))}</div>
            </div>
        </div>
    );
};
