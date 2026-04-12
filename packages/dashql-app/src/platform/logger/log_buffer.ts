export enum LogLevel {
    Trace = 1,
    Debug = 2,
    Info = 3,
    Warn = 4,
    Error = 5,
}

export function getLogLevelName(level: LogLevel): string {
    switch (level) {
        case LogLevel.Trace: return "trace";
        case LogLevel.Debug: return "debug";
        case LogLevel.Info: return "info";
        case LogLevel.Warn: return "warn";
        case LogLevel.Error: return "error";
    }
}

export function parseLogLevel(text: string): LogLevel | null {
    switch (text) {
        case "trace": return LogLevel.Trace;
        case "debug": return LogLevel.Debug;
        case "info": return LogLevel.Info;
        case "warn": return LogLevel.Warn;
        case "error": return LogLevel.Error;
        default:
            return null;
    }
}

/// Trace information for a log record
export interface TraceInfo {
    /// The trace ID
    traceId: number;
    /// The span ID
    spanId: number;
    /// The parent span ID (optional)
    parentSpanId?: number;
}

/// A log record
export interface LogRecord {
    /// The timestamp
    timestamp: number;
    /// The log level
    level: LogLevel;
    /// The target
    target: string;
    /// The message
    message: string;
    /// Context information (if present)
    context: string | null;
    /// Tracing information (if present)
    tracing: TraceInfo | null;
    /// The log details
    keyValues: Record<string, string | null | undefined>;
}

const TARGET_CHUNK_SIZE = 1024;

class FrozenLogChunk {
    /// The entries of the chunk
    readonly entries: LogRecord[];
    /// Minimum trace ID in this chunk (undefined if no traces)
    readonly minTraceId: number | null;
    /// Maximum trace ID in this chunk (undefined if no traces)
    readonly maxTraceId: number | null;

    constructor(entries: LogRecord[]) {
        this.entries = entries;

        // Compute min and max trace IDs
        let min: number | null = null;
        let max: number | null = null;

        for (const entry of entries) {
            if (entry.tracing?.traceId !== undefined) {
                const traceId = entry.tracing.traceId;
                if (min === null || traceId < min) {
                    min = traceId;
                }
                if (max === null || traceId > max) {
                    max = traceId;
                }
            }
        }

        this.minTraceId = min;
        this.maxTraceId = max;
    }
}

type LogObserver = (buffer: LogBuffer) => void;
type LogRecordObserver = (record: LogRecord) => void;

export class LogBuffer {
    /// Internal version counter
    protected version_: number;
    /// The last entries
    protected lastEntries_: LogRecord[];
    /// The frozen chunks
    protected frozenChunks_: FrozenLogChunk[];
    /// The log observers
    protected logObservers: Set<LogObserver>;
    /// The trace record observers (map from trace ID to set of observers)
    protected traceObservers: Map<number, Set<LogRecordObserver>>;
    /// The minimum log level
    protected minLogLevel: LogLevel;

    constructor() {
        this.version_ = 1;
        this.lastEntries_ = [];
        this.frozenChunks_ = [];
        this.logObservers = new Set();
        this.traceObservers = new Map();
        this.minLogLevel = LogLevel.Debug;
    }

    /// Get the current version
    public get version(): number { return this.version_; }
    /// Get the total amount of log entries
    public get length(): number { return this.lastEntries_.length + this.frozenChunks_.length * TARGET_CHUNK_SIZE; }
    /// Get the observers
    public get observers(): Set<LogObserver> { return this.logObservers; }

    /// Subscribe to log events
    public subscribe(observer: LogObserver, callWhenRegistering: boolean = false) {
        this.logObservers.add(observer);
        if (callWhenRegistering) {
            observer(this);
        }
    }

    /// Subscribe to trace log events for a specific trace ID
    public subscribeTrace(traceId: number, observer: LogRecordObserver) {
        let observers = this.traceObservers.get(traceId);
        if (!observers) {
            observers = new Set();
            this.traceObservers.set(traceId, observers);
        }
        observers.add(observer);
    }

    /// Unsubscribe from trace log events
    public unsubscribeTrace(traceId: number, observer: LogRecordObserver) {
        const observers = this.traceObservers.get(traceId);
        if (observers) {
            observers.delete(observer);
            if (observers.size === 0) {
                this.traceObservers.delete(traceId);
            }
        }
    }

    /// Push an entry
    public push(entry: LogRecord) {
        // Ignore the entry
        if (entry.level < this.minLogLevel) {
            return;
        }

        // Buffer entries before compacting
        this.lastEntries_.push(entry);
        // Freeze chunk if forced or above threshold
        if (this.lastEntries_.length > TARGET_CHUNK_SIZE) {
            this.frozenChunks_.push(new FrozenLogChunk(this.lastEntries_));
            this.lastEntries_ = [];
        }
        // Bump the version
        this.version_ += 1;
        // Notify all observers
        for (const observer of this.logObservers) {
            observer(this);
        }
        // Notify trace observers for this specific trace ID
        if (entry.tracing) {
            const observers = this.traceObservers.get(entry.tracing.traceId);
            if (observers) {
                for (const observer of observers) {
                    observer(entry);
                }
            }
        }
    }

    /// Get at position
    public at(index: number): LogRecord | null {
        const frozenEntries = this.frozenChunks_.length * TARGET_CHUNK_SIZE
        if (index < frozenEntries) {
            const chunkIndex = Math.floor(index / TARGET_CHUNK_SIZE);
            const indexInChunk = index - (chunkIndex * TARGET_CHUNK_SIZE);
            if (chunkIndex >= this.frozenChunks_.length) {
                return null;
            }
            const chunk = this.frozenChunks_[chunkIndex];
            if (indexInChunk >= chunk.entries.length) {
                return null;
            }
            return chunk.entries[indexInChunk];
        }
        const pendingIndex = index - frozenEntries;
        if (pendingIndex < this.lastEntries_.length) {
            return this.lastEntries_[pendingIndex];
        }
        return null;
    }

    /// Collect all log records for a specific trace ID
    public collectTraceLogs(traceId: number): LogRecord[] {
        const results: LogRecord[] = [];

        // Scan frozen chunks, using min/max trace IDs to skip irrelevant chunks
        for (const chunk of this.frozenChunks_) {
            // Skip chunk if trace ID is outside its range
            if (chunk.minTraceId !== null && chunk.maxTraceId !== null) {
                if (traceId < chunk.minTraceId || traceId > chunk.maxTraceId) {
                    continue;
                }
            }

            // Scan entries in this chunk
            for (const entry of chunk.entries) {
                if (entry.tracing?.traceId === traceId) {
                    results.push(entry);
                }
            }
        }

        // Scan pending entries
        for (const entry of this.lastEntries_) {
            if (entry.tracing?.traceId === traceId) {
                results.push(entry);
            }
        }

        return results;
    }
}
