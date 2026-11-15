import * as dashql from './index.js';

import { loadCoreWasm } from './test_fixture.js';

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await loadCoreWasm() });
});
afterEach(() => {
    dql!.resetUnsafe();
});

const TRINO = 'https://trino.example.com';

/// A host that answers the requests of a Trino query and records the events
class TrinoHost implements dashql.QueryExecutorHost {
    events: string[] = [];
    results: Uint8Array[] = [];
    requests: dashql.QueryExecutorHttpRequest[] = [];
    aborted: number[] = [];
    /// Hold the pages, the query runs until it is cancelled
    hold = false;

    now() { return Date.now(); }
    setTimer(ms: number, callback: () => void) { return setTimeout(callback, ms); }
    clearTimer(timer: unknown) { clearTimeout(timer as ReturnType<typeof setTimeout>); }
    log() { }
    async fetch(_requestId: number, request: dashql.QueryExecutorHttpRequest): Promise<dashql.QueryExecutorHttpResponse> {
        this.requests.push(request);
        const json = (body: object) => ({ status: 200, statusText: 'OK', headers: [] as [string, string][], body: new TextEncoder().encode(JSON.stringify(body)) });
        if (request.method === 'DELETE') return { status: 204, statusText: 'No Content', headers: [], body: new Uint8Array() };
        if (request.url.endsWith('/v1/statement')) {
            return json({ id: 'q1', nextUri: `${TRINO}/v1/statement/executing/q1/y/1`, stats: { state: 'QUEUED', queued: true } });
        }
        if (this.hold) return await new Promise(() => { });
        return json({ id: 'q1', columns: [{ name: 'n', type: 'integer' }], data: [[1], [2]], stats: { state: 'FINISHED' } });
    }
    abortFetch(requestId: number) { this.aborted.push(requestId); }
    report(_queryId: number, event: string, payload: unknown) {
        const type = JSON.parse(event).type as string;
        if (type === 'log') return;
        this.events.push(type);
        if (type === 'receivedAllBatches') this.results.push(payload as Uint8Array);
    }
    async cacheLookup() { return null; }
    async cacheRead(): Promise<{ rows: number; columns: number }> { throw new Error('no cache'); }
    async cacheTouch() { }
    async cacheWrite() { }
    async analyzeResult() { }
    async channelOpen() { return false; }
    async channelNext(): Promise<dashql.QueryExecutorChannelMessage> { throw new Error('no channel'); }
    async channelCancel() { }
    channelProfileDetail() { }
}

const request = (target: dashql.DashQLQueryTarget): dashql.DashQLQueryRequest => ({
    connectionId: 'c',
    text: 'select 1',
    target,
    publishResults: true,
    analyzeResults: false,
    cache: null,
    cacheOnly: false,
    touchesRelations: false,
    throwOnError: true,
    failure: null,
    logDetails: { workbookId: 'w' },
});

const trino: dashql.DashQLQueryTarget = {
    type: 'trino', endpoint: TRINO, auth: { authType: 'AUTH_BASIC', basic: { username: 'u', secret: 's' } }, accessToken: null, catalog: null, schema: null,
};

describe('DashQLQueryExecutor', () => {
    it('streams a Trino query over the fetch of the host and hands the result over as Arrow IPC', async () => {
        const host = new TrinoHost();
        const executor = dql!.createQueryExecutor(host);
        const outcome = await executor.execute(1, request(trino));
        expect(outcome).toEqual({ status: 'resolved', hasResult: true });
        expect(host.events).toEqual(['sending', 'running', 'progress', 'progress', 'receivedBatch', 'timing', 'receivedAllBatches', 'resultsReady', 'succeeded']);
        expect(host.requests[0].headers).toContainEqual(['X-Trino-User', 'u']);
        // An Arrow IPC stream starts with the continuation marker of its schema message
        expect([...host.results[0].slice(0, 4)]).toEqual([255, 255, 255, 255]);
        expect(executor.isRunning(1)).toBe(false);
        executor.destroy();
    });

    it('cancels a query at the server and aborts its requests', async () => {
        const host = new TrinoHost();
        host.hold = true;
        const executor = dql!.createQueryExecutor(host);
        const execution = executor.execute(1, request(trino));
        await vi.waitFor(() => expect(host.requests).toHaveLength(2));
        expect(executor.isRunning(1)).toBe(true);
        await executor.cancel(1);
        const outcome = await execution;
        expect(outcome.status).toBe('rejected');
        expect(outcome.status === 'rejected' && outcome.failure.kind).toBe('cancelled');
        expect(host.requests.at(-1)?.method).toBe('DELETE');
        expect(host.events.at(-1)).toBe('cancelled');
        executor.destroy();
    });

    it('rejects with what the caller failed the query with', async () => {
        const host = new TrinoHost();
        const executor = dql!.createQueryExecutor(host);
        const failure = new Error('bar.sql: unknown script :missing');
        const outcome = await executor.execute(1, { ...request({ type: 'host' }), failure: { message: failure.message } }, failure);
        expect(outcome.status === 'rejected' && outcome.value).toBe(failure);
        expect(host.events).toEqual(['failed']);
        executor.destroy();
    });
});
