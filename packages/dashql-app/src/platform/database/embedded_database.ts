import type * as arrow from 'apache-arrow';

export interface EmbeddedTableInsertOptions {
    schema?: string;
    name: string;
    create?: boolean;
}

export interface EmbeddedConnection {
    close(): Promise<void>;
    query(query: string): Promise<arrow.Table>;
    queryArrowIPC(query: string, abort?: AbortSignal): Promise<Uint8Array>;
}

export interface EmbeddedConnectionOptions {
    defaultDatabase?: '__dashql_compute' | 'hyper';
}

export interface EmbeddedTableImportConnection extends EmbeddedConnection {
    insertArrowTable(table: arrow.Table, options: EmbeddedTableInsertOptions): Promise<void>;
    createTableAs(name: string, query: string): Promise<void>;
}

export interface PersistentDatabaseMetadata {
    readonly name: string;
    readonly storage: 'memory' | 'persistent';
}

/** Optional browser-backed database management capability. */
export interface EmbeddedPersistentDatabase {
    listDatabases(): Promise<readonly PersistentDatabaseMetadata[]>;
    createPersistentDatabase(name: string): Promise<void>;
    openPersistentDatabase(name: string): Promise<void>;
    checkpointPersistentDatabase(name: string): Promise<void>;
    dropPersistentDatabase(name: string): Promise<void>;
}

export interface EmbeddedPersistentDatabaseConnection extends EmbeddedConnection {
    attachPersistentDatabase(name: string, alias: string): Promise<void>;
    detachPersistentDatabase(alias: string): Promise<void>;
}

export interface EmbeddedDatabase<Connection extends EmbeddedConnection = EmbeddedConnection> {
    terminate(): void | Promise<void>;
    getVersion(): Promise<string>;
    connect(options?: EmbeddedConnectionOptions): Promise<Connection>;
}

export type EmbeddedComputeDatabase = EmbeddedDatabase<EmbeddedTableImportConnection>;
