import type { DashQLConnection } from './connection.js';
import type { DashQLStorageWriter, StorageWriteOutcome } from './storage_writer.js';

/// What storage keeps of a connection, the fields before a change decide whether the change is written
export interface PersistedConnectionFields {
    active: boolean;
    params: unknown;
    paramsDraft?: unknown;
    name?: string | null;
    cacheQueryResults?: boolean | null;
}

/// What changed a connection
export type ConnectionPersistenceChange =
    | { type: 'other' | 'paramsCommitted' | 'relationsTouched' }
    /// A catalog update finished, a lookup that changed nothing (`changed` false) has nothing to save
    | { type: 'catalogUpdateFinished'; taskId: number; status: 'succeeded' | 'partiallySucceeded' | 'failed' | 'cancelled'; changed?: boolean };

/// The outcome of writing the copy of a connection into a workbook
export interface ConnectionCopyOutcome {
    workbookId: string;
    result: StorageWriteOutcome;
}

/// The outcome of saving a connection
export interface ConnectionSaveOutcome {
    /// The saved params
    params: unknown;
    /// The outcome of writing the app manifest
    manifest: StorageWriteOutcome;
    /// The outcomes of writing the copies of the workbooks, none if the manifest wasn't written
    workbooks: ConnectionCopyOutcome[];
}

/// The persistence of connections in the Rust runtime: what storage keeps of a connection and when it is written,
/// through a storage writer of the module
export const DashQLConnectionPersistence = {
    /// Schedule the writes after a change of a connection that the workbooks `workbookIds` reference. The id comes with
    /// the call, a connection that the app created holds none.
    scheduleWrites(writer: DashQLStorageWriter, connection: DashQLConnection, connectionId: string, prev: PersistedConnectionFields, change: ConnectionPersistenceChange, workbookIds: readonly string[]): void {
        writer.ptr.api.bindings.ConnectionPersistence.scheduleWrites(
            writer.ptr.assertNotNull(), connection.ptr.assertNotNull(), connectionId, JSON.stringify(prev), JSON.stringify(change), [...workbookIds]);
    },

    /// Schedule the writes of a deleted connection, an active one leaves the app manifest with its files
    scheduleDeleteWrites(writer: DashQLStorageWriter, connectionId: string, active: boolean): void {
        writer.ptr.api.bindings.ConnectionPersistence.scheduleDeleteWrites(writer.ptr.assertNotNull(), connectionId, active);
    },

    /// Save a connection: the given params, else its draft, else its params. The app manifest first, `commit` gets the
    /// saved params once it is written, then the copies of the workbooks.
    async save(writer: DashQLStorageWriter, connection: DashQLConnection, connectionId: string, saved: unknown, workbookIds: readonly string[], commit: (params: unknown) => void): Promise<ConnectionSaveOutcome> {
        const outcome = await writer.ptr.api.bindings.ConnectionPersistence.save(
            writer.ptr.assertNotNull(), connection.ptr.assertNotNull(), connectionId, saved == null ? undefined : JSON.stringify(saved), [...workbookIds],
            (params: string) => commit(JSON.parse(params)));
        return outcome as ConnectionSaveOutcome;
    },

    /// Write the copies of the saved params of a connection into workbooks again
    async writeCopies(writer: DashQLStorageWriter, connectionId: string, params: unknown, workbookIds: readonly string[]): Promise<ConnectionCopyOutcome[]> {
        const outcome = await writer.ptr.api.bindings.ConnectionPersistence.writeCopies(writer.ptr.assertNotNull(), connectionId, JSON.stringify(params), [...workbookIds]);
        return outcome as ConnectionCopyOutcome[];
    },
};
