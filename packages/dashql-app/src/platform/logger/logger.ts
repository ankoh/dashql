import { LogBuffer, LogLevel, LogRecord, TraceInfo } from "./log_buffer.js";
import { globalTraceContext, TRACE_ID_KEY, SPAN_ID_KEY, PARENT_SPAN_ID_KEY } from "./trace_context.js";

/// A helper for log statistics
export class LogStatistics {
    /// The max width of the target attribute
    public maxTargetWidth: number;
    /// The max width of the message attribute
    public maxMessageWidth: number;

    constructor() {
        this.maxTargetWidth = 0;
        this.maxMessageWidth = 0;
    }

    /// Push a log record
    public push(record: LogRecord) {
        this.maxTargetWidth = Math.max(record.target.length, this.maxTargetWidth);
        this.maxMessageWidth = Math.max(record.message.length, this.maxMessageWidth);
    }
}

const CONTEXT_KEY = "context";

/// Helper to parse string to number safely
function parseNumberOrUndefined(value: string | null | undefined): number | undefined {
    if (typeof value !== 'string') return undefined;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? undefined : parsed;
}

/// Helper to extract context and trace fields from keyValues
function extractContextAndTraceFields(keyValues: Record<string, string | null | undefined>): {
    context: string | null;
    tracing: TraceInfo | null;
    filteredKeyValues: Record<string, string | null | undefined>;
} {
    const context = typeof keyValues[CONTEXT_KEY] === 'string' ? keyValues[CONTEXT_KEY] : null;
    const traceId = parseNumberOrUndefined(keyValues[TRACE_ID_KEY]);
    const spanId = parseNumberOrUndefined(keyValues[SPAN_ID_KEY]);
    const parentSpanId = parseNumberOrUndefined(keyValues[PARENT_SPAN_ID_KEY]);

    // Create trace info if we have at least traceId and spanId
    const tracing: TraceInfo | null = (traceId !== undefined && spanId !== undefined) ? {
        traceId,
        spanId,
        parentSpanId,
    } : null;

    // Create a new object without context and trace fields
    const filteredKeyValues: Record<string, string | null | undefined> = {};
    for (const [key, value] of Object.entries(keyValues)) {
        if (key !== CONTEXT_KEY && key !== TRACE_ID_KEY && key !== SPAN_ID_KEY && key !== PARENT_SPAN_ID_KEY) {
            filteredKeyValues[key] = value;
        }
    }

    return { context, tracing, filteredKeyValues };
}

export class LoggableException extends Error {
    /// The keyValues
    keyValues: Record<string, string | null | undefined>;
    /// The target
    target?: string;

    constructor(message: string, keyValues: Record<string, string | null | undefined> = {}, target?: string) {
        super(message);
        this.keyValues = keyValues;
        this.target = target;
    }
}

/// A platform logger
export abstract class Logger {
    /// The pending log messages
    protected pendingRecords: LogRecord[];
    /// The output log buffer.
    /// To be populated by `flushPendingRecords`
    protected outputBuffer: LogBuffer;
    /// The log statistics
    protected logStatistics: LogStatistics;

    constructor() {
        this.pendingRecords = [];
        this.outputBuffer = new LogBuffer();
        this.logStatistics = new LogStatistics();
    }

    /// Destroy the logger
    public abstract destroy(): void;
    /// Helper to flush pending records
    protected abstract flushPendingRecords(): void;

    /// Access the log buffer
    public get buffer() { return this.outputBuffer; }
    /// Access the log statistics
    public get statistics() { return this.logStatistics; }

    /// Push a log record
    public push(entry: LogRecord): void {
        this.pendingRecords.push(entry);
        this.logStatistics.push(entry);
        this.flushPendingRecords();
    }
    /// Log a trace message
    public trace(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void {
        globalTraceContext.injectContext(keyValues);
        const { context, tracing, filteredKeyValues } = extractContextAndTraceFields(keyValues);
        const entry: LogRecord = {
            timestamp: Date.now(),
            level: LogLevel.Trace,
            target: target ?? "pwa:unknown",
            message,
            context,
            tracing,
            keyValues: filteredKeyValues,
        };
        this.pendingRecords.push(entry);
        this.logStatistics.push(entry);
        this.flushPendingRecords();
        if (pipeToConsole) {
            console.log(entry);
        }
    }
    /// Log an debug message
    public debug(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void {
        globalTraceContext.injectContext(keyValues);
        const { context, tracing, filteredKeyValues } = extractContextAndTraceFields(keyValues);
        const entry: LogRecord = {
            timestamp: Date.now(),
            level: LogLevel.Debug,
            target: target ?? "pwa:unknown",
            message,
            context,
            tracing,
            keyValues: filteredKeyValues,
        };
        this.pendingRecords.push(entry);
        this.logStatistics.push(entry);
        this.flushPendingRecords();
        if (pipeToConsole) {
            console.log(entry);
        }
    }
    /// Log an info message
    public info(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void {
        globalTraceContext.injectContext(keyValues);
        const { context, tracing, filteredKeyValues } = extractContextAndTraceFields(keyValues);
        const entry: LogRecord = {
            timestamp: Date.now(),
            level: LogLevel.Info,
            target: target ?? "pwa:unknown",
            message,
            context,
            tracing,
            keyValues: filteredKeyValues,
        };
        this.pendingRecords.push(entry);
        this.logStatistics.push(entry);
        this.flushPendingRecords();
        if (pipeToConsole) {
            console.log(entry);
        }
    }
    /// Log a warning message
    public warn(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void {
        globalTraceContext.injectContext(keyValues);
        const { context, tracing, filteredKeyValues } = extractContextAndTraceFields(keyValues);
        const entry: LogRecord = {
            timestamp: Date.now(),
            level: LogLevel.Warn,
            target: target ?? "pwa:unknown",
            message,
            context,
            tracing,
            keyValues: filteredKeyValues,
        };
        this.pendingRecords.push(entry);
        this.logStatistics.push(entry);
        this.flushPendingRecords();
        if (pipeToConsole) {
            console.log(entry);
        }
    }
    /// Log an error message
    public error(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void {
        globalTraceContext.injectContext(keyValues);
        const { context, tracing, filteredKeyValues } = extractContextAndTraceFields(keyValues);
        const entry: LogRecord = {
            timestamp: Date.now(),
            level: LogLevel.Error,
            target: target ?? "pwa:unknown",
            message,
            context,
            tracing,
            keyValues: filteredKeyValues,
        };
        this.pendingRecords.push(entry);
        this.logStatistics.push(entry);
        this.flushPendingRecords();
        if (pipeToConsole) {
            console.log(entry);
        }
    }
    /// Log an exception
    public exception(error: any, pipeToConsole?: boolean) {
        if (error instanceof LoggableException) {
            this.error(error.message, error.keyValues, error.target);
        } else {
            this.error(error.toString(), {});
        }
        if (pipeToConsole) {
            console.log(error);
        }
    }
}
