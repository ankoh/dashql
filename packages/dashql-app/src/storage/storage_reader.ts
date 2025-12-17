import * as core from '@ankoh/dashql-core';
import * as proto from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import { LoggableException, Logger } from '../platform/logger.js';
import { DB } from './storage_setup.js';
import { WorkbookState } from '../workbook/workbook_state.js';
import { ConnectionState } from '../connection/connection_state.js';
import { decodeConnectionFromProto, restoreConnectionState } from '../connection/connection_import.js';
import { ConnectionSignatureMap } from '../connection/connection_signature.js';
import { analyzeWorkbookScriptOnInitialLoad, restoreWorkbookScript, restoreWorkbookState } from '../workbook/workbook_import.js';
import { decodeCatalogFromProto } from '../connection/catalog_import.js';
import { CATALOG_DEFAULT_DESCRIPTOR_POOL } from '../connection/catalog_update_state.js';
import { AppLoadingPartialProgressConsumer } from '../app_loading_progress.js';
import { ProgressCounter } from '../utils/progress.js';
import { CONNECTOR_TYPES, ConnectorType } from '../connection/connector_info.js';

const LOG_CTX = "storage_reader";

export interface RestoredAppState {
    /// The connection signatures
    connectionSignatures: ConnectionSignatureMap;
    /// The connection states
    connectionStates: Map<number, ConnectionState>;
    /// The connection states by type
    connectionStatesByType: number[][];
    /// The workbook states
    workbooks: Map<number, WorkbookState>;
    /// The workbooks by connection type
    workbooksByConnection: Map<number, number[]>;
    /// The workbooks by connection type
    workbooksByConnectionType: number[][];
    /// The maximum connection id
    maxConnectionId: number;
    /// The maximum workbook id
    maxWorkbookId: number;
}

export class StorageReader {
    /// The logger
    logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /// Wait until the initial state was restored
    async waitForInitialRestore() {
    }

    /// Get the number of stored connections
    async readConnectionCount(): Promise<number> {
        return await DB.connections.count();
    }
    /// Read all connections
    async readConnections(): Promise<[number, proto.dashql.connection.Connection][]> {
        const stored = await DB.connections.toArray();
        const parsed: [number, proto.dashql.connection.Connection][] = [];
        for (const c of stored) {
            const conn = buf.fromBinary(proto.dashql.connection.ConnectionSchema, c.connectionProto);
            parsed.push([c.connectionId, conn]);
        }
        return parsed;
    }
    /// Get the number of stored connection catalogs
    async readConnectionCatalogCount(): Promise<number> {
        return await DB.connectionCatalogs.count();
    }
    /// Read all catalogs
    async readConnectionCatalogs(): Promise<[number, proto.dashql.catalog.Catalog][]> {
        const catalogs = await DB.connectionCatalogs.toArray();
        const parsed: [number, proto.dashql.catalog.Catalog][] = [];
        for (const c of catalogs) {
            const catalog = buf.fromBinary(proto.dashql.catalog.CatalogSchema$, c.catalogProto);
            parsed.push([c.connectionId, catalog]);
        }
        return parsed;
    }
    /// Get the number of stored workbooks
    async readWorkbookCount(): Promise<number> {
        return await DB.workbooks.count();
    }
    /// Read all workbooks
    async readWorkbooks(): Promise<[number, number, proto.dashql.workbook.Workbook][]> {
        const workbooks = await DB.workbooks.toArray();
        const parsed: [number, number, proto.dashql.workbook.Workbook][] = [];
        for (const w of workbooks) {
            const catalog = buf.fromBinary(proto.dashql.workbook.WorkbookSchema, w.workbookProto);
            parsed.push([w.workbookId, w.connectionId, catalog]);
        }
        return parsed;
    }
    /// Read all workbook scripts
    async readWorkbookScripts(): Promise<[number, number, proto.dashql.workbook.WorkbookScript][]> {
        const scripts = await DB.workbookScripts.toArray();
        const parsed: [number, number, proto.dashql.workbook.WorkbookScript][] = [];
        for (const s of scripts) {
            const script = buf.fromBinary(proto.dashql.workbook.WorkbookScriptSchema, s.scriptProto);
            parsed.push([s.workbookId, s.scriptId, script]);
        }
        return parsed;
    }
    /// Restore the app state
    public async restoreAppState(instance: core.DashQL, notifyProgress: AppLoadingPartialProgressConsumer, _abort?: AbortSignal): Promise<RestoredAppState> {
        const out: RestoredAppState = {
            connectionSignatures: new Map(),
            connectionStates: new Map(),
            connectionStatesByType: CONNECTOR_TYPES.map(() => []),
            maxConnectionId: 1,
            workbooks: new Map(),
            workbooksByConnection: new Map(),
            workbooksByConnectionType: CONNECTOR_TYPES.map(() => []),
            maxWorkbookId: 1,
        };

        // First collect the counts
        const [
            connectionCount,
            catalogCount,
            workbookCount,
        ] = await Promise.all([
            this.readConnectionCount(),
            this.readConnectionCatalogCount(),
            this.readWorkbookCount(),
        ]);

        // Publish the initial progress
        let progress = {
            restoreConnections: new ProgressCounter(connectionCount),
            restoreCatalogs: new ProgressCounter(catalogCount),
            restoreWorkbooks: new ProgressCounter(workbookCount),
        };
        progress.restoreConnections = progress.restoreConnections.addStarted(connectionCount);
        progress.restoreCatalogs = progress.restoreCatalogs.addStarted(catalogCount);
        progress.restoreWorkbooks = progress.restoreWorkbooks.addStarted(workbookCount);
        notifyProgress(progress);

        // Read the different tables
        const storedConns = this.readConnections();
        const storedCatalogs = this.readConnectionCatalogs();
        const storedWorkbooks = this.readWorkbooks();
        const storedWorkbookScripts = this.readWorkbookScripts();

        // Read connections
        for (const [cid, c] of await storedConns) {
            // First read the connection details from the protobuf
            const [connInfo, connDetails] = decodeConnectionFromProto(c, cid);
            // Restore the connection state
            const state = restoreConnectionState(instance, cid, connInfo, connDetails, out.connectionSignatures);
            // Register the connection state
            if (out.connectionStates.has(cid)) {
                throw new LoggableException("detected connection with duplicate id", {
                    connection: cid.toString()
                }, LOG_CTX);
            }
            out.maxConnectionId = Math.max(out.maxWorkbookId, cid);

            // Never restore demo connections from disk
            if (state.connectorInfo.connectorType == ConnectorType.DEMO) {
                this.logger.warn("refused to restore a demo connection", {
                    connection: cid.toString(),
                }, LOG_CTX);
                progress = {
                    ...progress,
                    restoreConnections: progress.restoreConnections
                        .clone()
                        .addSkipped()
                };
            } else {
                out.connectionStates.set(cid, state);
                out.connectionStatesByType[connInfo.connectorType].push(cid);
                progress = {
                    ...progress,
                    restoreConnections: progress.restoreConnections
                        .clone()
                        .addSucceeded()
                };
            }
            notifyProgress(progress);
        }
        this.logger.info("restored connections", {
            total: (progress.restoreConnections.total ?? 0).toString(),
            succeeded: progress.restoreConnections.succeeded.toString(),
            skipped: progress.restoreConnections.skipped.toString(),
            failed: progress.restoreConnections.failed.toString(),
        }, LOG_CTX);

        // Read workbooks
        for (const [wid, cid, w] of await storedWorkbooks) {
            // Check if we know the connection
            const connection = out.connectionStates.get(cid);
            if (!connection) {
                this.logger.warn("workbook refers to unknown connection", {
                    workbook: wid.toString(),
                    connection: cid.toString()
                }, LOG_CTX);
                progress = {
                    ...progress,
                    restoreWorkbooks: progress.restoreWorkbooks
                        .clone()
                        .addSkipped()
                };
                notifyProgress(progress);
                continue;
            }
            // Restore the workbook state
            const state = restoreWorkbookState(instance, wid, w, connection);
            // Register the workbook state
            if (out.workbooks.has(cid)) {
                this.logger.warn("detected workbook with duplicate id", {
                    workbook: wid.toString(),
                    connection: cid.toString(),
                }, LOG_CTX);
                progress = {
                    ...progress,
                    restoreWorkbooks: progress.restoreWorkbooks
                        .clone()
                        .addFailed()
                };
                notifyProgress(progress);
                continue;
            }
            out.maxWorkbookId = Math.max(out.maxWorkbookId, wid);

            // Never restore demo workbooks from disk
            if (state.connectorInfo.connectorType == ConnectorType.DEMO) {
                this.logger.warn("refused to read a demo workbook", {
                    workbook: wid.toString(),
                    connection: cid.toString(),
                }, LOG_CTX);
                progress = {
                    ...progress,
                    restoreWorkbooks: progress.restoreWorkbooks
                        .clone()
                        .addSkipped()
                };
                notifyProgress(progress);
            } else {
                out.workbooks.set(wid, state);
                out.workbooksByConnectionType[state.connectorInfo.connectorType].push(wid);
                let byConn = out.workbooksByConnection.get(cid) ?? [];
                byConn.push(wid);
                out.workbooksByConnection.set(cid, byConn);

                // Succeeded will be bumped once we loaded the scripts
            }
        }
        this.logger.info("restored workbooks", {
            total: (progress.restoreWorkbooks.total ?? 0).toString(),
            succeeded: progress.restoreWorkbooks.succeeded.toString(),
            skipped: progress.restoreWorkbooks.skipped.toString(),
            failed: progress.restoreWorkbooks.failed.toString(),
        }, LOG_CTX);

        // Read connection catalogs
        for (const [cid, c] of await storedCatalogs) {
            // Check if we know the connection
            const connection = out.connectionStates.get(cid);
            if (!connection) {
                this.logger.warn("catalog refers to unknown connection", {
                    connection: cid.toString()
                }, LOG_CTX);
                progress = {
                    ...progress,
                    restoreCatalogs: progress.restoreCatalogs
                        .clone()
                        .addSkipped()
                };
            } else {
                // Add schema descriptors to the catalog
                const schemaDescriptor = decodeCatalogFromProto(c);
                connection.catalog.addSchemaDescriptorsT(CATALOG_DEFAULT_DESCRIPTOR_POOL, schemaDescriptor);
                progress = {
                    ...progress,
                    restoreCatalogs: progress.restoreCatalogs
                        .clone()
                        .addSucceeded()
                };
            }
            notifyProgress(progress);
        }
        this.logger.info("restored catalogs", {
            total: (progress.restoreCatalogs.total ?? 0).toString(),
            succeeded: progress.restoreCatalogs.succeeded.toString(),
            skipped: progress.restoreCatalogs.skipped.toString(),
            failed: progress.restoreCatalogs.failed.toString(),
        }, LOG_CTX);

        // Read workbook scripts
        for (const [workbookId, scriptId, scriptProto] of await storedWorkbookScripts) {
            // Check if we know the connection
            const workbook = out.workbooks.get(workbookId);
            if (!workbook) {
                this.logger.error("workbook script refers to unknown workbook", {
                    workbook: workbookId.toString(),
                    script: scriptId.toString()
                }, LOG_CTX);
                progress = {
                    ...progress,
                    restoreWorkbooks: progress.restoreCatalogs
                        .clone()
                        .addFailed()
                };
                notifyProgress(progress);
                continue;
            }
            // Collision on script id in the workbook?
            if (workbook.scripts[scriptId] !== undefined) {
                this.logger.error("detected script with duplicate id", {
                    workbook: workbookId.toString(),
                    script: scriptId.toString()
                }, LOG_CTX);
                progress = {
                    ...progress,
                    restoreWorkbooks: progress.restoreCatalogs
                        .clone()
                        .addFailed()
                };
                notifyProgress(progress);
                continue;
            }
            // Restore the script data
            const scriptData = restoreWorkbookScript(instance, workbook, scriptId, scriptProto);
            workbook.scripts[scriptId] = scriptData;
            workbook.nextScriptKey = Math.max(workbook.nextScriptKey, scriptId + 1);
        }

        // Analyze all workbooks
        for (const [_wid, w] of out.workbooks) {
            try {
                analyzeWorkbookScriptOnInitialLoad(w, this.logger);
                progress = {
                    ...progress,
                    restoreWorkbooks: progress.restoreWorkbooks
                        .clone()
                        .addSucceeded()
                };
            } catch (e: any) {
                this.logger.exception(e)

                progress = {
                    ...progress,
                    restoreWorkbooks: progress.restoreWorkbooks
                        .clone()
                        .addFailed()
                };
            }
            notifyProgress(progress);
        }
        return out;
    }
}
