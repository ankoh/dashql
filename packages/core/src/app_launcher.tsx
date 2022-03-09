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
    const resolveDatabase = rd.useDuckDBResolver();
    const metadata = model.useDatabaseMetadata();
    const metadataDispatch = model.useDatabaseMetadataDispatch();
    const [dbc, setDbc] = React.useState<DatabaseClient | null>(null);

    // Resolve database and analyzer
    React.useEffect(() => {
        if (!database.resolving()) {
            resolveDatabase();
        }
        if (!analyzer.resolving()) {
            resolveAnalyzer();
        }
    }, [database, analyzer]);

    // Initialize database client
    const connecting = React.useRef<boolean>(false);
    React.useEffect(() => {
        if (database.value != null && !connecting.current) {
            connecting.current = true;
            const connect = async () => {
                const conn = await database.value.connect();
                const client = new DatabaseClient(conn, metadata, metadataDispatch);
                setDbc(client);
            };
            connect();
        }
    }, [database]);

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

    // Render status steps
    const renderStatus = (label: string, status: rd.ResolvableStatus) => (
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
                    {renderStatus('Initialize the database', database.status)}
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
            <DuckDBContext>
                <AnalyzerProvider>
                    <JMESPathProvider>
                        <LaunchLogic>{props.children}</LaunchLogic>
                    </JMESPathProvider>
                </AnalyzerProvider>
            </DuckDBContext>
        </AppConfigResolver>
    );
};
