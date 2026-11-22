import type { EmbeddedComputeDatabase, EmbeddedConnection } from '@akohn/dashql/platform/embedded_database';
import { hyperLogClientContext } from './hyper_log_metrics.js';

import SCHEMA_SQL from './sql/schema.sql?raw';
import AGGREGATE_SQL from './sql/aggregate.sql?raw';
import TOP_VALUES_SQL from './sql/top_values.sql?raw';
import DISTINCT_USERS_SQL from './sql/distinct_users.sql?raw';
import SERIES_SQL from './sql/series.sql?raw';
import FAILING_SQL from './sql/failing.sql?raw';

/// The connection that the demo attributes its queries to, the monitor extracts the log of this connection
export const DEMO_CONNECTION_ID = 'hyper_log_demo';

/// A query of the workload
export interface WorkloadQuery {
    /// The name of the query
    name: string;
    /// The text of the query
    sql: string;
    /// Does the app send the query, like a computation on a pooled compute connection? The dashboard tells these apart
    /// from the queries of the user.
    sentByApp: boolean;
}

/// The queries of the workload, one after another. The last one fails, so that the log holds errors too.
export const WORKLOAD_QUERIES: readonly WorkloadQuery[] = [
    { name: 'aggregate', sql: AGGREGATE_SQL, sentByApp: false },
    { name: 'top values', sql: TOP_VALUES_SQL, sentByApp: false },
    { name: 'distinct users', sql: DISTINCT_USERS_SQL, sentByApp: true },
    { name: 'series', sql: SERIES_SQL, sentByApp: false },
    { name: 'failing', sql: FAILING_SQL, sentByApp: false },
];

/// The queries that run at once at most, a tick skips its query while they run
const MAX_RUNNING = 4;

/// What the workload sent
export interface WorkloadCounts {
    /// The queries that ended
    sent: number;
    /// The queries that failed
    failed: number;
}

/// Open a connection of the demo that its queries run on: of the user on the user database of the page, or of the app
/// on a pooled connection
async function connect(database: EmbeddedComputeDatabase, sentByApp: boolean): Promise<EmbeddedConnection> {
    return sentByApp
        ? await database.connect({ pooled: true, defaultDatabase: 'hyper', clientContext: hyperLogClientContext(DEMO_CONNECTION_ID, 'sqlframe') })
        : await database.connect({ defaultDatabase: 'hyper', clientContext: hyperLogClientContext(DEMO_CONNECTION_ID, 'user') });
}

/// Create the table that the workload reads
export async function createWorkloadTable(database: EmbeddedComputeDatabase): Promise<void> {
    const conn = await connect(database, false);
    try {
        await conn.execute(SCHEMA_SQL);
    } finally {
        await conn.close();
    }
}

/// Run a query of the workload on a connection of its own, true if it succeeded
export async function runWorkloadQuery(database: EmbeddedComputeDatabase, query: WorkloadQuery): Promise<boolean> {
    const conn = await connect(database, query.sentByApp);
    try {
        await conn.query(query.sql);
        return true;
    } catch {
        return false;
    } finally {
        await conn.close();
    }
}

/// Sends the queries of the workload, a number per second, round robin. A rate of 0 stops it.
export class HyperLogWorkload {
    private timer: ReturnType<typeof setInterval> | null = null;
    private next = 0;
    private running = 0;
    private counts: WorkloadCounts = { sent: 0, failed: 0 };

    constructor(
        private readonly database: EmbeddedComputeDatabase,
        /// Receives the counts after every query
        private readonly onCounts: (counts: WorkloadCounts) => void,
    ) {}

    /// Send this many queries per second, 0 stops
    setRate(perSecond: number): void {
        if (this.timer != null) clearInterval(this.timer);
        this.timer = perSecond <= 0 ? null : setInterval(() => this.tick(), 1000 / perSecond);
    }

    /// Stop sending, the running queries end on their own
    stop(): void {
        this.setRate(0);
    }

    /// Send the next query unless too many run
    tick(): Promise<void> {
        if (this.running >= MAX_RUNNING) return Promise.resolve();
        const query = WORKLOAD_QUERIES[this.next];
        this.next = (this.next + 1) % WORKLOAD_QUERIES.length;
        this.running += 1;
        return runWorkloadQuery(this.database, query).then(succeeded => {
            this.counts = { sent: this.counts.sent + 1, failed: this.counts.failed + (succeeded ? 0 : 1) };
            this.onCounts(this.counts);
        }, () => {}).finally(() => { this.running -= 1; });
    }
}
