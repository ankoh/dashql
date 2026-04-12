import { globalTraceContext } from '../logger/trace_context.js';

export function injectTraceHeaders(headers: Headers): void {
    const ctx = globalTraceContext.currentContext();
    if (ctx) {
        headers.set('dashql-trace-id', ctx.traceId);
        headers.set('dashql-span-id', ctx.spanId);
        if (ctx.parentSpanId) {
            headers.set('dashql-parent-span-id', ctx.parentSpanId);
        }
    }
}
