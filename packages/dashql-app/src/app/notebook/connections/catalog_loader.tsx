import * as React from 'react';

import { useDynamicConnectionDispatch } from './connection_registry.js';
import { CatalogUpdateTaskState, CatalogUpdateTaskStatus, CatalogUpdateVariant } from './catalog_update_state.js';
import { useSalesforceAPI } from './salesforce/salesforce_connector.js';
import { CatalogResolver, HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, TRINO_CONNECTOR } from './connector_info.js';
import {
    CATALOG_UPDATE_CANCELLED,
    CATALOG_UPDATE_FAILED,
    CATALOG_UPDATE_PARTIALLY_SUCCEEDED,
    CATALOG_UPDATE_SUCCEEDED,
    SET_CATALOG_SCRIPT,
    UPDATE_CATALOG,
} from './connection_state.js';
import { updateSalesforceCatalog } from './salesforce/salesforce_catalog_update.js';
import { useQueryExecutor } from './query_executor.js';
import { useLogger } from '../../../platform/logger/logger_provider.js';
import { createTrace } from '../../../platform/logger/trace_context.js';
import { updateInformationSchemaCatalog } from './catalog_query_information_schema.js';
import { useConnectionScriptsDispatch } from '../scripts/notebook_scripts_registry.js';
import { CATALOG_DID_UPDATE } from '../scripts/notebook_scripts.js';
import { updateHyperCatalog } from './hyper/hyper_catalog_update.js';

const LOG_CTX = 'catalog_loader';

const CATALOG_REFRESH_AFTER = 60 * 1000;
let NEXT_CATALOG_UPDATE_ID = 1;

/// The catalog update args
interface CatalogLoaderArgs { }
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

export function CatalogLoaderProvider(props: { children?: React.ReactElement }) {
    const logger = useLogger();
    const executor = useQueryExecutor();
    const sfapi = useSalesforceAPI();

    // The connection registry changes frequently, the connection map is stable.
    // This executor will depend on the map directly since it can resolve everything ad-hoc.
    const [connReg, connDispatch] = useDynamicConnectionDispatch();
    const connMap = connReg.connectionMap;
    const connScriptsDispatch = useConnectionScriptsDispatch();

    // Execute a query with pre-allocated query id
    const updateImpl = React.useCallback(async (connectionId: string, _args: CatalogLoaderArgs, updateId: number): Promise<void> => {
        // Each catalog update gets its own trace so failures don't borrow
        // whatever trace happens to be on a shared stack.
        const traced = logger.withTrace(createTrace());

        const conn = connMap.get(connectionId);
        if (!conn) {
            traced.warn("Failed to resolve connection", { connectionId }, LOG_CTX);
            throw new Error(`couldn't find a connection with id ${connectionId}`);
        }
        const notebookId = conn.notebookId;
        if (!executor) {
            traced.warn("Query executor not configured", { notebookId }, LOG_CTX);
            throw new Error(`couldn't find trino executor`);
        }

        traced.debug("Updating catalog", { notebookId }, LOG_CTX);

        // Accept the query and clear the request
        const abortController = new AbortController();
        const now = new Date();
        const initialState: CatalogUpdateTaskState = {
            taskId: updateId,
            taskVariant: CatalogUpdateVariant.FULL_CATALOG_REFRESH,
            status: CatalogUpdateTaskStatus.STARTED,
            cancellation: abortController,
            queries: [],
            error: null,
            startedAt: now,
            finishedAt: null,
            lastUpdateAt: now,
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
                notebookId,
                "updateId": updateId.toString(),
                "elapsedMs": elapsedMs.toFixed(0),
            }, LOG_CTX);
        }, 5000);

        // Update the catalog
        try {
            let partialError: Error | null = null;
            switch (conn.connectorInfo.catalogResolver) {
                // Update the catalog by querying the information_schema?
                case CatalogResolver.SQL_INFORMATION_SCHEMA: {
                    switch (conn.details.type) {
                        case TRINO_CONNECTOR: {
                            const catalog = conn.details.value.proto.setupParams?.catalogName ?? "";
                            const schemas = conn.details.value.proto.setupParams?.schemaNames ?? [];
                            await updateInformationSchemaCatalog(connectionId, connDispatch, updateId, catalog, schemas, executor, conn.catalog, conn.instance, conn.catalogRelationScript, conn.catalogFunctionScript);
                            break;
                        }
                        default:
                            throw new Error(
                                `cannot load information_schema catalog for ${conn.connectorInfo.names.displayShort} connections`,
                            );
                    }
                    break;
                }
                // Update the catalog by querying the pg_attribute?
                case CatalogResolver.SQL_PG_ATTRIBUTE: {
                    throw new Error(
                        `cannot load pg_attribute catalog for ${conn.connectorInfo.names.displayShort} connections`,
                    );
                }
                case CatalogResolver.SQL_HYPER: {
                    if (conn.details.type !== HYPER_CONNECTOR) {
                        throw new Error(
                            `cannot load Hyper catalog for ${conn.connectorInfo.names.displayShort} connections`,
                        );
                    }
                    const result = await updateHyperCatalog(
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
                        conn.catalogRelationScript,
                        conn.catalogFunctionScript,
                        abortController.signal,
                    );
                    if (result.failures.length > 0) {
                        partialError = new Error(result.failures
                            .map(failure => `${failure.database}: ${failure.error.message}`)
                            .join('; '));
                        traced.warn('Partially updated Hyper catalog', {
                            notebookId,
                            updated: result.updatedDatabases.join(', '),
                            failed: result.failures.map(failure => failure.database).join(', '),
                        }, LOG_CTX);
                    }
                    break;
                }
                // Update the catalog by querying the Salesforce Metadata Service?
                case CatalogResolver.SALESFORCE_METDATA_API: {
                    if (conn.details.type == SALESFORCE_DATA_CLOUD_CONNECTOR) {
                        const script = await updateSalesforceCatalog(
                            traced,
                            conn.details.value,
                            conn.catalog,
                            conn.instance,
                            conn.catalogRelationScript,
                            conn.catalogFunctionScript,
                            sfapi,
                            abortController,
                        );
                        if (conn.catalogRelationScript !== script) {
                            connDispatch(connectionId, {
                                type: SET_CATALOG_SCRIPT,
                                value: script
                            });
                        }
                        break;
                    } else {
                        throw new Error(
                            `cannot load salesforce metadata catalog for ${conn.connectorInfo.names.displayShort} connections`,
                        );
                    }
                }
                case CatalogResolver.SQL_SCRIPT:
                    break;
            }
            traced.debug("Updated catalog", { notebookId }, LOG_CTX);

            // Mark the update successful
            if (partialError == null) {
                connDispatch(connectionId, {
                    type: CATALOG_UPDATE_SUCCEEDED,
                    value: [updateId],
                });
            } else {
                connDispatch(connectionId, {
                    type: CATALOG_UPDATE_PARTIALLY_SUCCEEDED,
                    value: [updateId, partialError],
                });
            }
            // Mark all connection notebooks outdated
            connScriptsDispatch(connectionId, {
                type: CATALOG_DID_UPDATE,
                value: null,
            });

        } catch (e: any) {
            if (e?.name === 'AbortError') {
                traced.info("Cancelled catalog update", { notebookId, "error": e?.message ?? String(e) }, LOG_CTX);
                connDispatch(connectionId, {
                    type: CATALOG_UPDATE_CANCELLED,
                    value: [updateId, e],
                });
            } else {
                traced.error("Failed to update catalog", { notebookId, "error": e?.message ?? String(e) }, LOG_CTX);
                connDispatch(connectionId, {
                    type: CATALOG_UPDATE_FAILED,
                    value: [updateId, e],
                });
            }
        } finally {
            clearInterval(heartbeat);
            const totalMs = performance.now() - updateStartMs;
            traced.info("Finished catalog update", {
                notebookId,
                "updateId": updateId.toString(),
                "durationMs": totalMs.toFixed(0),
            }, LOG_CTX);
        }
    }, [connMap, sfapi, executor]);

    // Allocate the next query id and start the execution
    const update = React.useCallback<CatalogLoader>((connectionId: string, args: CatalogLoaderArgs): [number, Promise<void>] => {
        const updateId = NEXT_CATALOG_UPDATE_ID++;
        const execution = updateImpl(connectionId, args, updateId);
        return [updateId, execution];
    }, [updateImpl]);

    // Maintain a queue
    const [queueState, setQueueState] = React.useState<CatalogLoaderQueue>(() => ({ queue: new Map() }));
    const enqueue = React.useCallback<RefreshCatalogFn>((connectionId: string, force: boolean) => {
        setQueueState(s => ({ queue: s.queue.set(connectionId, force) }));
    }, []);

    // Subscribe the queue
    const updatesInProgress = React.useRef<Set<string> | null>(null);
    React.useEffect(() => {
        const inProgress = updatesInProgress.current ?? new Set();
        updatesInProgress.current = inProgress;

        // Helper to perform the catalog update
        const doUpdate = async (connectionId: string) => {
            inProgress.add(connectionId);
            try {
                logger.info("Starting catalog update", { connectionId }, LOG_CTX);
                // Otherwise start the catalog update
                const [_updateId, updatePromise] = update(connectionId, {});
                // Await the update
                await updatePromise;
            } catch (e: any) {
                logger.warn("Catalog update failed", { connectionId, "error": e?.message ?? String(e) }, LOG_CTX);
            }
            inProgress.delete(connectionId);
        };

        const processed: string[] = [];
        for (const [connectionId, force] of queueState.queue) {
            // Already updating?
            if (inProgress.has(connectionId)) {
                continue;
            }
            logger.debug("Received catalog update request", { connectionId }, LOG_CTX);

            // Find the connection
            const connState = connReg.connectionMap.get(connectionId);
            if (!connState) {
                logger.warn("Failed to resolve connection", { connectionId }, LOG_CTX);
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
                    task.cancellation.abort("superseded by forced catalog refresh");
                }
            }

            // Was the catalog restored from disk on notebook open?
            // Skip auto-refreshes so a saved catalog script isn't wiped by
            // an empty/erroring query right after opening the notebook.
            // Only an explicit (forced) refresh can replace a restored catalog.
            if (!force && connState.catalogUpdates.restoredAt != null) {
                logger.info("Skipping catalog update, catalog was restored from disk", {
                    connectionId,
                    "restoredAt": connState.catalogUpdates.restoredAt.toISOString(),
                }, LOG_CTX);
                processed.push(connectionId);
                continue;
            }

            // Was there a recent refresh?
            if (!force && connState.catalogUpdates.lastFullRefresh != null) {
                const refresh = connState.catalogUpdates.tasksRunning.get(connState.catalogUpdates.lastFullRefresh)
                    ?? connState.catalogUpdates.tasksFinished.get(connState.catalogUpdates.lastFullRefresh)
                    ?? null;
                if (refresh) {
                    const now = new Date();
                    const elapsed = (refresh.finishedAt?.getTime() ?? now.getTime()) - now.getTime();
                    if (elapsed < CATALOG_REFRESH_AFTER) {
                        logger.info("Skipping catalog update", {
                            "elapsed": elapsed.toString(),
                            "threshold": CATALOG_REFRESH_AFTER.toString()
                        }, LOG_CTX);
                        continue;
                    }
                }
            }

            // Perform the catalog update
            doUpdate(connectionId);
            processed.push(connectionId);
        }

        // No processed?
        if (processed.length == 0) {
            return;
        }

        // Remove all processed ids from the queue
        setQueueState(s => {
            // Remove
            for (const connectionId of processed) {
                s.queue.delete(connectionId)
            }
            return { ...s, queue: s.queue };
        });
    }, [queueState]);

    return (
        <LOADER_QUEUE_FN_CTX.Provider value={enqueue}>
            {props.children}
        </LOADER_QUEUE_FN_CTX.Provider>
    );
}
