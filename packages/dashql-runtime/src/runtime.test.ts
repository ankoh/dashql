import * as dashql from '@ankoh/dashql-core';
import { beforeAll, describe, expect, it } from 'vitest';

import { createRuntime, type Runtime, type RuntimePlatform } from './runtime.js';
import { TASK_UPDATE_SCHEDULER } from './store/store.js';
import { TestLogger } from './testing/test_logger.js';
import { WorkbookTestBackend } from './testing/workbook_test_backend.js';
import { createDefaultHyperWasmConnectionState } from './connections/connection_params.js';
import type { OAuthFlow } from './oauth/oauth_flow.js';
import type { HttpClient } from './platform/http/http_client.js';

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

/// The next task, the registries apply their updates at the end of the current one
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('the runtime', () => {
    it('writes what the registries hold and a second runtime restores it', async () => {
        const storage = new WorkbookTestBackend();
        let first: Runtime | null = createRuntime(testPlatform(storage));
        let second: Runtime | null = null;
        try {
            expect((await first.restore()).workbookScripts.size).toBe(0);

            const connection = first.connections.allocate({ ...createDefaultHyperWasmConnectionState(core), active: true });
            const workbook = first.workbooks.create(connection, 'Sales', false);
            await settle();
            expect(first.workbooks.store.current.workbookScriptsMap.get(workbook.workbookId)?.name).toBe('Sales');
            expect(first.connections.store.current.connections.get(connection.connectionId)).toBe(connection);
            await first.destroy();
            first = null;

            second = createRuntime(testPlatform(storage));
            const restored = await second.restore();
            expect([...restored.workbookScripts.keys()]).toEqual([workbook.workbookId]);
            expect(second.workbooks.store.current.workbookScriptsMap.get(workbook.workbookId)?.name).toBe('Sales');
            expect(second.connections.store.current.connections.has(connection.connectionId)).toBe(true);
        } finally {
            await first?.destroy();
            await second?.destroy();
        }
    });
});
