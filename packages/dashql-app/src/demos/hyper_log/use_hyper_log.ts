import * as React from 'react';

import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { useLogger } from '../../host/logger_provider.js';
import {
    type HyperLogMetrics,
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

/// The time that the rows reach back, the largest window of the dashboard
const RETAINED_MS = 60 * 60_000;

/// The state of the extract of the Hyper log, it changes with every transfer of new rows
export function useHyperLogState(metrics: HyperLogMetrics): HyperLogState {
    return React.useSyncExternalStore(metrics.state.subscribe, metrics.state.get);
}

/// The rows of the extract of the Hyper log
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

/// The rows of the last hour, read from the extract with the reader of the monitor.
/// Every transfer of the extract reads the rows after the last read row and appends them.
export function useHyperLogRows(metrics: HyperLogMetrics): HyperLogRows {
    const logger = useLogger();
    const state = useHyperLogState(metrics);
    const [rows, setRows] = React.useState<HyperLogRows>(NO_ROWS);
    const reader = React.useRef({
        /// The monitor of the read rows
        metrics: null as HyperLogMetrics | null,
        /// Changes with the monitor, the reads of an earlier generation are dropped
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
        const { queryEnds, resourceMetrics } = state;
        if (queryEnds == null || resourceMetrics == null) return;
        const current = reader.current;
        // Start over for another monitor
        if (current.metrics !== metrics) {
            current.metrics = metrics;
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
            const queryTable = await metrics.query(queryEndsQuery(queryEnds, { afterRow: current.queryEndsRow, since }));
            const sampleTable = await metrics.query(resourceSamplesQuery(resourceMetrics, { afterRow: current.resourceMetricsRow, since }));
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
    }, [state, metrics, logger]);
    return rows;
}
