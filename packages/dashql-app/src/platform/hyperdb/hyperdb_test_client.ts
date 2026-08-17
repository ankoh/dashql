import type { HyperDBEngineClient } from './hyperdb_wasm.js';

const lockPath = `${process.env.TEST_TMPDIR ?? process.cwd()}/hyperdb-wasm-test.lock`;

export async function createNodeTestClient(): Promise<HyperDBEngineClient> {
    const raw = await import('hyperdb-wasm/raw') as unknown as {
        createNodeClient(options?: { hostPath?: string }): HyperDBEngineClient;
    };
    return raw.createNodeClient({ hostPath: process.env.TEST_TMPDIR ?? process.cwd() });
}

export async function createSerializedNodeTestClient(): Promise<{
    client: HyperDBEngineClient;
    release: () => Promise<void>;
}> {
    const { open, rm } = await import('node:fs/promises');
    for (;;) {
        try {
            const lock = await open(lockPath, 'wx');
            await lock.close();
            try {
                return {
                    client: await createNodeTestClient(),
                    release: async () => { await rm(lockPath, { force: true }); },
                };
            } catch (error) {
                await rm(lockPath, { force: true });
                throw error;
            }
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }
}
