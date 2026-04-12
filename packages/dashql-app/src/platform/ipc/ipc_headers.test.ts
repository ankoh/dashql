import { injectTraceHeaders } from './ipc_headers.js';
import { globalTraceContext } from '../logger/trace_context.js';

describe('injectTraceHeaders', () => {
    beforeEach(() => {
        // Clear any existing trace context
        while (globalTraceContext.currentContext()) {
            globalTraceContext.endSpan();
        }
    });

    it('adds trace headers when context exists', () => {
        globalTraceContext.startTrace('test-trace-123');

        const headers = new Headers();
        injectTraceHeaders(headers);

        expect(headers.get('dashql-trace-id')).toBe('test-trace-123');
        expect(headers.get('dashql-span-id')).toBeDefined();
        expect(headers.get('dashql-parent-span-id')).toBeNull();

        globalTraceContext.endSpan();
    });

    it('includes parent span ID for child spans', () => {
        globalTraceContext.startTrace();
        const parent = globalTraceContext.currentContext();
        globalTraceContext.startSpan();

        const headers = new Headers();
        injectTraceHeaders(headers);

        expect(headers.get('dashql-trace-id')).toBe(parent?.traceId);
        expect(headers.get('dashql-parent-span-id')).toBe(parent?.spanId);

        globalTraceContext.endSpan();
        globalTraceContext.endSpan();
    });

    it('does nothing when no context exists', () => {
        const headers = new Headers();
        headers.set('existing-header', 'value');

        injectTraceHeaders(headers);

        expect(headers.get('dashql-trace-id')).toBeNull();
        expect(headers.get('dashql-span-id')).toBeNull();
        expect(headers.get('existing-header')).toBe('value');
    });

    it('overwrites existing trace headers', () => {
        globalTraceContext.startTrace('new-trace');

        const headers = new Headers();
        headers.set('dashql-trace-id', 'old-trace');
        injectTraceHeaders(headers);

        expect(headers.get('dashql-trace-id')).toBe('new-trace');

        globalTraceContext.endSpan();
    });
});
