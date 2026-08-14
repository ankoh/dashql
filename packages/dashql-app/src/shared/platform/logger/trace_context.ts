export const TRACE_ID_KEY = "trace_id";
export const SPAN_ID_KEY = "span_id";
export const PARENT_SPAN_ID_KEY = "parent_span_id";

export interface TraceContext {
    traceId: number;
    spanId: number;
    parentSpanId: number | null;
}

let traceCounter = 0;
let spanCounter = 0;

export function nextTraceId(): number {
    return ++traceCounter;
}

export function nextSpanId(): number {
    return ++spanCounter;
}

export function createTrace(traceId?: number): TraceContext {
    return {
        traceId: traceId ?? nextTraceId(),
        spanId: nextSpanId(),
        parentSpanId: null,
    };
}

export function createChildSpan(parent: TraceContext): TraceContext {
    return {
        traceId: parent.traceId,
        spanId: nextSpanId(),
        parentSpanId: parent.spanId,
    };
}

export function injectTraceContext(
    keyValues: Record<string, string | null | undefined>,
    ctx: TraceContext,
): void {
    keyValues[TRACE_ID_KEY] = ctx.traceId.toString();
    keyValues[SPAN_ID_KEY] = ctx.spanId.toString();
    if (ctx.parentSpanId !== null) {
        keyValues[PARENT_SPAN_ID_KEY] = ctx.parentSpanId.toString();
    }
}
