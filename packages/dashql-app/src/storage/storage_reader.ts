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
import { AppLoadingProgress, AppLoadingProgressConsumer } from '../app_loading_progress.js';
import { ProgressCounter } from '../utils/progress.js';

const LOG_CTX = "storage_reader";

export interface RestoredAppState {
    /// The connection signatures
    connectionSignatures: ConnectionSignatureMap;
    /// The connection states
    connectionStates: Map<number, ConnectionState>;
    /// The workbook states
    workbookStates: Map<number, WorkbookState>;
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
    /// Get the number of stored workbook scripts
    async readWorkbookScriptCount(): Promise<number> {
        return await DB.workbookScripts.count();
    }
    /// Read all workbook scripts
    async readWorkbookScripts(): Promise<[number, number, string][]> {
        const scripts = await DB.workbookScripts.toArray();
        const parsed: [number, number, string][] = scripts
            .map(s => ([s.scriptId, s.workbookId, s.scriptText]));
        return parsed;
    }
    /// Restore the app state
    public async restoreAppState(instance: core.DashQL, notifyProgress: AppLoadingProgressConsumer): Promise<RestoredAppState> {
        const out: RestoredAppState = {
            connectionSignatures: new Map(),
            connectionStates: new Map(),
            workbookStates: new Map()
        };

        // First collect the counts
        const [
            connectionCount,
            catalogCount,
            workbookCount,
            scriptCount,
        ] = await Promise.all([
            this.readConnectionCount(),
            this.readConnectionCatalogCount(),
            this.readWorkbookCount(),
            this.readWorkbookScriptCount(),
        ]);

        // Publish the initial progress
        let progress: AppLoadingProgress = {
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
            out.connectionStates.set(cid, state);

            progress = {
                ...progress,
                restoreConnections: progress.restoreConnections
                    .clone()
                    .addSucceeded()
            };
            notifyProgress(progress);
        }

        // Read workbooks
        for (const [wid, cid, w] of await storedWorkbooks) {
            // Check if we know the connection
            const connection = out.connectionStates.get(cid);
            if (!connection) {
                throw new LoggableException("workbook refers to unknown connection", {
                    workbook: wid.toString(),
                    connection: cid.toString()
                }, LOG_CTX);
            }
            // Restore the workbook state
            const state = restoreWorkbookState(instance, wid, w, connection);
            // Register the workbook state
            out.workbookStates.set(wid, state);

            progress = {
                ...progress,
                restoreWorkbooks: progress.restoreWorkbooks
                    .clone()
                    .addSucceeded()
            };
            notifyProgress(progress);
        }

        // Read connection catalogs
        for (const [cid, c] of await storedCatalogs) {
            // Check if we know the connection
            const connection = out.connectionStates.get(cid);
            if (!connection) {
                throw new LoggableException("catalog refers to unknown connection", {
                    catalog: cid.toString(),
                }, LOG_CTX);
            }
            // Add schema descriptors to the catalog
            const schemaDescriptor = decodeCatalogFromProto(c);
            connection.catalog.addSchemaDescriptorsT(CATALOG_DEFAULT_DESCRIPTOR_POOL, schemaDescriptor);

            progress = {
                ...progress,
                restoreCatalogs: progress.restoreCatalogs
                    .clone()
                    .addSucceeded()
            };
            notifyProgress(progress);
        }

        // Read workbook scripts
        for (const [scriptId, workbookId, text] of await storedWorkbookScripts) {
            // Check if we know the connection
            const workbook = out.workbookStates.get(workbookId);
            if (!workbook) {
                throw new LoggableException("workbook script refers to unknown workbook", {
                    workbook: workbookId.toString(),
                    script: scriptId.toString()
                }, LOG_CTX);
            }

            // Restore the script data
            const scriptData = restoreWorkbookScript(instance, workbook, scriptId, text);
            workbook.scripts[scriptId] = scriptData;
        }

        // Analyze all workbooks
        for (const [_wid, w] of out.workbookStates) {
            const scriptCount = Object.keys(w.scripts).length;
            analyzeWorkbookScriptOnInitialLoad(w);

            progress = {
                ...progress,
                restoreWorkbooks: progress.restoreWorkbooks
                    .clone()
                    .addSucceeded()
            };
            notifyProgress(progress);
        }
        return out;
    }
}
