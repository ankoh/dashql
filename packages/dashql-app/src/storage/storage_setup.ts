import * as dexie from 'dexie';
import { type EntityTable, type Table } from 'dexie';

import { StoredConnection, StoredConnectionCatalog, StoredNotebook, StoredNotebookScript } from './storage_model.js';

const DATABASE_NAME = "DASHQL";
const DATABASE_VERSION_2 = 2;

export const DB = (new dexie.Dexie(DATABASE_NAME)) as dexie.Dexie & {
    /// The connections
    connections: EntityTable<StoredConnection, "connectionId">,
    /// The connection auth state
    connectionCatalogs: EntityTable<StoredConnectionCatalog, "connectionId">,
    /// The notebooks
    notebooks: EntityTable<StoredNotebook, "notebookId">,
    /// The notebook scripts
    notebookScripts: Table<StoredNotebookScript, [number, number]>,
};

DB.version(DATABASE_VERSION_2).stores({
    /// The connection config
    connections: "connectionId",
    /// The connection catalogs
    connectionCatalogs: "connectionId",
    /// The notebooks
    notebooks: "notebookId,connectionId",
    /// The notebook scripts
    notebookScripts: "[notebookId+scriptId]",
});


