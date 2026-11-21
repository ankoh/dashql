import * as arrow from 'apache-arrow';
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
    /// Describes the channel of a query of the host, a Trino connection owns its channel
    describe: () => Promise<dashql.RuntimeChannelTarget> = async () => ({ type: 'host' });
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
        },
        results: null,
        crypto: {
            randomUuid: () => `uuid-${this.next}`,
            sha256: async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)),
        },
        oauth: NO_OAUTH,
        extensions: { loadSpec: () => Promise.reject(new Error('no extensions')) },
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

/// The params of a Trino connection with basic auth
const TRINO_PARAMS = { trino: { endpoint: TRINO, defaultCatalog: 'tpch', auth: { authType: 'AUTH_BASIC', basic: { username: 'u', secret: 's' } } } };

/// Set up the Trino connection, its channel is owned by the connection. The requests of the setup are forgotten.
async function setupTrino(runtime: dashql.Runtime, platform: TestPlatform, params: unknown = TRINO_PARAMS) {
    expect(await runtime.setupConnection('trino', { params: params as dashql.JsonParams })).toMatchObject({ status: 'succeeded' });
    platform.requests.length = 0;
    platform.described.length = 0;
}

/// The rows of the result table of a query, from the parts of its Arrow IPC stream
function resultTable(outcome: unknown): arrow.Table {
    const parts = (outcome as { table: { parts: Uint8Array[] } }).table.parts;
    const bytes = new Uint8Array(parts.reduce((n, part) => n + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
    }
    return arrow.tableFromIPC(bytes);
}

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
        runtime.free();
    });

    it('shows the rules of the connectors in the views, the tokens only on request', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        const main = viewOf(runtime, 'connection', 'main')!;
        // The embedded Hyper reads the attachments of workbooks and caches no results
        expect(main).toMatchObject({ open: false, healthLabel: 'Not Started', readsAttachments: true, cachesQueryResults: false, cacheQueryResults: null });
        expect((await runtime.setupConnection('trino', { params: { trino: { endpoint: TRINO } } })).status).toBe('succeeded');
        const trino = viewOf(runtime, 'connection', 'trino')!;
        expect(trino).toMatchObject({ open: true, healthLabel: 'Online', readsAttachments: false, cachesQueryResults: true });
        // The choice of the user wins over the connector
        runtime.dispatch({ connection: 'trino' }, { kind: 'setQueryResultCaching', value: { caching: false } });
        expect(viewOf(runtime, 'connection', 'trino')!.cachesQueryResults).toBe(false);
        // A connection without OAuth has no tokens
        expect(runtime.revealConnectionSecrets('trino')).toEqual({ accessToken: null, coreAccessToken: null, dataCloudAccessToken: null });
        expect(runtime.revealConnectionSecrets('gone')).toBeNull();
        runtime.free();
    });

    it('sets up a connection, its probe is a query of the connection', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        const params = TRINO_PARAMS;
        const setup = runtime.setupConnection('trino', { params });
        expect(viewOf(runtime, 'connection', 'trino')!.setupRunning).toBe(true);
        expect(await setup).toEqual({ status: 'succeeded', message: null, data: {}, authentication: null });
        const trino = viewOf(runtime, 'connection', 'trino')!;
        expect(trino).toMatchObject({ connectionHealth: dashql.ConnectionHealth.ONLINE, setupRunning: false, params });
        // The connection owns the Trino channel, the platform keeps nothing of it and describes nothing
        expect(platform.connected).toEqual([]);
        expect(trino.details.channel).toBeNull();
        expect(platform.described).toEqual([]);
        expect(platform.requests[0].headers).toContainEqual(['X-Trino-Catalog', 'tpch']);
        expect(platform.forgotten).toEqual(trino.queriesFinishedOrdered);
        expect(viewOf(runtime, 'query', trino.queriesFinishedOrdered[0])).toMatchObject({ queryMetadata: { title: 'Health Check', issuer: 'Connection Setup' } });
        // A connection of another connector doesn't take the params
        expect(await runtime.setupConnection('main', { params })).toMatchObject({ status: 'failed' });
        expect(await runtime.setupConnection('gone')).toMatchObject({ status: 'failed', message: 'no connection registered with id gone' });
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
        runtime.free();
    });

    it('keeps the channel of a setup that replaced one that was stuck connecting', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        let connects = 0;
        let finishFirst: (fails: boolean) => void = () => { };
        platform.platform.channels.connect = async (_setupId, request) => {
            connects += 1;
            if (connects === 1) {
                // The first connect hangs and ends after the second setup
                const fails = await new Promise<boolean>(resolve => { finishFirst = resolve; });
                if (fails) throw new Error('the first connect failed late');
            }
            return platform.platform.handles.register({ request, close: () => { } });
        };
        const first = runtime.setupConnection('main');
        await vi.waitFor(() => expect(connects).toBe(1));
        const second = runtime.setupConnection('main');
        expect(await second).toMatchObject({ status: 'succeeded' });
        // The second setup cancelled the first one, which stopped waiting for its connect
        expect(await first).toMatchObject({ status: 'cancelled' });
        const online = viewOf(runtime, 'connection', 'main')!;
        expect(online.connectionHealth).toBe(dashql.ConnectionHealth.ONLINE);
        runtime.takeChanges();
        // The connect of the first setup ends late, the connection keeps the channel of the second one
        finishFirst(false);
        await vi.waitFor(() => expect(runtime.takeChanges().effects).toEqual([{ type: 'close', handle: expect.any(Number) }]));
        const after = viewOf(runtime, 'connection', 'main')!;
        expect(after.connectionHealth).toBe(dashql.ConnectionHealth.ONLINE);
        expect(after.details.channel).toBe(online.details.channel);
        runtime.free();
    });

    it('aborts the OAuth flow of a setup that is cancelled', async () => {
        const platform = new TestPlatform();
        const flows: number[] = [];
        const aborted: number[] = [];
        platform.platform.oauth = {
            ...platform.platform.oauth,
            pkce: async () => ({ value: 'challenge', verifier: 'verifier' }),
            // The loopback server waits for the redirect until the flow is aborted
            authorizeWithLoopback: (_setupId, flow) => {
                flows.push(flow);
                return new Promise(() => { });
            },
            abort: flow => { aborted.push(flow); },
        };
        const runtime = createRuntime(platform);
        const oauth = { authorizationUrl: 'https://idp.example.com/auth', tokenUrl: 'https://idp.example.com/token', clientId: 'dashql' };
        const setup = runtime.setupConnection('trino', { params: { trino: { endpoint: TRINO, auth: { authType: 'AUTH_OAUTH', oauth } } } });
        await vi.waitFor(() => expect(flows).toHaveLength(1));
        runtime.cancelSetup('trino');
        expect(await setup).toMatchObject({ status: 'cancelled' });
        // The loopback server of the flow closes
        expect(aborted).toEqual(flows);
        runtime.free();
    });

    it('leaves the setup that runs alone when the params of another one do not read', async () => {
        const platform = new TestPlatform();
        platform.hold = true;
        const runtime = createRuntime(platform);
        const setup = runtime.setupConnection('trino', { params: TRINO_PARAMS });
        await vi.waitFor(() => expect(platform.requests).toHaveLength(2));
        // Params of another connector fail before they touch the connection
        expect(await runtime.setupConnection('trino', { params: { hyper: { protocol: 'WASM' } } as unknown as dashql.JsonParams })).toMatchObject({ status: 'failed' });
        expect(viewOf(runtime, 'connection', 'trino')).toMatchObject({ setupRunning: true, connectionHealth: dashql.ConnectionHealth.CONNECTING });
        runtime.cancelSetup('trino');
        expect(await setup).toMatchObject({ status: 'cancelled' });
        expect(viewOf(runtime, 'connection', 'trino')!.connectionHealth).toBe(dashql.ConnectionHealth.CANCELLED);
        runtime.free();
    });

    it('closes the channel of the host that a new setup replaces', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        expect(await runtime.setupConnection('main')).toMatchObject({ status: 'succeeded' });
        const first = viewOf(runtime, 'connection', 'main')!.details.channel;
        expect(first).toEqual(expect.any(Number));
        runtime.takeChanges();
        // A shell that mounts again sets the embedded Hyper up again: the session of the first setup closes
        expect(await runtime.setupConnection('main')).toMatchObject({ status: 'succeeded' });
        expect(runtime.takeChanges().effects).toContainEqual({ type: 'close', handle: first });
        expect(viewOf(runtime, 'connection', 'main')!.details.channel).not.toBe(first);
        runtime.free();
    });

    it('ignores the late steps of a setup after a reset during its probe', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        platform.hold = true;
        const setup = runtime.setupConnection('trino', { params: TRINO_PARAMS });
        await vi.waitFor(() => expect(platform.requests).toHaveLength(2));
        runtime.dispatch({ connection: 'trino' }, { kind: 'resetConnection' });
        expect(await setup).toMatchObject({ status: 'cancelled' });
        const trino = viewOf(runtime, 'connection', 'trino')!;
        // The cancelled probe and the end of the setup don't land after the reset
        expect(trino.connectionHealth).toBe(dashql.ConnectionHealth.NOT_STARTED);
        expect(trino.details.channel).toBeNull();
        expect(trino.setupRunning).toBe(false);
        runtime.free();
    });

    it('describes a connection that comes online with the catalog loader', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        await setupTrino(runtime, platform, { trino: { endpoint: TRINO } });
        runtime.runCatalogLoader(true);
        await vi.waitFor(() => expect(viewOf(runtime, 'connection', 'trino')!.catalogUpdates.tasksFinished).toHaveLength(1));
        const trino = viewOf(runtime, 'connection', 'trino')!;
        // The metadata query is a query of the connection that the update registered, the catalogs of Trino come first
        expect(platform.requests.filter(r => r.url.endsWith('/v1/statement')).map(r => r.body)).toEqual([expect.stringContaining('system.metadata.catalogs')]);
        expect(trino.catalogUpdates.tasksFinished[0].queries).toEqual([trino.queriesFinishedOrdered.at(-1)]);
        runtime.free();
    });

    it('shares the catalog of a connection read-only and keeps its function script', () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        const catalog = dql!.runtimeCatalog(runtime, 'main')!;
        expect(dql!.runtimeCatalog(runtime, 'gone')).toBeNull();
        const script = dql!.createScript(catalog);
        script.replaceText('create table t (a int)');
        script.analyze();
        // The catalog changes only through the runtime
        expect(() => catalog.loadScript(script, dashql.buffers.catalog.CatalogLayer.CONNECTION)).toThrow(/only through the runtime/);
        expect(() => catalog.clear()).toThrow(/only through the runtime/);
        // A script of a workbook publishes into it
        runtime.dispatch('app', { kind: 'createWorkbook', value: { workbookId: 'w', connectionId: 'main' } });
        const version = catalog.version();
        runtime.dispatch({ workbook: 'w' }, { kind: 'createScript', value: { text: 'create table t (a int)', base: 'alpha' } });
        expect(catalog.version()).toBeGreaterThan(version);
        // The identity of the catalog is in the view of the connection
        const catalogId = viewOf(runtime, 'connection', 'main')!.catalogId;
        expect(catalogId).toBeGreaterThan(0);
        expect(viewOf(runtime, 'connection', 'main')!.catalogId).toBe(catalogId);
        const reset = catalog.version();
        runtime.dispatch({ connection: 'main' }, { kind: 'resetConnection' });
        expect(catalog.version()).toBeGreaterThan(reset);
        expect(runtime.functionScriptText('main')).toContain('DashQL Connection Functions');
        script.destroy();
        catalog.destroy();
        runtime.free();
    });

    it('gives a connection that is created again under its id a catalog of another identity', () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        const trino = { connectionId: 'other', connectorType: dashql.ConnectorType.TRINO, setupParams: { endpoint: TRINO, defaultCatalog: 'tpch', defaultSchema: 'tiny' } };
        runtime.dispatch('app', { kind: 'createConnection', value: trino });
        const before = viewOf(runtime, 'connection', 'other')!.catalogId;
        expect(runtime.dispatch({ connection: 'other' }, { kind: 'deleteConnection' })).toMatchObject({ ok: true });
        runtime.dispatch('app', { kind: 'createConnection', value: trino });
        expect(viewOf(runtime, 'connection', 'other')!.catalogId).not.toBe(before);
        runtime.free();
    });

    it('refuses actions of the wrong shape without throwing and stays usable', () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        expect(runtime.dispatch({ connection: 'main' }, { kind: 'setDraft', value: { params: 42 } } as unknown as dashql.RuntimeAction)).toMatchObject({ ok: false, error: expect.stringContaining('malformed') });
        expect(runtime.dispatch({ connection: 'main' }, { kind: 'nope' } as unknown as dashql.RuntimeAction)).toMatchObject({ ok: false });
        expect(runtime.dispatch({ nope: 1 } as unknown as dashql.Target, { kind: 'rename', value: { name: 'x' } })).toMatchObject({ ok: false });
        expect(runtime.dispatch({ connection: 'main' }, { kind: 'queryCacheDeleted', value: { queryId: -1 } })).toMatchObject({ ok: false });
        expect(() => runtime.views('query', ['x' as unknown as number])).toThrow();
        expect(() => runtime.cancelQuery(-1)).toThrow();
        expect(runtime.dispatch({ connection: 'main' }, { kind: 'rename', value: { name: 'Main' } })).toMatchObject({ ok: true, changed: true });
        expect(viewOf(runtime, 'connection', 'main')!.name).toBe('Main');
        runtime.free();
    });

    it('sets up the embedded Hyper of an opened workbook once', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        expect(runtime.dispatch('app', { kind: 'createWorkbook', value: { workbookId: 'memory', connectionId: 'main' } }).ok).toBe(true);
        expect(runtime.dispatch('app', { kind: 'createWorkbook', value: { workbookId: 'remote', connectionId: 'trino' } }).ok).toBe(true);
        // The Trino connection needs the user, an unknown workbook has nothing to set up
        runtime.setUpOpenedWorkbook('remote');
        runtime.setUpOpenedWorkbook('gone');
        runtime.setUpOpenedWorkbook('memory');
        await vi.waitFor(() => expect(platform.connected.map(request => request.type)).toEqual(['hyper']));
        // The health check of the channel fails here, the connection is not set up again
        await vi.waitFor(() => expect(viewOf(runtime, 'connection', 'main')!.connectionHealth).not.toBe(dashql.ConnectionHealth.CONNECTING));
        runtime.setUpOpenedWorkbook('memory');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(platform.connected).toHaveLength(1);
        runtime.free();
    });
});

describe('The queries of the runtime', () => {
    it('runs a Trino query into the history of its connection, the parts of the result stay with the host', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        await setupTrino(runtime, platform);
        const before = viewOf(runtime, 'connection', 'trino')!;
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
        expect(connection.queriesFinishedOrdered).toEqual([...before.queriesFinishedOrdered, ticket.queryId]);
        // The statement touched a relation that the catalog loader asks about
        expect(connection.catalogUpdates.touchedRelations).toMatchObject([{ databaseName: 'tpch', tableName: 't' }]);
        expect(viewOf(runtime, 'query', ticket.queryId)).toMatchObject({
            connectionId: 'trino',
            traceId: 7,
            status: dashql.QueryExecutionStatus.SUCCEEDED,
            resultTable: { rows: 2 },
            latestProgressUpdate: { phase: 'FINISHED' },
        });
        runtime.free();
    });

    it('cancels a query at the server and aborts its requests', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        await setupTrino(runtime, platform);
        platform.hold = true;
        const ticket = runtime.executeQuery('trino', { text: 'select 1', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true } }, undefined, null);
        await vi.waitFor(() => expect(platform.requests).toHaveLength(2));
        await runtime.cancelQuery(ticket.queryId);
        const outcome = await ticket.done;
        expect(outcome.status === 'rejected' && outcome.failure.kind).toBe('cancelled');
        expect(platform.requests.at(-1)?.method).toBe('DELETE');
        // The fetch of the page that the query waited for is aborted
        expect(platform.aborted).toHaveLength(1);
        expect(viewOf(runtime, 'query', ticket.queryId)!.status).toBe(dashql.QueryExecutionStatus.CANCELLED);
        runtime.free();
    });

    it('fails a query of an unknown connection, a query that the caller failed and one that is cancelled before it ran', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        const unknown = runtime.executeQuery('gone', { text: 'select 1', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true } }, undefined, null);
        expect(await unknown.done).toMatchObject({ status: 'rejected', failure: { message: "Couldn't find a connection with id gone" } });

        await setupTrino(runtime, platform);
        const failure = new Error('bar.sql: unknown script :missing');
        const failed = runtime.executeQuery('trino', { text: 'select 1', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true } }, failure, null);
        const outcome = await failed.done;
        expect(outcome.status === 'rejected' && outcome.value).toBe(failure);
        expect(viewOf(runtime, 'query', failed.queryId)).toMatchObject({ status: dashql.QueryExecutionStatus.FAILED, error: { message: failure.message } });

        // A query of a channel of the host that is cancelled while the platform describes it
        let describe: (target: dashql.RuntimeChannelTarget) => void = () => { };
        platform.describe = () => new Promise(resolve => { describe = resolve; });
        const pending = runtime.executeQuery('main', { text: 'select 1', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true } }, undefined, null);
        await vi.waitFor(() => expect(platform.described).toEqual(['select 1']));
        await runtime.cancelQuery(pending.queryId);
        describe({ type: 'host' });
        expect(await pending.done).toMatchObject({ status: 'rejected', failure: { kind: 'cancelled' } });
        expect(platform.requests).toHaveLength(0);
        runtime.free();
    });

    it('records a query that the caller failed without describing it', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        const failure = new Error('bar.sql: unknown script :missing');
        const failed = runtime.executeQuery('main', { text: 'select 1', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true, analyzeResults: true } }, failure, null);
        const outcome = await failed.done;
        expect(outcome.status === 'rejected' && outcome.value).toBe(failure);
        // Neither the channel nor the compute database is asked
        expect(platform.described).toEqual([]);
        expect(viewOf(runtime, 'query', failed.queryId)).toMatchObject({ status: dashql.QueryExecutionStatus.FAILED, error: { message: failure.message } });
        runtime.free();
    });

    it('cancels a query of a channel of the host while the channel still opens it', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        // The channel runs one query at a time, the query waits for its turn until it is cancelled
        const turns = new Map<number, (error: unknown) => void>();
        const cancelled: number[] = [];
        platform.platform.channels.open = queryId => new Promise<boolean>((_resolve, reject) => { turns.set(queryId, reject); });
        platform.platform.channels.cancel = async queryId => {
            cancelled.push(queryId);
            turns.get(queryId)?.(new DOMException('Query was cancelled', 'AbortError'));
        };
        const ticket = runtime.executeQuery('main', { text: 'insert into t values (1)', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true } }, undefined, null);
        await vi.waitFor(() => expect(turns.size).toBe(1));
        // The cancel reaches the channel and resolves once the query ended, it doesn't wait for the turn
        await runtime.cancelQuery(ticket.queryId);
        expect(cancelled).toEqual([ticket.queryId]);
        expect(await ticket.done).toMatchObject({ status: 'rejected', failure: { kind: 'cancelled' } });
        expect(viewOf(runtime, 'query', ticket.queryId)!.status).toBe(dashql.QueryExecutionStatus.CANCELLED);
        runtime.free();
    });

    it('releases the result of a query that the history no longer takes', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        await setupTrino(runtime, platform);
        // The connection goes while the history takes its handle of the result
        let copy: number | null = null;
        const duplicate = platform.platform.handles.duplicate;
        platform.platform.handles.duplicate = handle => {
            const duplicated = duplicate(handle);
            if (copy == null) {
                copy = duplicated;
                expect(runtime.dispatch({ connection: 'trino' }, { kind: 'deleteConnection' })).toMatchObject({ ok: true });
            }
            return duplicated;
        };
        runtime.takeChanges();
        const ticket = runtime.executeQuery('trino', { text: 'select 1', metadata: USER_QUERY, traceId: 1 }, undefined, null);
        await ticket.done;
        expect(copy).not.toBeNull();
        expect(runtime.takeChanges().effects).toContainEqual({ type: 'release', handle: copy });
        runtime.free();
    });

    it('stores the result of a query as the file of its script and removes the older files of the script', async () => {
        const platform = new TestPlatform();
        const key = 'a'.repeat(64);
        const files: { name: string; size: number; mtimeMs: number }[] = [{ name: `q.${'b'.repeat(64)}.00000001.parquet`, size: 1, mtimeMs: 1 }];
        const results = {
            mountPath: (workbookId: string) => `/mnt/external/results/${workbookId}`,
            files: async () => files,
            pin: async () => 1,
            release: async () => { },
            write: async (_workbookId: string, name: string) => {
                files.push({ name, size: 100, mtimeMs: 2 });
                return 1;
            },
            remove: async (_workbookId: string, name: string) => {
                files.splice(files.findIndex(file => file.name === name), 1);
                return true;
            },
        } as unknown as dashql.RuntimeResults;
        Object.assign(platform.platform, { results });
        const runtime = createRuntime(platform);
        await setupTrino(runtime, platform);
        const result = { workbookId: 'w', script: 'q.sql', key };
        const ticket = runtime.executeQuery('trino', { text: 'select 1', metadata: USER_QUERY, traceId: 1, options: { result } }, undefined, null);
        expect((await ticket.done).status).toBe('resolved');
        await runtime.flushResultWrites();
        expect(files.map(file => file.name)).toEqual([expect.stringMatching(new RegExp(`^q\\.${key}\\.[0-9a-f]{8}\\.parquet$`))]);
        expect(viewOf(runtime, 'query', ticket.queryId)!.cacheKey).toBe(key);
        runtime.free();
    });

    it('cancels a call of a client function while its spec loads, the call never starts', async () => {
        const platform = new TestPlatform();
        let loads = 0;
        let load: (spec: string) => void = () => { };
        platform.platform.extensions = { loadSpec: () => { ++loads; return new Promise(resolve => { load = resolve; }); } };
        platform.describe = async () => ({ type: 'host' });
        const runtime = createRuntime(platform);
        runtime.dispatch('app', { kind: 'createConnection', value: { connectionId: 'sf', connectorType: dashql.ConnectorType.SALESFORCE_DATA_CLOUD, setupParams: {} } });
        const call = { namespace: 'd360', function: 'query', effect: 'read' };
        const ticket = runtime.executeQuery('sf', { text: 'call d360.query()', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true, clientFunctionCall: call } }, undefined, null);
        // The call waits for the spec that the registration of the client functions of the connection loads, one load
        await vi.waitFor(() => expect(loads).toBe(1));
        // The cancel resolves once the query ended, it doesn't wait for the spec
        await runtime.cancelQuery(ticket.queryId);
        expect(viewOf(runtime, 'query', ticket.queryId)!.status).toBe(dashql.QueryExecutionStatus.CANCELLED);
        expect(await ticket.done).toMatchObject({ status: 'rejected', failure: { kind: 'cancelled' } });
        load('{"functions":[]}');
        await new Promise(resolve => setTimeout(resolve, 0));
        expect(platform.requests).toHaveLength(0);
        expect(viewOf(runtime, 'query', ticket.queryId)!.status).toBe(dashql.QueryExecutionStatus.CANCELLED);
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
        const runtime = createRuntime(platform);
        await setupTrino(runtime, platform);
        platform.fetch = async request => {
            const ok = (body: Uint8Array) => ({ status: 200, statusText: 'OK', headers: [] as [string, string][], body });
            if (request.url.endsWith('/v1/statement')) {
                return ok(encoder.encode(`{"id":"q1","nextUri":"${TRINO}/v1/statement/executing/q1/y/1","stats":{"state":"QUEUED","queued":true}}`));
            }
            return ok(page(Number(/\/y\/(\d+)/.exec(request.url)?.[1])));
        };
        // The parts are counted, not kept
        platform.platform.tables.push = (_table, part) => { platform.resultBytes += part.byteLength; };
        const before = dashql.DashQL.moduleMemoryBytes();
        const ticket = runtime.executeQuery('trino', { text: 'select 1', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true } }, undefined, null);
        expect((await ticket.done).status).toBe('resolved');
        const grown = dashql.DashQL.moduleMemoryBytes() - before;
        expect(platform.resultBytes).toBeGreaterThan(64 * 1024 * 1024);
        expect(grown).toBeLessThan(24 * 1024 * 1024);
        runtime.free();
    });

    it('keeps the structured progress of a query, its recording and its followers', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        await setupTrino(runtime, platform);
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
        runtime.free();
    });

    it('stops the queries of a connection that is reset', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        await setupTrino(runtime, platform);
        platform.hold = true;
        const ticket = runtime.executeQuery('trino', { text: 'select 1', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true } }, undefined, null);
        await vi.waitFor(() => expect(platform.requests).toHaveLength(2));
        runtime.dispatch({ connection: 'trino' }, { kind: 'resetConnection' });
        expect(viewOf(runtime, 'connection', 'trino')!.queriesActiveOrdered).toEqual([]);
        expect((await ticket.done).status).toBe('rejected');
        expect(viewOf(runtime, 'query', ticket.queryId)).toBeNull();
        runtime.free();
    });

    it('aborts the fetches of a query that fails and cancels it at the server', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        await setupTrino(runtime, platform);
        platform.fetch = async request => {
            const json = (body: object) => ({ status: 200, statusText: 'OK', headers: [] as [string, string][], body: new TextEncoder().encode(JSON.stringify(body)) });
            if (request.method === 'DELETE') return { status: 204, statusText: 'No Content', headers: [], body: new Uint8Array() };
            if (request.url.endsWith('/v1/statement')) {
                return json({ id: 'q1', nextUri: `${TRINO}/v1/statement/executing/q1/y/1`, stats: { state: 'QUEUED', queued: true } });
            }
            // The first page breaks the protocol while the next one downloads
            if (request.url.includes('/y/1')) {
                return json({ id: 'q1', nextUri: `${TRINO}/v1/statement/executing/q1/y/2`, data: [[1]], stats: { state: 'RUNNING' } });
            }
            return await new Promise(() => { });
        };
        const ticket = runtime.executeQuery('trino', { text: 'select 1', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true } }, undefined, null);
        expect(await ticket.done).toMatchObject({ status: 'rejected', failure: { message: 'Result schema is missing' } });
        // The download of the next page stops and Trino stops the query
        expect(platform.aborted).toHaveLength(1);
        expect(platform.requests.at(-1)).toMatchObject({ method: 'DELETE', url: `${TRINO}/v1/statement/executing/q1/y/2` });
        runtime.free();
    });

    it('reads the timestamps of Trino in named time zones with the zones of the host', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        await setupTrino(runtime, platform);
        platform.fetch = async request => {
            const json = (body: object) => ({ status: 200, statusText: 'OK', headers: [] as [string, string][], body: new TextEncoder().encode(JSON.stringify(body)) });
            if (request.url.endsWith('/v1/statement')) {
                return json({ id: 'q1', nextUri: `${TRINO}/v1/statement/executing/q1/y/1`, stats: { state: 'QUEUED', queued: true } });
            }
            return json({
                id: 'q1',
                columns: [{ name: 'ts', type: 'timestamp(3) with time zone' }],
                // Winter and summer time in Berlin, an offset, UTC and a zone that the host doesn't know
                data: [['2024-01-15 12:00:00.000 Europe/Berlin'], ['2024-07-15 12:00:00.000 Europe/Berlin'], ['2024-07-15 12:00:00.000 +02:00'], ['2024-07-15 12:00:00.000 UTC'], ['2024-07-15 12:00:00.000 Mars/Olympus']],
                stats: { state: 'FINISHED' },
            });
        };
        const ticket = runtime.executeQuery('trino', { text: 'select ts', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true } }, undefined, null);
        const outcome = await ticket.done;
        expect(outcome.status).toBe('resolved');
        const column = resultTable(outcome).getChild('ts')!;
        const ms = Array.from({ length: column.length }, (_, i) => column.get(i)).map(value => value == null ? null : Number(value));
        expect(ms).toEqual([Date.UTC(2024, 0, 15, 11), Date.UTC(2024, 6, 15, 10), Date.UTC(2024, 6, 15, 10), Date.UTC(2024, 6, 15, 12), null]);
        runtime.free();
    });

    it('refreshes the token of a Trino connection once for the queries of the connection and keeps it', async () => {
        const platform = new TestPlatform();
        const runtime = createRuntime(platform);
        const tokenUrl = 'https://idp.example.com/token';
        const params = { trino: { endpoint: TRINO, auth: { authType: 'AUTH_OAUTH', oauth: { authorizationUrl: 'https://idp.example.com/auth', tokenUrl, clientId: 'dashql' } } } };
        // The login answers at once, the first token expires right away
        let tokens = 0;
        platform.platform.oauth = {
            ...NO_OAUTH,
            pkce: async () => ({ value: 'challenge', verifier: 'verifier' }),
            authorizeWithLoopback: async (_setupId, _id, url) => ({ code: 'code', state: new URL(url).searchParams.get('state') ?? undefined }),
        };
        const defaultFetch = platform.fetch;
        let answerRefresh: () => void = () => { };
        platform.fetch = async request => {
            if (request.url === tokenUrl) {
                tokens += 1;
                const body = new TextEncoder().encode(JSON.stringify({ access_token: `token-${tokens}`, refresh_token: `refresh-${tokens}`, expires_in: tokens === 1 ? 1 : 3600 }));
                if (tokens > 1) await new Promise<void>(resolve => { answerRefresh = resolve; });
                return { status: 200, statusText: 'OK', headers: [], body };
            }
            return await defaultFetch(request);
        };
        // The probe of the setup refreshes the token that expires
        const setup = runtime.setupConnection('trino', { params });
        await vi.waitFor(() => expect(tokens).toBe(2));
        answerRefresh();
        expect(await setup).toMatchObject({ status: 'succeeded' });
        platform.requests.length = 0;
        // A query of the user and one of the catalog loader share the channel with its fresh token, no further refresh
        const ticket = runtime.executeQuery('trino', { text: 'select 1', metadata: USER_QUERY, traceId: 1, options: { throwOnError: true } }, undefined, null);
        runtime.runCatalogLoader(true);
        expect((await ticket.done).status).toBe('resolved');
        await vi.waitFor(() => expect(viewOf(runtime, 'connection', 'trino')!.catalogUpdates.tasksFinished).toHaveLength(1));
        expect(tokens).toBe(2);
        const statements = platform.requests.filter(r => r.url.endsWith('/v1/statement'));
        expect(statements.length).toBeGreaterThanOrEqual(2);
        for (const statement of statements) expect(statement.headers).toContainEqual(['Authorization', 'Bearer token-2']);
        runtime.free();
    });
});
