import type * as core from '@ankoh/dashql-core';

import type { Logger } from './platform/logger/logger.js';
import type { HttpClient } from './platform/http/http_client.js';
import type { EmbeddedComputeDatabase } from './platform/database/embedded_database.js';
import type { OAuthFlow } from './oauth/oauth_flow.js';
import type { UpdateScheduler } from './store/store.js';
import type { StorageBackend } from './storage/storage_backend.js';
import { StorageWriter } from './storage/storage_writer.js';
import type { QueryResultCache } from './query/query_result_cache.js';
import { CoreRuntime } from './core_runtime.js';
import { CatalogLoaderService } from './connections/catalog/catalog_loader_service.js';
import { SalesforceApiClient, type SalesforceApiClientInterface } from './connections/salesforce/salesforce_api_client.js';
import { CATALOG_DID_UPDATE } from './workbook/scripts/workbook_scripts.js';
import { WorkbookScriptsRegistryService } from './workbook/scripts/workbook_scripts_registry_service.js';
import { WorkbookExecutionService } from './workbook/scripts/workbook_execution_service.js';
import { registerScriptRunServices } from './workbook/scripts/script_run.js';
import { restoreAppState, type AppStateRestorationProgress, type RestoredAppState } from './workbook/persistence/app_state_loader.js';

/// What a platform passes to the runtime: the browser, the desktop app or Node
export interface RuntimePlatform {
    logger: Logger;
    /// Where the workbooks and connections are kept
    storage: StorageBackend;
    /// The writer of the storage, by default one of the runtime. The app passes the one that it flushes when the page
    /// hides and stops when another tab takes over.
    storageWriter?: StorageWriter;
    http: HttpClient;
    /// When the registries apply their updates
    scheduler: UpdateScheduler;
    /// How connectors authorize
    oauthFlow: OAuthFlow;
    /// Instantiate the core
    setupCore: (context: string) => Promise<core.DashQL>;
    /// The database of the computations, null without one
    computeDatabase?: EmbeddedComputeDatabase | null;
    /// The cache of query results, null without one
    resultCache?: QueryResultCache | null;
    /// The API of Salesforce, by default over `http`. The catalog loader fetches the metadata of Salesforce over `http`
    /// itself, another API, e.g. the mock of the app, answers it instead.
    salesforce?: SalesforceApiClientInterface;
}

/// The logic of DashQL without a user interface: the runtime of the module with the connections, their queries and the
/// computations, the registry of the workbooks and the services on them. The app binds it to React, the command line
/// tool uses it as it is.
export interface Runtime {
    platform: RuntimePlatform;
    logger: Logger;
    storageWriter: StorageWriter;
    workbooks: WorkbookScriptsRegistryService;
    /// The runtime of the module: the connections with their queries, the query executor, the saves of the connections
    /// and the computations of results, read through its store
    coreRuntime: CoreRuntime;
    catalogLoader: CatalogLoaderService;
    execution: WorkbookExecutionService;
    /// Set the database of the computations once the platform has set it up, e.g. in the app after the settings loaded.
    /// The queries and runs that start later use it.
    setComputeDatabase(database: EmbeddedComputeDatabase | null): void;
    /// Set the API of Salesforce once the platform knows it, e.g. in the app after the config chose a mock
    setSalesforce(salesforce: SalesforceApiClientInterface): void;
    /// Load the stored connections into the runtime and the stored workbooks into the registry
    restore(progress?: (progress: AppStateRestorationProgress) => void): Promise<RestoredAppState>;
    /// Write what is pending and stop the services
    destroy(): Promise<void>;
}

/// Create the runtime of a platform. The app creates it in its RuntimeProvider, the command line tool on its own.
///
/// The runtime of the module holds the connections and runs their queries; the workbooks tell it which connections
/// they use. The catalog loader follows the connections of the runtime, the runs of workbooks run on its executor. The
/// core is instantiated when the runtime restores the stored state, the services ask the platform for it when they
/// need it.
export function createRuntime(platform: RuntimePlatform): Runtime {
    const { logger, storage, http, scheduler } = platform;
    // The writer of the platform may exist before the core, it sets one up the way the platform does
    const storageWriter = platform.storageWriter ?? new StorageWriter(logger, storage);
    storageWriter.provideCore(platform.setupCore);

    const workbooks = new WorkbookScriptsRegistryService({ logger, storageWriter }, scheduler);
    const coreRuntime = new CoreRuntime({
        logger,
        scheduler,
        setupCore: platform.setupCore,
        computeDatabase: platform.computeDatabase ?? null,
        http,
        resultCache: platform.resultCache ?? null,
    });

    // The platform may set the compute database and the API of Salesforce later, the services read them when they use them
    let computeDatabase = platform.computeDatabase ?? null;
    let salesforce = platform.salesforce ?? new SalesforceApiClient(logger, http);
    const resultCache = platform.resultCache ?? null;

    const catalogLoader = new CatalogLoaderService({
        logger,
        runtime: coreRuntime,
        http,
        get salesforce() { return salesforce; },
        // The scripts that use the connection are analyzed again with the new catalog
        onCatalogDidUpdate: (connectionId: string) => {
            void workbooks.dispatchConnection(connectionId, { type: CATALOG_DID_UPDATE, value: connectionId });
        },
    });
    const execution = new WorkbookExecutionService({
        logger,
        readWorkbooks: () => workbooks.store.current,
        readConnections: () => coreRuntime.registry(),
        executeQuery: coreRuntime.execute,
        cancelQuery: coreRuntime.cancel,
        dispatchWorkbookScripts: workbooks.dispatch,
        get computeDatabase() { return computeDatabase; },
        resultCache,
    });

    // The services follow the registry of the workbooks and the connections of the runtime, like the effects of their
    // providers
    let scriptRunInstances = new Set<core.DashQL>();
    let references: Map<string, string[]> | null = null;
    const followWorkbooks = () => {
        const current = workbooks.store.current;
        const next = new Set([...current.workbookScriptsMap.values()].map(workbook => workbook.instance));
        for (const instance of scriptRunInstances) if (!next.has(instance)) registerScriptRunServices(instance, null);
        for (const instance of next) registerScriptRunServices(instance, execution.scriptRunServices);
        scriptRunInstances = next;
        // The runtime knows the workbooks that use a connection, e.g. it refuses to delete one that a workbook uses
        if (current.workbookScriptsByConnection !== references) {
            references = current.workbookScriptsByConnection;
            coreRuntime.setConnectionReferences([...references]);
        }
        execution.followRegistries(current, coreRuntime.registry());
    };
    const followConnections = () => {
        catalogLoader.follow();
        execution.followRegistries(workbooks.store.current, coreRuntime.registry());
    };
    const unsubscribe = [
        workbooks.store.subscribe(followWorkbooks),
        coreRuntime.store.subscribeKind('connectionList', followConnections),
        coreRuntime.store.subscribeKind('connection', followConnections),
    ];
    catalogLoader.start();

    return {
        platform,
        logger,
        storageWriter,
        workbooks,
        coreRuntime,
        catalogLoader,
        execution,
        setComputeDatabase(database) {
            computeDatabase = database;
            coreRuntime.setComputeDatabase(database);
        },
        setSalesforce(api) {
            salesforce = api;
        },
        async restore(progress = () => { }) {
            const instance = await platform.setupCore('runtime');
            coreRuntime.setCore(instance);
            storageWriter.provideCore(instance);
            // The connections save through the writer of the platform
            await storageWriter.withNativeWriter(async native => coreRuntime.setStorageWriter(native));
            const restored = await restoreAppState(coreRuntime, storage, logger, progress, storageWriter);
            workbooks.store.update({
                workbookScriptsMap: restored.workbookScripts,
                workbookScriptsByConnection: restored.workbookScriptsByConnection,
                invalidWorkbooks: restored.invalidWorkbooks,
            });
            return restored;
        },
        async destroy() {
            for (const stop of unsubscribe) stop();
            execution.stopAll();
            catalogLoader.stop();
            for (const instance of scriptRunInstances) registerScriptRunServices(instance, null);
            // The results of the last queries may still be written into the query result cache
            await coreRuntime.flushCacheWrites();
            await storageWriter.flush();
            workbooks.dispose();
            coreRuntime.destroy();
        },
    };
}
