import * as React from 'react';
import * as model from './model';

import { StatusIndicator } from './components/status_indicator';
import { AppConfigResolver, useAppConfig } from './model/app_config';

import logo from '../static/svg/logo/logo.svg';
import styles from './app_launcher.module.css';

interface Props {
    children: JSX.Element;
}

const AppLaunchSequence: React.FC<Props> = (props: Props) => {
    const config = useAppConfig();

    // Render status steps
    const renderStatus = (label: string, status: model.ResolvableStatus) => (
        <div key={label} className={styles.step}>
            <div className={styles.step_status}>
                <StatusIndicator width="18px" height="18px" status={status} />
            </div>
            <div className={styles.step_name}>{label}</div>
        </div>
    );

    // const completed = config.value != null && analyzer.value != null && database != null && dbc != null;
    // if (completed) {
    //     return props.children;
    // }
    return (
        <div className={styles.launcher}>
            <div className={styles.inner}>
                <div className={styles.logo}>
                    <svg width="110px" height="110px">
                        <use xlinkHref={`${logo}#sym`} />
                    </svg>
                </div>
                <div className={styles.steps}>
                    {renderStatus('Configure the application', config.status)}
                    {renderStatus('Prepare the language analyzer', model.ResolvableStatus.RUNNING)}
                    {renderStatus('Prepare the embedded database', model.ResolvableStatus.RUNNING)}
                </div>
            </div>
        </div>
    );
};

export const AppLauncher: React.FC<Props> = (props: Props) => {
    return (
        <AppConfigResolver>
            <AppLaunchSequence>{props.children}</AppLaunchSequence>
        </AppConfigResolver>
    );
};
