import type * as core from '@ankoh/dashql-core';

import type { Logger } from './platform/logger/logger.js';
import type { HttpClient } from './platform/http/http_client.js';
import type { EmbeddedComputeDatabase } from './platform/database/embedded_database.js';
import type { OAuthFlow } from './oauth/oauth_flow.js';
import type { UpdateScheduler } from './store/store.js';
import type { StorageBackend } from './storage/storage_backend.js';
import { StorageWriter } from './storage/storage_writer.js';
import type { QueryResultCache } from './query/query_result_cache.js';
import { createComputations, type Computations } from './compute/computations.js';
import { ConnectionRegistryService } from './connections/connection_registry_service.js';
import { QueryExecutorService } from './connections/query_executor_service.js';
import { CatalogLoaderService } from './connections/catalog/catalog_loader_service.js';
import { ConnectionPersistenceService } from './connections/connection_persistence_service.js';
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

/// The logic of DashQL without a user interface: the registries of workbooks and connections and the services on them.
/// The app binds it to React, the command line tool uses it as it is.
export interface Runtime {
    platform: RuntimePlatform;
    logger: Logger;
    storageWriter: StorageWriter;
    workbooks: WorkbookScriptsRegistryService;
    connections: ConnectionRegistryService;
    computations: Computations;
    executor: QueryExecutorService;
    catalogLoader: CatalogLoaderService;
    execution: WorkbookExecutionService;
    persistence: ConnectionPersistenceService;
    /// Set the database of the computations once the platform has set it up, e.g. in the app after the settings loaded.
    /// The queries and runs that start later use it.
    setComputeDatabase(database: EmbeddedComputeDatabase | null): void;
    /// Set the API of Salesforce once the platform knows it, e.g. in the app after the config chose a mock
    setSalesforce(salesforce: SalesforceApiClientInterface): void;
    /// Load the stored connections and workbooks into the registries
    restore(progress?: (progress: AppStateRestorationProgress) => void): Promise<RestoredAppState>;
    /// Write what is pending and stop the services
    destroy(): Promise<void>;
}

/// Create the runtime of a platform. The app creates it in its RuntimeProvider, the command line tool on its own.
///
/// The workbooks come first, the connections read from them which workbooks use a connection; then the query executor
/// on the connections and the computations, the catalog loader and the runs of workbooks on the executor. The core is
/// instantiated when the runtime restores the stored state, the services ask the platform for it when they need it.
export function createRuntime(platform: RuntimePlatform): Runtime {
    const { logger, storage, http, scheduler } = platform;
    // The writer of the platform may exist before the core, it sets one up the way the platform does
    const storageWriter = platform.storageWriter ?? new StorageWriter(logger, storage);
    storageWriter.provideCore(platform.setupCore);

    const workbooks = new WorkbookScriptsRegistryService({ logger, storageWriter }, scheduler);
    const connections = new ConnectionRegistryService({ logger, storageWriter, references: workbooks.references }, scheduler);

    const computations = createComputations(logger, platform.setupCore);

    // The platform may set the compute database and the API of Salesforce later, the services read them when they use them
    let computeDatabase = platform.computeDatabase ?? null;
    let salesforce = platform.salesforce ?? new SalesforceApiClient(logger, http);
    const resultCache = platform.resultCache ?? null;
    const executor = new QueryExecutorService({
        logger,
        http,
        readConnections: () => connections.store.current,
        dispatchConnection: connections.dispatch,
        dispatchComputation: computations.dispatch,
        get computeDatabase() { return computeDatabase; },
        resultCache,
        setupCore: platform.setupCore,
    });
    const execute = executor.execute.bind(executor);
    const cancel = executor.cancel.bind(executor);

    const catalogLoader = new CatalogLoaderService({
        logger,
        dispatchConnection: connections.dispatch,
        execute,
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
        readConnections: () => connections.store.current,
        executeQuery: execute,
        cancelQuery: cancel,
        dispatchWorkbookScripts: workbooks.dispatch,
        get computeDatabase() { return computeDatabase; },
        resultCache,
    });
    const persistence = new ConnectionPersistenceService({
        storageWriter,
        readConnections: () => connections.store.current,
        references: workbooks.references,
        dispatchConnection: connections.dispatch,
    });

    // The services follow the registries, like the effects of their providers
    let scriptRunInstances = new Set<core.DashQL>();
    const followWorkbooks = () => {
        const next = new Set([...workbooks.store.current.workbookScriptsMap.values()].map(workbook => workbook.instance));
        for (const instance of scriptRunInstances) if (!next.has(instance)) registerScriptRunServices(instance, null);
        for (const instance of next) registerScriptRunServices(instance, execution.scriptRunServices);
        scriptRunInstances = next;
        execution.followRegistries(workbooks.store.current, connections.store.current);
    };
    const followConnections = () => {
        catalogLoader.setRegistry(connections.store.current);
        execution.followRegistries(workbooks.store.current, connections.store.current);
    };
    const unsubscribe = [workbooks.store.subscribe(followWorkbooks), connections.store.subscribe(followConnections)];
    catalogLoader.start();

    return {
        platform,
        logger,
        storageWriter,
        workbooks,
        connections,
        computations,
        executor,
        catalogLoader,
        execution,
        persistence,
        setComputeDatabase(database) {
            computeDatabase = database;
        },
        setSalesforce(api) {
            salesforce = api;
        },
        async restore(progress = () => { }) {
            const instance = await platform.setupCore('runtime');
            computations.setCore(instance);
            storageWriter.provideCore(instance);
            const restored = await restoreAppState(instance, storage, logger, progress, storageWriter);
            connections.store.update({
                connections: restored.connectionStates,
                connectionsByType: restored.connectionStatesByType,
            });
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
            await executor.flushCacheWrites();
            await storageWriter.flush();
            workbooks.dispose();
            connections.dispose();
            computations.destroy();
        },
    };
}
