// The embedded Hyper of Node: the build of hyperdb-wasm for Node over a folder of the host with the layout of the origin
// private file system (docs/design/storage_layout.md). The folder is the root of the files of the app and the storage of
// the engine, so the engine sees it at `/mnt/fs` like the browser build sees the origin private file system, and the
// query result cache, the instances and the attachments keep their paths.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { checkWasmFeatures } from '@ankoh/hyperdb-edge/node/runtime_check';

import { HyperDB, type HyperDBEngine, type MountFile } from '../platform/hyperdb/hyperdb_wasm.js';
import { HYPERDB_WASM_ENGINE_SETTINGS } from '../platform/hyperdb/hyperdb_settings.js';
import { setOPFSRootProvider } from '../platform/opfs_root.js';
import { cleanupStaleHyperDBOPFSInstances, createHyperDBOPFSInstance, HYPER_INSTANCES_DIRECTORY } from '../platform/hyperdb/hyperdb_opfs_instance.js';
import type { QueryResultCache } from '../query/query_result_cache.js';
import { createOPFSQueryResultCache } from '../storage/opfs_query_result_cache.js';
import { openNodeRoot } from './node_directory_handle.js';
import { nodeInstanceLocks } from './node_instance_locks.js';
import { PROCESS_LOCKS } from './node_locks.js';

/// The folder of the files that statements of an instance mount, e.g. the Arrow IPC of an insert
const INSTANCE_FILES_DIRECTORY = 'files';

/// The build of Node mounts only files of the host: the file is written into a folder first and removed with its mount
function mountHostFile(folder: string): MountFile {
    return async (engine, file, mountPath) => {
        await mkdir(folder, { recursive: true });
        const hostPath = path.join(folder, `${crypto.randomUUID()}-${file.name.replace(/[^A-Za-z0-9._-]/g, '_')}`);
        await writeFile(hostPath, new Uint8Array(await file.arrayBuffer()));
        try {
            const resource = await engine.mount(hostPath, { path: mountPath });
            return {
                path: resource.path,
                refresh: () => resource.refresh(),
                list: () => resource.list(),
                readFile: (file: string) => resource.readFile(file),
                close: async () => {
                    try {
                        await resource.close();
                    } finally {
                        await rm(hostPath, { force: true });
                    }
                },
            };
        } catch (error) {
            await rm(hostPath, { force: true });
            throw error;
        }
    };
}

/// Keep the files of the app in a folder of the host, for every module of this process that keeps files there
export async function useNodeRoot(folder: string): Promise<FileSystemDirectoryHandle> {
    const root = await openNodeRoot(folder);
    setOPFSRootProvider(async () => root);
    return root;
}

/// An engine of the embedded Hyper of Node with an instance folder, the HyperDBs on it get databases in that folder
export interface NodeHyperEngine {
    /// The folder of the host that is the root of the files of the app
    readonly root: string;
    /// The Hyper path of the folder of the instance
    readonly instancePath: string;
    /// Create a HyperDB on the engine. Its databases are dropped when it terminates, the engine stays.
    createDatabase(databases: { compute?: string; default?: string; snippets?: string }): Promise<HyperDB>;
    /// Stop the engine and remove the folder of the instance
    close(): Promise<void>;
}

/// Start the engine of the embedded Hyper in a folder of the host with an instance of its own, like a window of the app
export async function startNodeHyperEngine(folder: string): Promise<NodeHyperEngine> {
    // Node 24 before 24.15 has exnref behind a flag, the check sets it before the engine compiles
    checkWasmFeatures();
    const root = path.resolve(folder);
    const handle = await useNodeRoot(root);
    // An instance folder like a window of the app, the folders of processes that are gone are removed
    const locks = nodeInstanceLocks(path.join(root, HYPER_INSTANCES_DIRECTORY));
    await cleanupStaleHyperDBOPFSInstances(async () => handle, locks);
    const instance = await createHyperDBOPFSInstance(async () => handle, locks);
    const instancePath = instance.directoryPath;
    const mountFile = mountHostFile(path.join(root, HYPER_INSTANCES_DIRECTORY, instance.id, INSTANCE_FILES_DIRECTORY));

    let engine: HyperDBEngine;
    try {
        // Loaded only here, the commands that don't query the embedded Hyper run without it
        const { HyperDB: Engine } = await import('hyperdb-wasm');
        engine = await Engine.create({
            storagePath: root,
            settings: { ...HYPERDB_WASM_ENGINE_SETTINGS, log_file_path: instance.logDirectoryPath },
        }) as unknown as HyperDBEngine;
    } catch (error) {
        await instance.dispose();
        throw error;
    }
    const pathOf = (name: string | undefined) => name == null ? undefined : `${instancePath}/${name}`;
    return {
        root,
        instancePath,
        createDatabase: async databases => await HyperDB.create(engine, {
            computeDatabasePath: pathOf(databases.compute),
            defaultDatabasePath: pathOf(databases.default),
            snippetsDatabasePath: pathOf(databases.snippets),
            terminateEngine: false,
            mountFile,
        }),
        async close() {
            try {
                await engine.terminate();
            } finally {
                await instance.dispose();
            }
        },
    };
}

/// The embedded Hyper of Node with the query result cache of the root
export interface NodeComputeDatabase {
    /// The folder of the host that is the root of the files of the app
    readonly root: string;
    readonly database: HyperDB;
    readonly resultCache: QueryResultCache;
    /// Stop the engine and remove the folder of the instance
    close(): Promise<void>;
}

/// Start the embedded Hyper in a folder of the host with an instance of its own, like a window of the app
export async function openNodeComputeDatabase(folder: string): Promise<NodeComputeDatabase> {
    const engine = await startNodeHyperEngine(folder);
    let database: HyperDB;
    try {
        // The database of the embedded Hyper connector is scratch space of the instance like in a window of the app
        database = await engine.createDatabase({ compute: 'compute.hyper', default: 'user.hyper' });
    } catch (error) {
        await engine.close();
        throw error;
    }
    return {
        root: engine.root,
        database,
        resultCache: createOPFSQueryResultCache({ locks: PROCESS_LOCKS as unknown as LockManager }),
        async close() {
            try {
                await database.terminate();
            } finally {
                await engine.close();
            }
        },
    };
}
