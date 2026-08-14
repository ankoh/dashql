import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { LogLevel, LogRecord, TraceInfo } from './log_buffer.js';
import { Logger } from './logger.js';
import { TRACE_ID_KEY, SPAN_ID_KEY, PARENT_SPAN_ID_KEY } from './trace_context.js';

enum RustLogLevel {
    Error = 1,
    Warn = 2,
    Info = 3,
    Debug = 4,
    Trace = 5,
}

/// The Rust log::LogLevel is flipped.
/// Events arriving at log://log are apparently storing the Rust log level:
/// https://github.com/tauri-apps/plugins-workspace/issues/1193
function rustToWebLogLevel(level: RustLogLevel): LogLevel {
    switch (level) {
        case RustLogLevel.Trace: return LogLevel.Trace;
        case RustLogLevel.Debug: return LogLevel.Debug;
        case RustLogLevel.Info: return LogLevel.Info;
        case RustLogLevel.Warn: return LogLevel.Warn;
        case RustLogLevel.Error: return LogLevel.Error;
    }
}

/// Helper to parse string to number safely
function parseNumberOrUndefined(value: string | null | undefined): number | undefined {
    if (typeof value !== 'string') return undefined;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? undefined : parsed;
}

/// Extract trace information from keyValues and remove trace fields
function extractTraceInfo(keyValues: Record<string, any>): { tracing: TraceInfo | null; filteredKeyValues: Record<string, any> } {
    const traceId = parseNumberOrUndefined(keyValues[TRACE_ID_KEY]);
    const spanId = parseNumberOrUndefined(keyValues[SPAN_ID_KEY]);
    const parentSpanId = parseNumberOrUndefined(keyValues[PARENT_SPAN_ID_KEY]);

    // Create trace info if we have at least traceId and spanId
    const tracing: TraceInfo | null = (traceId !== undefined && spanId !== undefined) ? {
        traceId,
        spanId,
        parentSpanId: parentSpanId ?? null,
    } : null;

    // Create a new object without trace fields
    const filteredKeyValues: Record<string, any> = {};
    for (const [key, value] of Object.entries(keyValues)) {
        if (key !== TRACE_ID_KEY && key !== SPAN_ID_KEY && key !== PARENT_SPAN_ID_KEY) {
            filteredKeyValues[key] = value;
        }
    }

    return { tracing, filteredKeyValues };
}

export class NativeLogger extends Logger {
    unlistener: Promise<UnlistenFn>;

    constructor() {
        super();
        this.unlistener = listen("log://log", (event: any) => {
            const rawRecord = JSON.parse(event.payload.message) as any;
            const level = rustToWebLogLevel(rawRecord.level as RustLogLevel);

            // Extract trace info from keyValues if present
            const keyValues = rawRecord.keyValues || {};
            const { tracing, filteredKeyValues } = extractTraceInfo(keyValues);

            // Create properly formatted LogRecord
            const record: LogRecord = {
                timestamp: rawRecord.timestamp,
                level: level,
                target: rawRecord.target,
                message: rawRecord.message,
                context: null,
                tracing: tracing,
                keyValues: filteredKeyValues,
            };

            this.outputBuffer.push(record);
            this.logStatistics.push(record);
        });
    }

    /// Destroy the logger
    public async destroy(): Promise<void> {
        const unlisten = await this.unlistener;
        unlisten();
    }
    /// Helper to flush pending records
    protected flushPendingRecords(): void {
        if (this.pendingRecords.length == 0) {
            return;
        }
        const pending = this.pendingRecords;
        this.pendingRecords = [];
        for (let i = 0; i < pending.length; ++i) {
            const record = pending[i];

            // Put trace IDs and context back into keyValues for sending to Tauri
            const keyValues = { ...record.keyValues };
            if (record.context) {
                keyValues['context'] = record.context;
            }
            if (record.tracing) {
                keyValues[TRACE_ID_KEY] = record.tracing.traceId.toString();
                keyValues[SPAN_ID_KEY] = record.tracing.spanId.toString();
                if (record.tracing.parentSpanId !== null) {
                    keyValues[PARENT_SPAN_ID_KEY] = record.tracing.parentSpanId.toString();
                }
            }

            invoke("plugin:log|log", {
                level: record.level,
                message: record.message,
                location: record.target,
                keyValues: keyValues,
            });
        }
    }
};
