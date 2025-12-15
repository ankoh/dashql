import * as core from '@ankoh/dashql-core';
import * as proto from '@ankoh/dashql-protobuf';
import * as buf from "@bufbuild/protobuf";

import { LoggableException, Logger } from '../platform/logger.js';
import { DB } from './storage_setup.js';
import { WorkbookState } from '../workbook/workbook_state.js';
import { ConnectionState } from '../connection/connection_state.js';
import { decodeConnectionFromProto, restoreConnectionState } from '../connection/connection_import.js';
import { ConnectionSignatureMap } from '../connection/connection_signature.js';
import { restoreWorkbookScript, restoreWorkbookState } from '../workbook/workbook_import.js';
import { decodeCatalogFromProto } from '../connection/catalog_import.js';
import { CATALOG_DEFAULT_DESCRIPTOR_POOL } from '../connection/catalog_update_state.js';

const LOG_CTX = "storage_reader";

export class StorageReader {
    /// The logger
    logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /// Wait until the initial state was restored
    async waitForInitialRestore() {
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
    async readWorkbookScripts(): Promise<[number, number, string][]> {
        const scripts = await DB.workbookScripts.toArray();
        const parsed: [number, number, string][] = scripts
            .map(s => ([s.scriptId, s.workbookId, s.scriptText]));
        return parsed;
    }

    async restoreAppState(instance: core.DashQL) {
        // Read the different tables
        const storedConns = this.readConnections();
        const storedCatalogs = this.readConnectionCatalogs();
        const storedWorkbooks = this.readWorkbooks();
        const storedWorkbookScripts = this.readWorkbookScripts();

        const connSigs: ConnectionSignatureMap = new Map();
        const connectionStates = new Map<number, ConnectionState>();
        const workbookStates = new Map<number, WorkbookState>();

        // Read connections
        for (const [cid, c] of await storedConns) {
            // First read the connection details from the protobuf
            const [connInfo, connDetails] = decodeConnectionFromProto(c, cid);
            // Restore the connection state
            const state = restoreConnectionState(instance, cid, connInfo, connDetails, connSigs);
            // Register the connection state
            connectionStates.set(cid, state);
        }

        // Read workbooks
        for (const [wid, cid, w] of await storedWorkbooks) {
            // Check if we know the connection
            const connection = connectionStates.get(cid);
            if (!connection) {
                throw new LoggableException("workbook refers to unknown connection", {
                    workbook: wid.toString(),
                    connection: cid.toString()
                }, LOG_CTX);
            }
            // Restore the workbook state
            const state = restoreWorkbookState(instance, wid, w, connection);
            // Register the workbook state
            workbookStates.set(wid, state);
        }

        // Read workbook scripts
        for (const [scriptId, workbookId, text] of await storedWorkbookScripts) {
            // Check if we know the connection
            const workbook = workbookStates.get(workbookId);
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

        // Read connection catalogs
        for (const [cid, c] of await storedCatalogs) {
            // Check if we know the connection
            const connection = connectionStates.get(cid);
            if (!connection) {
                throw new LoggableException("catalog refers to unknown connection", {
                    catalog: cid.toString(),
                }, LOG_CTX);
            }
            // Add schema descriptors to the catalog
            const schemaDescriptor = decodeCatalogFromProto(c);
            connection.catalog.addSchemaDescriptorsT(CATALOG_DEFAULT_DESCRIPTOR_POOL, schemaDescriptor);
        }
    }
}
