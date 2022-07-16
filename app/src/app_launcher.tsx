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
    const config = useAppConfig();
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
        let text = '';
        switch (status) {
            case null:
            case InstantiationStatus.WAITING:
                indicator = model.ResolvableStatus.NONE;
                text = 'WAIT';
                break;
            case InstantiationStatus.READY:
                indicator = model.ResolvableStatus.COMPLETED;
                text = 'READY';
                break;
            case InstantiationStatus.INSTANTIATING:
                indicator = model.ResolvableStatus.RUNNING;
                text = 'COMPILE';
                break;
            case InstantiationStatus.PREPARING:
                indicator = model.ResolvableStatus.RUNNING;
                text = 'PREP';
                break;
            case InstantiationStatus.CONFIGURING:
                indicator = model.ResolvableStatus.RUNNING;
                text = 'CONFIG';
                break;
            case InstantiationStatus.FAILED:
                indicator = model.ResolvableStatus.FAILED;
                text = 'ERROR';
                break;
        }
        return (
            <>
                <div className={styles.step_status}>
                    <StatusIndicator width="18px" height="18px" status={indicator} />
                </div>
                <div className={styles.step_name}>{label}</div>
                <div className={styles.step_status_text}>{text}</div>
            </>
        );
    };

    // Render status steps
    const renderStatus = (label: string, status: model.ResolvableStatus) => (
        <>
            <div className={styles.step_status}>
                <StatusIndicator width="18px" height="18px" status={status} />
            </div>
            <div className={styles.step_name}>{label}</div>
        </>
    );

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
                    {renderStatus('Configure App', config.status)}
                    {renderBackendStatus('DuckDB', dbStatus, dbError)}
                    {renderBackendStatus('DashQL Parser', parserStatus, parserError)}
                    {renderBackendStatus('DashQL Core', coreStatus, coreError)}
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
