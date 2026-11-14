import type { HyperDB } from '../platform/hyperdb/hyperdb_wasm.js';

declare global {
    /// Creates a HyperDB with compute, default and snippets databases of its own on the engine that the tests of a
    /// platform share. The browser tests of the app install it over their engine worker (tests/hyperdb_pool.ts), the
    /// tests in Node over the embedded Hyper of Node (test/setup_node.mjs).
    var __DASHQL_TEST_HYPERDB__: ((context: string) => Promise<HyperDB>) | undefined;
}

/// A HyperDB for a test on the shared engine of its platform, terminating it drops its databases
export async function openTestHyperDB(context: string): Promise<HyperDB> {
    const factory = globalThis.__DASHQL_TEST_HYPERDB__;
    if (factory == null) throw new Error('The platform of the tests installs no HyperDB');
    return await factory(context);
}
