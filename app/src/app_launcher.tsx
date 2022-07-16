import * as React from 'react';
import * as model from './model';

import { StatusIndicator } from './components/status_indicator';
import { AppConfigResolver, useAppConfig } from './model/app_config';

import logo from '../static/svg/logo/logo.svg';
import styles from './app_launcher.module.css';

import { InstantiationStatus, useBackend, useBackendResolver } from './backend/backend_provider';

interface Props {
    children: JSX.Element;
}

const AppLaunchSequence: React.FC<Props> = (props: Props) => {
    // const config = useAppConfig();
    const backend = useBackend();
    const resolveBackend = useBackendResolver();

    // Resolve backend if not done yet
    React.useEffect(() => {
        if (!backend.resolving()) {
            resolveBackend();
        }
    }, [backend]);

    // Render status steps
    const renderBackendStatus = (label: string, status: InstantiationStatus | null, error: any | null) => {
        let indicator = model.ResolvableStatus.NONE;
        switch (status) {
            case InstantiationStatus.WAITING:
                indicator = model.ResolvableStatus.NONE;
                break;
            case InstantiationStatus.READY:
                indicator = model.ResolvableStatus.COMPLETED;
                break;
            case InstantiationStatus.INSTANTIATING:
            case InstantiationStatus.PREPARING:
            case InstantiationStatus.CONFIGURING:
                indicator = model.ResolvableStatus.RUNNING;
                break;
            case InstantiationStatus.FAILED:
                indicator = model.ResolvableStatus.FAILED;
                break;
        }
        return (
            <div key={label} className={styles.step}>
                <div className={styles.step_status}>
                    <StatusIndicator width="18px" height="18px" status={indicator} />
                </div>
                <div className={styles.step_name}>{label}</div>
            </div>
        );
    };

    // // Render status steps
    // const renderStatus = (label: string, status: model.ResolvableStatus) => (
    //     <div key={label} className={styles.step}>
    //         <div className={styles.step_status}>
    //             <StatusIndicator width="18px" height="18px" status={status} />
    //         </div>
    //         <div className={styles.step_name}>{label}</div>
    //     </div>
    // );

    // const completed = config.value != null;
    // if (completed) {
    //     return props.children;
    // }

    if (backend.progress == null) {
        return <div />;
    }

    const [dbStatus, dbError] = backend.progress.db;
    const [parserStatus, parserError] = backend.progress.parser;
    const [coreStatus, coreError] = backend.progress.core;

    return (
        <div className={styles.launcher}>
            <div className={styles.inner}>
                <div className={styles.logo}>
                    <svg width="110px" height="110px">
                        <use xlinkHref={`${logo}#sym`} />
                    </svg>
                </div>
                <div className={styles.steps}>
                    {renderBackendStatus('Parser', parserStatus, parserError)}
                    {renderBackendStatus('Database', dbStatus, dbError)}
                    {renderBackendStatus('Core', coreStatus, coreError)}
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
