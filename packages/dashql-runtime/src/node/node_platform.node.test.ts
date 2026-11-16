import { createNodePlatform } from './node_platform.js';
import { createRuntime } from '../runtime.js';
import { TestLogger } from '@ankoh/dashql-platform/testing/test_logger';
import { WorkbookTestBackend } from '@ankoh/dashql-platform/testing/workbook_test_backend';
import { newDefaultHyperWasmConnection } from '@ankoh/dashql-platform/connections/connection_params';

describe('the platform of Node', () => {
    it('runs a runtime with the core from its file', async () => {
        const storage = new WorkbookTestBackend();
        const runtime = createRuntime(createNodePlatform({ logger: new TestLogger(), storage }));
        try {
            await runtime.restore();
            const connection = runtime.createConnection(newDefaultHyperWasmConnection({ active: true }));
            const workbook = runtime.createWorkbook(connection.connectionId, 'Node', false);
            expect(runtime.store.get('workbook', workbook.workbookId)?.name).toBe('Node');
            await expect(runtime.platform.oauthFlow!.authorizeWithLoopback(new URL('http://127.0.0.1'), '', new AbortController().signal, () => { }))
                .rejects.toThrow('dashql auth');
        } finally {
            await runtime.destroy();
        }
        expect(storage.workbooks.size).toBe(1);
    });
});
