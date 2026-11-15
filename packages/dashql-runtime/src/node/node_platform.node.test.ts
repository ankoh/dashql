import { createNodePlatform } from './node_platform.js';
import { createRuntime } from '../runtime.js';
import { TestLogger } from '../testing/test_logger.js';
import { WorkbookTestBackend } from '../testing/workbook_test_backend.js';
import { newDefaultHyperWasmConnection } from '../connections/connection_params.js';

describe('the platform of Node', () => {
    it('runs a runtime with the core from its file', async () => {
        const storage = new WorkbookTestBackend();
        const runtime = createRuntime(createNodePlatform({ logger: new TestLogger(), storage }));
        try {
            await runtime.restore();
            const connection = runtime.coreRuntime.createConnection(newDefaultHyperWasmConnection({ active: true }));
            const workbook = runtime.coreRuntime.createWorkbook(connection.connectionId, 'Node', false);
            expect(runtime.coreRuntime.workbook(workbook.workbookId)?.name).toBe('Node');
            await expect(runtime.platform.oauthFlow.authorizeWithLoopback(new URL('http://127.0.0.1'), '', new AbortController().signal, () => { }))
                .rejects.toThrow('dashql auth');
        } finally {
            await runtime.destroy();
        }
        expect(storage.workbooks.size).toBe(1);
    });
});
