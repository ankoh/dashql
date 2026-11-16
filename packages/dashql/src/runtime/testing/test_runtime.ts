import * as dashql from '../../core/index.js';

import type { ConnectionState } from '../../platform/connections/connection_state.js';
import { createTestConnection, type TestConnectionOptions } from './connection_fixtures.js';
import type { OAuthFlow } from '../../platform/oauth/oauth_flow.js';
import type { EmbeddedComputeDatabase } from '../../platform/platform/database/embedded_database.js';
import type { HttpClient } from '../../platform/platform/http/http_client.js';
import type { QueryResultCache } from '../../platform/query/query_result_cache.js';
import { createRuntime, type Runtime, type RuntimePlatform } from '../runtime.js';
import { TASK_UPDATE_SCHEDULER } from '../store/store.js';
import type { StorageBackend, WorkbookData } from '../../platform/storage/storage_backend.js';
import { storageVersions } from '../../platform/storage/storage_versions.js';
import type { ScriptDataMap, WorkbookScripts } from '../../platform/workbook/scripts/workbook_scripts.js';
import { TestLogger } from '../../platform/testing/test_logger.js';
import { WorkbookTestBackend } from '../../platform/testing/workbook_test_backend.js';
import { createRuntimeArchives, type ParquetReadDatabase } from '../storage/workbook_archives.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

/// The core of the tests of a file, instantiated once
let core: Promise<dashql.DashQL> | null = null;
export function testCore(): Promise<dashql.DashQL> {
    core ??= DASHQL_PRECOMPILED.then(wasmBinary => dashql.DashQL.create({ wasmBinary }));
    return core;
}

export interface TestRuntimeOptions {
    /// Where the workbooks and connections are kept, in memory by default
    storage?: StorageBackend;
    /// The network, none by default
    http?: HttpClient;
    /// The database of the computations, none by default
    computeDatabase?: EmbeddedComputeDatabase | null;
    /// The cache of query results, none by default
    resultCache?: QueryResultCache | null;
    /// The database that writes and scans the Parquet files of `.dashql` archives, none by default
    archiveDatabase?: (context: string) => Promise<ParquetReadDatabase>;
    /// Keep the catalog loader running. It asks connections that come online about their catalogs, the tests of other
    /// services stop it.
    catalogLoader?: boolean;
}

/// A runtime of the platform of the tests: the services of the app without a user interface, in Node and in the
/// browsers alike
export interface TestRuntime extends Runtime {
    logger: TestLogger;
    /// Create a connection in the runtime, with a channel ready and online if the options have one
    addConnection(options: TestConnectionOptions): ConnectionState;
    /// The connection as the runtime holds it now
    connection(connectionId: string): ConnectionState;
    /// Create a workbook on a connection with scripts of names and texts in feed order, every script analyzed with the
    /// declarations of the others, and return it once its view is in the store
    addWorkbook(connectionId: string, scripts?: Array<[string, string]>, options?: { name?: string; ephemeral?: boolean }): WorkbookScripts;
    /// The scripts of a workbook of the last flush by key
    scripts(workbookId: string): ScriptDataMap;
}

/// Analyze the outdated scripts of a workbook until none is outdated: a script that publishes its declarations
/// outdates the scripts that read them
export function analyzeWorkbook(runtime: Runtime, workbookId: string): void {
    for (let round = 0; round < 4; ++round) {
        runtime.flush();
        const outdated = (runtime.store.get('workbook', workbookId)?.scriptKeys ?? []).filter(key => runtime.module?.isAnalysisOutdated(key));
        if (outdated.length === 0) break;
        for (const scriptKey of outdated) runtime.dispatch({ workbook: workbookId }, { kind: 'analyzeOutdatedScript', value: { scriptKey } });
    }
    runtime.flush();
}

/// The scripts of a workbook of the last flush by key
export function workbookScripts(runtime: Runtime, workbookId: string): ScriptDataMap {
    const scripts: ScriptDataMap = {};
    for (const key of runtime.store.get('workbook', workbookId)?.scriptKeys ?? []) {
        const script = runtime.store.get('script', key);
        if (script != null) scripts[key] = script;
    }
    return scripts;
}

/// A runtime of the module of a test with the core of the tests and a storage in memory, its catalog loader stopped
export function testStorageRuntime(dql: dashql.DashQL, storage: StorageBackend = new WorkbookTestBackend(), logger = new TestLogger()): Runtime {
    const runtime = createRuntime({ logger, scheduler: TASK_UPDATE_SCHEDULER, setupCore: dql, storage });
    runtime.runCatalogLoader(false);
    return runtime;
}

/// A script of a stored workbook: its file name, its text and the id of its connection
export type StoredTestScript = [fileName: string, text: string, connectionId: string];

/// Write a workbook into a storage with scripts on connections of a runtime, the workbook file holds copies of their
/// params. Returns the id of the workbook.
export async function storeTestWorkbook(
    runtime: Runtime,
    storage: StorageBackend,
    scripts: readonly StoredTestScript[],
    options: { workbookId?: string; name?: string; pendingConnectionId?: string } = {},
): Promise<string> {
    const workbookId = options.workbookId ?? crypto.randomUUID();
    const connectionIds = [...new Set(scripts.map(([, , connectionId]) => connectionId))];
    if (connectionIds.length === 0 && options.pendingConnectionId != null) connectionIds.push(options.pendingConnectionId);
    const connections = connectionIds.map(connectionId => {
        const connection = runtime.connection(connectionId);
        if (connection == null) throw new Error(`the runtime has no connection ${connectionId}`);
        return { connectionId, params: connection.params as WorkbookData['connections'][number]['params'] };
    });
    const workbook: WorkbookData = {
        formatVersion: storageVersions().formatVersion,
        workbookId,
        name: options.name ?? 'Test',
        connections,
        scripts: scripts.map(([name, , connectionId]) => ({ name, connectionId })),
        attachments: [],
        metadata: {},
    } as WorkbookData;
    await storage.saveWorkbookManifest(workbookId, workbook);
    for (const [name, text] of scripts) await storage.saveScript(workbookId, name, text);
    return workbookId;
}

/// Write a workbook into the storage of a runtime and restore it into the runtime against its connections. The scripts
/// are not analyzed, like the scripts of a workbook that the app restores. Returns the workbook once its view is in the
/// store.
export async function restoreTestWorkbook(
    runtime: Runtime,
    storage: StorageBackend,
    scripts: readonly StoredTestScript[],
    options: { workbookId?: string; name?: string; pendingConnectionId?: string } = {},
): Promise<WorkbookScripts> {
    const workbookId = await storeTestWorkbook(runtime, storage, scripts, options);
    await runtime.restoreWorkbook(workbookId);
    const workbook = runtime.store.get('workbook', workbookId);
    if (workbook == null) throw new Error(`the workbook ${workbookId} was not restored`);
    return workbook;
}

/// Create a workbook on a connection of a runtime with scripts of names and texts, see `TestRuntime.addWorkbook`
export function addTestWorkbook(runtime: Runtime, connectionId: string, scripts: Array<[string, string]> = [], options: { name?: string; ephemeral?: boolean } = {}): WorkbookScripts {
    const workbook = runtime.createWorkbook(connectionId, options.name ?? 'Test', options.ephemeral ?? false);
    for (const [fileName, text] of scripts) {
        const outcome = runtime.dispatch({ workbook: workbook.workbookId }, { kind: 'createScript', value: { text, base: fileName.replace(/\.sql$/i, '') } });
        if (!outcome.ok) throw new Error(outcome.error ?? `the script ${fileName} was not created`);
    }
    analyzeWorkbook(runtime, workbook.workbookId);
    const created = runtime.store.get('workbook', workbook.workbookId);
    if (created == null) throw new Error('the workbook was not created');
    return created;
}

export async function createTestRuntime(options: TestRuntimeOptions = {}): Promise<TestRuntime> {
    const offline = () => { throw new Error('the test has no network'); };
    const logger = new TestLogger();
    const instance = await testCore();
    const platform: RuntimePlatform = {
        logger,
        storage: options.storage ?? new WorkbookTestBackend(),
        http: options.http ?? ({ fetch: offline } as HttpClient),
        scheduler: TASK_UPDATE_SCHEDULER,
        oauthFlow: { authorizeWithRedirectPage: offline, authorizeWithLoopback: offline } as unknown as OAuthFlow,
        setupCore: async () => instance,
        computeDatabase: options.computeDatabase ?? null,
        resultCache: options.resultCache ?? null,
        archives: options.archiveDatabase == null ? undefined : handles => createRuntimeArchives(handles, options.archiveDatabase!),
    };
    const runtime = createRuntime(platform);
    if (!options.catalogLoader) runtime.runCatalogLoader(false);
    // The runtime of the module has the core of the tests from the start
    runtime.setCore(instance);
    const read = runtime.connection.bind(runtime);
    return Object.assign(runtime, {
        logger,
        addConnection(connection: TestConnectionOptions) {
            return createTestConnection(runtime, connection);
        },
        connection(connectionId: string) {
            const connection = read(connectionId);
            if (connection == null) throw new Error(`the runtime has no connection ${connectionId}`);
            return connection;
        },
        addWorkbook(connectionId: string, scripts?: Array<[string, string]>, options?: { name?: string; ephemeral?: boolean }) {
            return addTestWorkbook(runtime, connectionId, scripts, options);
        },
        scripts(workbookId: string) {
            return workbookScripts(runtime, workbookId);
        },
    });
}
