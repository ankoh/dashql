import type * as arrow from 'apache-arrow';

export interface EmbeddedTableInsertOptions {
    schema?: string;
    name: string;
    create?: boolean;
    /// Stops the insert, e.g. the import of a result whose computation was cancelled
    abort?: AbortSignal;
}

/// The record batches of a running query
export interface EmbeddedResultStream extends AsyncIterable<arrow.RecordBatch> {
    /// The schema of the result
    readonly schema: arrow.Schema;
    /// Read the next record batch
    next(): Promise<IteratorResult<arrow.RecordBatch>>;
    /// Stop reading, a query that did not finish is cancelled
    cancel(): Promise<void>;
}

export interface EmbeddedConnection {
    close(): Promise<void>;
    /// Run a query and read its whole result, statements without a result give a table without columns.
    query(query: string, abort?: AbortSignal): Promise<arrow.Table>;
    /// Run a query and stream the result batches as the engine produces them.
    /// The connection serves nothing else until the stream is read to the end or cancelled.
    queryStream(query: string, abort?: AbortSignal): Promise<EmbeddedResultStream>;
    /// Run a statement without a result, returns the affected rows of COPY, DELETE, FETCH, INSERT, MERGE and UPDATE.
    execute(statement: string, abort?: AbortSignal): Promise<bigint | null>;
}

/// A JSON object that describes the client of the queries of a connection
export type EmbeddedClientContext = Record<string, unknown>;

/// The databases of an embedded database instance by the alias they are attached as:
/// the data frames of the computations, the database of the embedded Hyper connector, and the snippet search
export type EmbeddedDatabaseAlias = '__dashql_compute' | 'hyper' | '__dashql_snippets';

/// A database that a session attaches, like the attached databases of a Hyper server
export interface EmbeddedAttachedDatabase {
    /// The Hyper path of the database file
    path: string;
    /// The alias that statements name the database by
    alias: string;
}

export interface EmbeddedConnectionOptions {
    /// The database of the instance that the session attaches first, the compute database by default, none with null
    defaultDatabase?: EmbeddedDatabaseAlias | null;
    /// Databases that the session attaches after its default database. Unlike the databases of the instance they
    /// outlive it: a database is created when a session first attaches it, unless it exists, and only dropped on request
    /// (EmbeddedAttachedDatabases). Hyper
    /// resolves unqualified names only in a session with a single database, a session that attaches one has no default
    /// database.
    attachedDatabases?: readonly EmbeddedAttachedDatabase[];
    /// Reuse an idle connection and return it to a pool on close.
    /// Only for callers that leave no session state behind, such as settings, transactions or temporary tables.
    pooled?: boolean;
    /// The client context of the queries of the connection, set when its session is connected.
    /// Hyper logs it as ctx.client of the query events, e.g. to attribute queries of pooled connections.
    /// Pooled sessions are only reused for the same client context.
    clientContext?: EmbeddedClientContext;
}

export interface EmbeddedTableImportConnection extends EmbeddedConnection {
    insertArrowTable(table: arrow.Table, options: EmbeddedTableInsertOptions): Promise<void>;
    createTableAs(name: string, query: string, abort?: AbortSignal): Promise<void>;
}

export interface EmbeddedExternalFileDatabase {
    registerExternalFile(name: string, blob: Blob, path?: string, signal?: AbortSignal): Promise<string>;
    removeExternalFile(path: string): Promise<void>;
}

export type ExternalDirectoryMode = 'read' | 'readwrite';

/// Drop a database that sessions attached, e.g. of a local cloud that is deleted
export interface EmbeddedAttachedDatabases {
    /// Drop the database file, unless it doesn't exist. Fails while a session attaches it.
    dropAttachedDatabase(path: string): Promise<void>;
}

/// Can the database drop the databases that its sessions attached?
export function dropsAttachedDatabases(database: object): database is EmbeddedAttachedDatabases {
    return typeof (database as Partial<EmbeddedAttachedDatabases>).dropAttachedDatabase === 'function';
}

/** Optional capability: mount files in memory as a directory, e.g. the attachments of a workbook of a runtime without storage. */
export interface EmbeddedMemoryDirectoryDatabase extends EmbeddedExternalDirectoryDatabase {
    /// Mount files in memory as a read-only directory at a path below `/mnt/external/`, by their paths in it. The
    /// names of the files may be any, the path of the directory is ASCII. `removeExternalDirectory` unmounts it.
    registerMemoryDirectory(files: Readonly<Record<string, Blob>>, path: string): Promise<string>;
}

/** Can a database mount files in memory as a directory? */
export function supportsMemoryDirectories(database: EmbeddedExternalDirectoryDatabase): database is EmbeddedMemoryDirectoryDatabase {
    return typeof (database as Partial<EmbeddedMemoryDirectoryDatabase>).registerMemoryDirectory === 'function';
}

/** Optional browser directory registration capability. */
export interface EmbeddedExternalDirectoryDatabase {
    registerExternalDirectory(
        handle: FileSystemDirectoryHandle,
        path: string | undefined,
        mode: ExternalDirectoryMode,
    ): Promise<string>;
    removeExternalDirectory(path: string): Promise<void>;
    /// Forget the files that the database opened below a mounted directory, the next access looks them up again.
    /// Running queries keep reading the files they opened.
    refreshExternalDirectory(path: string): Promise<void>;
}

export interface EmbeddedDatabase<Connection extends EmbeddedConnection = EmbeddedConnection> {
    terminate(): void | Promise<void>;
    getVersion(): Promise<string>;
    connect(options?: EmbeddedConnectionOptions): Promise<Connection>;
}

export type EmbeddedComputeDatabase = EmbeddedDatabase<EmbeddedTableImportConnection>;
