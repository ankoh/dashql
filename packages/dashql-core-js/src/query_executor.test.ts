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
    /// The progress updates of the queries
    progress: dashql.QueryProgressUpdate[] = [];

    report(_queryId: number, event: string, payload: unknown) {
        const type = JSON.parse(event).type as string;
        if (type === 'log') return;
        this.events.push(type);
        if (type === 'resultData') this.results.push(payload as Uint8Array);
        if (type === 'progress') this.progress.push(payload as dashql.QueryProgressUpdate);
    }
    async cacheLookup() { return null; }
    async cacheRead(): Promise<{ rows: number; columns: number }> { throw new Error('no cache'); }
    async cacheTouch() { }
    async cacheWrite() { }
    async analyzeResult() { }
    async finishResult(): Promise<dashql.QueryExecutorHostTable> { return { rows: 2, columns: 1, batches: 1 }; }
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
    it('streams a Trino query over the fetch of the host and hands the pages over as parts of an Arrow IPC stream', async () => {
        const host = new TrinoHost();
        const executor = dql!.createQueryExecutor(host);
        const outcome = await executor.execute(1, request(trino));
        expect(outcome).toEqual({ status: 'resolved', hasResult: true });
        expect(host.events).toEqual([
            'sending', 'running', 'progress', 'progress', 'resultData', 'receivedBatch', 'resultData', 'timing', 'receivedAllBatches',
            'resultsReady', 'succeeded',
        ]);
        expect(host.requests[0].headers).toContainEqual(['X-Trino-User', 'u']);
        // The first part starts with the continuation marker of the schema message, the last one ends the stream
        expect([...host.results[0].slice(0, 4)]).toEqual([255, 255, 255, 255]);
        expect([...host.results[1]]).toEqual([255, 255, 255, 255, 0, 0, 0, 0]);
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

    it('hands the chunks of Hyper over HTTP back to the host as they came', async () => {
        const host = new TrinoHost();
        const status = (chunks: number) => JSON.stringify({ queryId: 'h1', completionStatus: 'FINISHED', chunkCount: chunks });
        const bodies = [new Uint8Array([255, 255, 255, 255, 8, 0, 0, 0]), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])];
        host.fetch = async (_requestId, request) => {
            host.requests.push(request);
            const body = request.method === 'POST' ? bodies[0] : bodies[1];
            return { status: 200, statusText: 'OK', headers: [['x-hyperdb-status', status(2)]], body };
        };
        const executor = dql!.createQueryExecutor(host);
        const hyper: dashql.DashQLQueryTarget = { type: 'hyperHttp', params: { endpoint: 'https://hyper.example' }, clientContext: null, auth: {} };
        const outcome = await executor.execute(1, request(hyper));
        expect(outcome).toEqual({ status: 'resolved', hasResult: true });
        expect(host.requests).toHaveLength(2);
        expect(host.requests[1].url).toContain('/api/v3/query/h1/chunk/1');
        // The same objects, the bytes never entered the module
        expect(host.results).toHaveLength(2);
        expect(host.results[0]).toBe(bodies[0]);
        expect(host.results[1]).toBe(bodies[1]);
        executor.destroy();
    });

    it('keeps the memory of the module at a page while a large Trino result streams', async () => {
        // 64 pages of 4096 rows with a text of 256 characters, 69 MB as Arrow. The module grows by about 5 MB, it grew
        // by 200 MB when the executor collected the batches and wrote them as one stream.
        const PAGES = 64;
        const value = 'x'.repeat(256);
        const data = JSON.stringify(Array.from({ length: 4096 }, (_, i) => [i, value]));
        const columns = JSON.stringify([{ name: 'n', type: 'integer' }, { name: 's', type: 'varchar' }]);
        const encoder = new TextEncoder();
        const page = (index: number) => {
            const next = index < PAGES ? `,"nextUri":"${TRINO}/v1/statement/executing/q1/y/${index + 1}"` : '';
            const state = index < PAGES ? 'RUNNING' : 'FINISHED';
            return encoder.encode(`{"id":"q1","columns":${columns},"data":${data}${next},"stats":{"state":"${state}"}}`);
        };
        const host = new TrinoHost();
        let resultBytes = 0;
        host.fetch = async (_requestId, request) => {
            const ok = (body: Uint8Array) => ({ status: 200, statusText: 'OK', headers: [] as [string, string][], body });
            if (request.url.endsWith('/v1/statement')) {
                return ok(encoder.encode(`{"id":"q1","nextUri":"${TRINO}/v1/statement/executing/q1/y/1","stats":{"state":"QUEUED","queued":true}}`));
            }
            return ok(page(Number(/\/y\/(\d+)/.exec(request.url)?.[1])));
        };
        host.report = (_queryId, _event, payload) => {
            if (payload instanceof Uint8Array) resultBytes += payload.byteLength;
            // A progress update holds memory of the module until a history takes it
            else (payload as { free?: () => void } | undefined)?.free?.();
        };
        const executor = dql!.createQueryExecutor(host);
        const before = dashql.DashQL.moduleMemoryBytes();
        const outcome = await executor.execute(1, request(trino));
        const grown = dashql.DashQL.moduleMemoryBytes() - before;
        expect(outcome).toEqual({ status: 'resolved', hasResult: true });
        expect(resultBytes).toBeGreaterThan(64 * 1024 * 1024);
        expect(grown).toBeLessThan(24 * 1024 * 1024);
        executor.destroy();
    });

    it('reports the structured progress of a query, a history keeps it', async () => {
        const host = new TrinoHost();
        const executor = dql!.createQueryExecutor(host);
        const layout = new dashql.buffers.profile.ProfileLayoutConfigT();
        layout.orientation = dashql.buffers.profile.ProfileLayoutOrientation.LEFT_TO_RIGHT;
        executor.setProgressLayout(layout);
        const history = dql!.createQueryHistory();
        const metadata = { queryType: dashql.QueryType.USER_PROVIDED, title: null, description: null, issuer: null, userProvided: true };
        history.executeQuery(1, 41, 1, 'select 1', metadata, 10);
        expect(await executor.execute(1, request(trino))).toEqual({ status: 'resolved', hasResult: true });
        // Every update carries the structured progress of the statement stats of Trino
        expect(host.progress).toHaveLength(2);
        for (const update of host.progress) expect(history.queryProgressUpdated(1, update, 20).changed).toBe(true);

        const view = history.query(1)!;
        expect(view.latestProgress?.phase).toBe('FINISHED');
        const profile = view.latestProgress!.profile!;
        const structure = history.readQueryProfile(profile.structure!).read();
        expect(structure.engine()).toBe(dashql.buffers.profile.ProfileEngine.TRINO);
        expect(structure.layoutConfig()!.input()!.orientation()).toBe(dashql.buffers.profile.ProfileLayoutOrientation.LEFT_TO_RIGHT);
        const events = dashql.readFlatBuffer(profile.execution!, bb => dashql.buffers.profile.QueryProfileEvents.getRootAsQueryProfileEvents(bb));
        const query = events.events(0)!;
        expect(query.entity()).toBe(dashql.buffers.profile.ProfileEntity.QUERY);
        expect(query.status()).toBe(dashql.buffers.profile.ProfileExecutionStatus.SUCCEEDED);
        // The payloads with the keys that the host holds don't cross again
        const known = history.query(1, { revision: profile.revision, structureVersion: profile.structureVersion })!.latestProgress!.profile!;
        expect([known.structure, known.execution]).toEqual([null, null]);

        // The recording of the payloads replays the progress
        const recording = history.queryProgressRecording(1)!;
        expect(JSON.parse(recording).payloads.map((p: { payload: { kind: string } }) => p.payload.kind)).toEqual(['trino_statement_stats', 'trino_statement_stats']);
        expect(dql!.replayQueryProgress(recording, 0)).not.toBeNull();
        expect(dql!.replayQueryProgress(recording, -1)).toBeNull();
        expect(() => dql!.replayQueryProgress('{}', 0)).toThrow();

        // A follower replays it with another layout
        const rotated = new dashql.buffers.profile.ProfileLayoutConfigT();
        rotated.orientation = dashql.buffers.profile.ProfileLayoutOrientation.TOP_DOWN;
        const follower = dql!.createQueryProgressFollower(rotated);
        const followed = history.followQueryProgress(1, follower)!;
        expect(history.readQueryProfile(followed.structure!).read().layoutConfig()!.input()!.orientation()).toBe(rotated.orientation);
        expect(history.followQueryProgress(2, follower)).toBeNull();
        follower.destroy();
        history.destroy();
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
