import type { ConnectionRegistry, DynamicConnectionDispatch } from '../connection_registry_state.js';
import { CatalogUpdateTaskState, CatalogUpdateTaskStatus, CatalogUpdateVariant, MAX_TOUCHED_ATTEMPTS } from './catalog_update_state.js';
import { HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, DBCOM_CONNECTOR, TRINO_CONNECTOR } from '../connector_info.js';
import {
    ConnectionHealth,
    CATALOG_UPDATE_CANCELLED,
    CATALOG_UPDATE_FAILED,
    CATALOG_UPDATE_PARTIALLY_SUCCEEDED,
    CATALOG_UPDATE_SUCCEEDED,
    UPDATE_CATALOG,
} from '../connection_state.js';
import { getHyperCloudAttachedDatabase, updateSalesforceCatalog } from '../salesforce/salesforce_catalog_update.js';
import type { SalesforceApiClientInterface } from '../salesforce/salesforce_api_client.js';
import type { QueryExecutor } from '../query_execution_args.js';
import type { Logger } from '../../platform/logger/logger.js';
import { createTrace } from '../../platform/logger/trace_context.js';
import { updateInformationSchemaCatalog, updateInformationSchemaRelations } from './catalog_query_information_schema.js';
import type { RelationName } from './catalog_sql_generator.js';
import { queryTrinoCatalogScopes, trinoCatalogScopes } from '../trino/trino_catalogs.js';
import { updateHyperCatalog } from '../hyper/hyper_catalog_update.js';
import { connectionCatalogIsDurable } from '../connection_params.js';
import { ensureConnectionClientFunctions } from '../connection_client_functions.js';
import { connectorOfDetails } from '../connector_descriptor.js';

const LOG_CTX = 'catalog_loader';

/// The wait before asking a connection again about the relations of executed statements, per failed attempt
const TOUCHED_RETRY_DELAY_MS = 2000;
let NEXT_CATALOG_UPDATE_ID = 1;

/// The catalog update args
export interface CatalogLoaderArgs {
    /// The relations to ask the connection about, everything if absent
    relations: RelationName[] | null;
}
/// The catalog updater function
export type CatalogLoader = (connectionId: string, args: CatalogLoaderArgs) => [number, Promise<void>];

/// What the catalog loader needs, replaced in tests
export interface CatalogLoaderDependencies {
    logger: Logger;
    dispatchConnection: DynamicConnectionDispatch;
    execute: QueryExecutor | null;
    salesforce: SalesforceApiClientInterface;
    updateHyperCatalog: typeof updateHyperCatalog;
    /// Called when the catalog of a connection changed
    onCatalogDidUpdate?: (connectionId: string) => void;
}

/// Keeps the catalogs of the connections current: describes a connection when it comes online, refreshes on request
/// and asks a connection about the relations that executed statements touched.
///
/// The host passes every new connection registry with setRegistry(). The loader then reconsiders its queue at the end
/// of the task, as it does after an enqueued request, a finished update and a retry timer.
export class CatalogLoaderService {
    private readonly deps: CatalogLoaderDependencies;
    private registry: Pick<ConnectionRegistry, 'connections'> = { connections: new Map() };
    /// The requested refreshes (connectionId -> forced)
    private readonly queue = new Map<string, boolean>();
    /// The connections that are online
    private readonly online = new Set<string>();
    /// The connections with an update in progress
    private readonly inProgress = new Set<string>();
    /// When the last update of a connection finished
    private readonly lastFinishedAt = new Map<string, number>();
    /// The timer of the next attempt to ask about touched relations
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private scheduled = false;
    private stopped = false;

    constructor(deps: CatalogLoaderDependencies) {
        this.deps = deps;
    }

    /// Follow a new connection registry
    setRegistry(registry: Pick<ConnectionRegistry, 'connections'>): void {
        this.registry = registry;
        const connMap = registry.connections;
        // The client functions of a connection come with its connector, scripts that call them are re-analyzed
        for (const connectionId of connMap.keys()) {
            ensureConnectionClientFunctions(connMap, connectionId, id => this.deps.onCatalogDidUpdate?.(id), this.deps.logger);
        }
        // A full refresh only runs on user input and for the initial description of a connection: the catalog of a
        // connection whose database doesn't outlive the app is not restored from storage, it is described whenever the
        // connection comes online. A connection that has neither a stored nor a refreshed catalog is described when it
        // first comes online. Everything else asks the connection about single relations.
        for (const [connectionId, conn] of connMap) {
            if (conn.connectionHealth !== ConnectionHealth.ONLINE) {
                this.online.delete(connectionId);
            } else if (!this.online.has(connectionId)) {
                this.online.add(connectionId);
                if (!connectionCatalogIsDurable(conn.params)) {
                    this.enqueue(connectionId, true);
                } else if (!conn.catalogUpdates.described) {
                    this.enqueue(connectionId, false);
                }
            }
        }
        for (const connectionId of [...this.online]) {
            if (!connMap.has(connectionId)) this.online.delete(connectionId);
        }
        this.requestSchedule();
    }

    /// Request a refresh of the catalog of a connection, a forced one supersedes a running update
    enqueue = (connectionId: string, force: boolean): void => {
        this.queue.set(connectionId, force || this.queue.get(connectionId) === true);
        this.requestSchedule();
    };

    /// Allocate the next update id and start the update
    update: CatalogLoader = (connectionId: string, args: CatalogLoaderArgs): [number, Promise<void>] => {
        const updateId = NEXT_CATALOG_UPDATE_ID++;
        return [updateId, this.updateWithId(connectionId, args, updateId)];
    };

    /// Start scheduling, e.g. again after stop()
    start(): void {
        this.stopped = false;
        this.requestSchedule();
    }

    /// Stop scheduling, running updates finish
    stop(): void {
        this.stopped = true;
        if (this.retryTimer != null) clearTimeout(this.retryTimer);
        this.retryTimer = null;
    }

    private requestSchedule(): void {
        if (this.scheduled || this.stopped) return;
        this.scheduled = true;
        queueMicrotask(() => {
            this.scheduled = false;
            if (!this.stopped) this.schedule();
        });
    }

    /// Start the updates that the queue and the touched relations ask for
    private schedule(): void {
        const { logger } = this.deps;
        const inProgress = this.inProgress;

        // Helper to perform the catalog update
        const doUpdate = async (connectionId: string, relations: RelationName[] | null) => {
            inProgress.add(connectionId);
            try {
                logger.info("Starting catalog update", { connectionId, relations: String(relations?.length ?? 'all') }, LOG_CTX);
                const [_updateId, updatePromise] = this.update(connectionId, { relations });
                await updatePromise;
            } catch (e: any) {
                logger.warn("Catalog update failed", { connectionId, "error": e?.message ?? String(e) }, LOG_CTX);
            } finally {
                inProgress.delete(connectionId);
                this.lastFinishedAt.set(connectionId, Date.now());
                // Pending requests must be reconsidered even if the registry does not change.
                this.requestSchedule();
            }
        };

        // Ask the connections about the relations of executed statements, when they have room for another query.
        // A refresh that runs may have read the relations too early, this update follows it and corrects them.
        for (const [connectionId, conn] of this.registry.connections) {
            const { touchedRelations: relations, touchedFailures: failures, tasksRunning } = conn.catalogUpdates;
            if (relations.length === 0 || inProgress.has(connectionId) || tasksRunning.size > 0) continue;
            // A requested refresh goes first, the lookup follows it
            if (this.queue.has(connectionId)) continue;
            // Relations that a restored catalog still has to ask about wait for the connection
            if (conn.connectionHealth !== ConnectionHealth.ONLINE) continue;
            if (conn.queriesActive.size >= connectorOfDetails(conn.details).maxConcurrentQueries(conn.details.value)) continue;
            // The next statement or a manual refresh tries again
            if (failures >= MAX_TOUCHED_ATTEMPTS) continue;
            if (failures > 0) {
                const wait = (this.lastFinishedAt.get(connectionId) ?? 0) + TOUCHED_RETRY_DELAY_MS * failures - Date.now();
                if (wait > 0) {
                    if (this.retryTimer == null) {
                        this.retryTimer = setTimeout(() => {
                            this.retryTimer = null;
                            this.requestSchedule();
                        }, wait);
                    }
                    continue;
                }
            }
            void doUpdate(connectionId, relations);
        }

        for (const [connectionId, force] of [...this.queue]) {
            logger.debug("Received catalog update request", { connectionId }, LOG_CTX);

            // Find the connection
            const connState = this.registry.connections.get(connectionId);
            if (!connState) {
                logger.warn("Failed to resolve connection", { connectionId }, LOG_CTX);
                this.queue.delete(connectionId);
                continue;
            }

            // Has a current catalog update running?
            // Skip auto-updates, but let explicit user refreshes supersede
            // the in-flight ones by aborting them first.
            if (connState.catalogUpdates.tasksRunning.size > 0) {
                if (!force) {
                    logger.info("Skipping redundant catalog update", { connectionId }, LOG_CTX);
                    continue;
                }
                for (const task of connState.catalogUpdates.tasksRunning.values()) {
                    if (!task.cancellation.signal.aborted) {
                        task.cancellation.abort(new DOMException('Superseded by forced catalog refresh', 'AbortError'));
                    }
                }
            }

            // Keep forced requests queued until the cancelled execution settles.
            if (inProgress.has(connectionId)) {
                continue;
            }

            // A refresh described the connection meanwhile
            if (!force && connState.catalogUpdates.described) {
                this.queue.delete(connectionId);
                continue;
            }

            // Perform the catalog update
            this.queue.delete(connectionId);
            void doUpdate(connectionId, null);
        }
    }

    /// Update the catalog with a pre-allocated update id
    private async updateWithId(connectionId: string, args: CatalogLoaderArgs, updateId: number): Promise<void> {
        const { logger, dispatchConnection: connDispatch, execute: executor, salesforce: sfapi } = this.deps;
        const connMap = this.registry.connections;
        // Each catalog update gets its own trace so failures don't borrow
        // whatever trace happens to be on a shared stack.
        const traced = logger.withTrace(createTrace());

        const conn = connMap.get(connectionId);
        if (!conn) {
            traced.warn("Failed to resolve connection", { connectionId }, LOG_CTX);
            throw new Error(`couldn't find a connection with id ${connectionId}`);
        }
        if (!executor) {
            traced.warn("Query executor not configured", { connectionId }, LOG_CTX);
            throw new Error(`couldn't find trino executor`);
        }

        traced.debug("Updating catalog", { connectionId }, LOG_CTX);

        const relations = args.relations;

        // Accept the query and clear the request
        const abortController = new AbortController();
        const now = new Date();
        const initialState: CatalogUpdateTaskState = {
            taskId: updateId,
            taskVariant: relations != null ? CatalogUpdateVariant.RELATION_REFRESH : CatalogUpdateVariant.FULL_CATALOG_REFRESH,
            status: CatalogUpdateTaskStatus.STARTED,
            cancellation: abortController,
            queries: [],
            error: null,
            startedAt: now,
            finishedAt: null,
            touchedRelations: relations ?? [],
        };
        connDispatch(connectionId, {
            type: UPDATE_CATALOG,
            value: [updateId, initialState],
        });

        // Emit a heartbeat log every few seconds so long-running updates
        // don't look like a silent hang between "Starting" and "Updated".
        const updateStartMs = performance.now();
        const heartbeat = setInterval(() => {
            const elapsedMs = performance.now() - updateStartMs;
            traced.info("Catalog update in progress", {
                connectionId,
                "updateId": updateId.toString(),
                "elapsedMs": elapsedMs.toFixed(0),
            }, LOG_CTX);
        }, 5000);

        // Update the catalog
        const versionBefore = conn.catalog.version();
        try {
            const batchOptions = {
                abortSignal: abortController.signal,
                isCurrent: () => this.registry.connections.get(connectionId)?.catalog === conn.catalog,
            };
            let partialError: Error | null = null;
            switch (conn.details.type) {
                // Update the catalog by querying the information_schema
                case TRINO_CONNECTOR: {
                    // Trino folds the names of relations to lower case
                    if (relations != null) {
                        const folded = relations.map(r => ({ databaseName: r.databaseName.toLowerCase(), schemaName: r.schemaName.toLowerCase(), tableName: r.tableName.toLowerCase() }));
                        await updateInformationSchemaRelations(connectionId, connDispatch, updateId, folded, executor, conn.catalog, conn.catalogRelationEntryId, batchOptions);
                        break;
                    }
                    const setupParams = conn.details.value.proto.setupParams;
                    let scopes = setupParams ? trinoCatalogScopes(setupParams) : [];
                    // Without configured catalogs, read all catalogs of the server
                    if (scopes.length === 0) {
                        scopes = await queryTrinoCatalogScopes(connectionId, connDispatch, updateId, executor, abortController.signal);
                    }
                    await updateInformationSchemaCatalog(connectionId, connDispatch, updateId, scopes, executor, conn.catalog, conn.catalogRelationEntryId, batchOptions);
                    break;
                }
                case HYPER_CONNECTOR: {
                    const result = await this.deps.updateHyperCatalog(
                        traced,
                        connectionId,
                        connDispatch,
                        updateId,
                        (conn.details.value.proto.setupParams?.attachedDatabases ?? []).map(database => ({
                            path: database.path ?? '',
                            alias: database.alias,
                        })),
                        executor,
                        conn.catalog,
                        conn.instance,
                        conn.catalogRelationEntryId,
                        conn.catalogFunctionScript,
                        conn.details.value.proto.setupParams?.protocol === 'WASM',
                        abortController.signal,
                        batchOptions,
                        relations,
                    );
                    if (result.failures.length > 0) {
                        partialError = new Error(result.failures
                            .map(failure => `${failure.database}: ${failure.error.message}`)
                            .join('; '));
                        traced.warn('Partially updated Hyper catalog', {
                            connectionId,
                            updated: result.updatedDatabases.join(', '),
                            failed: result.failures.map(failure => failure.database).join(', '),
                        }, LOG_CTX);
                    }
                    break;
                }
                // Update the catalog by querying the _hyper_catalog of the attached Hyper Cloud database
                case DBCOM_CONNECTOR:
                    await this.deps.updateHyperCatalog(
                        traced,
                        connectionId,
                        connDispatch,
                        updateId,
                        [getHyperCloudAttachedDatabase(conn.details.value.proto.setupParams)],
                        executor,
                        conn.catalog,
                        conn.instance,
                        conn.catalogRelationEntryId,
                        conn.catalogFunctionScript,
                        false,
                        abortController.signal,
                        batchOptions,
                        relations,
                    );
                    break;
                // Update the catalog by querying the Salesforce Metadata Service
                case SALESFORCE_DATA_CLOUD_CONNECTOR:
                    await updateSalesforceCatalog(
                        traced,
                        conn.details.value,
                        conn.catalog,
                        conn.instance,
                        conn.catalogRelationEntryId,
                        conn.catalogFunctionScript,
                        sfapi,
                        abortController,
                        batchOptions,
                    );
                    break;
            }
            traced.debug("Updated catalog", { connectionId }, LOG_CTX);

            // Mark the update successful
            if (partialError == null) {
                connDispatch(connectionId, {
                    type: CATALOG_UPDATE_SUCCEEDED,
                    value: [updateId, conn.catalog.version() !== versionBefore],
                });
            } else {
                connDispatch(connectionId, {
                    type: CATALOG_UPDATE_PARTIALLY_SUCCEEDED,
                    value: [updateId, partialError],
                });
            }
            // Announce the new catalog
            this.deps.onCatalogDidUpdate?.(connectionId);

        } catch (e: any) {
            if (e?.name === 'AbortError') {
                traced.info("Cancelled catalog update", { connectionId, "error": e?.message ?? String(e) }, LOG_CTX);
                connDispatch(connectionId, {
                    type: CATALOG_UPDATE_CANCELLED,
                    value: [updateId, e],
                });
            } else {
                traced.error("Failed to update catalog", { connectionId, "error": e?.message ?? String(e) }, LOG_CTX);
                connDispatch(connectionId, {
                    type: CATALOG_UPDATE_FAILED,
                    value: [updateId, e],
                });
            }
        } finally {
            clearInterval(heartbeat);
            const totalMs = performance.now() - updateStartMs;
            traced.info("Finished catalog update", {
                connectionId,
                "updateId": updateId.toString(),
                "durationMs": totalMs.toFixed(0),
            }, LOG_CTX);
        }
    }
}
