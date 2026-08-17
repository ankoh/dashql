import type { HyperDBEngineClient } from './hyperdb_wasm.js';

export async function createNodeTestClient(hostPath?: string): Promise<HyperDBEngineClient> {
    const raw = await import('hyperdb-wasm/raw') as unknown as {
        createNodeClient(options?: { hostPath?: string }): HyperDBEngineClient;
    };
    return raw.createNodeClient({ hostPath: hostPath ?? process.env.TEST_TMPDIR ?? process.cwd() });
}

export async function createIsolatedNodeTestClient(): Promise<{
    client: HyperDBEngineClient;
    release: () => Promise<void>;
}> {
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const directory = await mkdtemp(join(process.env.TEST_TMPDIR ?? process.cwd(), 'hyperdb-wasm-test-'));
    try {
        return {
            client: await createNodeTestClient(directory),
            release: async () => { await rm(directory, { recursive: true, force: true }); },
        };
    } catch (error) {
        await rm(directory, { recursive: true, force: true });
        throw error;
    }
}
