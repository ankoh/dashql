import * as dashql from '../core/index.js';
import { beforeAll, describe, expect, it } from 'vitest';

import { createRuntime, type Runtime, type RuntimePlatform } from './runtime.js';
import { TASK_UPDATE_SCHEDULER } from './store/store.js';
import { TestLogger } from '../platform/testing/test_logger.js';
import { WorkbookTestBackend } from '../platform/testing/workbook_test_backend.js';
import { newDefaultHyperWasmConnection } from '../platform/connections/connection_params.js';
import type { OAuthFlow } from '../platform/oauth/oauth_flow.js';
import type { HttpClient } from '../platform/platform/http/http_client.js';

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
        setupCore: async () => core,
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
});
