import {
    createChildSpan,
    createTrace,
    injectTraceContext,
    PARENT_SPAN_ID_KEY,
    SPAN_ID_KEY,
    TRACE_ID_KEY,
} from './trace_context.js';

describe('trace_context', () => {
    describe('createTrace', () => {
        it('creates a new trace with numeric trace id and span id', () => {
            const ctx = createTrace();

            expect(typeof ctx.traceId).toBe('number');
            expect(ctx.traceId).toBeGreaterThan(0);
            expect(typeof ctx.spanId).toBe('number');
            expect(ctx.spanId).toBeGreaterThan(0);
            expect(ctx.parentSpanId).toBeNull();
        });

        it('accepts a custom trace id', () => {
            const ctx = createTrace(42);
            expect(ctx.traceId).toBe(42);
        });

        it('produces unique trace ids across calls', () => {
            const a = createTrace();
            const b = createTrace();
            expect(a.traceId).not.toBe(b.traceId);
            expect(a.spanId).not.toBe(b.spanId);
        });
    });

    describe('createChildSpan', () => {
        it('inherits parent trace id and sets parent span id', () => {
            const parent = createTrace();
            const child = createChildSpan(parent);

            expect(child.traceId).toBe(parent.traceId);
            expect(child.spanId).not.toBe(parent.spanId);
            expect(child.parentSpanId).toBe(parent.spanId);
        });

        it('supports nested children', () => {
            const root = createTrace();
            const child1 = createChildSpan(root);
            const child2 = createChildSpan(child1);

            expect(child1.parentSpanId).toBe(root.spanId);
            expect(child2.parentSpanId).toBe(child1.spanId);
            expect(child1.traceId).toBe(root.traceId);
            expect(child2.traceId).toBe(root.traceId);
        });
    });

    describe('injectTraceContext', () => {
        it('writes trace id and span id into the key/value map', () => {
            const ctx = createTrace();
            const kv: Record<string, string | null | undefined> = {};

            injectTraceContext(kv, ctx);

            expect(kv[TRACE_ID_KEY]).toBe(ctx.traceId.toString());
            expect(kv[SPAN_ID_KEY]).toBe(ctx.spanId.toString());
            expect(kv[PARENT_SPAN_ID_KEY]).toBeUndefined();
        });

        it('writes parent span id for child spans', () => {
            const parent = createTrace();
            const child = createChildSpan(parent);
            const kv: Record<string, string | null | undefined> = {};

            injectTraceContext(kv, child);

            expect(kv[PARENT_SPAN_ID_KEY]).toBe(parent.spanId.toString());
        });

        it('overwrites existing trace fields', () => {
            const ctx = createTrace();
            const kv: Record<string, string | null | undefined> = {
                existing: 'value',
                [TRACE_ID_KEY]: 'stale',
            };

            injectTraceContext(kv, ctx);

            expect(kv.existing).toBe('value');
            expect(kv[TRACE_ID_KEY]).toBe(ctx.traceId.toString());
        });
    });

    describe('concurrent traces stay isolated', () => {
        it('two independent traces do not share span ids', () => {
            // Simulates the original bug: two unrelated operations each hold
            // their own TraceContext, and logs tagged via each should never
            // collide even when interleaved.
            const a = createTrace();
            const b = createTrace();

            expect(a.traceId).not.toBe(b.traceId);
            expect(a.spanId).not.toBe(b.spanId);

            const kvA: Record<string, string | null | undefined> = {};
            const kvB: Record<string, string | null | undefined> = {};
            injectTraceContext(kvA, a);
            injectTraceContext(kvB, b);

            expect(kvA[TRACE_ID_KEY]).not.toBe(kvB[TRACE_ID_KEY]);
            expect(kvA[SPAN_ID_KEY]).not.toBe(kvB[SPAN_ID_KEY]);
        });
    });
});
