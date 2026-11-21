import * as React from 'react';
import { Link } from 'react-router-dom';

import { createHyperDBOPFSInstance, type HyperDBOPFSInstance } from '@akohn/dashql/platform/hyperdb/hyperdb_opfs_instance';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { SegmentedControl, SegmentedControlSize } from '@akohn/dashql-react/components/segmented_control';
import { useRuntime } from '@akohn/dashql-react/hooks';
import { DashQLCoreProvider } from '../../host/core_provider.js';
import { useLogger } from '../../host/logger_provider.js';
import { StandaloneRuntime } from '../../host/standalone_runtime.js';
import { useDemoDataSource, type DemoDataSource } from '../shared/data_source.js';
import { HyperLogDashboard } from './hyper_log_dashboard.js';
import { HyperLogMetrics } from './hyper_log_metrics.js';
import { HyperLogMetricsProvider } from './hyper_log_metrics_provider.js';
import { createWorkloadTable, DEMO_CONNECTION_ID, HyperLogWorkload, type WorkloadCounts } from './hyper_log_workload.js';
import * as styles from './hyper_log_page.module.css';

const LOG_CTX = 'hyper_log_demo';

/// The rates of the workload in queries per second, 0 sends none
const RATES = [0, 1, 5];

/// The monitor of the log of the HyperDB WASM of the page. Its monitoring database lives in an OPFS instance folder of
/// its own, which is removed when the page goes and cleaned up as stale after a crash.
function useHyperLogMonitor(source: DemoDataSource | null): HyperLogMetrics | null {
    const logger = useLogger();
    const [metrics, setMetrics] = React.useState<HyperLogMetrics | null>(null);
    React.useEffect(() => {
        setMetrics(null);
        if (source == null) return;
        let instance: Promise<HyperDBOPFSInstance> | null = null;
        const monitor = new HyperLogMetrics({
            logger,
            sink: async () => source.embedded,
            prepareDatabase: async () => {
                instance ??= createHyperDBOPFSInstance();
                return `${(await instance).directoryPath}/monitoring.hyper`;
            },
        });
        monitor.watch({ database: source.database, sessions: true }, DEMO_CONNECTION_ID);
        setMetrics(monitor);
        return () => {
            void monitor.stop().then(async () => {
                await (await instance)?.dispose();
            }).catch(error => {
                logger.warn('Stopping the monitor of the Hyper log failed', { error: stringifyError(error) }, LOG_CTX);
            });
        };
    }, [source, logger]);
    return metrics;
}

/// The workload of the page, it creates its table first
function useWorkload(source: DemoDataSource | null, rate: number): { counts: WorkloadCounts; error: string | null } {
    const logger = useLogger();
    const [workload, setWorkload] = React.useState<HyperLogWorkload | null>(null);
    const [counts, setCounts] = React.useState<WorkloadCounts>({ sent: 0, failed: 0 });
    const [error, setError] = React.useState<string | null>(null);
    React.useEffect(() => {
        setWorkload(null);
        if (source == null) return;
        let stopped = false;
        let created: HyperLogWorkload | null = null;
        createWorkloadTable(source.embedded).then(() => {
            if (stopped) return;
            created = new HyperLogWorkload(source.embedded, setCounts);
            setWorkload(created);
        }, error => {
            logger.error('Creating the table of the workload failed', { error: stringifyError(error) }, LOG_CTX);
            if (!stopped) setError(error instanceof Error ? error.message : String(error));
        });
        return () => {
            stopped = true;
            created?.stop();
        };
    }, [source, logger]);
    React.useEffect(() => { workload?.setRate(rate); }, [workload, rate]);
    return { counts, error };
}

/// Set up the compute database of the runtime right away, the table of the queries analyzes its rows there
function PrepareComputeDatabase() {
    const runtime = useRuntime();
    React.useEffect(() => runtime.computeDatabase.prepare(), [runtime]);
    return null;
}

/// The query metrics of a Hyper from its log: a monitor extracts the log of the HyperDB WASM of the page into a
/// monitoring database every 5 seconds, while a workload sends queries. The table of the queries is a data table of
/// the app, it needs the core and a runtime of its own on the HyperDB WASM of the page.
export const HyperLogPage: React.FC = () => (
    <DashQLCoreProvider>
        <StandaloneRuntime fallback={<div className={styles.loading}>Loading the core…</div>}>
            <PrepareComputeDatabase />
            <HyperLogDemo />
        </StandaloneRuntime>
    </DashQLCoreProvider>
);

/// The page with the workload, the monitor and the dashboard
const HyperLogDemo: React.FC = () => {
    const { source, error: sourceError } = useDemoDataSource();
    const [rate, setRate] = React.useState(1);
    const metrics = useHyperLogMonitor(source);
    const workload = useWorkload(source, rate);
    const error = sourceError ?? workload.error;
    return (
        <div className={styles.root}>
            <header className={styles.header}>
                <div className={styles.title_row}>
                    <Link className={styles.back} to="/">Demos</Link>
                    <h1 className={styles.title}>Hyper Log</h1>
                    <SegmentedControl aria-label="Queries per second" data-testid="workload-rate" size={SegmentedControlSize.Small} onChange={i => setRate(RATES[i])}>
                        {RATES.map(r => <SegmentedControl.Button key={r} selected={r === rate}>{r === 0 ? 'Off' : `${r}/s`}</SegmentedControl.Button>)}
                    </SegmentedControl>
                    <span className={styles.counts} data-testid="workload-counts">
                        {`${workload.counts.sent} queries · ${workload.counts.failed} failed`}
                    </span>
                </div>
                {error != null && <p className={styles.error} role="alert">{error}</p>}
            </header>
            <main className={styles.main}>
                {metrics != null && (
                    <HyperLogMetricsProvider metrics={metrics}>
                        <HyperLogDashboard
                            connectionId={DEMO_CONNECTION_ID}
                            engine={<span data-testid="detail-version">{source?.version == null ? 'Hyper' : `Hyper ${source.version}`} · embedded (WebAssembly)</span>}
                        />
                    </HyperLogMetricsProvider>
                )}
            </main>
        </div>
    );
};

export default HyperLogPage;
