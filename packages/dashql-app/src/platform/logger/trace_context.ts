export const TRACE_ID_KEY = "trace_id";
export const SPAN_ID_KEY = "span_id";
export const PARENT_SPAN_ID_KEY = "parent_span_id";

export interface TraceContext {
    traceId: number;
    spanId: number;
    parentSpanId: number | null;
}

export class TraceContextManager {
    private contextStack: TraceContext[] = [];
    private traceCounter = 0;
    private spanCounter = 0;

    generateTraceId(): number {
        return ++this.traceCounter;
    }

    generateSpanId(): number {
        return ++this.spanCounter;
    }

    startTrace(traceId?: number): TraceContext {
        const ctx = {
            traceId: traceId ?? this.generateTraceId(),
            spanId: this.generateSpanId(),
            parentSpanId: null,
        };
        this.contextStack.push(ctx);
        return ctx;
    }

    startSpan(): TraceContext {
        const parent = this.currentContext();
        const ctx = {
            traceId: parent?.traceId ?? this.generateTraceId(),
            spanId: this.generateSpanId(),
            parentSpanId: parent?.spanId ?? null,
        };
        this.contextStack.push(ctx);
        return ctx;
    }

    endSpan(): void {
        this.contextStack.pop();
    }

    currentContext(): TraceContext | undefined {
        return this.contextStack[this.contextStack.length - 1];
    }

    injectContext(keyValues: Record<string, string | null | undefined>): void {
        const ctx = this.currentContext();
        if (ctx) {
            keyValues[TRACE_ID_KEY] = ctx.traceId.toString();
            keyValues[SPAN_ID_KEY] = ctx.spanId.toString();
            if (ctx.parentSpanId !== null) {
                keyValues[PARENT_SPAN_ID_KEY] = ctx.parentSpanId.toString();
            }
        }
    }
}

export const globalTraceContext = new TraceContextManager();
