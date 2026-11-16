import { ConnectionHealth, type ConnectionState } from '../../platform/connections/connection_state.js';
import { newConnectionFromParams, type ConnectionParams } from '../../platform/connections/connection_params.js';
import { connectorOfParams } from '../../platform/connections/connector_descriptor.js';
import { ConnectorType } from '../../platform/connections/connector_info.js';
import type { HttpClient, HttpFetchResult } from '../../platform/http_client.js';
import { createQueryResponseStreamMetrics, type QueryExecutionResponseStream } from '../../platform/query/query_execution_state.js';
import * as arrow from 'apache-arrow';

import { tableFromArrays } from '../../platform/testing/arrow_fixtures.js';
import type { ChannelConnector, Runtime } from '../runtime.js';

// The connections of tests are set up by the runtime (`setupConnection`) like the connections of the app, over a
// platform that answers like the backend: the channel connector hands back the channel of the test, the probe of the
// health check ends as the test asks, on the channel of a Hyper of the host and over HTTP for Trino and for a Hyper over
// HTTP, which the runtime speaks itself.

/// The options of a connection of a test
export interface TestConnectionOptions {
    /// The id, `test` by default
    connectionId?: string;
    /// The params
    params: ConnectionParams;
    /// Does the connection belong to a committed workbook or was it connected once?
    active?: boolean;
    /// The name
    name?: string;
    /// A channel of the connection, e.g. one with a fake `executeQuery`. The runtime sets the connection up with it.
    /// Without, the connection is not set up.
    channel?: object;
    /// How the setup with the channel ends: online by default, failed with `error` or connecting until the test ends
    health?: ConnectionHealth;
    /// The error of a failed setup
    error?: string;
}

/// How the setup of a connection of a test ends
interface TestSetup {
    channel: object;
    health: ConnectionHealth;
    error: string;
    /// Does the setup check the health of the channel now? The queries on the channel are the probe then.
    probing: boolean;
    /// End a probe that runs until the test ends it, see `finishTestSetup`
    finish: (() => void) | null;
}

/// The setups of the connections of tests on a runtime: the channel connector and the HTTP client of the platform with
/// the channels and the probes of the tests, everything else goes to the ones the runtime had
class TestSetups {
    readonly setups = new Map<string, TestSetup>();
    /// The Trino endpoints of the setups
    private readonly trino = new Map<string, TestSetup>();
    /// The endpoints of the setups of a Hyper over HTTP
    private readonly hyper = new Map<string, TestSetup>();

    constructor(runtime: Runtime) {
        const channels = runtime.options.channels ?? null;
        const http = runtime.options.http ?? null;
        const connector: ChannelConnector = {
            connect: async (connectionId, request) => {
                const setup = this.setups.get(connectionId);
                if (setup == null) {
                    if (channels == null) throw new Error(`The platform connects no ${request.type} channels`);
                    return await channels.connect(connectionId, request);
                }
                // The embedded Hyper runs no probe, a setup that is connecting or fails does so in the connect
                if (request.type === 'hyper' && request.kind === 'embedded' && setup.health !== ConnectionHealth.ONLINE) {
                    if (setup.health === ConnectionHealth.FAILED) throw new Error(setup.error);
                    return await new Promise(() => { });
                }
                return probedChannel(setup);
            },
            hyperLinkToken: connectionId => channels?.hyperLinkToken?.(connectionId) ?? null,
        };
        // The platform of a test is the test's, the runtime asks it for every channel and request
        runtime.options.channels = connector;
        const fetch: HttpClient['fetch'] = async (input, init) => {
            const url = input instanceof Request ? input.url : input.toString();
            for (const [endpoint, setup] of this.trino) {
                if (setup.probing && url.startsWith(`${endpoint}/v1/statement`)) return await trinoProbe(setup, init?.method);
            }
            for (const [endpoint, setup] of this.hyper) {
                if (setup.probing && url.startsWith(`${endpoint}/api/v3/query`)) return await hyperProbe(setup);
            }
            if (http == null) throw new Error('the test has no network');
            return await http.fetch(input, init);
        };
        runtime.options.http = { fetch };
    }

    /// Prepare the setup of a connection
    prepare(connectionId: string, params: ConnectionParams, setup: TestSetup): void {
        this.setups.set(connectionId, setup);
        if ('trino' in params) this.trino.set(params.trino.endpoint.replace(/\/+$/, ''), setup);
        const hyper = 'hyper' in params ? params.hyper : null;
        if (hyper != null && (hyper.protocol === 'V3_HTTP' || hyper.protocol === 'V3_HTTP_LINK')) {
            this.hyper.set((hyper.endpoint ?? '').replace(/\/+$/, ''), setup);
        }
    }
}

const SETUPS = new WeakMap<Runtime, TestSetups>();

/// The setups of the tests on a runtime
function testSetups(runtime: Runtime): TestSetups {
    let setups = SETUPS.get(runtime);
    if (setups == null) {
        setups = new TestSetups(runtime);
        SETUPS.set(runtime, setups);
    }
    return setups;
}

/// The result of a probe that succeeds, one row
function probeResult(): QueryExecutionResponseStream {
    const table = tableFromArrays({ health: Int32Array.from([1]) });
    const stream: QueryExecutionResponseStream = {
        getMetrics: createQueryResponseStreamMetrics,
        getSchema: async () => table.schema,
        produce: async batches => {
            for (const batch of table.batches) batches.resolve(stream, batch);
        },
    };
    return stream;
}

/// The probe of a setup on a channel: it succeeds, fails or runs until it is cancelled
async function probe(setup: TestSetup, abort?: AbortSignal): Promise<QueryExecutionResponseStream> {
    switch (setup.health) {
        case ConnectionHealth.FAILED:
            throw new Error(setup.error);
        case ConnectionHealth.CONNECTING:
            await new Promise<void>((resolve, reject) => {
                setup.finish = resolve;
                abort?.addEventListener('abort', () => reject(abort.reason), { once: true });
            });
            return await probe(setup, abort);
        default:
            return probeResult();
    }
}

/// The channel of a test whose queries are the probe while the setup checks its health
function probedChannel(setup: TestSetup): object {
    return new Proxy(setup.channel, {
        get(target, property, receiver) {
            if (property === 'executeQuery' && setup.probing) {
                return (_query: unknown, abort?: AbortSignal) => probe(setup, abort);
            }
            return Reflect.get(target, property, receiver);
        },
    });
}

/// The answer of a Trino to the probe of a setup
async function trinoProbe(setup: TestSetup, method?: string): Promise<HttpFetchResult> {
    const json = (body: object) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (method === 'DELETE') return new Response(null, { status: 204 });
    switch (setup.health) {
        case ConnectionHealth.FAILED:
            return json({ id: 'probe', error: { message: setup.error, errorName: 'GENERIC_INTERNAL_ERROR' }, stats: { state: 'FAILED' } });
        case ConnectionHealth.CONNECTING:
            return await new Promise(() => { });
        default:
            return json({ id: 'probe', columns: [{ name: 'health', type: 'integer' }], data: [[1]], stats: { state: 'FINISHED' } });
    }
}

/// The answer of the HTTP API of a Hyper to the probe of a setup: one row, an error, or none until the test ends
async function hyperProbe(setup: TestSetup): Promise<HttpFetchResult> {
    switch (setup.health) {
        case ConnectionHealth.FAILED:
            return new Response(JSON.stringify({ code: 2, message: setup.error }), { status: 500, headers: { 'content-type': 'application/json' } });
        case ConnectionHealth.CONNECTING:
            return await new Promise(() => { });
        default: {
            const table = tableFromArrays({ health: Int32Array.from([1]) });
            const status = { queryId: 'probe', completionStatus: 'FINISHED', chunkCount: 1, rowCount: 1 };
            return new Response(arrow.tableToIPC(table, 'stream') as Uint8Array<ArrayBuffer>, {
                status: 200,
                headers: { 'content-type': 'application/vnd.apache.arrow.stream', 'x-hyperdb-status': JSON.stringify(status) },
            });
        }
    }
}

/// Set a connection of a test up with a channel: the runtime connects the channel and checks its health, the setup
/// ends with the health. A connecting setup runs until the runtime cancels it. Returns the connection as the runtime
/// holds it after the setup, or once it is connecting.
export async function setupTestConnection(runtime: Runtime, connectionId: string, options: { channel?: object; health?: ConnectionHealth; error?: string } = {}): Promise<ConnectionState> {
    const current = runtime.connection(connectionId);
    if (current == null) throw new Error(`the runtime has no connection ${connectionId}`);
    const connector = connectorOfParams(current.params).info.connectorType;
    if (connector === ConnectorType.SALESFORCE_DATA_CLOUD || connector === ConnectorType.DBCOM) {
        throw new Error('the connections of tests set up no Salesforce');
    }
    const setup: TestSetup = {
        channel: options.channel ?? { close: () => { } },
        health: options.health ?? ConnectionHealth.ONLINE,
        error: options.error ?? 'failed',
        probing: true,
        finish: null,
    };
    testSetups(runtime).prepare(connectionId, current.params, setup);
    // The setup of the module, a test may replace the one of the runtime to see what the app asks for
    const done = runtime.module.setupConnection(connectionId, {}).finally(() => { setup.probing = false; });
    if (setup.health === ConnectionHealth.CONNECTING) {
        // The setup runs until the runtime cancels it
        void done.catch(() => { });
        for (let i = 0; i < 1000 && runtime.connection(connectionId)?.connectionHealth !== ConnectionHealth.CONNECTING; ++i) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    } else {
        await done;
    }
    runtime.flush();
    return runtime.connection(connectionId)!;
}

/// End the setup of a connection of a test that is connecting: its probe on the channel of a Hyper ends with the
/// health. Returns the connection as the runtime holds it after the setup.
export async function finishTestSetup(runtime: Runtime, connectionId: string, health: ConnectionHealth, error?: string): Promise<ConnectionState> {
    const setup = SETUPS.get(runtime)?.setups.get(connectionId);
    if (setup?.finish == null) throw new Error(`the connection ${connectionId} of the test has no probe that runs`);
    setup.health = health;
    setup.error = error ?? setup.error;
    const finish = setup.finish;
    setup.finish = null;
    finish();
    for (let i = 0; i < 1000 && runtime.connection(connectionId)?.connectionHealth === ConnectionHealth.CONNECTING; ++i) {
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    runtime.flush();
    return runtime.connection(connectionId)!;
}

/// A connection of a test in a runtime, set up with its channel if the options have one
export async function createTestConnection(runtime: Runtime, options: TestConnectionOptions): Promise<ConnectionState> {
    const state = runtime.createConnection(newConnectionFromParams(options.params, { active: options.active, name: options.name }), options.connectionId ?? 'test');
    if (options.channel == null) return state;
    return await setupTestConnection(runtime, state.connectionId, { channel: options.channel, health: options.health, error: options.error });
}
