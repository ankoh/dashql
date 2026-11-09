import * as React from 'react';

import { useDynamicConnectionDispatch } from '../connection_registry.js';
import { CatalogUpdateTaskState, CatalogUpdateTaskStatus, CatalogUpdateVariant, MAX_TOUCHED_ATTEMPTS } from './catalog_update_state.js';
import { useSalesforceAPI } from '../salesforce/salesforce_connector.js';
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
import { useQueryExecutor } from '../query_executor.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
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
interface CatalogLoaderArgs {
    /// The relations to ask the connection about, everything if absent
    relations: RelationName[] | null;
}
/// The catalog updater function
export type CatalogLoader = (connectionId: string, args: CatalogLoaderArgs) => [number, Promise<void>];
/// A function to add a connection id to a catalog loader queue
type RefreshCatalogFn = (connectionId: string, force: boolean) => void;
/// A catalog loader queue
interface CatalogLoaderQueue { queue: Map<string, boolean>; }

/// The React context to propagate a active catalog loader queue function
const LOADER_QUEUE_FN_CTX = React.createContext<RefreshCatalogFn | null>(null);

/// The hook to resolve the catalog queue
export const useCatalogLoaderQueue = () => React.useContext(LOADER_QUEUE_FN_CTX)!;

export interface CatalogLoaderDependencies {
    useDynamicConnectionDispatch: typeof useDynamicConnectionDispatch;
    useQueryExecutor: typeof useQueryExecutor;
    useSalesforceAPI: typeof useSalesforceAPI;
    updateHyperCatalog: typeof updateHyperCatalog;
}

const DEFAULT_DEPENDENCIES: CatalogLoaderDependencies = {
    useDynamicConnectionDispatch,
    useQueryExecutor,
    useSalesforceAPI,
    updateHyperCatalog,
};

/// The props of the catalog loader
export interface CatalogLoaderProviderProps {
    /// The children
    children?: React.ReactElement;
    /// The hooks the loader uses, replaced in tests
    dependencies?: CatalogLoaderDependencies;
    /// Called when the catalog of a connection changed
    onCatalogDidUpdate?: (connectionId: string) => void;
}

export function CatalogLoaderProvider(props: CatalogLoaderProviderProps) {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const logger = useLogger();
    const executor = dependencies.useQueryExecutor();
    const sfapi = dependencies.useSalesforceAPI();

    // The connection registry changes frequently, the connection map is stable.
    // This executor will depend on the map directly since it can resolve everything ad-hoc.
    const [connReg, connDispatch] = dependencies.useDynamicConnectionDispatch();
    const connMap = connReg.connections;
    const onCatalogDidUpdate = React.useRef(props.onCatalogDidUpdate);
    onCatalogDidUpdate.current = props.onCatalogDidUpdate;

    // The client functions of a connection come with its connector, scripts that call them are re-analyzed
    React.useEffect(() => {
        for (const connectionId of connMap.keys()) {
            ensureConnectionClientFunctions(connMap, connectionId, id => onCatalogDidUpdate.current?.(id), logger);
        }
    }, [connReg, connMap, logger]);

    // Maintain a queue
    const [queueState, setQueueState] = React.useState<CatalogLoaderQueue>(() => ({ queue: new Map() }));
    const enqueue = React.useCallback<RefreshCatalogFn>((connectionId: string, force: boolean) => {
        setQueueState(s => ({ queue: new Map(s.queue).set(connectionId, force || s.queue.get(connectionId) === true) }));
    }, []);

    // Execute a query with pre-allocated query id
    const updateImpl = React.useCallback(async (connectionId: string, args: CatalogLoaderArgs, updateId: number): Promise<void> => {
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
                isCurrent: () => connMap.get(connectionId)?.catalog === conn.catalog,
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
                    const result = await dependencies.updateHyperCatalog(
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
                    await dependencies.updateHyperCatalog(
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
            onCatalogDidUpdate.current?.(connectionId);

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
    }, [connMap, sfapi, executor, dependencies.updateHyperCatalog]);

    // Allocate the next query id and start the execution
    const update = React.useCallback<CatalogLoader>((connectionId: string, args: CatalogLoaderArgs): [number, Promise<void>] => {
        const updateId = NEXT_CATALOG_UPDATE_ID++;
        const execution = updateImpl(connectionId, args, updateId);
        return [updateId, execution];
    }, [updateImpl]);

    // A full refresh only runs on user input and for the initial description of a connection: the catalog of a
    // connection whose database doesn't outlive the app is not restored from storage, it is described whenever the
    // connection comes online. A connection that has neither a stored nor a refreshed catalog is described when it
    // first comes online. Everything else asks the connection about single relations.
    const onlineRef = React.useRef(new Set<string>());
    React.useEffect(() => {
        const online = onlineRef.current;
        for (const [connectionId, conn] of connMap) {
            if (conn.connectionHealth !== ConnectionHealth.ONLINE) {
                online.delete(connectionId);
            } else if (!online.has(connectionId)) {
                online.add(connectionId);
                if (!connectionCatalogIsDurable(conn.params)) {
                    enqueue(connectionId, true);
                } else if (!conn.catalogUpdates.described) {
                    enqueue(connectionId, false);
                }
            }
        }
        for (const connectionId of [...online]) {
            if (!connMap.has(connectionId)) online.delete(connectionId);
        }
    }, [connReg, connMap, enqueue]);

    // When the last update of a connection finished and the timer of the next attempt
    const lastFinishedAt = React.useRef(new Map<string, number>());
    const retryTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    React.useEffect(() => () => {
        if (retryTimer.current != null) clearTimeout(retryTimer.current);
        retryTimer.current = null;
    }, []);

    // Subscribe the queue
    const updatesInProgress = React.useRef<Set<string> | null>(null);
    React.useEffect(() => {
        const inProgress = updatesInProgress.current ?? new Set();
        updatesInProgress.current = inProgress;

        // Helper to perform the catalog update
        const doUpdate = async (connectionId: string, relations: RelationName[] | null) => {
            inProgress.add(connectionId);
            try {
                logger.info("Starting catalog update", { connectionId, relations: String(relations?.length ?? 'all') }, LOG_CTX);
                // Otherwise start the catalog update
                const [_updateId, updatePromise] = update(connectionId, { relations });
                // Await the update
                await updatePromise;
            } catch (e: any) {
                logger.warn("Catalog update failed", { connectionId, "error": e?.message ?? String(e) }, LOG_CTX);
            } finally {
                inProgress.delete(connectionId);
                lastFinishedAt.current.set(connectionId, Date.now());
                // Pending requests must be reconsidered even if the registry does not change.
                setQueueState(s => ({ ...s }));
            }
        };

        // Ask the connections about the relations of executed statements, when they have room for another query.
        // A refresh that runs may have read the relations too early, this update follows it and corrects them.
        for (const [connectionId, conn] of connReg.connections) {
            const { touchedRelations: relations, touchedFailures: failures, tasksRunning } = conn.catalogUpdates;
            if (relations.length === 0 || inProgress.has(connectionId) || tasksRunning.size > 0) continue;
            // A requested refresh goes first, the lookup follows it
            if (queueState.queue.has(connectionId)) continue;
            // Relations that a restored catalog still has to ask about wait for the connection
            if (conn.connectionHealth !== ConnectionHealth.ONLINE) continue;
            if (conn.queriesActive.size >= connectorOfDetails(conn.details).maxConcurrentQueries(conn.details.value)) continue;
            // The next statement or a manual refresh tries again
            if (failures >= MAX_TOUCHED_ATTEMPTS) continue;
            if (failures > 0) {
                const wait = (lastFinishedAt.current.get(connectionId) ?? 0) + TOUCHED_RETRY_DELAY_MS * failures - Date.now();
                if (wait > 0) {
                    if (retryTimer.current == null) {
                        retryTimer.current = setTimeout(() => {
                            retryTimer.current = null;
                            setQueueState(s => ({ ...s }));
                        }, wait);
                    }
                    continue;
                }
            }
            doUpdate(connectionId, relations);
        }

        const processed: string[] = [];
        for (const [connectionId, force] of queueState.queue) {
            logger.debug("Received catalog update request", { connectionId }, LOG_CTX);

            // Find the connection
            const connState = connReg.connections.get(connectionId);
            if (!connState) {
                logger.warn("Failed to resolve connection", { connectionId }, LOG_CTX);
                processed.push(connectionId);
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
                processed.push(connectionId);
                continue;
            }

            // Perform the catalog update
            doUpdate(connectionId, null);
            processed.push(connectionId);
        }

        // No processed?
        if (processed.length == 0) {
            return;
        }

        // Remove all processed ids from the queue
        setQueueState(s => {
            const queue = new Map(s.queue);
            for (const connectionId of processed) {
                queue.delete(connectionId);
            }
            return { ...s, queue };
        });
    }, [queueState, connReg, update, logger]);

    return (
        <LOADER_QUEUE_FN_CTX.Provider value={enqueue}>
            {props.children}
        </LOADER_QUEUE_FN_CTX.Provider>
    );
}
