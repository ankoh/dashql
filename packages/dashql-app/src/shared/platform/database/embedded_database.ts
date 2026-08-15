import type * as arrow from 'apache-arrow';

export interface EmbeddedTableInsertOptions {
    schema?: string;
    name: string;
    create?: boolean;
}

export interface EmbeddedConnection {
    close(): Promise<void>;
    query(query: string): Promise<arrow.Table>;
    queryArrowIPC(query: string): Promise<Uint8Array>;
}

export interface EmbeddedTableImportConnection extends EmbeddedConnection {
    insertArrowTable(table: arrow.Table, options: EmbeddedTableInsertOptions): Promise<void>;
}

export interface EmbeddedDatabase<Connection extends EmbeddedConnection = EmbeddedConnection> {
    terminate(): void | Promise<void>;
    getVersion(): Promise<string>;
    connect(): Promise<Connection>;
}

export type EmbeddedComputeDatabase = EmbeddedDatabase<EmbeddedTableImportConnection>;
