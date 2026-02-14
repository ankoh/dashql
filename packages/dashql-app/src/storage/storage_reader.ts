import * as core from '@ankoh/dashql-core';
import * as proto from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import { LoggableException, Logger } from '../platform/logger.js';
import { DB } from './storage_setup.js';
import { NotebookState } from '../notebook/notebook_state.js';
import { ConnectionState } from '../connection/connection_state.js';
import { decodeConnectionFromProto, restoreConnectionState } from '../connection/connection_import.js';
import { ConnectionSignatureMap } from '../connection/connection_signature.js';
import { analyzeNotebookScriptOnInitialLoad, restoreNotebookScript, restoreNotebookState } from '../notebook/notebook_import.js';
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
    /// The notebook states
    notebooks: Map<number, NotebookState>;
    /// The notebooks by connection type
    notebooksByConnection: Map<number, number[]>;
    /// The notebooks by connection type
    notebooksByConnectionType: number[][];
    /// The maximum connection id
    maxConnectionId: number;
    /// The maximum notebook id
    maxNotebookId: number;
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
    /// Get the number of stored notebooks
    async readNotebookCount(): Promise<number> {
        return await DB.notebooks.count();
    }
    /// Read all notebooks
    async readNotebooks(): Promise<[number, number, proto.dashql.notebook.Notebook][]> {
        const notebooks = await DB.notebooks.toArray();
        const parsed: [number, number, proto.dashql.notebook.Notebook][] = [];
        for (const w of notebooks) {
            const catalog = buf.fromBinary(proto.dashql.notebook.NotebookSchema, w.notebookProto);
            parsed.push([w.notebookId, w.connectionId, catalog]);
        }
        return parsed;
    }
    /// Read all notebook scripts
    async readNotebookScripts(): Promise<[number, number, proto.dashql.notebook.NotebookScript][]> {
        const scripts = await DB.notebookScripts.toArray();
        const parsed: [number, number, proto.dashql.notebook.NotebookScript][] = [];
        for (const s of scripts) {
            const script = buf.fromBinary(proto.dashql.notebook.NotebookScriptSchema, s.scriptProto);
            parsed.push([s.notebookId, s.scriptId, script]);
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
            notebooks: new Map(),
            notebooksByConnection: new Map(),
            notebooksByConnectionType: CONNECTOR_TYPES.map(() => []),
            maxNotebookId: 1,
        };

        // First collect the counts
        const [
            connectionCount,
            catalogCount,
            notebookCount,
        ] = await Promise.all([
            this.readConnectionCount(),
            this.readConnectionCatalogCount(),
            this.readNotebookCount(),
        ]);

        // Publish the initial progress
        let progress = {
            restoreConnections: new ProgressCounter(connectionCount),
            restoreCatalogs: new ProgressCounter(catalogCount),
            restoreNotebooks: new ProgressCounter(notebookCount),
        };
        progress.restoreConnections = progress.restoreConnections.addStarted(connectionCount);
        progress.restoreCatalogs = progress.restoreCatalogs.addStarted(catalogCount);
        progress.restoreNotebooks = progress.restoreNotebooks.addStarted(notebookCount);
        notifyProgress(progress);

        // Read the different tables
        const storedConns = this.readConnections();
        const storedCatalogs = this.readConnectionCatalogs();
        const storedNotebooks = this.readNotebooks();
        const storedNotebookScripts = this.readNotebookScripts();

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
            out.maxConnectionId = Math.max(out.maxNotebookId, cid);

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

        // Read notebooks
        for (const [wid, cid, w] of await storedNotebooks) {
            // Check if we know the connection
            const connection = out.connectionStates.get(cid);
            if (!connection) {
                this.logger.warn("notebook refers to unknown connection", {
                    notebook: wid.toString(),
                    connection: cid.toString()
                }, LOG_CTX);
                progress = {
                    ...progress,
                    restoreNotebooks: progress.restoreNotebooks
                        .clone()
                        .addSkipped()
                };
                notifyProgress(progress);
                continue;
            }
            // Restore the notebook state
            const state = restoreNotebookState(instance, wid, w, connection);
            // Register the notebook state
            if (out.notebooks.has(cid)) {
                this.logger.warn("detected notebook with duplicate id", {
                    notebook: wid.toString(),
                    connection: cid.toString(),
                }, LOG_CTX);
                progress = {
                    ...progress,
                    restoreNotebooks: progress.restoreNotebooks
                        .clone()
                        .addFailed()
                };
                notifyProgress(progress);
                continue;
            }
            out.maxNotebookId = Math.max(out.maxNotebookId, wid);

            // Never restore demo notebooks from disk
            if (state.connectorInfo.connectorType == ConnectorType.DEMO) {
                this.logger.warn("refused to read a demo notebook", {
                    notebook: wid.toString(),
                    connection: cid.toString(),
                }, LOG_CTX);
                progress = {
                    ...progress,
                    restoreNotebooks: progress.restoreNotebooks
                        .clone()
                        .addSkipped()
                };
                notifyProgress(progress);
            } else {
                out.notebooks.set(wid, state);
                out.notebooksByConnectionType[state.connectorInfo.connectorType].push(wid);
                let byConn = out.notebooksByConnection.get(cid) ?? [];
                byConn.push(wid);
                out.notebooksByConnection.set(cid, byConn);

                // Succeeded will be bumped once we loaded the scripts
            }
        }
        this.logger.info("restored notebooks", {
            total: (progress.restoreNotebooks.total ?? 0).toString(),
            succeeded: progress.restoreNotebooks.succeeded.toString(),
            skipped: progress.restoreNotebooks.skipped.toString(),
            failed: progress.restoreNotebooks.failed.toString(),
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
                connection.catalogUpdates = {
                    ...connection.catalogUpdates,
                    restoredAt: new Date(),
                };
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

        // Read notebook scripts
        for (const [notebookId, scriptId, scriptProto] of await storedNotebookScripts) {
            // Check if we know the connection
            const notebook = out.notebooks.get(notebookId);
            if (!notebook) {
                this.logger.error("notebook script refers to unknown notebook", {
                    notebook: notebookId.toString(),
                    script: scriptId.toString()
                }, LOG_CTX);
                progress = {
                    ...progress,
                    restoreNotebooks: progress.restoreCatalogs
                        .clone()
                        .addFailed()
                };
                notifyProgress(progress);
                continue;
            }
            // Collision on script id in the notebook?
            if (notebook.scripts[scriptId] !== undefined) {
                this.logger.error("detected script with duplicate id", {
                    notebook: notebookId.toString(),
                    script: scriptId.toString()
                }, LOG_CTX);
                progress = {
                    ...progress,
                    restoreNotebooks: progress.restoreCatalogs
                        .clone()
                        .addFailed()
                };
                notifyProgress(progress);
                continue;
            }
            // Restore the script data
            const scriptData = restoreNotebookScript(instance, notebook, scriptId, scriptProto);
            notebook.scripts[scriptId] = scriptData;
            notebook.nextScriptKey = Math.max(notebook.nextScriptKey, scriptId + 1);
        }

        // Analyze all notebooks
        for (const [_wid, w] of out.notebooks) {
            try {
                analyzeNotebookScriptOnInitialLoad(w, this.logger);
                progress = {
                    ...progress,
                    restoreNotebooks: progress.restoreNotebooks
                        .clone()
                        .addSucceeded()
                };
            } catch (e: any) {
                this.logger.exception(e)

                progress = {
                    ...progress,
                    restoreNotebooks: progress.restoreNotebooks
                        .clone()
                        .addFailed()
                };
            }
            notifyProgress(progress);
        }
        return out;
    }
}
