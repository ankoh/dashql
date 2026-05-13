import * as React from 'react';

import { useDynamicConnectionDispatch } from './connection_registry.js';
import { CatalogUpdateTaskState, CatalogUpdateTaskStatus, CatalogUpdateVariant } from './catalog_update_state.js';
import { useSalesforceAPI } from './salesforce/salesforce_connector.js';
import { CatalogResolver, DATALESS_CONNECTOR, HYPER_CONNECTOR, SALESFORCE_DATA_CLOUD_CONNECTOR, TRINO_CONNECTOR } from './connector_info.js';
import {
    CATALOG_UPDATE_CANCELLED,
    CATALOG_UPDATE_FAILED,
    CATALOG_UPDATE_SUCCEEDED,
    SET_CATALOG_SCRIPT,
    UPDATE_CATALOG,
} from './connection_state.js';
import { updateSalesforceCatalog } from './salesforce/salesforce_catalog_update.js';
import { useQueryExecutor } from './query_executor.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { createTrace } from '../platform/logger/trace_context.js';
import { updateInformationSchemaCatalog } from './catalog_query_information_schema.js';
import { updatePgCatalog } from './catalog_query_pg_attribute.js';
import { updateDemoSchemaCatalog } from './dataless/dataless_demo_catalog.js';
import { useConnectionNotebookDispatch } from '../notebook/notebook_state_registry.js';
import { CATALOG_DID_UPDATE } from '../notebook/notebook_state.js';

const LOG_CTX = 'catalog_loader';

const CATALOG_REFRESH_AFTER = 60 * 1000;
let NEXT_CATALOG_UPDATE_ID = 1;

/// The catalog update args
interface CatalogLoaderArgs { }
/// The catalog updater function
export type CatalogLoader = (sessionId: string, args: CatalogLoaderArgs) => [number, Promise<void>];
/// A function to add a session id to a catalog loader queue
type RefreshCatalogFn = (sessionId: string, force: boolean) => void;
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
    const connNotebookDispatch = useConnectionNotebookDispatch();

    // Execute a query with pre-allocated query id
    const updateImpl = React.useCallback(async (sessionId: string, _args: CatalogLoaderArgs, updateId: number): Promise<void> => {
        // Each catalog update gets its own trace so failures don't borrow
        // whatever trace happens to be on a shared stack.
        const traced = logger.withTrace(createTrace());

        // Check if we know the session id.
        const conn = connMap.get(sessionId);
        if (!conn) {
            traced.error("Failed to resolve connection", { "session": sessionId }, LOG_CTX);
            throw new Error(`couldn't find a connection with session id ${sessionId}`);
        }
        if (!executor) {
            traced.error("Query executor not configured", { "session": sessionId }, LOG_CTX);
            throw new Error(`couldn't find trino executor`);
        }

        traced.debug("Updating catalog", { "session": sessionId }, LOG_CTX);

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
        connDispatch(sessionId, {
            type: UPDATE_CATALOG,
            value: [updateId, initialState],
        });

        // Emit a heartbeat log every few seconds so long-running updates
        // don't look like a silent hang between "Starting" and "Updated".
        const updateStartMs = performance.now();
        const heartbeat = setInterval(() => {
            const elapsedMs = performance.now() - updateStartMs;
            traced.info("Catalog update in progress", {
                "session": sessionId,
                "updateId": updateId.toString(),
                "elapsedMs": elapsedMs.toFixed(0),
            }, LOG_CTX);
        }, 5000);

        // Update the catalog
        try {
            switch (conn.connectorInfo.catalogResolver) {
                // Update the catalog by querying the information_schema?
                case CatalogResolver.SQL_INFORMATION_SCHEMA: {
                    switch (conn.details.type) {
                        case TRINO_CONNECTOR: {
                            const catalog = conn.details.value.proto.setupParams?.catalogName ?? "";
                            const schemas = conn.details.value.proto.setupParams?.schemaNames ?? [];
                            await updateInformationSchemaCatalog(sessionId, connDispatch, updateId, catalog, schemas, executor, conn.catalog, conn.instance, conn.catalogRelationScript, conn.catalogFunctionScript);
                            break;
                        }
                        case DATALESS_CONNECTOR: {
                            await updateDemoSchemaCatalog(sessionId, connDispatch, updateId, conn.catalog, conn.instance, conn.catalogRelationScript, conn.catalogFunctionScript);
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
                    if (conn.details.type == HYPER_CONNECTOR) {
                        const databaseName = ""; // XXX: Get from Hyper connection details
                        const schemas: string[] = []; // XXX
                        await updatePgCatalog(sessionId, connDispatch, updateId, databaseName, schemas, executor, conn.catalog, conn.instance, conn.catalogRelationScript, conn.catalogFunctionScript);
                    } else {
                        throw new Error(
                            `cannot load pg_attribute catalog for ${conn.connectorInfo.names.displayShort} connections`,
                        );
                    }
                    break;
                }
                // Update the catalog by querying the Salesforce Metadata Service?
                case CatalogResolver.SALESFORCE_METDATA_API: {
                    if (conn.details.type == SALESFORCE_DATA_CLOUD_CONNECTOR) {
                        const script = await updateSalesforceCatalog(conn.details.value, conn.catalog, conn.instance, conn.catalogRelationScript, sfapi, abortController);
                        if (conn.catalogRelationScript !== script) {
                            connDispatch(sessionId, {
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
            traced.debug("Updated catalog", { "session": sessionId }, LOG_CTX);

            // Mark the update successful
            connDispatch(sessionId, {
                type: CATALOG_UPDATE_SUCCEEDED,
                value: [updateId],
            });
            // Mark all connection notebooks outdated
            connNotebookDispatch(sessionId, {
                type: CATALOG_DID_UPDATE,
                value: null,
            });

        } catch (e: any) {
            if (e?.name === 'AbortError') {
                traced.error("Cancelled catalog update", { "session": sessionId, "error": e?.message ?? String(e) }, LOG_CTX);
                connDispatch(sessionId, {
                    type: CATALOG_UPDATE_CANCELLED,
                    value: [updateId, e],
                });
            } else {
                traced.error("Failed to update catalog", { "session": sessionId, "error": e?.message ?? String(e) }, LOG_CTX);
                console.error(e);
                connDispatch(sessionId, {
                    type: CATALOG_UPDATE_FAILED,
                    value: [updateId, e],
                });
            }
        } finally {
            clearInterval(heartbeat);
            const totalMs = performance.now() - updateStartMs;
            traced.info("Finished catalog update", {
                "session": sessionId,
                "updateId": updateId.toString(),
                "durationMs": totalMs.toFixed(0),
            }, LOG_CTX);
        }
    }, [connMap, sfapi, executor]);

    // Allocate the next query id and start the execution
    const update = React.useCallback<CatalogLoader>((sessionId: string, args: CatalogLoaderArgs): [number, Promise<void>] => {
        const updateId = NEXT_CATALOG_UPDATE_ID++;
        const execution = updateImpl(sessionId, args, updateId);
        return [updateId, execution];
    }, [updateImpl]);

    // Maintain a queue
    const [queueState, setQueueState] = React.useState<CatalogLoaderQueue>(() => ({ queue: new Map() }));
    const enqueue = React.useCallback<RefreshCatalogFn>((sid: string, force: boolean) => {
        setQueueState(s => ({ queue: s.queue.set(sid, force) }));
    }, []);

    // Subscribe the queue
    const updatesInProgress = React.useRef<Set<string> | null>(null);
    React.useEffect(() => {
        const inProgress = updatesInProgress.current ?? new Set();

        // Helper to perform the catalog update
        const doUpdate = async (sessionId: string) => {
            inProgress.add(sessionId);
            try {
                logger.info("Starting catalog update", { "session": sessionId }, LOG_CTX);
                // Otherwise start the catalog update
                const [_updateId, updatePromise] = update(sessionId, {});
                // Await the update
                await updatePromise;
            } catch (e: any) {
                logger.warn("Catalog update failed", { "session": sessionId, "error": e?.message ?? String(e) }, LOG_CTX);
            }
            inProgress.delete(sessionId);
        };

        const processed: string[] = [];
        for (const [sessionId, force] of queueState.queue) {
            // Already updating?
            if (inProgress.has(sessionId)) {
                continue;
            }
            logger.debug("Received catalog update request", { "session": sessionId }, LOG_CTX);

            // Find the connection
            const connState = connReg.connectionMap.get(sessionId);
            if (!connState) {
                logger.warn("Failed to resolve connection", { "session": sessionId }, LOG_CTX);
                continue;
            }

            // Has a current catalog update running?
            // Skip auto-updates, but let explicit user refreshes supersede
            // the in-flight ones by aborting them first.
            if (connState.catalogUpdates.tasksRunning.size > 0) {
                if (!force) {
                    logger.info("Skipping redundant catalog update", { "session": sessionId }, LOG_CTX);
                    continue;
                }
                for (const task of connState.catalogUpdates.tasksRunning.values()) {
                    task.cancellation.abort("superseded by forced catalog refresh");
                }
            }

            // Was the catalog restored from disk on session open?
            // Skip auto-refreshes so a saved catalog script isn't wiped by
            // an empty/erroring query right after opening the session.
            // Only an explicit (forced) refresh can replace a restored catalog.
            if (!force && connState.catalogUpdates.restoredAt != null) {
                logger.info("Skipping catalog update, catalog was restored from disk", {
                    "session": sessionId,
                    "restoredAt": connState.catalogUpdates.restoredAt.toISOString(),
                }, LOG_CTX);
                processed.push(sessionId);
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
            doUpdate(sessionId);
            // Remember that we processed the session id
            processed.push(sessionId);
        }

        // No processed?
        if (processed.length == 0) {
            return;
        }

        // Remove all processed ids from the queue
        setQueueState(s => {
            // Remove
            for (const sessionId of processed) {
                s.queue.delete(sessionId)
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
