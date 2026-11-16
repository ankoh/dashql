import * as dashql from './index.js';

import { loadCoreWasm, NO_OAUTH } from './test_fixture.js';

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await loadCoreWasm() });
});
afterEach(() => {
    dql!.resetUnsafe();
});

const TRINO = 'https://trino.example.com';

const USER_QUERY: dashql.QueryMetadataView = {
    queryType: dashql.QueryType.USER_PROVIDED,
    title: null,
    description: null,
    issuer: null,
    userProvided: true,
    resultOwner: 'alpha',
};

const METRICS: dashql.QueryStreamMetrics = {
    totalDataBytesReceived: 0,
    totalBatchesReceived: 1,
    totalRowsReceived: 3,
    totalQueryRequestsStarted: 1,
    totalQueryRequestsSucceeded: 1,
    totalQueryRequestsFailed: 0,
    totalQueryRequestDurationMs: 5,
    durationUntilFirstBatchMs: 2,
};

/// A platform that answers the requests of a Trino query, keeps the parts of the results and records what the runtime
/// tells it
class TestPlatform {
    readonly objects = new Map<number, unknown>();
    private next = 1;
    readonly requests: dashql.RuntimeHttpRequest[] = [];
    readonly aborted: number[] = [];
    readonly logs: string[] = [];
    /// The channels that the setups connected
    readonly connected: dashql.RuntimeChannelRequest[] = [];
    /// The queries that the runtime described on their channels, and the ones that ended
    readonly described: string[] = [];
    readonly forgotten: number[] = [];
    /// Describes the channel of a query, the queries run on Trino
    describe: () => Promise<unknown> = async () => TRINO_TARGET;
    /// The parts of the tables that stream, by handle
    readonly parts = new Map<number, Uint8Array[]>();
    resultBytes = 0;
    /// Hold the pages, the query runs until it is cancelled
    hold = false;
    fetch: (request: dashql.RuntimeHttpRequest) => Promise<dashql.RuntimeHttpResponse> = request => this.trino(request);

    readonly platform: dashql.RuntimePlatform = {
        clock: { now: () => Date.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) },
        log: (_level, message) => { this.logs.push(message); },
        handles: {
            register: object => this.register(object),
            release: handle => { this.objects.delete(handle); },
            get: handle => this.objects.get(handle),
            duplicate: handle => this.register(this.objects.get(handle)),
        },
        tables: {
            begin: () => { throw new Error('no tables'); },
            append: () => { throw new Error('no tables'); },
            open: () => {
                const handle = this.register(null);
                this.parts.set(handle, []);
                return handle;
            },
            push: (table, part) => {
                this.parts.get(table)!.push(part);
                this.resultBytes += part.byteLength;
            },
            finish: table => {
                const parts = this.parts.get(table)!;
                this.parts.delete(table);
                this.objects.set(table, { parts });
                return { rows: 2, bytes: 0, columns: 1, batches: 1 };
            },
            read: () => { throw new Error('no tables'); },
            describe: () => { throw new Error('no tables'); },
        },
        compute: null,
        http: {
            fetch: async (_id, request) => {
                this.requests.push(request);
                return await this.fetch(request);
            },
            abort: id => { this.aborted.push(id); },
        },
        channels: {
            connect: async (_setupId, request) => {
                this.connected.push(request);
                return this.register({ request, close: () => { } });
            },
            hyperLinkToken: () => null,
            describe: async (_queryId, _channel, query) => {
                this.described.push(query.text);
                return await this.describe();
            },
            forget: queryId => { this.forgotten.push(queryId); },
            open: async () => false,
            next: () => Promise.reject(new Error('no channel')),
            cancel: async () => { },
            profileDetail: () => { },
        },
        resultCache: null,
        crypto: {
            randomUuid: () => `uuid-${this.next}`,
            sha256: async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)),
        },
        oauth: NO_OAUTH,
        extensions: { loadSpec: () => Promise.reject(new Error('no extensions')) },
        salesforce: null,
        storage: null,
        archives: null,
        changed: () => { },
    };

    private register(object: unknown): number {
        const handle = this.next++;
        this.objects.set(handle, object);
        return handle;
    }

    private async trino(request: dashql.RuntimeHttpRequest): Promise<dashql.RuntimeHttpResponse> {
        const json = (body: object) => ({ status: 200, statusText: 'OK', headers: [] as [string, string][], body: new TextEncoder().encode(JSON.stringify(body)) });
        if (request.method === 'DELETE') return { status: 204, statusText: 'No Content', headers: [], body: new Uint8Array() };
        if (request.url.endsWith('/v1/statement')) {
            return json({ id: 'q1', nextUri: `${TRINO}/v1/statement/executing/q1/y/1`, stats: { state: 'QUEUED', queued: true } });
        }
        if (this.hold) return await new Promise(() => { });
        return json({ id: 'q1', columns: [{ name: 'n', type: 'integer' }], data: [[1], [2]], stats: { state: 'FINISHED' } });
    }
}

/// The target of a query on a Trino channel, as the platform of TypeScript describes it
const TRINO_TARGET = {
    type: 'trino',
    endpoint: TRINO,
    auth: { authType: 'AUTH_BASIC', basic: { username: 'u', secret: 's' } },
    accessToken: null,
    catalog: null,
    schema: null,
};

function createRuntime(platform: TestPlatform) {
    const runtime = dql!.createRuntime(platform.platform);
    // The tests of the catalog loader start it
    runtime.runCatalogLoader(false);
    const created = (connectorType: dashql.ConnectorType, connectionId: string, setupParams: dashql.JsonParams) => {
        const outcome = runtime.dispatch('app', { kind: 'createConnection', value: { connectionId, connectorType, setupParams } });
        expect(outcome).toMatchObject({ ok: true, id: connectionId });
    };
    created(dashql.ConnectorType.HYPER, 'main', { protocol: 'WASM', endpoint: '' });
    created(dashql.ConnectorType.TRINO, 'trino', { endpoint: TRINO, defaultCatalog: 'tpch', defaultSchema: 'tiny' });
    return runtime;
}

const viewOf = <K extends dashql.ViewKind>(runtime: dashql.Runtime, kind: K, id: dashql.ViewId<K>) => runtime.views(kind, [id])[0];

describe('The connections of the runtime', () => {
    it('lists the connections and reports their slices', () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        const changes = runtime.takeChanges().changes.map(change => `${change.kind}:${change.id}`);
        expect(changes).toEqual(['connectionList:root', 'connection:main', 'connection:trino']);
        expect(runtime.takeChanges().changes).toEqual([]);
        const list = viewOf(runtime, 'connectionList', 'root')!;
        expect(list.connections.map(c => [c.connectionId, c.listed, c.ordinal])).toEqual([['main', false, null], ['trino', false, null]]);
        expect(list.connectionsByType[dashql.ConnectorType.TRINO]).toEqual(['trino']);
        const main = viewOf(runtime, 'connection', 'main')!;
        expect(main).toMatchObject({ connectionId: 'main', connectionHealth: dashql.ConnectionHealth.NOT_STARTED, queriesActiveOrdered: [], workbooks: [] });
        expect(Object.getPrototypeOf(main.params)).toBe(Object.prototype);
        expect(runtime.views('connection', ['gone'])).toEqual([null]);

        // A workbook on a connection uses it, a connection that a workbook uses is listed
        expect(runtime.dispatch('app', { kind: 'createWorkbook', value: { workbookId: 'w', connectionId: 'trino' } }).ok).toBe(true);
        const connectionChanges = runtime.takeChanges().changes.filter(change => change.kind.startsWith('connection')).map(change => `${change.kind}:${change.id}`);
        expect(connectionChanges).toEqual(['connectionList:root', 'connection:trino']);
        expect(viewOf(runtime, 'connection', 'trino')!.workbooks).toEqual(['w']);
        expect(runtime.dispatch({ connection: 'trino' }, { kind: 'deleteConnection' })).toMatchObject({ ok: false });
        expect(runtime.dispatch({ connection: 'main' }, { kind: 'deleteConnection' })).toMatchObject({ ok: false });
        runtime.destroy();
        runtime.free();
    });

    it('applies the steps of a setup, the connection takes the channel by its handle', () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        runtime.takeChanges();
        const channel = { close: () => { } };
        const handle = platform.platform.handles.register(channel);
        expect(runtime.dispatch({ connection: 'main' }, { kind: 'setupStep', value: { step: 'HYPER_CHANNEL_SETUP_STARTED', value: { protocol: 'WASM', endpoint: '' } } }).ok).toBe(true);
        expect(runtime.dispatch({ connection: 'main' }, { kind: 'setupStep', value: { step: 'HYPER_CHANNEL_READY', value: { protocol: 'WASM', endpoint: '' }, channel: handle } }).changed).toBe(true);
        const main = viewOf(runtime, 'connection', 'main')!;
        expect(main).toMatchObject({ connectionHealth: dashql.ConnectionHealth.ONLINE, active: true, details: { channel: handle } });
        // A reset closes the channel
        runtime.dispatch({ connection: 'main' }, { kind: 'resetConnection' });
        expect(runtime.takeChanges().effects).toEqual([{ type: 'close', handle }]);
        // A step that no connector knows fails and releases its channel
        const other = platform.platform.handles.register({});
        expect(runtime.dispatch({ connection: 'main' }, { kind: 'setupStep', value: { step: 'UNKNOWN', channel: other } })).toMatchObject({ ok: false });
        expect(runtime.takeChanges().effects).toEqual([{ type: 'release', handle: other }]);
        runtime.destroy();
        runtime.free();
    });

    it('sets up a connection, its probe is a query of the connection', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        const params = { trino: { endpoint: TRINO, defaultCatalog: 'tpch', auth: { authType: 'AUTH_BASIC', basic: { username: 'u', secret: 's' } } } };
        const setup = runtime.setupConnection('trino', { params });
        expect(viewOf(runtime, 'connection', 'trino')!.setupRunning).toBe(true);
        expect(await setup).toEqual({ status: 'succeeded', message: null, data: {}, authentication: null });
        const trino = viewOf(runtime, 'connection', 'trino')!;
        expect(trino).toMatchObject({ connectionHealth: dashql.ConnectionHealth.ONLINE, setupRunning: false, params });
        expect(platform.connected).toEqual([{ type: 'trino', endpoint: TRINO, auth: expect.objectContaining({ authType: 'AUTH_BASIC' }), catalog: 'tpch', schema: null, accessToken: null }]);
        expect(platform.objects.get(trino.details.channel!)).toMatchObject({ request: { type: 'trino' } });
        expect(platform.described).toEqual(['select 1']);
        expect(platform.forgotten).toEqual(trino.queriesFinishedOrdered);
        expect(viewOf(runtime, 'query', trino.queriesFinishedOrdered[0])).toMatchObject({ queryMetadata: { title: 'Health Check', issuer: 'Connection Setup' } });
        // A connection of another connector doesn't take the params
        expect(await runtime.setupConnection('main', { params })).toMatchObject({ status: 'failed' });
        expect(await runtime.setupConnection('gone')).toMatchObject({ status: 'failed', message: 'no connection registered with id gone' });
        runtime.destroy();
        runtime.free();
    });

    it('cancels a setup, the probe stops at the server', async () => {
        const platform = new TestPlatform();
        platform.hold = true;
        const runtime = createRuntime(platform);
        const setup = runtime.setupConnection('trino', { params: { trino: { endpoint: TRINO } } });
        await vi.waitFor(() => expect(platform.requests).toHaveLength(2));
        runtime.cancelSetup('trino');
        expect(await setup).toMatchObject({ status: 'cancelled' });
        expect(platform.requests.at(-1)?.method).toBe('DELETE');
        expect(viewOf(runtime, 'connection', 'trino')!.connectionHealth).toBe(dashql.ConnectionHealth.CANCELLED);
        runtime.destroy();
        runtime.free();
    });

    it('describes a connection that comes online with the catalog loader', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        expect((await runtime.setupConnection('trino', { params: { trino: { endpoint: TRINO } } })).status).toBe('succeeded');
        platform.described.length = 0;
        runtime.runCatalogLoader(true);
        await vi.waitFor(() => expect(viewOf(runtime, 'connection', 'trino')!.catalogUpdates.tasksFinished).toHaveLength(1));
        const trino = viewOf(runtime, 'connection', 'trino')!;
        // The metadata query is a query of the connection that the update registered, the catalogs of Trino come first
        expect(platform.described).toEqual([expect.stringContaining('system.metadata.catalogs')]);
        expect(trino.catalogUpdates.tasksFinished[0].queries).toEqual([trino.queriesFinishedOrdered.at(-1)]);
        runtime.destroy();
        runtime.free();
    });

    it('shares the catalog of a connection and keeps its function script', () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        const catalog = dql!.runtimeCatalog(runtime, 'main')!;
        expect(dql!.runtimeCatalog(runtime, 'gone')).toBeNull();
        const script = dql!.createScript(catalog);
        script.replaceText('create table t (a int)');
        script.analyze();
        catalog.loadScript(script, dashql.buffers.catalog.CatalogLayer.CONNECTION);
        const version = catalog.version();
        runtime.dispatch({ connection: 'main' }, { kind: 'resetConnection' });
        expect(catalog.version()).toBeGreaterThan(version);
        expect(runtime.functionScriptText('main')).toContain('DashQL Connection Functions');
        runtime.dispatch({ connection: 'main' }, { kind: 'replaceFunctionScriptText', value: { text: 'create function f() returns int;' } });
        expect(runtime.functionScriptText('main')).toBe('create function f() returns int;');
        script.destroy();
        catalog.destroy();
        runtime.destroy();
        runtime.free();
    });

    it('refuses actions of the wrong shape and stays usable', () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        expect(() => runtime.dispatch({ connection: 'main' }, { kind: 'setDraft', value: { params: 42 } } as unknown as dashql.RuntimeAction)).toThrow();
        expect(() => runtime.dispatch({ connection: 'main' }, { kind: 'nope' } as unknown as dashql.RuntimeAction)).toThrow();
        expect(() => runtime.views('query', ['x' as unknown as number])).toThrow();
        expect(() => runtime.cancelQuery(-1)).toThrow();
        expect(runtime.dispatch({ connection: 'main' }, { kind: 'rename', value: { name: 'Main' } })).toMatchObject({ ok: true, changed: true });
        expect(viewOf(runtime, 'connection', 'main')!.name).toBe('Main');
        runtime.destroy();
        runtime.free();
    });
});

describe('The queries of the runtime', () => {
    it('tracks the queries of the host in a history without a connection', () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        expect(runtime.dispatch({ history: 'shell' }, { kind: 'trackQuery', value: { traceId: 1, text: 'select 1', metadata: USER_QUERY } })).toMatchObject({ ok: false });
        runtime.dispatch({ history: 'shell' }, { kind: 'createHistory', value: { limit: 1 } });
        const record = platform.platform.handles.register({ abort: () => { } });
        const first = runtime.dispatch({ history: 'shell' }, { kind: 'trackQuery', value: { traceId: 1, text: 'select 1', metadata: USER_QUERY, handle: record } });
        expect(first).toMatchObject({ ok: true, id: expect.any(Number) });
        const queryId = first.id as number;
        const table = platform.platform.handles.register('table');
        runtime.dispatch({ history: 'shell' }, { kind: 'queryRunning', value: { queryId } });
        runtime.dispatch({ history: 'shell' }, { kind: 'queryReceivedAllBatches', value: { queryId, table, rows: 3, metrics: METRICS } });
        runtime.dispatch({ history: 'shell' }, { kind: 'querySucceeded', value: { queryId } });
        expect(viewOf(runtime, 'history', 'shell')).toEqual({ queries: [queryId] });
        expect(viewOf(runtime, 'query', queryId)).toMatchObject({
            queryId,
            connectionId: null,
            queryText: 'select 1',
            queryMetadata: { resultOwner: 'alpha' },
            status: dashql.QueryExecutionStatus.SUCCEEDED,
            resultTable: { id: table, rows: 3 },
        });
        runtime.takeChanges();
        // The limit drops the oldest query with its table
        const second = runtime.dispatch({ history: 'shell' }, { kind: 'trackQuery', value: { traceId: 2, text: 'select 2', metadata: USER_QUERY } });
        const changes = runtime.takeChanges();
        expect(changes.effects).toEqual([{ type: 'release', handle: table }, { type: 'release', handle: record }]);
        expect(changes.changes.filter(change => change.kind === 'query')).toEqual([
            { kind: 'query', id: second.id, revision: expect.any(Number) },
            { kind: 'query', id: queryId, revision: null },
        ]);
        expect(viewOf(runtime, 'query', queryId)).toBeNull();
        runtime.destroy();
        runtime.free();
    });

    it('runs a Trino query into the history of its connection, the parts of the result stay with the host', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        runtime.takeChanges();
        const events: string[] = [];
        const ticket = runtime.executeQuery('trino', { text: 'create table t as select 1', metadata: USER_QUERY, traceId: 7, options: { throwOnError: true } }, undefined, event => events.push(event.type));
        expect(viewOf(runtime, 'connection', 'trino')!.queriesActiveOrdered).toEqual([ticket.queryId]);
        const outcome = await ticket.done;
        expect(outcome).toMatchObject({ status: 'resolved', hasResult: true });
        expect(outcome.status === 'resolved' && (outcome.table as { parts: Uint8Array[] }).parts).toHaveLength(2);
        expect(events).toEqual(['timing', 'resultsReady']);
        expect(platform.requests[0].headers).toContainEqual(['X-Trino-User', 'u']);
        const connection = viewOf(runtime, 'connection', 'trino')!;
        expect(connection.queriesFinishedOrdered).toEqual([ticket.queryId]);
        expect(connection.metrics.successfulQueries.totalQueries).toBe(1);
        // The statement touched a relation that the catalog loader asks about
        expect(connection.catalogUpdates.touchedRelations).toMatchObject([{ databaseName: 'tpch', tableName: 't' }]);
        expect(viewOf(runtime, 'query', ticket.queryId)).toMatchObject({
            connectionId: 'trino',
            traceId: 7,
            status: dashql.QueryExecutionStatus.SUCCEEDED,
            resultTable: { rows: 2 },
            latestProgressUpdate: { phase: 'FINISHED' },
        });
        runtime.destroy();
        runtime.free();
    });

    it('cancels a query at the server and aborts its requests', async () => {
        const platform = new TestPlatform();
        platform.hold = true;
        const runtime = createRuntime(platform);
        const ticket = runtime.executeQuery('trino', { text: 'select 1', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true } }, undefined, null);
        await vi.waitFor(() => expect(platform.requests).toHaveLength(2));
        await runtime.cancelQuery(ticket.queryId);
        const outcome = await ticket.done;
        expect(outcome.status === 'rejected' && outcome.failure.kind).toBe('cancelled');
        expect(platform.requests.at(-1)?.method).toBe('DELETE');
        expect(viewOf(runtime, 'query', ticket.queryId)!.status).toBe(dashql.QueryExecutionStatus.CANCELLED);
        runtime.destroy();
        runtime.free();
    });

    it('fails a query of an unknown connection, a query that the caller failed and one that is cancelled before it ran', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        const unknown = runtime.executeQuery('gone', { text: 'select 1', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true } }, undefined, null);
        expect(await unknown.done).toMatchObject({ status: 'rejected', failure: { message: "Couldn't find a connection with id gone" } });

        const failure = new Error('bar.sql: unknown script :missing');
        const failed = runtime.executeQuery('trino', { text: 'select 1', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true } }, failure, null);
        const outcome = await failed.done;
        expect(outcome.status === 'rejected' && outcome.value).toBe(failure);
        expect(viewOf(runtime, 'query', failed.queryId)).toMatchObject({ status: dashql.QueryExecutionStatus.FAILED, error: { message: failure.message } });

        let describe: (target: unknown) => void = () => { };
        platform.describe = () => new Promise(resolve => { describe = resolve; });
        const pending = runtime.executeQuery('trino', { text: 'select 1', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true } }, undefined, null);
        await vi.waitFor(() => expect(platform.described).toEqual(['select 1', 'select 1']));
        await runtime.cancelQuery(pending.queryId);
        describe(TRINO_TARGET);
        expect(await pending.done).toMatchObject({ status: 'rejected', failure: { kind: 'cancelled' } });
        expect(platform.requests).toHaveLength(0);
        runtime.destroy();
        runtime.free();
    });

    it('cancels a call of a client function while its spec loads, the call never starts', async () => {
        const platform = new TestPlatform();
        let loads = 0;
        let load: (spec: string) => void = () => { };
        platform.platform.extensions = { loadSpec: () => { ++loads; return new Promise(resolve => { load = resolve; }); } };
        platform.describe = async () => ({ type: 'host', tokens: null });
        const runtime = createRuntime(platform);
        runtime.dispatch('app', { kind: 'createConnection', value: { connectionId: 'sf', connectorType: dashql.ConnectorType.SALESFORCE_DATA_CLOUD, setupParams: {} } });
        const call = { namespace: 'cdp', function: 'query', effect: 'read' };
        const ticket = runtime.executeQuery('sf', { text: 'call cdp.query()', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true, clientFunctionCall: call } }, undefined, null);
        // The registration of the client functions of the connection loads the spec as well
        await vi.waitFor(() => expect(loads).toBe(2));
        // The cancel resolves once the query ended, it doesn't wait for the spec
        await runtime.cancelQuery(ticket.queryId);
        expect(viewOf(runtime, 'query', ticket.queryId)!.status).toBe(dashql.QueryExecutionStatus.CANCELLED);
        expect(await ticket.done).toMatchObject({ status: 'rejected', failure: { kind: 'cancelled' } });
        load('{"functions":[]}');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(platform.requests).toHaveLength(0);
        expect(viewOf(runtime, 'query', ticket.queryId)!.status).toBe(dashql.QueryExecutionStatus.CANCELLED);
        runtime.destroy();
        runtime.free();
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
        const platform = new TestPlatform();
        platform.fetch = async request => {
            const ok = (body: Uint8Array) => ({ status: 200, statusText: 'OK', headers: [] as [string, string][], body });
            if (request.url.endsWith('/v1/statement')) {
                return ok(encoder.encode(`{"id":"q1","nextUri":"${TRINO}/v1/statement/executing/q1/y/1","stats":{"state":"QUEUED","queued":true}}`));
            }
            return ok(page(Number(/\/y\/(\d+)/.exec(request.url)?.[1])));
        };
        // The parts are counted, not kept
        platform.platform.tables.push = (_table, part) => { platform.resultBytes += part.byteLength; };
        const runtime = createRuntime(platform);
        const before = dashql.DashQL.moduleMemoryBytes();
        const ticket = runtime.executeQuery('trino', { text: 'select 1', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true } }, undefined, null);
        expect((await ticket.done).status).toBe('resolved');
        const grown = dashql.DashQL.moduleMemoryBytes() - before;
        expect(platform.resultBytes).toBeGreaterThan(64 * 1024 * 1024);
        expect(grown).toBeLessThan(24 * 1024 * 1024);
        runtime.destroy();
        runtime.free();
    });

    it('keeps the structured progress of a query, its recording and its followers', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        const layout = new dashql.buffers.profile.ProfileLayoutConfigT();
        layout.orientation = dashql.buffers.profile.ProfileLayoutOrientation.LEFT_TO_RIGHT;
        runtime.setProgressLayout(layout);
        const ticket = runtime.executeQuery('trino', { text: 'select 1', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true } }, undefined, null);
        expect((await ticket.done).status).toBe('resolved');
        const view = viewOf(runtime, 'query', ticket.queryId)!;
        const profile = view.latestProgressUpdate!.profile!;
        const structure = dql!.readQueryProfile(profile.structure!).read();
        expect(structure.engine()).toBe(dashql.buffers.profile.ProfileEngine.TRINO);
        expect(structure.layoutConfig()!.input()!.orientation()).toBe(dashql.buffers.profile.ProfileLayoutOrientation.LEFT_TO_RIGHT);
        const events = dashql.readFlatBuffer(profile.execution!, bb => dashql.buffers.profile.QueryProfileEvents.getRootAsQueryProfileEvents(bb));
        expect(events.events(0)!.status()).toBe(dashql.buffers.profile.ProfileExecutionStatus.SUCCEEDED);
        // The payloads with the keys that the host holds don't cross again
        const known = runtime.views('query', [ticket.queryId], [{ revision: profile.revision, structureVersion: profile.structureVersion }])[0]!;
        expect([known.latestProgressUpdate!.profile!.structure, known.latestProgressUpdate!.profile!.execution]).toEqual([null, null]);

        const recording = runtime.queryProgressRecording(ticket.queryId)!;
        expect(JSON.parse(recording).payloads.map((p: { payload: { kind: string } }) => p.payload.kind)).toEqual(['trino_statement_stats', 'trino_statement_stats']);
        expect(dql!.replayQueryProgress(recording, 0)).not.toBeNull();
        const rotated = new dashql.buffers.profile.ProfileLayoutConfigT();
        rotated.orientation = dashql.buffers.profile.ProfileLayoutOrientation.TOP_DOWN;
        const follower = dql!.createQueryProgressFollower(rotated);
        const followed = follower.follow(runtime, ticket.queryId)!;
        expect(dql!.readQueryProfile(followed.structure!).read().layoutConfig()!.input()!.orientation()).toBe(rotated.orientation);
        expect(follower.follow(runtime, ticket.queryId + 100)).toBeNull();
        follower.destroy();
        runtime.destroy();
        runtime.free();
    });

    it('stops the queries of a connection that is reset', async () => {
        const platform = new TestPlatform();
        platform.hold = true;
        const runtime = createRuntime(platform);
        const ticket = runtime.executeQuery('trino', { text: 'select 1', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true } }, undefined, null);
        await vi.waitFor(() => expect(platform.requests).toHaveLength(2));
        runtime.dispatch({ connection: 'trino' }, { kind: 'resetConnection' });
        expect(viewOf(runtime, 'connection', 'trino')!.queriesActiveOrdered).toEqual([]);
        expect((await ticket.done).status).toBe('rejected');
        expect(viewOf(runtime, 'query', ticket.queryId)).toBeNull();
        runtime.destroy();
        runtime.free();
    });
});
