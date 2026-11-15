import type { DashQLConnection } from './connection.js';
import type { DashQLStorageWriter } from './storage_writer.js';
import type * as glue from './wasm/dashql_core.js';

/// The views of the persistence of connections, declared by the module
/// (`packages/dashql-core-wasm/src/connection_persistence/view.rs`)
export type {
    CatalogUpdateFinalStatus,
    ConnectionCopyOutcome,
    ConnectionPersistenceChange,
    ConnectionSaveOutcome,
    PersistedConnectionFields,
} from './wasm/dashql_core.js';

/// The persistence of connections in the Rust runtime: what storage keeps of a connection and when it is written,
/// through a storage writer of the module
export const DashQLConnectionPersistence = {
    /// Schedule the writes after a change of a connection that the workbooks `workbookIds` reference. The id comes with
    /// the call, a connection that the app created holds none.
    scheduleWrites(writer: DashQLStorageWriter, connection: DashQLConnection, connectionId: string, prev: glue.PersistedConnectionFields, change: glue.ConnectionPersistenceChange, workbookIds: readonly string[]): void {
        writer.ptr.api.bindings.ConnectionPersistence.scheduleWrites(
            writer.ptr.assertNotNull(), connection.ptr.assertNotNull(), connectionId, prev, change, [...workbookIds]);
    },

    /// Schedule the writes of a deleted connection, an active one leaves the app manifest with its files
    scheduleDeleteWrites(writer: DashQLStorageWriter, connectionId: string, active: boolean): void {
        writer.ptr.api.bindings.ConnectionPersistence.scheduleDeleteWrites(writer.ptr.assertNotNull(), connectionId, active);
    },

    /// Save a connection: the given params, else its draft, else its params. The app manifest first, `commit` gets the
    /// saved params once it is written, then the copies of the workbooks.
    async save(writer: DashQLStorageWriter, connection: DashQLConnection, connectionId: string, saved: glue.JsonParams | null, workbookIds: readonly string[], commit: (params: glue.JsonParams) => void): Promise<glue.ConnectionSaveOutcome> {
        return await writer.ptr.api.bindings.ConnectionPersistence.save(
            writer.ptr.assertNotNull(), connection.ptr.assertNotNull(), connectionId, saved, [...workbookIds], commit);
    },

    /// Write the copies of the saved params of a connection into workbooks again
    async writeCopies(writer: DashQLStorageWriter, connectionId: string, params: glue.JsonValue, workbookIds: readonly string[]): Promise<glue.ConnectionCopyOutcome[]> {
        return await writer.ptr.api.bindings.ConnectionPersistence.writeCopies(writer.ptr.assertNotNull(), connectionId, params, [...workbookIds]);
    },
};
