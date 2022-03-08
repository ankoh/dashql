import * as React from 'react';
import * as rd from '@duckdb/react-duckdb';
import * as model from './model';

import { DUCKDB_BUNDLES } from './duckdb_bundles';
import { StatusIndicator } from './components';
import { AnalyzerProvider, useAnalyzer, useAnalyzerResolver } from './analyzer';
import { JMESPathProvider } from './jmespath';
import { AppConfigResolver } from './app_config';
import { DatabaseClient, DatabaseClientProvider } from './database_client';
import { ProgramPipeline } from './program_pipeline';
import { useAppConfig } from './app_config';

import logo from '../static/svg/logo/logo.svg';

import styles from './app_launcher.module.css';

import { HTTPClientProvider } from './http_client';

interface Props {
    children: JSX.Element;
}

const LaunchLogic: React.FC<Props> = (props: Props) => {
    const config = useAppConfig();
    const analyzer = useAnalyzer();
    const resolveAnalyzer = useAnalyzerResolver();
    const database = rd.useDuckDB();
    const databaseStatus = rd.useDuckDBStatus();
    const databaseLauncher = rd.useDuckDBLauncher();
    const metadata = model.useDatabaseMetadata();
    const metadataDispatch = model.useDatabaseMetadataDispatch();
    const [dbc, setDbc] = React.useState<DatabaseClient | null>(null);

    // Initialize database
    const connecting = React.useRef<boolean>(false);
    React.useEffect(() => {
        if (database == null) {
            databaseLauncher();
        } else if (database != null && !connecting.current) {
            connecting.current = true;
            const connect = async () => {
                const conn = await database.connect();
                const client = new DatabaseClient(conn, metadata, metadataDispatch);
                setDbc(client);
            };
            connect();
        }
    }, [database]);

    // Initialize analyzer
    React.useEffect(() => {
        if (analyzer.value == null) {
            resolveAnalyzer();
        }
    }, [analyzer.value]);

    // Launch completed?
    const completed = config.value != null && analyzer.value != null && database != null && dbc != null;
    if (completed) {
        return (
            <DatabaseClientProvider database={dbc!}>
                <HTTPClientProvider>
                    <ProgramPipeline>{props.children}</ProgramPipeline>
                </HTTPClientProvider>
            </DatabaseClientProvider>
        );
    }

    // Get the status
    let dbStatus = model.Status.NONE;
    if (database != null) {
        dbStatus = model.Status.COMPLETED;
    } else if (databaseStatus == null) {
        dbStatus = model.Status.NONE;
    } else if (databaseStatus.instantiationError != null) {
        dbStatus = model.Status.FAILED;
    } else if (databaseStatus.instantiationProgress != null) {
        dbStatus = model.Status.RUNNING;
    }

    // Render status steps
    const renderStatus = (label: string, status: model.Status) => (
        <div key={label} className={styles.step}>
            <div className={styles.step_status}>
                <StatusIndicator width="14px" height="14px" status={status} />
            </div>
            <div className={styles.step_name}>{label}</div>
        </div>
    );
    return (
        <div className={styles.launcher}>
            <div className={styles.inner}>
                <div className={styles.logo}>
                    <svg width="104px" height="104px">
                        <use xlinkHref={`${logo}#sym`} />
                    </svg>
                </div>
                <div className={styles.steps}>
                    {renderStatus('Configure the application', config.status)}
                    {renderStatus('Initialize the database', dbStatus)}
                    {renderStatus('Initialize the analyzer', analyzer.status)}
                </div>
            </div>
        </div>
    );
};

const DuckDBContext: React.FC<Props> = (props: Props) => {
    const logger = model.useLogger();
    return (
        <rd.DuckDBPlatform bundles={DUCKDB_BUNDLES} logger={logger}>
            <rd.DuckDBProvider>
                <rd.DuckDBConnectionProvider>{props.children}</rd.DuckDBConnectionProvider>
            </rd.DuckDBProvider>
        </rd.DuckDBPlatform>
    );
};

export const AppLauncher: React.FC<Props> = (props: Props) => {
    return (
        <AppConfigResolver>
            <AnalyzerProvider>
                <JMESPathProvider>
                    <DuckDBContext>
                        <LaunchLogic>{props.children}</LaunchLogic>
                    </DuckDBContext>
                </JMESPathProvider>
            </AnalyzerProvider>
        </AppConfigResolver>
    );
};
