import { createNodePlatform } from './node_platform.js';
import { createRuntime } from '../runtime.js';
import { TestLogger } from '../testing/test_logger.js';
import { WorkbookTestBackend } from '../testing/workbook_test_backend.js';
import { createDefaultHyperWasmConnectionState } from '../connections/connection_params.js';

describe('the platform of Node', () => {
    it('runs a runtime with the core from its file', async () => {
        const storage = new WorkbookTestBackend();
        const runtime = await createRuntime(createNodePlatform({ logger: new TestLogger(), storage }));
        try {
            const connection = runtime.connections.allocate({ ...createDefaultHyperWasmConnectionState(runtime.core), active: true });
            const workbook = runtime.workbooks.create(connection, 'Node', false);
            expect(runtime.workbooks.store.current.workbookScriptsMap.get(workbook.workbookId)?.name).toBe('Node');
            await expect(runtime.platform.oauthFlow.authorizeWithLoopback(new URL('http://127.0.0.1'), '', new AbortController().signal, () => { }))
                .rejects.toThrow('dashql auth');
        } finally {
            await runtime.destroy();
        }
        expect(storage.workbooks.size).toBe(1);
    });
});
