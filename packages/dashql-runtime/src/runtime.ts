import type * as core from '@ankoh/dashql-core';

import type { Logger } from './platform/logger/logger.js';
import type { HttpClient } from './platform/http/http_client.js';
import type { EmbeddedComputeDatabase } from './platform/database/embedded_database.js';
import type { OAuthFlow } from './oauth/oauth_flow.js';
import { Store, type UpdateScheduler } from './store/store.js';
import type { StorageBackend } from './storage/storage_backend.js';
import { StorageWriter } from './storage/storage_writer.js';
import type { QueryResultCache } from './query/query_result_cache.js';
import { createComputationState, reduceComputationState, type ComputationAction, type ComputationState } from './compute/computation_state.js';
import { DataFrameRegistry } from './compute/data_frame.js';
import { ConnectionRegistryService } from './connections/connection_registry_service.js';
import { QueryExecutorService } from './connections/query_executor_service.js';
import { CatalogLoaderService } from './connections/catalog/catalog_loader_service.js';
import { ConnectionPersistenceService } from './connections/connection_persistence_service.js';
import { updateHyperCatalog } from './connections/hyper/hyper_catalog_update.js';
import { SalesforceApiClient } from './connections/salesforce/salesforce_api_client.js';
import { WorkbookScriptsRegistryService } from './workbook/scripts/workbook_scripts_registry_service.js';
import { WorkbookExecutionService } from './workbook/scripts/workbook_execution_service.js';
import { registerScriptRunServices } from './workbook/scripts/script_run.js';
import { restoreAppState, type AppStateRestorationProgress, type RestoredAppState } from './workbook/persistence/app_state_loader.js';

/// What a platform passes to the runtime: the browser, the desktop app or Node
export interface RuntimePlatform {
    logger: Logger;
    /// Where the workbooks and connections are kept
    storage: StorageBackend;
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
}

/// The computations on query results
export interface RuntimeComputations {
    store: Store<ComputationState>;
    dispatch: (action: ComputationAction) => void;
    dataFrames: DataFrameRegistry;
}

/// The logic of DashQL without a user interface: the registries of workbooks and connections and the services on them.
/// The app binds it to React, the command line tool uses it as it is.
export interface Runtime {
    platform: RuntimePlatform;
    core: core.DashQL;
    logger: Logger;
    storageWriter: StorageWriter;
    workbooks: WorkbookScriptsRegistryService;
    connections: ConnectionRegistryService;
    computations: RuntimeComputations;
    executor: QueryExecutorService;
    catalogLoader: CatalogLoaderService;
    execution: WorkbookExecutionService;
    persistence: ConnectionPersistenceService;
    /// Load the stored connections and workbooks into the registries
    restore(progress?: (progress: AppStateRestorationProgress) => void): Promise<RestoredAppState>;
    /// Write what is pending and stop the services
    destroy(): Promise<void>;
}

/// Create the runtime of a platform.
///
/// The order is the one that the providers of the app nest in: the workbooks first, the connections read from them
/// which workbooks use a connection; then the query executor on the connections and the computations, the catalog
/// loader and the runs of workbooks on the executor.
export async function createRuntime(platform: RuntimePlatform): Promise<Runtime> {
    const { logger, storage, http, scheduler } = platform;
    const instance = await platform.setupCore('runtime');
    const storageWriter = new StorageWriter(logger, storage);

    const workbooks = new WorkbookScriptsRegistryService({ logger, storageWriter }, scheduler);
    const connections = new ConnectionRegistryService({ logger, storageWriter, references: workbooks.references }, scheduler);

    const dataFrames = new DataFrameRegistry(logger);
    const computationStore = new Store<ComputationState>(createComputationState());
    const computations: RuntimeComputations = {
        store: computationStore,
        // Reducing acquires and releases data frames, the store runs every action once
        dispatch: action => computationStore.update(state => reduceComputationState(state, action, dataFrames)),
        dataFrames,
    };

    const computeDatabase = platform.computeDatabase ?? null;
    const resultCache = platform.resultCache ?? null;
    const executor = new QueryExecutorService({
        logger,
        http,
        readConnections: () => connections.store.current,
        dispatchConnection: connections.dispatch,
        dispatchComputation: computations.dispatch,
        computeDatabase,
        resultCache,
        setupCore: platform.setupCore,
    });
    const execute = executor.execute.bind(executor);
    const cancel = executor.cancel.bind(executor);

    const catalogLoader = new CatalogLoaderService({
        logger,
        dispatchConnection: connections.dispatch,
        execute,
        salesforce: new SalesforceApiClient(logger, http),
        updateHyperCatalog,
    });
    const execution = new WorkbookExecutionService({
        logger,
        readWorkbooks: () => workbooks.store.current,
        readConnections: () => connections.store.current,
        executeQuery: execute,
        cancelQuery: cancel,
        dispatchWorkbookScripts: workbooks.dispatch,
        computeDatabase,
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
        core: instance,
        logger,
        storageWriter,
        workbooks,
        connections,
        computations,
        executor,
        catalogLoader,
        execution,
        persistence,
        async restore(progress = () => { }) {
            const restored = await restoreAppState(instance, storage, logger, progress);
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
        },
    };
}
