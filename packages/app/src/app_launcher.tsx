import * as React from 'react';
import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as model from './model';
import * as examples from './example_scripts';

import { Analyzer } from './analyzer/bindings_browser';
import { JMESPath } from './jmespath/bindings_browser';
import { StatusIndicator } from './components';
import { AnalyzerProvider } from './analyzer';
import { JMESPathProvider } from './jmespath';

import axios from 'axios';
import config_url from '../static/config.json';
import {
    LaunchStepType,
    LAUNCH_STEPS,
    Status,
    UPDATE_LAUNCH_STEP,
    useLaunchProgress,
    useLaunchProgressDispatch,
} from './model/launch_progress';
import { AppConfig, AppConfigProvider } from './model';
import { DatabaseClient, DatabaseClientProvider } from './database_client';
import { ScriptPipeline } from './script_pipeline';

import logo from '../static/svg/logo/logo.svg';

import styles from './app_launcher.module.css';

import jmespath_wasm from './jmespath/jmespath_wasm.wasm';
import analyzer_wasm from './analyzer/analyzer_wasm.wasm';
import duckdb_wasm from '@dashql/duckdb/dist/duckdb.wasm';
import duckdb_wasm_next from '@dashql/duckdb/dist/duckdb-next.wasm';
import duckdb_wasm_next_coi from '@dashql/duckdb/dist/duckdb-next-coi.wasm';
import { HTTPClientProvider } from './http_client';

const DUCKDB_BUNDLES: duckdb.DuckDBBundles = {
    asyncDefault: {
        mainModule: duckdb_wasm,
        mainWorker: new URL('@dashql/duckdb/dist/duckdb-browser-async.worker.js', import.meta.url).toString(),
    },
    asyncNext: {
        mainModule: duckdb_wasm_next,
        mainWorker: new URL('@dashql/duckdb/dist/duckdb-browser-async-next.worker.js', import.meta.url).toString(),
    },
    asyncNextCOI: {
        mainModule: duckdb_wasm_next_coi,
        mainWorker: new URL('@dashql/duckdb/dist/duckdb-browser-async-next-coi.worker.js', import.meta.url).toString(),
        pthreadWorker: new URL(
            '@dashql/duckdb/dist/duckdb-browser-async-next-coi.pthread.worker.js',
            import.meta.url,
        ).toString(),
    },
};

interface Props {
    children: JSX.Element;
}

type State = {
    config: AppConfig | null;
    database: DatabaseClient | null;
    analyzer: Analyzer | null;
};

const resolveJMESPath = async () => {
    const jp = new JMESPath(jmespath_wasm);
    await jp.init();
    return jp;
};

export const AppLauncher: React.FC<Props> = (props: Props) => {
    const [state, stateDispatch] = React.useState<State>({
        config: null,
        database: null,
        analyzer: null,
    });
    const dbMetadata = model.useDatabaseMetadata();
    const dbMetadataDispatch = model.useDatabaseMetadataDispatch();
    const programContextDispatch = model.useProgramContextDispatch();
    const launchProgress = useLaunchProgress();
    const launchProgressDispatch = useLaunchProgressDispatch();
    const logger = model.useLogger();

    // Helper to update a launch step
    const updateStep = (step: LaunchStepType, status: Status, error?: any) => {
        launchProgressDispatch({
            type: UPDATE_LAUNCH_STEP,
            data: {
                type: step,
                status,
                error,
            },
        });
    };

    // Configure the application
    React.useEffect(() => {
        (async () => {
            try {
                const resp = await axios.get(config_url);
                if (!model.isAppConfig(resp.data)) {
                    updateStep(LaunchStepType.CONFIGURE_APP, Status.FAILED, 'invalid app config');
                    return null;
                }
                stateDispatch(s => ({ ...s, config: resp.data as model.AppConfig }));
                updateStep(LaunchStepType.CONFIGURE_APP, Status.COMPLETED);
            } catch (e) {
                console.error(e);
                updateStep(LaunchStepType.CONFIGURE_APP, Status.FAILED, e);
            }
        })();
    }, []);

    // Initialize DuckDB
    React.useEffect(() => {
        if (state.config == null || state.database != null) return;
        (async () => {
            updateStep(LaunchStepType.INIT_DATABASE, Status.RUNNING);
            try {
                const config = await duckdb.configure(DUCKDB_BUNDLES);
                const worker = new Worker(config.mainWorker!);
                const db = new duckdb.AsyncDuckDB(logger, worker);
                await db.instantiate(config.mainModule, config.pthreadWorker);
                const client = new DatabaseClient(db, dbMetadata, dbMetadataDispatch);
                await client.connect();
                console.log(await db.getVersion());
                stateDispatch(s => ({ ...s, database: client }));
                updateStep(LaunchStepType.INIT_DATABASE, Status.COMPLETED);
            } catch (e) {
                console.error(e);
                updateStep(LaunchStepType.INIT_DATABASE, Status.FAILED, e);
            }
        })();
    }, [state.config, state.database]);

    // Initialize the analyzer
    React.useEffect(() => {
        if (state.config == null || state.analyzer != null) return;
        (async () => {
            updateStep(LaunchStepType.INIT_ANALYZER, Status.RUNNING);
            try {
                const ana = new Analyzer({}, analyzer_wasm);
                await ana.init();
                stateDispatch(s => ({ ...s, analyzer: ana }));
                updateStep(LaunchStepType.INIT_ANALYZER, Status.COMPLETED);
            } catch (e) {
                updateStep(LaunchStepType.INIT_ANALYZER, Status.FAILED, e);
            }
        })();
    }, [state.config, state.analyzer]);

    /// Load the example script when database and analyzer are ready
    React.useEffect(() => {
        if (state.database == null || state.analyzer == null) return;
        (async () => {
            const example = examples.EXAMPLE_SCRIPT_MAP.get('demo_unischema')!;
            const script = await examples.getScript(example);
            programContextDispatch({
                type: model.SET_SCRIPT,
                data: script,
            });
        })();
    }, [state.database, state.analyzer]);

    // Render the loading spinner
    // XXX wasm instantiation progress with readable stream proxy!
    if (launchProgress.complete) {
        return (
            <AppConfigProvider config={state.config!}>
                <DatabaseClientProvider database={state.database!}>
                    <AnalyzerProvider analyzer={state.analyzer!}>
                        <JMESPathProvider resolver={resolveJMESPath}>
                            <HTTPClientProvider>
                                <ScriptPipeline>{props.children}</ScriptPipeline>
                            </HTTPClientProvider>
                        </JMESPathProvider>
                    </AnalyzerProvider>
                </DatabaseClientProvider>
            </AppConfigProvider>
        );
    }
    return (
        <div className={styles.launcher}>
            <div className={styles.inner}>
                <div className={styles.logo}>
                    <img src={logo} />
                </div>
                <div className={styles.title}>DashQL</div>
                <div className={styles.steps}>
                    {LAUNCH_STEPS.map(s => {
                        const step = launchProgress.steps.get(s)!;
                        return (
                            <div key={s as number} className={styles.step}>
                                <div className={styles.step_status}>
                                    <StatusIndicator width="14px" height="14px" status={step.status} />
                                </div>
                                <div className={styles.step_name}>{step.label}</div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
