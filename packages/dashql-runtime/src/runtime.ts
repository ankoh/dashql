import type * as core from '@ankoh/dashql-core';

import type { Logger } from './platform/logger/logger.js';
import type { HttpClient } from './platform/http/http_client.js';
import type { EmbeddedComputeDatabase } from './platform/database/embedded_database.js';
import type { OAuthFlow } from './oauth/oauth_flow.js';
import type { UpdateScheduler } from './store/store.js';
import type { StorageBackend } from './storage/storage_backend.js';
import type { QueryResultCache } from './query/query_result_cache.js';
import { CoreRuntime, type ChannelConnector } from './core_runtime.js';
import type { SalesforceApiClientInterface } from './connections/salesforce/salesforce_api_client.js';
import { WorkbookExecutionService } from './workbook/scripts/workbook_execution_service.js';

/// What a platform passes to the runtime: the browser, the desktop app or Node
export interface RuntimePlatform {
    logger: Logger;
    /// Where the workbooks and connections are kept
    storage: StorageBackend;
    http: HttpClient;
    /// When the store takes the changes of the runtime
    scheduler: UpdateScheduler;
    /// How connectors authorize
    oauthFlow: OAuthFlow;
    /// Connects the channels of the setups besides Trino, e.g. the embedded Hyper. None by default, the app sets it
    /// once its clients are there.
    channels?: ChannelConnector | null;
    /// Instantiate the core
    setupCore: (context: string) => Promise<core.DashQL>;
    /// The database of the computations, null without one
    computeDatabase?: EmbeddedComputeDatabase | null;
    /// The cache of query results, null without one
    resultCache?: QueryResultCache | null;
    /// The API of Salesforce, by default the client over `http`. The catalog loader fetches the metadata of Salesforce
    /// over `http` itself, another API, e.g. the mock of the app, answers it instead.
    salesforce?: SalesforceApiClientInterface;
}

/// The logic of DashQL without a user interface: the runtime of the module with the connections, their queries, the
/// computations, the workbooks, the storage writer and the restore, and the service of the runs of workbooks. The app
/// binds it to React, the command line tool uses it as it is.
export interface Runtime {
    platform: RuntimePlatform;
    logger: Logger;
    /// The runtime of the module, read through its store
    coreRuntime: CoreRuntime;
    execution: WorkbookExecutionService;
    /// Set the database of the computations once the platform has set it up, e.g. in the app after the settings loaded.
    /// The queries and runs that start later use it.
    setComputeDatabase(database: EmbeddedComputeDatabase | null): void;
    /// Set the API of Salesforce once the platform knows it, e.g. in the app after the config chose a mock
    setSalesforce(salesforce: SalesforceApiClientInterface): void;
    /// Restore the stored connections and workbooks into the runtime
    restore(progress?: (progress: core.RestoreProgress) => void): Promise<core.RestoreOutcome>;
    /// Write what is pending and stop the services
    destroy(): Promise<void>;
}

/// Create the runtime of a platform. The app creates it in its RuntimeProvider, the command line tool on its own.
///
/// The runtime of the module holds the connections and the workbooks, sets the connections up, loads their catalogs,
/// runs their queries and writes what changed. The runs of workbooks run on its executor. The core is instantiated when
/// the runtime restores the stored state, the services ask the platform for it when they need it.
export function createRuntime(platform: RuntimePlatform): Runtime {
    const { logger, storage, http, scheduler } = platform;
    const coreRuntime = new CoreRuntime({
        logger,
        scheduler,
        setupCore: platform.setupCore,
        computeDatabase: platform.computeDatabase ?? null,
        http,
        resultCache: platform.resultCache ?? null,
        oauthFlow: platform.oauthFlow,
        channels: platform.channels ?? null,
        salesforce: platform.salesforce ?? null,
        storage,
    });

    // The platform may set the compute database later, the services read it when they use it
    let computeDatabase = platform.computeDatabase ?? null;
    const resultCache = platform.resultCache ?? null;

    const execution = new WorkbookExecutionService({
        logger,
        readWorkbooks: () => coreRuntime.store.all('workbook').values(),
        readWorkbook: workbookId => coreRuntime.workbook(workbookId),
        runs: coreRuntime,
        readConnections: () => coreRuntime.registry(),
        executeQuery: coreRuntime.execute,
        cancelQuery: coreRuntime.cancel,
        dispatchWorkbookScripts: coreRuntime.dispatchWorkbook,
        get computeDatabase() { return computeDatabase; },
        resultCache,
    });

    // The runs follow the workbooks and the connections of the runtime
    const follow = () => execution.followRegistries(coreRuntime.store.all('workbook').values(), coreRuntime.registry());
    const unsubscribe = [
        coreRuntime.store.subscribeKind('workbook', follow),
        coreRuntime.store.subscribeKind('connectionList', follow),
        coreRuntime.store.subscribeKind('connection', follow),
    ];

    return {
        platform,
        logger,
        coreRuntime,
        execution,
        setComputeDatabase(database) {
            computeDatabase = database;
            coreRuntime.setComputeDatabase(database);
        },
        setSalesforce(api) {
            coreRuntime.setSalesforce(api);
        },
        async restore(progress) {
            const instance = await platform.setupCore('runtime');
            coreRuntime.setCore(instance);
            return await coreRuntime.restore(progress);
        },
        async destroy() {
            for (const stop of unsubscribe) stop();
            execution.stopAll();
            coreRuntime.runCatalogLoader(false);
            // The results of the last queries may still be written into the query result cache
            await coreRuntime.flushCacheWrites();
            await coreRuntime.storage.flush();
            coreRuntime.destroy();
        },
    };
}
