import { createNodePlatform } from './node_platform.js';
import { createRuntime } from '../runtime.js';
import { TestLogger } from '../../platform/testing/test_logger.js';
import { WorkbookTestBackend } from '../../platform/testing/workbook_test_backend.js';
import { newDefaultHyperWasmConnection } from '../../platform/connections/connection_params.js';

describe('the platform of Node', () => {
    it('runs a runtime with the core from its file', async () => {
        const storage = new WorkbookTestBackend();
        const runtime = createRuntime(await createNodePlatform({ logger: new TestLogger(), storage }));
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
