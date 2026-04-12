export const TRACE_ID_KEY = "trace_id";
export const SPAN_ID_KEY = "span_id";
export const PARENT_SPAN_ID_KEY = "parent_span_id";

export interface TraceContext {
    traceId: string;
    spanId: string;
    parentSpanId?: string;
}

export class TraceContextManager {
    private contextStack: TraceContext[] = [];
    private spanCounter = 0;

    generateSpanId(): string {
        return `${Date.now() * 1000 + this.spanCounter++}`;
    }

    startTrace(traceId?: string): TraceContext {
        const ctx = {
            traceId: traceId ?? crypto.randomUUID(),
            spanId: this.generateSpanId(),
            parentSpanId: undefined,
        };
        this.contextStack.push(ctx);
        return ctx;
    }

    startSpan(): TraceContext {
        const parent = this.currentContext();
        const ctx = {
            traceId: parent?.traceId ?? crypto.randomUUID(),
            spanId: this.generateSpanId(),
            parentSpanId: parent?.spanId,
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
            keyValues[TRACE_ID_KEY] = ctx.traceId;
            keyValues[SPAN_ID_KEY] = ctx.spanId;
            if (ctx.parentSpanId) {
                keyValues[PARENT_SPAN_ID_KEY] = ctx.parentSpanId;
            }
        }
    }
}

export const globalTraceContext = new TraceContextManager();
