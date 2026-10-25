import * as React from 'react';

import { useEmbeddedDatabaseSetup } from '../../../platform/database/embedded_database_provider.js';
import { useStorageReader } from '../../storage/storage_provider.js';
import { connectionMonitoringDatabasePath, isSessionRegistryBackend } from '../../storage/storage_backend.js';
import { stringifyError } from '../../../platform/logger/logger.js';
import { useLogger } from '../../../platform/logger/logger_provider.js';
import { useConnectionRegistryStore } from '../connection_registry.js';
import {
    CLOSED_LOG_STATE,
    HyperLogMetrics,
    lastExtractRow,
    queryEndsQuery,
    readQueryEnds,
    readResourceSamples,
    resourceSamplesQuery,
    type HyperLogState,
    type HyperQueryEnd,
    type HyperResourceSample,
} from './hyper_log_metrics.js';

const LOG_CTX = 'hyper_log_metrics';

const LOG_METRICS_CTX = React.createContext<HyperLogMetrics | null>(null);

/// The time that the rows of a connection reach back, the largest window of the connection metrics
const RETAINED_MS = 60 * 60_000;

interface Props {
    /// The children
    children: React.ReactElement;
}

/// Provides the extracts of the Hyper logs of the connections, in the monitoring databases in the folders of the
/// connections. The Hyper connections start their monitors, the monitors of deleted connections are stopped.
/// Must be nested in the connection registry and the embedded database, which holds the monitoring databases.
export const HyperLogMetricsProvider: React.FC<Props> = (props: Props) => {
    const logger = useLogger();
    const storage = useStorageReader();
    const registryStore = useConnectionRegistryStore();
    const setupEmbeddedDatabase = useEmbeddedDatabaseSetup();
    const [logMetrics] = React.useState(() => new HyperLogMetrics({
        logger,
        sink: () => setupEmbeddedDatabase('hyper_log_metrics'),
        prepareDatabase: async connectionId => {
            const backend = storage.backend;
            if (!isSessionRegistryBackend(backend)) throw new Error('the storage keeps no connection folders');
            await backend.createConnectionFolder(connectionId);
            return connectionMonitoringDatabasePath(connectionId);
        },
    }));
    React.useEffect(() => {
        const retain = () => logMetrics.retain(new Set(registryStore.current.connections.keys()));
        retain();
        return registryStore.subscribe(retain);
    }, [logMetrics, registryStore]);
    React.useEffect(() => () => { void logMetrics.stop(); }, [logMetrics]);
    return <LOG_METRICS_CTX.Provider value={logMetrics}>{props.children}</LOG_METRICS_CTX.Provider>;
};

/// The Hyper log metrics, null outside of a HyperLogMetricsProvider
export function useHyperLogMetrics(): HyperLogMetrics | null {
    return React.useContext(LOG_METRICS_CTX);
}

const NO_STATES: ReadonlyMap<string, HyperLogState> = new Map();
const NO_SUBSCRIPTION = () => () => {};

/// The state of the extract of the Hyper log of a connection, it changes with every transfer of new rows
export function useHyperLogState(connectionId: string): HyperLogState {
    const logMetrics = useHyperLogMetrics();
    const states = React.useSyncExternalStore(logMetrics?.state.subscribe ?? NO_SUBSCRIPTION, () => logMetrics?.state.current ?? NO_STATES);
    return states.get(connectionId) ?? CLOSED_LOG_STATE;
}

/// The rows of a connection in the extract of the Hyper log
export interface HyperLogRows {
    /// The finished queries of the connection, ordered by their end, see queryEndsQuery()
    queries: HyperQueryEnd[];
    /// The resource samples of the Hyper process, ordered by time
    samples: HyperResourceSample[];
}

const NO_ROWS: HyperLogRows = { queries: [], samples: [] };

/// Append rows that are mostly newer than the rows, and drop the rows before a time
function appendRows<T>(rows: T[], added: T[], time: (row: T) => number, since: number): T[] {
    if (added.length === 0 && (rows.length === 0 || time(rows[0]) >= since)) return rows;
    const all = rows.concat(added);
    // The events of a transfer can end before the events of the last one, e.g. the queries that ran during its read
    if (rows.length > 0 && added.length > 0 && time(added[0]) < time(rows[rows.length - 1])) {
        all.sort((l, r) => time(l) - time(r));
    }
    const first = all.findIndex(row => time(row) >= since);
    return first < 0 ? [] : all.slice(first);
}

/// The rows of a connection of the last hour, read from its extract with the reader of its monitor.
/// Every transfer of the extract reads the rows after the last read row and appends them.
export function useHyperLogRows(connectionId: string): HyperLogRows {
    const logger = useLogger();
    const logMetrics = useHyperLogMetrics();
    const state = useHyperLogState(connectionId);
    const [rows, setRows] = React.useState<HyperLogRows>(NO_ROWS);
    const reader = React.useRef({
        /// The connection of the read rows
        connectionId: null as string | null,
        /// Changes with the connection, the reads of an earlier generation are dropped
        generation: 0,
        /// The last read row of the query ends and the resource metrics, the row numbers of an extract never repeat
        queryEndsRow: 0,
        resourceMetricsRow: 0,
        /// The running reads, one after another
        reading: Promise.resolve(),
        /// Is a read queued that did not start yet?
        queued: false,
    });

    React.useEffect(() => {
        const { queryEnds, resourceMetrics, clockOffsetMs } = state;
        if (logMetrics == null || queryEnds == null || resourceMetrics == null || clockOffsetMs == null) return;
        const current = reader.current;
        // Start over for another connection
        if (current.connectionId !== connectionId) {
            current.connectionId = connectionId;
            current.generation += 1;
            current.queryEndsRow = 0;
            current.resourceMetricsRow = 0;
            current.queued = false;
            setRows(NO_ROWS);
        }
        // A queued read reads the rows of this transfer too
        if (current.queued) return;
        current.queued = true;
        const generation = current.generation;
        current.reading = current.reading.then(async () => {
            if (current.generation !== generation) return;
            current.queued = false;
            const since = Date.now() - RETAINED_MS;
            const queryTable = await logMetrics.query(connectionId, queryEndsQuery(queryEnds, clockOffsetMs, { afterRow: current.queryEndsRow, since }));
            const sampleTable = await logMetrics.query(connectionId, resourceSamplesQuery(resourceMetrics, clockOffsetMs, { afterRow: current.resourceMetricsRow, since }));
            if (current.generation !== generation) return;
            current.queryEndsRow = Math.max(current.queryEndsRow, lastExtractRow(queryTable));
            current.resourceMetricsRow = Math.max(current.resourceMetricsRow, lastExtractRow(sampleTable));
            const queries = readQueryEnds(queryTable);
            const samples = readResourceSamples(sampleTable);
            setRows(previous => ({
                queries: appendRows(previous.queries, queries, query => query.endedAt, since),
                samples: appendRows(previous.samples, samples, sample => sample.sampledAt, since),
            }));
        }).catch(error => {
            logger.warn('Reading the Hyper log extract failed', { error: stringifyError(error) }, LOG_CTX);
        });
    }, [state, connectionId, logMetrics, logger]);
    return rows;
}
