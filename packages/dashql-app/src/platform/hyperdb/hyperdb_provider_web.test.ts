import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockState = vi.hoisted(() => ({
    client: { ready: vi.fn() },
    database: { terminate: vi.fn() },
    terminateDatabase: vi.fn(),
    blobParts: [] as unknown[],
    createBrowserClient: vi.fn(),
    createHyperDB: vi.fn(),
}));

vi.mock('hyperdb-wasm/raw', () => ({
    createBrowserClient: (options: unknown) => mockState.createBrowserClient(options),
}));
vi.mock('./hyperdb_wasm.js', () => ({
    HyperDB: {
        create: (...args: any[]) => mockState.createHyperDB(...args),
    },
}));

import { setupWebHyperDB } from './hyperdb_provider_web.js';

describe('setupWebHyperDB', () => {
    const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    } as any;

    beforeEach(() => {
        vi.stubGlobal('SharedArrayBuffer', class SharedArrayBuffer {});
        vi.stubGlobal('crossOriginIsolated', true);
        vi.stubGlobal('Blob', class Blob {
            constructor(parts: unknown[]) {
                mockState.blobParts = parts;
            }
        });
        vi.stubGlobal('URL', Object.assign(URL, {
            createObjectURL: vi.fn().mockReturnValue('blob:https://example.test/hyperdb-engine'),
            revokeObjectURL: vi.fn(),
        }));
        mockState.createBrowserClient.mockReset().mockReturnValue(mockState.client);
        mockState.createHyperDB.mockReset().mockResolvedValue(mockState.database);
        mockState.terminateDatabase.mockReset().mockResolvedValue(undefined);
        mockState.database.terminate = mockState.terminateDatabase;
        mockState.blobParts = [];
        logger.info.mockReset();
        logger.warn.mockReset();
        logger.error.mockReset();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('creates an isolated browser client and initializes the adapter', async () => {
        const database = await setupWebHyperDB('provider-test', logger);

        expect(database).toBe(mockState.database);
        expect(mockState.createBrowserClient).toHaveBeenCalledWith({
            engineUrl: 'blob:https://example.test/hyperdb-engine',
            workerUrl: expect.any(URL),
        });
        expect(mockState.createHyperDB).toHaveBeenCalledWith(
            mockState.client,
            {
                'global.experimental_view_creation': true,
                'global.experimental_persisted_view_creation': true,
            },
        );
        expect(mockState.blobParts.join('')).toContain(
            'self.HYPERDB_WASM_MODULE=self.Module??{};',
        );
        expect(mockState.blobParts.join('')).toContain('self.HYPERDB_WASM_MODULE.locateFile=');
        expect(mockState.blobParts.join('')).toContain('test-file-stub');
        expect(logger.info).toHaveBeenCalledWith(
            'Creating HyperDB WASM client',
            { context: 'provider-test' },
            'hyperdb',
        );

        await database.terminate();
        expect(mockState.terminateDatabase).toHaveBeenCalledTimes(1);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:https://example.test/hyperdb-engine');
    });

    it('fails before loading the engine when cross-origin isolation is unavailable', async () => {
        vi.stubGlobal('crossOriginIsolated', false);

        await expect(setupWebHyperDB('unsupported', logger)).rejects.toThrow(
            'HyperDB requires SharedArrayBuffer and a cross-origin-isolated page',
        );

        expect(mockState.createBrowserClient).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledWith(
            'Instantiating HyperDB WASM failed',
            expect.objectContaining({
                context: 'unsupported',
                error: 'HyperDB requires SharedArrayBuffer and a cross-origin-isolated page',
            }),
            'hyperdb',
        );
    });
});
