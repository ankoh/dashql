import { LogBuffer, LogLevel, LogRecord, TraceInfo } from "./log_buffer.js";
import { createChildSpan, injectTraceContext, TraceContext, TRACE_ID_KEY, SPAN_ID_KEY, PARENT_SPAN_ID_KEY } from "./trace_context.js";

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

export function stringifyError(e: unknown): string {
    if (e instanceof Error) {
        return e.message;
    }
    if (e && typeof e === 'object') {
        try {
            return JSON.stringify(e);
        } catch {
            return Object.prototype.toString.call(e);
        }
    }
    return String(e);
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
        parentSpanId: parentSpanId ?? null,
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

/// Structural logger interface satisfied by both Logger and TracedLogger.
/// Functions that just emit logs (and don't touch buffer/statistics/destroy)
/// should accept this type so either a raw or traced logger can be passed in.
export interface LoggerLike {
    trace(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void;
    debug(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void;
    info(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void;
    warn(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void;
    error(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void;
    exception(error: any, pipeToConsole?: boolean): void;
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

function buildRecord(level: LogLevel, message: string, target: string | undefined, keyValues: Record<string, string | null | undefined>): LogRecord {
    const { context, tracing, filteredKeyValues } = extractContextAndTraceFields(keyValues);
    return {
        timestamp: Date.now(),
        level,
        target: target ?? "pwa:unknown",
        message,
        context,
        tracing,
        keyValues: filteredKeyValues,
    };
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

    /// Bind a trace context and return a logger that tags every record with it
    public withTrace(ctx: TraceContext): TracedLogger {
        return new TracedLogger(this, ctx);
    }

    /// Push a log record
    public push(entry: LogRecord): void {
        this.pendingRecords.push(entry);
        this.logStatistics.push(entry);
        this.flushPendingRecords();
    }
    /// Log a trace message
    public trace(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void {
        const entry = buildRecord(LogLevel.Trace, message, target, keyValues);
        this.pendingRecords.push(entry);
        this.logStatistics.push(entry);
        this.flushPendingRecords();
        if (pipeToConsole) {
            console.log(entry);
        }
    }
    /// Log an debug message
    public debug(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void {
        const entry = buildRecord(LogLevel.Debug, message, target, keyValues);
        this.pendingRecords.push(entry);
        this.logStatistics.push(entry);
        this.flushPendingRecords();
        if (pipeToConsole) {
            console.log(entry);
        }
    }
    /// Log an info message
    public info(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void {
        const entry = buildRecord(LogLevel.Info, message, target, keyValues);
        this.pendingRecords.push(entry);
        this.logStatistics.push(entry);
        this.flushPendingRecords();
        if (pipeToConsole) {
            console.log(entry);
        }
    }
    /// Log a warning message
    public warn(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void {
        const entry = buildRecord(LogLevel.Warn, message, target, keyValues);
        this.pendingRecords.push(entry);
        this.logStatistics.push(entry);
        this.flushPendingRecords();
        if (pipeToConsole) {
            console.log(entry);
        }
    }
    /// Log an error message
    public error(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void {
        const entry = buildRecord(LogLevel.Error, message, target, keyValues);
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
            this.error(stringifyError(error), {});
        }
        if (pipeToConsole) {
            console.log(error);
        }
    }
}

/// A logger view that tags every record with a fixed trace context
export class TracedLogger {
    constructor(
        private readonly base: Logger,
        public readonly context: TraceContext,
    ) { }

    /// The underlying unwrapped logger (for callees that don't carry a trace)
    public get logger(): Logger { return this.base; }
    /// Access the log buffer
    public get buffer() { return this.base.buffer; }
    /// Access the log statistics
    public get statistics() { return this.base.statistics; }

    /// Derive a child logger with a new span under the same trace
    public childSpan(): TracedLogger {
        return new TracedLogger(this.base, createChildSpan(this.context));
    }
    /// Bind a different trace context
    public withTrace(ctx: TraceContext): TracedLogger {
        return new TracedLogger(this.base, ctx);
    }

    private tag(keyValues: Record<string, string | null | undefined>): Record<string, string | null | undefined> {
        const tagged = { ...keyValues };
        injectTraceContext(tagged, this.context);
        return tagged;
    }

    public trace(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void {
        this.base.trace(message, this.tag(keyValues), target, pipeToConsole);
    }
    public debug(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void {
        this.base.debug(message, this.tag(keyValues), target, pipeToConsole);
    }
    public info(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void {
        this.base.info(message, this.tag(keyValues), target, pipeToConsole);
    }
    public warn(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void {
        this.base.warn(message, this.tag(keyValues), target, pipeToConsole);
    }
    public error(message: string, keyValues: Record<string, string | null | undefined>, target?: string, pipeToConsole?: boolean): void {
        this.base.error(message, this.tag(keyValues), target, pipeToConsole);
    }
    public exception(error: any, pipeToConsole?: boolean) {
        if (error instanceof LoggableException) {
            this.error(error.message, error.keyValues, error.target);
        } else {
            this.error(stringifyError(error), {});
        }
        if (pipeToConsole) {
            console.log(error);
        }
    }
}
