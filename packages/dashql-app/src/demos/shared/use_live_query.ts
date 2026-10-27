import type * as arrow from 'apache-arrow';
import * as React from 'react';

import type { HyperDBSourceConnection, HyperDBSourceDatabase } from '../../platform/hyperdb/hyperdb_incremental_extract.js';

/// The latest result of a query that runs again and again
export interface LiveQueryState {
    /// The latest result, kept when a later run fails
    table: arrow.Table | null;
    /// The time of the latest run in milliseconds
    latencyMs: number | null;
    /// The error of the latest run, null once a run succeeds again
    error: Error | null;
}

export const NO_LIVE_QUERY_RESULT: LiveQueryState = { table: null, latencyMs: null, error: null };

/// The options of a live query loop
export interface LiveQueryLoopOptions {
    /// The time between the end of a run and the start of the next one
    intervalMs: number;
    /// Skip runs while the page is hidden
    isHidden?: () => boolean;
}

/// Run a query on its own connection, again and again.
/// The next run starts an interval after the previous one ended, so that runs never overlap, e.g. on a slow remote Hyper.
export class LiveQueryLoop {
    /// Stops the loop and cancels the running query
    private readonly abort = new AbortController();
    /// The timer of the next run
    private timer: ReturnType<typeof setTimeout> | null = null;
    /// The connection of the runs
    private connection: Promise<HyperDBSourceConnection> | null = null;
    /// The running query
    private running: Promise<void> | null = null;

    constructor(
        private readonly database: HyperDBSourceDatabase,
        private readonly sql: string,
        private readonly options: LiveQueryLoopOptions,
        private readonly onResult: (state: LiveQueryState) => void,
    ) {}

    /// Start the first run
    start(): void {
        this.running = this.run();
    }

    /// Stop the loop, cancel the running query and close the connection
    async stop(): Promise<void> {
        this.abort.abort();
        if (this.timer != null) clearTimeout(this.timer);
        this.timer = null;
        await this.running?.catch(() => { });
        const connection = await this.connection?.catch(() => null);
        await connection?.close().catch(() => { });
    }

    private schedule(): void {
        if (this.abort.signal.aborted) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.running = this.run();
        }, this.options.intervalMs);
    }

    private async run(): Promise<void> {
        if (this.options.isHidden?.()) {
            this.schedule();
            return;
        }
        const start = performance.now();
        let table: arrow.Table | null = null;
        let error: Error | null = null;
        try {
            this.connection ??= this.database.connect();
            table = await (await this.connection).query(this.sql, this.abort.signal);
        } catch (e: any) {
            error = e instanceof Error ? e : new Error(String(e));
            // A connection that failed to open is opened again by the next run
            if (await this.connection?.then(() => false, () => true)) this.connection = null;
        }
        if (this.abort.signal.aborted) return;
        this.onResult({ table, latencyMs: performance.now() - start, error });
        this.schedule();
    }
}

/// Run a query again and again while the component is mounted, null for no database or no query
export function useLiveQuery(database: HyperDBSourceDatabase | null, sql: string | null, intervalMs: number): LiveQueryState {
    const [state, setState] = React.useState<LiveQueryState>(NO_LIVE_QUERY_RESULT);
    React.useEffect(() => {
        setState(NO_LIVE_QUERY_RESULT);
        if (database == null || sql == null) return;
        const loop = new LiveQueryLoop(database, sql, { intervalMs, isHidden: () => document.hidden }, result => {
            // A failed run keeps the previous result on screen
            setState(prev => result.table == null ? { ...prev, latencyMs: result.latencyMs, error: result.error } : result);
        });
        loop.start();
        return () => { void loop.stop(); };
    }, [database, sql, intervalMs]);
    return state;
}
