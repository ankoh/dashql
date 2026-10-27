import type { HyperDBSourceConnection } from '../../platform/hyperdb/hyperdb_incremental_extract.js';
import { sqlLiteral } from '../shared/sql_template.js';

/// A trade of a symbol with the best bid and ask at its time, a row of the table `ticks`
export interface Tick {
    /// The symbol, e.g. AAPL or BTC-USD
    symbol: string;
    /// The time of the trade in milliseconds since the epoch
    ts: number;
    /// The price of the trade
    price: number;
    /// The traded quantity
    size: number;
    /// The best bid, null if unknown
    bid: number | null;
    /// The best ask, null if unknown
    ask: number | null;
}

/// The state of a feed, shown next to its name
export interface TickFeedStatus {
    /// Is the feed delivering ticks?
    state: 'connecting' | 'live' | 'paused' | 'failed';
    /// The reason of a failure or a reconnect
    detail?: string;
}

/// A source of ticks, e.g. a generator or a market data stream
export interface TickFeed {
    /// Start delivering ticks, the feed calls emit with the ticks since its previous call
    start(emit: (ticks: Tick[]) => void, onStatus: (status: TickFeedStatus) => void): void;
    /// Stop delivering ticks
    stop(): void;
}

/// The statement that inserts ticks into the table `ticks`
export function insertTicksSql(ticks: readonly Tick[]): string {
    const rows = ticks.map(tick => `(${[
        sqlLiteral(tick.symbol),
        `${sqlLiteral(new Date(tick.ts).toISOString())}::timestamptz`,
        sqlLiteral(tick.price),
        sqlLiteral(tick.size),
        sqlLiteral(tick.bid),
        sqlLiteral(tick.ask),
    ].join(', ')})`);
    return `insert into ticks (symbol, ts, price, size, bid, ask) values\n${rows.join(',\n')}`;
}

/// The statement that deletes the ticks older than the retention
export function deleteTicksBeforeSql(retentionMs: number): string {
    return `delete from ticks where ts < now() - interval '${Math.round(retentionMs / 1000)} seconds'`;
}

/// The options of a tick writer
export interface TickWriterOptions {
    /// The time between two inserts
    flushIntervalMs?: number;
    /// The maximum number of ticks of an insert, the rest waits for the next one
    maxBatchSize?: number;
    /// The age of the oldest ticks that the table keeps
    retentionMs?: number;
    /// The time between two deletions of old ticks
    retentionIntervalMs?: number;
    /// Receives the failures of statements, the writer keeps going
    onError?: (error: unknown) => void;
}

/// Write the ticks of a feed into the table `ticks` in batches.
/// All statements run one after another on the connection of the writer, a HyperDB WASM connection runs one at a time.
export class TickWriter {
    /// The ticks waiting for the next insert
    private pending: Tick[] = [];
    /// The timer of the next flush
    private timer: ReturnType<typeof setTimeout> | null = null;
    /// The running flush
    private flushing: Promise<void> | null = null;
    /// The time of the last deletion of old ticks, the first one is due an interval after the start
    private lastRetention = Date.now();
    /// Is the writer stopped?
    private stopped = false;
    /// The number of inserted ticks
    written = 0;
    /// The number of ticks that were dropped because the inserts did not keep up
    dropped = 0;

    private readonly flushIntervalMs: number;
    private readonly maxBatchSize: number;
    private readonly retentionMs: number;
    private readonly retentionIntervalMs: number;

    constructor(private readonly connection: HyperDBSourceConnection, private readonly options: TickWriterOptions = {}) {
        this.flushIntervalMs = options.flushIntervalMs ?? 200;
        this.maxBatchSize = options.maxBatchSize ?? 10000;
        this.retentionMs = options.retentionMs ?? 30 * 60 * 1000;
        this.retentionIntervalMs = options.retentionIntervalMs ?? 10 * 1000;
    }

    /// Queue ticks for the next insert. Beyond 10 batches the oldest ticks are dropped, the table stays live.
    push(ticks: readonly Tick[]): void {
        if (this.stopped) return;
        // A spread of a large backfill would exceed the argument limit of push
        for (const tick of ticks) this.pending.push(tick);
        const overflow = this.pending.length - 10 * this.maxBatchSize;
        if (overflow > 0) {
            this.pending.splice(0, overflow);
            this.dropped += overflow;
        }
        this.timer ??= setTimeout(() => {
            this.timer = null;
            this.flushing = this.flush();
        }, this.flushIntervalMs);
    }

    /// Insert the pending ticks and delete old ones when it is time to
    async flush(): Promise<void> {
        await this.flushing;
        if (this.stopped) return;
        try {
            while (this.pending.length > 0) {
                const batch = this.pending.splice(0, this.maxBatchSize);
                await this.connection.execute(insertTicksSql(batch));
                this.written += batch.length;
            }
            const now = Date.now();
            if (now - this.lastRetention >= this.retentionIntervalMs) {
                this.lastRetention = now;
                await this.connection.execute(deleteTicksBeforeSql(this.retentionMs));
            }
        } catch (e) {
            this.options.onError?.(e);
        }
    }

    /// Stop writing, pending ticks are dropped
    async stop(): Promise<void> {
        this.stopped = true;
        if (this.timer != null) clearTimeout(this.timer);
        this.timer = null;
        this.pending = [];
        await this.flushing?.catch(() => { });
    }
}
