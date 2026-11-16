import { createBrowserClient } from 'hyperdb-wasm/raw';

import { cleanupStaleHyperDBOPFSInstances, createHyperDBOPFSInstance } from '@ankoh/dashql/platform/hyperdb/hyperdb_opfs_instance';
import { OPFS_TESTS_FOLDER } from '@ankoh/dashql/platform/opfs_root';
import { createWebHyperDBClientOptions } from '../platform/hyperdb/hyperdb_provider_web.js';
import { HYPERDB_WASM_ENGINE_SETTINGS } from '@ankoh/dashql/platform/hyperdb/hyperdb_settings';
import { HyperDB, HyperDBEngine, type HyperDBClient, type HyperDBConnection, type HyperDBSettings } from '../platform/hyperdb/hyperdb_wasm.js';
import type { SetupProgress } from '../platform/database/embedded_database_provider.js';
import { openTestHyperDB } from '@ankoh/dashql/platform/testing/test_hyperdb';

/// Start an engine worker with the settings of the app, overridden by the given startup settings.
/// Tests share the client between the frames of the test files, every frame wraps it in its own HyperDBEngine.
/// A HyperDBEngine would hand out Arrow objects of the frame that created it.
/// The engine keeps its default log folder in the OPFS folder of the tests, not in the one of the app.
export async function createTestHyperDBClient(
    onSetupProgress?: (progress: SetupProgress) => void,
    settings: HyperDBSettings = {},
): Promise<HyperDBClient> {
    const { revoke, ...options } = createWebHyperDBClientOptions();
    let client: ReturnType<typeof createBrowserClient>;
    try {
        client = createBrowserClient({ ...options, storagePath: OPFS_TESTS_FOLDER, onSetupProgress });
    } catch (error) {
        revoke();
        throw error;
    }
    const terminate = client.terminate.bind(client);
    client.terminate = async () => {
        try {
            await terminate();
        } finally {
            revoke();
        }
    };
    try {
        await client.ready();
        const result = await client.initialize({ ...HYPERDB_WASM_ENGINE_SETTINGS, ...settings });
        if (result.state !== 'ok') {
            const detail = result.state === 'error' || result.state === 'busy' ? `: ${JSON.stringify(result.error)}` : '';
            throw new Error(`initialize HyperDB returned ${result.state}${detail}`);
        }
    } catch (error) {
        await client.terminate();
        throw error;
    }
    return client;
}

/// The engine client shared by the test dashboard, or a new one when the test file runs on its own.
export async function getTestHyperDBClient(): Promise<{ client: HyperDBClient; shared: boolean }> {
    const shared = globalThis.__DASHQL_TEST_HYPERDB_CLIENT__;
    return shared
        ? { client: await shared(), shared: true }
        : { client: await createTestHyperDBClient(), shared: false };
}

/// The folder of the database files of the tests of this frame, see testDatabasePath()
let testDatabaseFolder: Promise<string> | null = null;

/// The Hyper path of a database file of a test.
/// The engines mount /mnt/fs on OPFS, which keeps the files of interrupted runs across reloads, fixed paths would
/// collide with them. Every test frame puts its files into an instance folder in the OPFS folder of the tests, its Web
/// Lock lives as long as the frame and the next run removes the folders of earlier runs.
export async function testDatabasePath(name: string): Promise<string> {
    testDatabaseFolder ??= (async () => {
        await cleanupStaleHyperDBOPFSInstances();
        return (await createHyperDBOPFSInstance()).directoryPath;
    })();
    return `${await testDatabaseFolder}/${name}`;
}

/// A HyperDB with databases of its own on the engine of the tests, the one of the tests of the runtime
/// (openTestHyperDB). `dispose` terminates it, which drops its databases.
export async function createTestHyperDB(name: string): Promise<{ database: HyperDB; dispose(): Promise<void> }> {
    const database = await openTestHyperDB(name);
    return { database, dispose: () => database.terminate() };
}

/// A view of a database that ignores `terminate`, for providers that terminate their database when they unmount while
/// the database of a test file serves several renders
export function withoutTermination<T extends { terminate(): unknown }>(database: T): T {
    return new Proxy(database, {
        get(target, property) {
            if (property === 'terminate') return async () => {};
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

/// A window of the app on an engine worker of its own, whose session attaches databases like a local cloud
export interface TestHyperDBWindow {
    database: HyperDB;
    session: HyperDBConnection;
    /// End the worker without closing the session, like a reload of the app
    reload(): Promise<void>;
    /// Close the session, which detaches the databases, and end the worker
    close(): Promise<void>;
}

/// Open a window of the app: a worker of its own, the shared engine of the tests would outlive a reload
export async function openTestHyperDBWindow(attachedDatabases: { path: string; alias: string }[], settings: HyperDBSettings = {}): Promise<TestHyperDBWindow> {
    const client = await createTestHyperDBClient(undefined, settings);
    try {
        const database = await HyperDB.create(new HyperDBEngine(client), {
            defaultDatabasePath: await testDatabasePath(`window-${crypto.randomUUID()}.hyper`),
            terminateEngine: false,
        });
        const session = await database.connect({ defaultDatabase: null, attachedDatabases });
        return {
            database,
            session,
            reload: () => client.terminate(),
            close: async () => {
                await session.close();
                await client.terminate();
            },
        };
    } catch (error) {
        await client.terminate();
        throw error;
    }
}
