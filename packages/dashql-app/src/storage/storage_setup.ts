import * as dexie from 'dexie';
import { type EntityTable, type Table } from 'dexie';

import { StoredConnection, StoredConnectionCatalog, StoredWorkbook, StoredWorkbookScript } from './storage_model.js';

const DATABASE_NAME = "DASHQL";
const DATABASE_VERSION_2 = 2;

export const DB = (new dexie.Dexie(DATABASE_NAME)) as dexie.Dexie & {
    /// The connections
    connections: EntityTable<StoredConnection, "connectionId">,
    /// The connection auth state
    connectionCatalogs: EntityTable<StoredConnectionCatalog, "connectionId">,
    /// The workbooks
    workbooks: EntityTable<StoredWorkbook, "workbookId">,
    /// The workbook scripts
    workbookScripts: Table<StoredWorkbookScript, [number, number]>,
};

DB.version(DATABASE_VERSION_2).stores({
    /// The connection config
    connections: "connectionId",
    /// The connection catalogs
    connectionCatalogs: "connectionId",
    /// The workbooks
    workbooks: "workbookId,connectionId",
    /// The workbook scripts
    workbookScripts: "[workbookId+scriptId]",
});


