import * as dashql from '../core/index.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createRuntime, type Runtime, type RuntimePlatform } from './runtime.js';
import { TASK_UPDATE_SCHEDULER } from './store/update_scheduler.js';
import { TestLogger } from '../platform/testing/test_logger.js';
import { WorkbookTestBackend } from '../platform/testing/workbook_test_backend.js';
import { newDefaultHyperWasmConnection } from '../platform/connections/connection_params.js';
import type { OAuthFlow } from '../platform/oauth/oauth_flow.js';
import type { HttpClient } from '../platform/platform/http/http_client.js';
import { ConnectorType } from '../platform/connections/connector_info.js';
import type { TrinoConnectionParams } from '@ankoh/dashql-jsonschema/connection.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let core: dashql.DashQL;

beforeAll(async () => {
    core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

/// A platform over a storage backend, without network and without a compute database
function testPlatform(storage: WorkbookTestBackend): RuntimePlatform {
    const offline = () => { throw new Error('the test has no network'); };
    return {
        logger: new TestLogger(),
        storage,
        http: { fetch: offline } as HttpClient,
        scheduler: TASK_UPDATE_SCHEDULER,
        oauthFlow: { authorizeWithRedirectPage: offline, authorizeWithLoopback: offline } as unknown as OAuthFlow,
        core,
    };
}

/// The next task, the store takes the changes of the runtime at the end of the current one
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('the runtime', () => {
    it('writes its workbooks and connections and a second runtime restores them', async () => {
        const storage = new WorkbookTestBackend();
        let first: Runtime | null = createRuntime(testPlatform(storage));
        let second: Runtime | null = null;
        try {
            expect((await first.restore()).workbookIds).toEqual([]);

            const connection = first.createConnection(newDefaultHyperWasmConnection({ active: true }));
            const workbook = first.createWorkbook(connection.connectionId, 'Sales', false);
            await settle();
            expect(first.store.get('workbook', workbook.workbookId)?.name).toBe('Sales');
            expect(first.store.all('connection').get(connection.connectionId)?.workbooks).toEqual([workbook.workbookId]);
            await first.destroy();
            first = null;

            second = createRuntime(testPlatform(storage));
            const restored = await second.restore();
            expect(restored.workbookIds).toEqual([workbook.workbookId]);
            expect(second.store.get('workbook', workbook.workbookId)?.name).toBe('Sales');
            // The runtime of the module took the stored connection, the store shows it
            expect(second.store.all('connection').has(connection.connectionId)).toBe(true);
            expect(second.catalog(connection.connectionId)).not.toBeNull();
        } finally {
            await first?.destroy();
            await second?.destroy();
        }
    });

    it('aborts the requests and the OAuth flows of the platform and refuses commands once destroyed', async () => {
        const requests: AbortSignal[] = [];
        const platform = testPlatform(new WorkbookTestBackend());
        platform.http = {
            fetch: (_input, init) => {
                requests.push(init!.signal!);
                return new Promise((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason)));
            },
        } as HttpClient;
        const runtime = createRuntime(platform);
        // The runtime has its module from the start, a dispatch applies at once
        const connection = runtime.createConnection(newDefaultHyperWasmConnection({ active: false }));
        expect(runtime.connection(connection.connectionId)?.connectionId).toBe(connection.connectionId);
        // A request of the runtime that hangs, e.g. the health check of a Trino setup
        const trino = { endpoint: 'http://127.0.0.1:1', catalogName: 'hive' } as TrinoConnectionParams;
        const setup = runtime.createConnection({ connectorType: ConnectorType.TRINO, setupParams: trino, params: { trino } });
        const outcome = runtime.setupConnection(setup.connectionId).catch(e => e);
        await vi.waitFor(() => expect(requests.length).toBeGreaterThan(0));
        await runtime.destroy();
        expect(requests.every(signal => signal.aborted)).toBe(true);
        await outcome;
        expect(runtime.destroyed).toBe(true);
        expect(runtime.dispatch('app', { kind: 'deleteWorkbook', value: { workbookId: 'x' } })).toMatchObject({ ok: false });
        expect(runtime.connection(connection.connectionId)).toBeNull();
        // A second destroy waits for the first
        await runtime.destroy();
    });
});
