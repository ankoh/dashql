import { TraceContextManager, TRACE_ID_KEY, SPAN_ID_KEY, PARENT_SPAN_ID_KEY } from './trace_context.js';

describe('TraceContextManager', () => {
    let manager: TraceContextManager;

    beforeEach(() => {
        manager = new TraceContextManager();
    });

    describe('startTrace', () => {
        it('creates a new trace with numeric trace ID', () => {
            const ctx = manager.startTrace();

            expect(ctx.traceId).toBeDefined();
            expect(typeof ctx.traceId).toBe('number');
            expect(ctx.traceId).toBeGreaterThan(0);
            expect(ctx.spanId).toBeDefined();
            expect(ctx.parentSpanId).toBeUndefined();
        });

        it('accepts custom trace ID', () => {
            const customTraceId = 42;
            const ctx = manager.startTrace(customTraceId);

            expect(ctx.traceId).toBe(customTraceId);
        });

        it('generates unique span IDs', () => {
            const ctx1 = manager.startTrace();
            const ctx2 = manager.startTrace();

            expect(ctx1.spanId).not.toBe(ctx2.spanId);
        });

        it('pushes context onto stack', () => {
            expect(manager.currentContext()).toBeUndefined();

            manager.startTrace();
            expect(manager.currentContext()).toBeDefined();
        });
    });

    describe('startSpan', () => {
        it('creates child span with parent trace ID', () => {
            const trace = manager.startTrace();
            const span = manager.startSpan();

            expect(span.traceId).toBe(trace.traceId);
            expect(span.spanId).not.toBe(trace.spanId);
            expect(span.parentSpanId).toBe(trace.spanId);
        });

        it('creates new trace if no parent exists', () => {
            const span = manager.startSpan();

            expect(span.traceId).toBeDefined();
            expect(span.parentSpanId).toBeUndefined();
        });
    });

    describe('endSpan', () => {
        it('pops context from stack', () => {
            manager.startTrace();
            expect(manager.currentContext()).toBeDefined();

            manager.endSpan();
            expect(manager.currentContext()).toBeUndefined();
        });

        it('restores parent context', () => {
            const parent = manager.startTrace();
            const child = manager.startSpan();

            expect(manager.currentContext()?.traceId).toBe(child.traceId);

            manager.endSpan();
            expect(manager.currentContext()?.traceId).toBe(parent.traceId);
        });
    });

    describe('currentContext', () => {
        it('returns undefined when stack is empty', () => {
            expect(manager.currentContext()).toBeUndefined();
        });

        it('returns top of stack', () => {
            const ctx = manager.startTrace();
            expect(manager.currentContext()).toEqual(ctx);
        });
    });

    describe('injectContext', () => {
        it('adds trace fields to keyValues', () => {
            const trace = manager.startTrace();
            const keyValues: Record<string, string | null | undefined> = {};

            manager.injectContext(keyValues);

            expect(keyValues[TRACE_ID_KEY]).toBe(trace.traceId.toString());
            expect(keyValues[SPAN_ID_KEY]).toBeDefined();
            expect(keyValues[PARENT_SPAN_ID_KEY]).toBeUndefined();
        });

        it('includes parent span ID for child spans', () => {
            manager.startTrace();
            manager.startSpan();

            const keyValues: Record<string, string | null | undefined> = {};
            manager.injectContext(keyValues);

            expect(keyValues[PARENT_SPAN_ID_KEY]).toBeDefined();
        });

        it('does nothing when no context exists', () => {
            const keyValues: Record<string, string | null | undefined> = { existing: 'value' };
            manager.injectContext(keyValues);

            expect(keyValues).toEqual({ existing: 'value' });
        });

        it('does not overwrite existing keys', () => {
            manager.startTrace();
            const keyValues: Record<string, string | null | undefined> = {
                existing: 'value',
                trace_id: 'should-not-be-overwritten'
            };

            manager.injectContext(keyValues);

            // Should overwrite with actual trace context
            expect(keyValues.existing).toBe('value');
            expect(keyValues.trace_id).not.toBe('should-not-be-overwritten');
        });
    });

    describe('nested spans', () => {
        it('maintains proper parent-child relationships', () => {
            const root = manager.startTrace();
            const child1 = manager.startSpan();
            const child2 = manager.startSpan();

            expect(child1.parentSpanId).toBe(root.spanId);
            expect(child2.parentSpanId).toBe(child1.spanId);
            expect(child1.traceId).toBe(root.traceId);
            expect(child2.traceId).toBe(root.traceId);
        });

        it('correctly unwinds stack', () => {
            const root = manager.startTrace();
            manager.startSpan();
            manager.startSpan();

            manager.endSpan();
            manager.endSpan();
            expect(manager.currentContext()?.traceId).toBe(root.traceId);

            manager.endSpan();
            expect(manager.currentContext()).toBeUndefined();
        });
    });
});
