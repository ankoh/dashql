//! The platform of the runtime: one JavaScript object that the runtime calls for its I/O
//! (docs/design/dashql_runtime.md), and `JsPlatform`, the host of the services of the crate over it.
//!
//! The platform holds the handle table, the Arrow tables by handle, the compute database, the clock, the log, fetch,
//! the channels of the host, the descriptions of the queries that the runtime runs itself, the stored results of the
//! scripts, the attachments of the workbooks, the OAuth flows and the specs of the extensions. The runtime
//! tells it that its state changed (`changed`), the store of the app then takes the changes and reads the views. Every
//! call into the platform catches: a member that throws or is missing fails the call of the service with a `HostError`
//! and never unwinds through the module. No borrow of the platform is held while it calls JavaScript, so the platform
//! may call the runtime again from any of its members.
//!
//! The helpers of the other hosts of the bindings (the storage) live here as well: reading the fields of JS values,
//! awaiting the promises of the host, requests and responses.

use std::any::Any;
use std::cell::{Cell, RefCell};
use std::future::Future;
use std::rc::Rc;

use dashql_core_runtime::compute::host::{ComputeContext, ComputeHost, KeptTable, RunId, TableShape};
use dashql_core_runtime::compute::tasks::result_table::ResultTable;
use dashql_core_runtime::compute::ComputationEffect;
use dashql_core_runtime::connections::registry::RegistryEffect;
use dashql_core_runtime::executor::HostTable;
use dashql_core_runtime::handles::Handle;
use dashql_core_runtime::host::{Host, HostError, LocalTask, LogLevel};
use dashql_core_runtime::http::{CancellationToken, Headers, HostBytes, HttpHost, HttpRequest, HttpResponse};
use dashql_core_runtime::settings::RuntimeSettings;
use dashql_core_storage::workbook_format::results::ResultFileStat;
use js_sys::{Array, Function, Object, Promise, Reflect, Uint8Array};
use serde::{Deserialize, Serialize};
use tsify::{Ts, Tsify};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::{spawn_local, JsFuture};

use crate::runtime::changes::{Dirty, Slice};
use crate::runtime::computation::ComputeCallContext;

#[wasm_bindgen(typescript_custom_section)]
const RUNTIME_PLATFORM: &str = r#"
/** The I/O of the runtime, one object of the host (docs/design/dashql_runtime.md). The members return promises where the runtime awaits them. */
export interface RuntimePlatform {
    /** The clock in milliseconds since epoch, and timers */
    clock: { now(): number; sleep(ms: number): Promise<void> };
    /** Log a message with its details as key value pairs, on a target of the log */
    log(level: 'debug' | 'info' | 'warn' | 'error', message: string, details: [string, string][], target?: string): void;
    /** The handle table of the host objects that the runtime names by a number */
    handles: RuntimeHandles;
    /** The Arrow tables of the host by handle, result data never enters the module */
    tables: RuntimeTables;
    /** The compute database of the computations, null until the host set it up */
    readonly compute: ComputePlatform | null;
    /** Send requests with the HTTP client of the platform */
    http: RuntimeHttp;
    /** The channels of the host: the ones that the setups connect, and the ones that run queries themselves (the embedded Hyper, gRPC through the native proxy, the channels of tests) */
    channels: RuntimeChannels;
    /** The stored results of the scripts of the workbooks, Parquet files that the compute database reads and writes; null without */
    readonly results: RuntimeResults | null;
    /** The attachments of the workbooks in the compute database. Null without a compute database that reads Parquet files. */
    readonly mounts: RuntimeMounts | null;
    /** Random ids and the SHA-256 digests of the result keys */
    crypto: { randomUuid(): string; sha256(bytes: Uint8Array): Promise<Uint8Array> };
    /** The OAuth flows of the setups */
    oauth: RuntimeOAuth;
    /** The specs of the client functions of the extensions, the JSON text */
    extensions: { loadSpec(extension: string): Promise<string> };
    /** The storage of the workbooks and the connections, the storage writer and the restore read and write through it */
    readonly storage: RuntimeStorage | null;
    /** The `.dashql` archives of imports and exports: the ZIP container and the Parquet files of the workbook tables. Null without. */
    readonly archives: RuntimeArchives | null;
    /** The state of the runtime changed, the host takes the changes. Urgent changes are taken at the end of the task, the others before the next frame. */
    changed(urgent: boolean): void;
    /** The settings of the runtime, the defaults of DashQL for what it leaves out. Read once when the runtime is created. */
    readonly settings?: RuntimeSettings;
}

/** The timings and limits of a runtime that a host may choose, see `settings.rs` of the core runtime */
export interface RuntimeSettings {
    /** The pause after the last change before the shown scripts that are not selected are analyzed, 150 by default */
    backgroundAnalysisDelayMs?: number;
    /** How often the catalog loader looks at the connections without being asked, 5000 by default */
    catalogHeartbeatMs?: number;
    /** The read timeout of the metadata queries of the catalog loader that have one, 60000 by default */
    catalogQueryTimeoutMs?: number;
    /** The finished internal queries that the history of a connection keeps, 100 by default */
    internalQueryHistoryLimit?: number;
}

/** The storage of the platform: the workbook files, scripts and attachments of the workbooks, the app manifest and the files of the connections. Workbook files and connection entries cross as plain JSON values. */
export interface RuntimeStorage {
    /** The workbook file, rejects if there is none */
    loadWorkbook(workbookId: string): Promise<unknown>;
    /**
     * The writes of the workbook file and of the scripts take what they expect on disk: `undefined` for any file, `null` for none, else the stamp that the
     * runtime recorded. A storage with stamps rejects a write whose file differs with an `ExternalScriptChangeError` (by its name, with `workbookId` and
     * `fileName`) and resolves with the stamp of what it wrote; a storage without stamps ignores the expectation and resolves with nothing. A write into a
     * workbook folder that is gone rejects with a `WorkbookFolderMissingError` (by its name), the runtime stops retrying it.
     */
    saveWorkbook(workbookId: string, workbook: unknown, expected?: RuntimeFileStamp | null): Promise<RuntimeFileStamp | null | void>;
    saveScript(workbookId: string, fileName: string, text: string, expected?: RuntimeFileStamp | null): Promise<RuntimeFileStamp | null | void>;
    /** A missing file is deleted already */
    deleteScript(workbookId: string, fileName: string, expected?: RuntimeFileStamp | null): Promise<void>;
    /** The file keeps its stamp, a missing source is renamed already */
    renameScript(workbookId: string, from: string, to: string, expectedFrom?: RuntimeFileStamp | null, expectedTo?: RuntimeFileStamp | null): Promise<void>;
    /** The text of the `.gitignore` of the folder of a workbook, null without one. The runtime decides its entries. */
    loadGitignore(workbookId: string): Promise<string | null>;
    /** Write the `.gitignore` of the folder of a workbook */
    saveGitignore(workbookId: string, text: string): Promise<void>;
    /** The names of the attachments, the runtime normalizes them to NFC and orders them naturally */
    listAttachments(workbookId: string): Promise<string[]>;
    /** Update the connection entries of the app manifest exclusively. The update gets the entries, null before the connections were migrated, and returns the new ones, null if nothing changed. */
    updateConnections(update: (connections: unknown[] | null) => unknown[] | null): Promise<void>;
    saveConnectionFile(connectionId: string, fileName: string, text: string): Promise<void>;
    deleteConnectionFiles(connectionId: string): Promise<void>;
    deleteWorkbook(workbookId: string): Promise<void>;
    /** Does the storage own the connections? A storage of a single workbook folder doesn't. */
    ownsConnections(): boolean;
    /** The entries of the workbook tree in the order of the sidebar: the id of a workbook as `path`, where it is stored and its native folder */
    listWorkbooks(): Promise<{ path: string; storageType?: string; nativePath?: string | null }[]>;
    /** The connection entries of the app manifest, null if the manifest has none */
    loadManifestConnections(): Promise<unknown[] | null>;
    /** The script files of a workbook */
    loadScripts(workbookId: string): Promise<RestoreScriptFile[]>;
    /** The data files of a workbook */
    listDataFiles(workbookId: string): Promise<WorkbookDataFile[]>;
    /** A file of a connection, null if it doesn't exist */
    loadConnectionFile(connectionId: string, fileName: string): Promise<string | null>;
    /** An attachment of a workbook, a Blob or its bytes */
    loadDataFile(workbookId: string, name: string): Promise<Blob | Uint8Array>;
    /** Write an attachment of a workbook */
    saveDataFile(workbookId: string, name: string, file: Blob | Uint8Array): Promise<void>;
    /** Rename an attachment of a workbook, keeping its contents */
    renameDataFile(workbookId: string, from: string, to: string): Promise<void>;
    /** Add or replace an entry of the workbook tree, e.g. to route a workbook to the origin private file system */
    upsertWorkbookEntry(entry: unknown): Promise<void>;
    /** Delete the files of a workbook, its entry stays */
    deleteWorkbookFiles(workbookId: string): Promise<void>;
    /** Register a native workbook folder in place under an id: the platform adds it to the workbook tree, the runtime migrates it */
    registerNativeWorkbook(dir: string, workbookId: string): Promise<void>;
    /** The folder of a workbook that the platform keeps in a folder of its own, e.g. a native workbook folder; null for the workbooks of the storage root, which `migrateStorage` migrates. The runtime migrates the folder when it reads a workbook file of an older format and checks it for changes outside the app. */
    workbookFolder?(workbookId: string): RuntimeWorkbookFolder | null;
    /** The attachments of a workbook folder changed outside the app, e.g. its mount looks them up again */
    attachmentsChanged?(workbookId: string): void;
}

/** The top-level files of a workbook folder, as the migrations read and write them */
export interface RuntimeFolder {
    /** A file, null if the folder doesn't hold it */
    readText(name: string): Promise<string | null>;
    /** Write a file, resolves with its stamp if the folder keeps stamps */
    writeText(name: string, text: string): Promise<RuntimeFileStamp | null | void>;
    /** Remove a file, a missing file is ignored */
    remove(name: string): Promise<void>;
}

/** The stamp of a file: size and modification time */
export interface RuntimeFileStamp {
    size: number;
    mtimeMs: number;
}

/** The stamps of the files of a workbook folder */
export interface RuntimeFolderStamps {
    scripts: ({ name: string } & RuntimeFileStamp)[];
    attachments: ({ name: string } & RuntimeFileStamp)[];
    /** The workbook file, null if there is none */
    workbook: RuntimeFileStamp | null;
}

/** A workbook folder that may change outside the app, e.g. a native workbook folder. The runtime keeps the stamps of what it wrote and acknowledged. */
export interface RuntimeWorkbookFolder extends RuntimeFolder {
    /** The stamps of the scripts, the attachments and the workbook file of the folder */
    stampFolder(): Promise<RuntimeFolderStamps>;
}

/** The storage root of the app for its migrations: files and directories by their paths below the root, `/` separated */
export interface RuntimeStorageRoot {
    /** A file, null if it doesn't exist */
    readText(path: string): Promise<string | null>;
    /** Write a file, its directories are created */
    writeText(path: string, text: string): Promise<void>;
    /** Create a directory and its parents */
    createDirectory(path: string): Promise<void>;
    /** Remove a file, or a directory with its content; a missing one is ignored */
    remove(path: string): Promise<void>;
    /** The entries of a directory, null if it doesn't exist */
    list(path: string): Promise<{ name: string; directory: boolean }[] | null>;
    /** Copy the files and folders of a directory into another one, which is created. Existing files are replaced, or kept with `keepExisting`. */
    copyDirectory(from: string, to: string, keepExisting: boolean): Promise<void>;
    /** The folder of a native workbook, claimed for the app; null without native folders or if it doesn't exist */
    nativeFolder(nativePath: string): Promise<RuntimeFolder | null>;
}

/** An entry of a `.dashql` archive that the platform writes: a workbook table from the Arrow IPC of its rows, written as Parquet, or a file of the handle table as it is */
export interface RuntimeArchiveEntry {
    fileName: string;
    /** Stored without compression, else deflated */
    stored: boolean;
    table: Uint8Array | null;
    file: number | null;
}

/** The `.dashql` archives of the platform. An archive that is read is a Blob of the handle table, the platform keeps its reader until `close`. */
export interface RuntimeArchives {
    /** Write an archive of the entries in order, resolves with its Blob */
    write(entries: RuntimeArchiveEntry[]): Promise<Blob>;
    /** The bytes of an archive of the handle table, e.g. for a link */
    bytes(archive: number): Promise<Uint8Array>;
    /** The entries of an archive, the runtime normalizes their names to NFC */
    entries(archive: number): Promise<{ filename: string; directory: boolean }[]>;
    /** The text of an entry */
    readText(archive: number, index: number): Promise<string>;
    /** A workbook table of a Parquet entry as Arrow IPC */
    readTable(archive: number, index: number): Promise<Uint8Array>;
    /** A file entry: a slice of the archive with the CRC-32 of the entry if it is stored and `slice` is set, else its bytes checked against the CRC-32 */
    readFile(archive: number, index: number, slice: boolean): Promise<{ file: Blob; crc32: number | null }>;
    /** Close the reader of an archive */
    close(archive: number): Promise<void>;
}

/** A workbook folder that an import reads: a native folder, a folder of the browser, a hosted workbook */
export interface RuntimeImportFolder {
    /** A top-level file or a catalog file of a connection (`connections/<id>/<file>`), null if missing */
    readText(path: string): Promise<string | null>;
    /** The script files, given the scripts that the workbook file lists */
    scripts(listed: string[]): Promise<{ name: string; sql: string }[]>;
    /** The attachments, given the attachments that the workbook file lists */
    attachments(listed: string[]): Promise<{ name: string; file: Blob | Uint8Array }[]>;
    /** The prefix of the errors, e.g. "Invalid remote workbook" */
    readonly errorPrefix?: string;
    /** Metadata of the source that the workbook file takes, e.g. the URL of a hosted workbook */
    readonly metadata?: unknown;
    /** The folder of a native workbook that is registered in place */
    readonly nativePath?: string | null;
}

/** The source of an import: a `.dashql` archive (a Blob of the handle table), a workbook folder, or the workbook tables with the rows of each table as Arrow IPC and the Parquet files of the data tables */
export type ImportSource =
    | { archive: number }
    | { folder: RuntimeImportFolder }
    | { tables: { rows: Record<string, Uint8Array>; data: { tableName: string; file: Blob | Uint8Array; crc32?: number | null }[]; errorPrefix?: string } };

/** A step of the commit of an import */
export type ImportStep = 'results' | 'workbook' | 'scripts' | 'attachments' | 'open';

/** The workbook tables of an export */
export interface ExportedTables {
    /** The rows of the workbook tables by table name */
    rows: Record<string, Record<string, string | number | boolean | null>[]>;
    /** The Parquet files of the attachment and result tables by handle */
    data: { tableName: string; file: number; size: number; crc32: number | null }[];
}

/** A channel of the host that a setup asks the host to connect: the embedded Hyper, or Hyper over gRPC through the native proxy. The runtime speaks Trino, Hyper over HTTP and the Hyper of Salesforce itself. */
export type RuntimeChannelRequest = { type: 'hyper'; kind: 'embedded' | 'grpc'; params: any; session: EmbeddedHyperSession | null };

/** The session of a channel to the embedded Hyper: the database of the instance, or none for a local cloud, which attaches databases of the clouds folder of the app by their paths relative to it */
export interface EmbeddedHyperSession {
    defaultDatabase: 'hyper' | null;
    attachedDatabases: { path: string; alias: string }[];
}

/** How the platform takes the user through the redirect page */
export interface RuntimeOAuthFlowInfo {
    redirectVariant: 'WEB_OPENER_FLOW' | 'NATIVE_LINK_FLOW';
    redirectCallbackUrl: string | null;
    debugMode: boolean;
    flavor: string | null;
}
/** The OAuth flows of the platform. A flow belongs to a setup by the id of the setup, `abort` with the id of the flow stops it: the runtime aborts a flow that it stops waiting for, e.g. a cancelled setup, which closes the loopback server or the window of the flow. */
export interface RuntimeOAuth {
    /** A PKCE challenge: a random verifier and the base64url of its SHA-256 digest */
    pkce(): Promise<{ value: string; verifier: string }>;
    flowInfo(setupId: string): RuntimeOAuthFlowInfo;
    /** Open the authorization URL and wait for the loopback redirect. The events are 'WINDOW_OPENED', 'WINDOW_CLOSED' and 'EXTERNAL_BROWSER_OPENED'. */
    authorizeWithLoopback(setupId: string, flow: number, url: string, callbackUrl: string, onEvent: (event: string) => void): Promise<{ code?: string; state?: string; error?: string; errorDescription?: string }>;
    /** Open the authorization URL and wait for the callback of the redirect page whose state has the flow id */
    authorizeWithRedirectPage(setupId: string, flow: number, url: string, flowId: string, onEvent: (event: string) => void): Promise<unknown>;
    abort(flow: number): void;
}

/** The handle table of the host */
export interface RuntimeHandles {
    /** Keep an object under a new handle */
    register(object: unknown): number;
    /** Forget the object of a handle */
    release(handle: number): void;
    /** The object of a handle */
    get(handle: number): unknown;
    /** Keep the object of a handle under a new handle as well, e.g. a result table that a computation takes too */
    duplicate(handle: number): number;
    /** Close the object of a handle, the handle stays until its release. The runtime closes at once with it and releases the handle with the changes, without it the store closes and releases. */
    close?(handle: number): void;
    /** Abort the object of a handle with a reason, the runtime aborts at once with it and leaves the abort to the store without it */
    abort?(handle: number, reason: string): void;
}

/** The Arrow tables of the host by handle */
export interface RuntimeTables {
    /** Begin a table with an Arrow IPC stream, its schema and maybe batches, returns its handle */
    begin(ipc: Uint8Array): number;
    /** Append the batches of an Arrow IPC stream to a table that began */
    append(table: number, ipc: Uint8Array): void;
    /** Open a table that streams in parts of one Arrow IPC stream, a message may span parts. A channel of the host pushes its batches into it. */
    open(): number;
    /** Push the next part of the Arrow IPC stream of a table that was opened */
    push(table: number, part: Uint8Array): void;
    /** Finish a table, it is a table of the handle table from then on */
    finish(table: number): { rows: number; bytes: number; columns: number; batches: number };
    /** A table of the handle table as an Arrow IPC stream, for the small tables that the runtime parses, e.g. the results of the metadata queries of the catalog loader */
    read(table: number): Uint8Array;
    /** The rows of a table of the handle table and its schema as an Arrow IPC stream without batches, the rows stay with the host */
    describe(table: number): { rows: number; schema: Uint8Array };
}

/** A request of the runtime for the HTTP client of the host */
export interface RuntimeHttpRequest {
    method: string;
    url: string;
    headers: [string, string][];
    body: string | null;
    /** The request or its response carries credentials, e.g. a token request: the host keeps no record of their bodies and headers */
    sensitive: boolean;
}
/** A response of the HTTP client of the host */
export interface RuntimeHttpResponse {
    status: number;
    statusText: string;
    headers: [string, string][];
    body: Uint8Array;
}
/** Fetch of the platform: `abort` with the id of a request stops it */
export interface RuntimeHttp {
    fetch(id: number, request: RuntimeHttpRequest): Promise<RuntimeHttpResponse>;
    abort(id: number): void;
}

/** What a channel of the host reports while it streams a result, the batches go into the table of the query */
export type RuntimeChannelMessage =
    | { type: 'progress'; progress: QueryProgressView }
    | { type: 'batch'; metrics: QueryStreamMetrics }
    | { type: 'end'; metrics: QueryStreamMetrics };
/** A query on a channel of the host, what the host needs to run it there */
export interface RuntimeChannelQuery {
    text: string;
    /** The time to wait for the next batch, null for the default of the channel */
    readTimeoutMs: number | null;
    /** Collect the result, a statement whose output nothing reads drains it */
    publishResults: boolean;
    /** The name of the connector, e.g. for the error of a channel that is not set up */
    connector: string;
    /** Is the query a call of a client function? The runtime sends its requests itself, the host names only the tokens of a Salesforce channel. */
    clientFunction: boolean;
}
/** The channels of the host. The setups connect them, the queries of the host run on them by query: the host knows the channel of a query from the query it described. */
export interface RuntimeChannels {
    /** Connect a channel of a setup, returns its handle. A channel that the runtime stops waiting for is closed once it is connected. */
    connect(setupId: string, request: RuntimeChannelRequest): Promise<number>;
    /** The token of the link to a Hyper that the page holds, null without */
    hyperLinkToken(connectionId: string): string | null;
    /** Describe a query on a channel of the host (null before its setup) as `{ type: 'host' }`. The connections own the channels that the runtime speaks itself (Trino, Hyper over HTTP, the Hyper of Salesforce), the host never describes them. The host keeps the channel and the query until `forget`. */
    describe(queryId: number, channel: number | null, query: RuntimeChannelQuery): Promise<RuntimeChannelTarget>;
    /** The query ended */
    forget(queryId: number): void;
    /** Run a query on its channel, its batches go into the table that was opened for it. False if the channel returned no result. */
    open(queryId: number, table: number): Promise<boolean>;
    /** The next message of the stream of a query */
    next(queryId: number): Promise<RuntimeChannelMessage>;
    /** Cancel the query of a channel: one that `open` still opens, the open then fails or returns a stream that the next cancel stops, or its stream at the backend */
    cancel(queryId: number): Promise<void>;
}

/** The stored results of the scripts of the workbooks: the Parquet files of `workbooks/<id>/results/`, mounted in the compute database at `/mnt/external/results/<id>` (docs/design/workbook_results.md). The platform lists, reads, writes, moves and removes the files; the runtime names them and decides which file is the result of a script. A pin is a shared lock of a file across the windows of the app, a move or removal leaves a pinned file alone. */
export interface RuntimeResults {
    /** Mount the results of a workbook in the compute database, refresh the mount after files were moved or removed */
    mount(workbookId: string): Promise<void>;
    /** Unmount the results of a workbook that was deleted or replaced */
    unmount(workbookId: string): Promise<void>;
    /** The Parquet files of the results of a workbook with their sizes and the times they were written, empty without a folder */
    files(workbookId: string): Promise<{ name: string; size: number; mtimeMs: number }[]>;
    /** Pin a file, also one that is about to be written, resolves with the id that `release` releases it with */
    pin(workbookId: string, name: string): Promise<number>;
    /** Release a pin, resolves once the file can be moved or removed */
    release(id: number): Promise<void>;
    /** Read a file into a table of the handle table while it is pinned, null if the file is gone */
    read(workbookId: string, name: string): Promise<RuntimeCachedTable | null>;
    /** Write a table of the handle table as a file that is pinned, moved in place once it is complete. Resolves with its rows. */
    write(workbookId: string, name: string, table: number): Promise<number>;
    /** The Blob of a file that is pinned, e.g. for an export */
    file(workbookId: string, name: string): Promise<Blob>;
    /** Stream a file of the handle table into a new file, checked against the CRC-32; a file that differs leaves nothing */
    import(workbookId: string, name: string, file: number, crc32: number | null): Promise<void>;
    /** Rename a file that nobody reads, resolves false if it is read and stays */
    move(workbookId: string, from: string, to: string): Promise<boolean>;
    /** Remove a file that nobody reads, resolves false if it is read and stays. A file that is gone is removed. */
    remove(workbookId: string, name: string): Promise<boolean>;
}

/** A file of an attachment of a workbook in memory: its file name and the handle of its Blob or bytes */
export interface RuntimeMemoryFile {
    fileName: string;
    file: number;
}

/** The attachments of the workbooks in the compute database */
export interface RuntimeMounts {
    /** Mount the attachments of a workbook: from the folder of the workbook in the storage (`files` null), or the files of a workbook in memory, mounted at the same paths */
    attachments(workbookId: string, files: RuntimeMemoryFile[] | null): Promise<void>;
    /** The columns of a Parquet attachment of a workbook, its attachments where `attachments` mounts them from */
    attachmentColumns(workbookId: string, fileName: string, files: RuntimeMemoryFile[] | null): Promise<string[]>;
    /** Unmount the attachments of a workbook that was deleted */
    dropAttachments(workbookId: string): Promise<void>;
}

/** The compute database of the computations, the embedded Hyper of the platform. The context of a call names the computation, the title of its task, the connection and the client context of the computation, and the run that `cancel` aborts. Result data never enters the module: a result is imported as the Arrow table of its handle, the tables that the tasks read stay Arrow tables, the runtime reads only the small ones that it parses as Arrow IPC streams. */
export interface ComputePlatform {
    /** Create the table of a data frame from an Arrow table of the handle table, with its rows numbered from 1 in an appended column of 64-bit integers that can't be null */
    importTable(dataFrame: number, tableName: string, table: unknown, rowNumberField: string, context: ComputeCallContext): Promise<void>;
    /** Create the table of a data frame from a SELECT, the host tracks the SELECT as a query of the task */
    createTable(dataFrame: number, tableName: string, sql: string, context: ComputeCallContext): Promise<void>;
    /** Run a query whose small result the runtime parses, resolves to its result as an Arrow IPC stream */
    query(sql: string, context: ComputeCallContext): Promise<Uint8Array>;
    /** Run a query, resolves to its result as an Arrow table that the runtime keeps in the handle table */
    queryTable(sql: string, context: ComputeCallContext): Promise<unknown>;
    /** Drop the table of a data frame with the statement that the runtime wrote */
    dropTable(dataFrame: number, tableName: string, sql: string): Promise<void>;
    /** Abort the calls of a run */
    cancel(run: number): void;
}
"#;

#[wasm_bindgen]
extern "C" {
    /// The platform object of the host
    #[wasm_bindgen(typescript_type = "RuntimePlatform")]
    #[derive(Clone)]
    pub type JsRuntimePlatform;
}

/// Where a query of a channel of the host runs, as the platform describes it: the channel of the host. The connections
/// own the channels that the module speaks itself (Trino, Hyper over HTTP, the Hyper of Salesforce), the platform never
/// describes them.
#[derive(Deserialize, Tsify)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum RuntimeChannelTarget {
    Host,
}

/// A stored result that the platform read into a table of the handle table
#[derive(Deserialize, Tsify)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeCachedTable {
    #[tsify(type = "number")]
    pub table: Handle,
    pub rows: f64,
    pub columns: f64,
}

/// What the services of the runtime do after an action of the registry
#[derive(Default)]
pub struct RegistryFollowUp {
    /// Cancel the setup of the connection that runs
    pub cancel_setup: bool,
    /// Cancel the catalog updates of the loader, with their reasons
    pub cancel_catalog_updates: Vec<(u32, &'static str)>,
}

/// An effect of the runtime on a handle of the host, applied by the store when it takes the changes
#[derive(Clone, Debug, Serialize, Tsify)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HandleEffect {
    /// Forget the object of a handle
    Release { handle: u32 },
    /// Close the object of a handle, e.g. a channel, and forget it
    Close { handle: u32 },
    /// Abort the object of a handle, it stays until a release
    Abort { handle: u32, reason: String },
}

/// What the runtime collected for the host since the last time it took the changes
#[derive(Default)]
struct Pending {
    /// The effects on handles, in order
    effects: Vec<HandleEffect>,
    /// Was the host told, and was it urgent?
    signaled: Option<bool>,
    /// Is a task scheduled that applies the aborts and the closes?
    immediate: bool,
    /// The slices that changed since the host took the changes
    dirty: Dirty,
}

struct Inner {
    object: JsRuntimePlatform,
    pending: RefCell<Pending>,
    /// The id of the last request
    last_request: Cell<f64>,
    /// Did the runtime shut down? The platform is called no more then.
    fenced: Cell<bool>,
    /// The settings of the platform object, read once
    settings: RuntimeSettings,
}

/// The error of a call of the platform after the runtime shut down
const FENCED_MESSAGE: &str = "the runtime was shut down";

/// The host of the services of the crate over the platform object. Clones share the object and the pending changes.
#[derive(Clone)]
pub struct JsPlatform {
    inner: Rc<Inner>,
}

/// The message of a value that JS failed with, an error of another realm too
pub(crate) fn message_of(value: &JsValue) -> String {
    let message = value
        .is_object()
        .then(|| Reflect::get(value, &JsValue::from_str("message")).ok())
        .flatten()
        .and_then(|m| m.as_string());
    message.or_else(|| value.as_string()).unwrap_or_else(|| "the platform failed".to_string())
}

/// A host error that keeps what JS failed with
pub(crate) fn host_error(value: JsValue) -> HostError {
    HostError::new(message_of(&value)).with_value(Rc::new(value))
}

/// What JS failed with, undefined for an error of the module
pub(crate) fn host_value(value: Option<&Rc<dyn Any>>) -> JsValue {
    value.and_then(|value| value.downcast_ref::<JsValue>()).cloned().unwrap_or(JsValue::UNDEFINED)
}

/// A field of a JS value, none for undefined and null
pub(crate) fn field(value: &JsValue, name: &str) -> Option<JsValue> {
    if !value.is_object() {
        return None;
    }
    Reflect::get(value, &JsValue::from_str(name)).ok().filter(|value| !value.is_undefined() && !value.is_null())
}

/// A member of an object
fn member(object: &JsValue, name: &str) -> Result<JsValue, HostError> {
    let value = Reflect::get(object, &JsValue::from_str(name)).map_err(host_error)?;
    if value.is_undefined() || value.is_null() {
        return Err(HostError::new(format!("the platform has no {name}")));
    }
    Ok(value)
}

/// Call a method of an object
fn call(object: &JsValue, name: &str, args: &[JsValue]) -> Result<JsValue, HostError> {
    let function = member(object, name)?
        .dyn_into::<Function>()
        .map_err(|_| HostError::new(format!("{name} of the platform is no function")))?;
    function.apply(object, &args.iter().collect::<Array>()).map_err(host_error)
}

/// Await the promise of a call
async fn settled(value: Result<JsValue, HostError>) -> Result<JsValue, HostError> {
    JsFuture::from(Promise::resolve(&value?)).await.map_err(host_error)
}

/// Call a method of an object of the host and await it, e.g. of the folder of an import
pub(crate) fn call_method(
    object: &JsValue,
    name: &str,
    args: &[JsValue],
) -> impl Future<Output = Result<JsValue, HostError>> + 'static {
    settled(call(object, name, args))
}

/// A number of the platform as a handle, none for no handle
fn as_handle(value: &JsValue) -> Option<Handle> {
    value
        .as_f64()
        .filter(|value| *value > 0.0 && *value <= Handle::MAX as f64 && value.fract() == 0.0)
        .map(|value| value as Handle)
}

/// The headers of a request or a response as `[name, value]` pairs
fn headers_value(headers: &Headers) -> Array {
    headers.iter().map(|(name, value)| Array::of2(&JsValue::from_str(name), &JsValue::from_str(value))).collect()
}

/// A request as the HTTP client of the host takes it
pub(crate) fn request_value(request: &HttpRequest) -> JsValue {
    let object = Object::new();
    let set = |key: &str, value: &JsValue| {
        let _ = Reflect::set(&object, &JsValue::from_str(key), value);
    };
    set("method", &JsValue::from_str(request.method.as_str()));
    set("url", &JsValue::from_str(&request.url));
    set("headers", &headers_value(&request.headers));
    set("body", &request.body.as_deref().map(JsValue::from_str).unwrap_or(JsValue::NULL));
    set("sensitive", &JsValue::from_bool(request.sensitive));
    object.into()
}

/// A response of the host. A successful one may keep its body with the host, the module passes it on unread.
pub(crate) fn response_keeping(value: &JsValue, keep_body: bool) -> Result<HttpResponse, HostError> {
    let status = field(value, "status")
        .and_then(|status| status.as_f64())
        .ok_or_else(|| HostError::new("a response without a status"))?;
    let mut response = HttpResponse::new(status.clamp(0.0, 999.0) as u16, Vec::new());
    response.status_text = field(value, "statusText").and_then(|text| text.as_string()).unwrap_or_default();
    if let Some(headers) = field(value, "headers").filter(Array::is_array) {
        for pair in Array::from(&headers).iter() {
            let pair = Array::from(&pair);
            if let (Some(name), Some(value)) = (pair.get(0).as_string(), pair.get(1).as_string()) {
                response.headers.append(&name, &value);
            }
        }
    }
    if let Some(body) = field(value, "body") {
        match body.dyn_ref::<Uint8Array>() {
            // The same object goes back to the host
            Some(bytes) if keep_body && response.status < 400 => {
                let length = bytes.length() as usize;
                response.host_body = Some(HostBytes::new(Rc::new(body), length));
            }
            Some(bytes) => response.body = bytes.to_vec(),
            None => response.body = Uint8Array::new(&body).to_vec(),
        }
    }
    Ok(response)
}

/// The settings of the platform object, the defaults for what it leaves out. A value that is no number of at least zero
/// is left out.
fn settings_of(object: &JsValue) -> RuntimeSettings {
    let defaults = RuntimeSettings::default();
    let Some(settings) = field(object, "settings") else { return defaults };
    let number = |name: &str| {
        field(&settings, name).and_then(|value| value.as_f64()).filter(|value| value.is_finite() && *value >= 0.0)
    };
    RuntimeSettings {
        background_analysis_delay_ms: number("backgroundAnalysisDelayMs")
            .unwrap_or(defaults.background_analysis_delay_ms),
        catalog_heartbeat_ms: number("catalogHeartbeatMs").unwrap_or(defaults.catalog_heartbeat_ms),
        catalog_query_timeout_ms: number("catalogQueryTimeoutMs")
            .map(|ms| ms.min(f64::from(u32::MAX)) as u32)
            .unwrap_or(defaults.catalog_query_timeout_ms),
        internal_query_history_limit: number("internalQueryHistoryLimit")
            .map(|limit| limit.min(f64::from(u32::MAX)) as usize)
            .unwrap_or(defaults.internal_query_history_limit),
    }
}

/// A count of a JS object
fn count_of(value: &JsValue, key: &str) -> u64 {
    field(value, key).and_then(|n| n.as_f64()).unwrap_or_default().max(0.0) as u64
}

/// A table of the host with its counts
pub(crate) fn host_table(value: &JsValue) -> HostTable {
    HostTable {
        rows: count_of(value, "rows"),
        columns: count_of(value, "columns"),
        batches: count_of(value, "batches"),
    }
}

/// The details of a log message as `[key, value]` pairs
pub(crate) fn details_value(details: &[(&str, &str)]) -> Array {
    details.iter().map(|(key, value)| Array::of2(&JsValue::from_str(key), &JsValue::from_str(value))).collect()
}

impl JsPlatform {
    pub fn new(object: JsRuntimePlatform) -> Self {
        let settings = settings_of(&object);
        Self {
            inner: Rc::new(Inner {
                settings,
                object,
                pending: RefCell::new(Pending::default()),
                last_request: Cell::new(0.0),
                fenced: Cell::new(false),
            }),
        }
    }

    /// The runtime shut down: from now on every call of the platform fails and a timer never fires. The effects on
    /// handles stay for the host, which takes them with the last changes.
    pub fn fence(&self) {
        self.inner.fenced.set(true);
    }

    /// Did the runtime shut down?
    pub fn is_fenced(&self) -> bool {
        self.inner.fenced.get()
    }

    /// A member of the platform object, an error once the runtime shut down
    fn member(&self, name: &str) -> Result<JsValue, HostError> {
        if self.is_fenced() {
            return Err(HostError::new(FENCED_MESSAGE));
        }
        member(&self.inner.object, name)
    }

    /// Call a method of the platform object, an error once the runtime shut down
    fn call_own(&self, name: &str, args: &[JsValue]) -> Result<JsValue, HostError> {
        if self.is_fenced() {
            return Err(HostError::new(FENCED_MESSAGE));
        }
        call(&self.inner.object, name, args)
    }

    /// A slice of the state changed: it is marked for the next changes that the host takes, and the host is told
    pub fn changed(&self, slice: Slice<'_>, urgent: bool) {
        self.mark(slice);
        self.signal(urgent);
    }

    /// Mark a slice for the next changes without telling the host, e.g. several slices of one change
    pub fn mark(&self, slice: Slice<'_>) {
        self.inner.pending.borrow_mut().dirty.mark(slice);
    }

    /// Mark the slices of a set again, e.g. the ones that were busy when the host took the changes
    pub fn mark_all(&self, dirty: Dirty) {
        self.inner.pending.borrow_mut().dirty.merge(dirty);
    }

    /// Take the marked slices
    pub fn take_dirty(&self) -> Dirty {
        std::mem::take(&mut self.inner.pending.borrow_mut().dirty)
    }

    /// Read the marked slices
    pub fn dirty<R>(&self, read: impl FnOnce(&Dirty) -> R) -> R {
        read(&self.inner.pending.borrow().dirty)
    }

    /// Tell the host that the state changed. The host is told once until it takes the changes, again only when a
    /// change becomes urgent. A change of state marks its slice, see `changed`.
    pub fn signal(&self, urgent: bool) {
        let tell = {
            let mut pending = self.inner.pending.borrow_mut();
            let tell = match pending.signaled {
                None => true,
                Some(signaled) => urgent && !signaled,
            };
            if tell {
                pending.signaled = Some(urgent);
            }
            tell
        };
        if tell {
            let _ = self.call_own("changed", &[JsValue::from_bool(urgent)]);
        }
    }

    /// Queue effects on handles in order and tell the host. An abort or a close is applied at once, in a task of its
    /// own that runs before the host takes the changes or at the end of the task: a query or a channel stops without
    /// waiting for the next frame. A release waits for the changes, a view of the last flush may still name its handle;
    /// so does the release of a closed handle.
    fn push(&self, effects: impl IntoIterator<Item = HandleEffect>) {
        let (pushed, schedule) = {
            let mut pending = self.inner.pending.borrow_mut();
            let before = pending.effects.len();
            pending.effects.extend(effects);
            let immediate =
                pending.effects.iter().skip(before).any(|effect| !matches!(effect, HandleEffect::Release { .. }));
            let schedule = immediate && !pending.immediate;
            if schedule {
                pending.immediate = true;
            }
            (pending.effects.len() != before, schedule)
        };
        if schedule {
            let platform = self.clone();
            spawn_local(async move { platform.apply_immediate() });
        }
        if pushed {
            self.signal(false);
        }
    }

    /// Apply the aborts and the closes that wait, the releases stay for the host and a closed handle leaves its release
    /// for the host. Without the members on the handle table of the platform the effects stay for the host as well.
    fn apply_immediate(&self) {
        let immediate: Vec<HandleEffect> = {
            let mut pending = self.inner.pending.borrow_mut();
            pending.immediate = false;
            let (releases, immediate) = std::mem::take(&mut pending.effects)
                .into_iter()
                .partition(|effect| matches!(effect, HandleEffect::Release { .. }));
            pending.effects = releases;
            immediate
        };
        let handles = self.member("handles").ok();
        let mut left = Vec::new();
        for effect in immediate {
            let applied = match (&handles, &effect) {
                (Some(handles), HandleEffect::Abort { handle, reason }) => {
                    call(handles, "abort", &[JsValue::from_f64(f64::from(*handle)), JsValue::from_str(reason)]).is_ok()
                }
                (Some(handles), HandleEffect::Close { handle }) => {
                    let closed = call(handles, "close", &[JsValue::from_f64(f64::from(*handle))]).is_ok();
                    if closed {
                        left.push(HandleEffect::Release { handle: *handle });
                    }
                    closed
                }
                _ => false,
            };
            if !applied {
                left.push(effect);
            }
        }
        self.requeue_effects(left);
    }

    /// Queue effects on handles again before the ones that wait, e.g. the releases that wait while a slice is busy
    pub fn requeue_effects(&self, mut effects: Vec<HandleEffect>) {
        if effects.is_empty() {
            return;
        }
        let mut pending = self.inner.pending.borrow_mut();
        effects.append(&mut pending.effects);
        pending.effects = effects;
    }

    /// Queue the effects of the computations on handles
    pub fn push_effects(&self, effects: &[ComputationEffect]) {
        self.push(effects.iter().filter_map(|effect| match *effect {
            ComputationEffect::Abort { handle, reason } => {
                Some(HandleEffect::Abort { handle, reason: reason.to_string() })
            }
            ComputationEffect::Release { handle } => Some(HandleEffect::Release { handle }),
            // The service cancels the runs of a search and drops the data frames
            ComputationEffect::AbortDataSearch { .. } | ComputationEffect::ReleaseDataFrame { .. } => None,
        }));
    }

    /// Queue the effects of the connections and the queries on handles, returns what the services of the runtime do
    pub fn push_registry_effects(&self, effects: &[RegistryEffect]) -> RegistryFollowUp {
        let mut follow_up = RegistryFollowUp::default();
        let mut queued = Vec::new();
        for effect in effects {
            match *effect {
                RegistryEffect::Release { handle } => queued.push(HandleEffect::Release { handle }),
                RegistryEffect::Close { handle } => queued.push(HandleEffect::Close { handle }),
                RegistryEffect::Abort { handle, reason } => {
                    queued.push(HandleEffect::Abort { handle, reason: reason.to_string() })
                }
                RegistryEffect::CancelSetup => follow_up.cancel_setup = true,
                RegistryEffect::CancelCatalogUpdate { task_id, reason } => {
                    follow_up.cancel_catalog_updates.push((task_id, reason))
                }
            }
        }
        self.push(queued);
        follow_up
    }

    /// Close a handle at once, e.g. a channel that a setup doesn't hand out
    pub fn push_close(&self, handle: Handle) {
        self.push([HandleEffect::Close { handle }]);
    }

    /// Release a handle with the next changes
    pub fn push_release(&self, handle: Handle) {
        self.push([HandleEffect::Release { handle }]);
    }

    /// Take the effects on handles, the host is told again with the next change
    pub fn take_effects(&self) -> Vec<HandleEffect> {
        let mut pending = self.inner.pending.borrow_mut();
        pending.signaled = None;
        std::mem::take(&mut pending.effects)
    }

    /// Log a message on a target
    pub fn log_on(&self, level: LogLevel, message: &str, details: &[(&str, &str)], target: &str) {
        let args = [
            JsValue::from_str(level.name()),
            JsValue::from_str(message),
            details_value(details).into(),
            JsValue::from_str(target),
        ];
        let _ = self.call_own("log", &args);
    }

    /// Keep an object in the handle table of the host
    pub fn register(&self, object: &JsValue) -> Result<Handle, HostError> {
        let handles = self.member("handles")?;
        as_handle(&call(&handles, "register", std::slice::from_ref(object))?)
            .ok_or_else(|| HostError::new("the handle table returned no handle"))
    }

    /// The object of a handle, undefined for none
    pub fn handle(&self, handle: Handle) -> JsValue {
        self.member("handles")
            .and_then(|handles| call(&handles, "get", &[JsValue::from_f64(handle as f64)]))
            .unwrap_or(JsValue::UNDEFINED)
    }

    /// Keep the object of a handle under a new handle as well
    pub fn duplicate(&self, handle: Handle) -> Result<Handle, HostError> {
        let handles = self.member("handles")?;
        as_handle(&call(&handles, "duplicate", &[JsValue::from_f64(handle as f64)])?)
            .ok_or_else(|| HostError::new("the handle table returned no handle"))
    }

    /// Read a table of the handle table as an Arrow IPC stream
    pub fn read_table(&self, table: Handle) -> Result<Vec<u8>, HostError> {
        let tables = self.member("tables")?;
        let ipc = call(&tables, "read", &[JsValue::from_f64(table as f64)])?;
        if !ipc.is_object() {
            return Err(HostError::new("the table is no Arrow IPC stream"));
        }
        // The bytes may come from another realm, they are copied by value
        Ok(Uint8Array::new(&ipc).to_vec())
    }

    /// The rows and the schema of a table of the handle table, the rows stay with the host
    pub fn describe_table(&self, table: Handle) -> Result<TableShape, HostError> {
        let tables = self.member("tables")?;
        let described = call(&tables, "describe", &[JsValue::from_f64(table as f64)])?;
        let schema = field(&described, "schema")
            .filter(JsValue::is_object)
            .ok_or_else(|| HostError::new("the table has no schema"))?;
        // The bytes may come from another realm, they are copied by value. A schema is small.
        let schema = Uint8Array::new(&schema).to_vec();
        let schema = ResultTable::schema_of_ipc_stream(&schema)
            .map_err(|e| HostError::new(format!("the schema of a table: {}", e.message)))?;
        Ok(TableShape { rows: count_of(&described, "rows"), schema })
    }

    /// Open a table that streams in parts
    pub fn open_table(&self) -> Result<Handle, HostError> {
        let tables = self.member("tables")?;
        as_handle(&call(&tables, "open", &[])?).ok_or_else(|| HostError::new("the tables returned no handle"))
    }

    /// Push the next part of a table that streams
    pub fn push_table(&self, table: Handle, part: &JsValue) -> Result<(), HostError> {
        let tables = self.member("tables")?;
        call(&tables, "push", &[JsValue::from_f64(table as f64), part.clone()])?;
        Ok(())
    }

    /// Finish a table, it is a table of the handle table from then on
    pub fn finish_table(&self, table: Handle) -> Result<HostTable, HostError> {
        let tables = self.member("tables")?;
        Ok(host_table(&call(&tables, "finish", &[JsValue::from_f64(table as f64)])?))
    }

    /// The id of the next request or flow of the platform
    fn next_id(&self) -> f64 {
        let id = self.inner.last_request.get() + 1.0;
        self.inner.last_request.set(id);
        id
    }

    /// Connect a channel of a setup, the handle of the channel. A future that is dropped before the connect settled
    /// closes the channel once it is connected, so a channel that nobody waits for never stays open.
    pub fn connect_channel(
        &self,
        setup_id: &str,
        request: &JsValue,
    ) -> impl Future<Output = Result<Handle, HostError>> + 'static {
        let call = self
            .member("channels")
            .and_then(|channels| call(&channels, "connect", &[JsValue::from_str(setup_id), request.clone()]));
        let promise = call.map(|sent| Promise::resolve(&sent));
        let close = CloseOnDrop { promise: promise.as_ref().ok().cloned(), platform: self.clone() };
        async move {
            let mut close = close;
            let settled = JsFuture::from(promise?).await;
            close.disarm();
            as_handle(&settled.map_err(host_error)?).ok_or_else(|| HostError::new("the platform connected no channel"))
        }
    }

    /// The token of the link to a Hyper that the page holds
    pub fn hyper_link_token(&self, connection_id: &str) -> Option<String> {
        let channels = self.member("channels").ok()?;
        call(&channels, "hyperLinkToken", &[JsValue::from_str(connection_id)]).ok()?.as_string()
    }

    /// Describe where a query runs on the channel of its connection, the target as JSON. The platform keeps the
    /// channel of a query of the host until `forget_channel_query`.
    pub fn channel_describe(
        &self,
        query_id: f64,
        channel: Option<Handle>,
        query: &JsValue,
    ) -> impl Future<Output = Result<RuntimeChannelTarget, HostError>> + 'static {
        let channel = channel.map(|channel| JsValue::from_f64(channel as f64)).unwrap_or(JsValue::NULL);
        let call = self
            .member("channels")
            .and_then(|channels| call(&channels, "describe", &[JsValue::from_f64(query_id), channel, query.clone()]));
        async move {
            let described = settled(call).await?;
            serde_wasm_bindgen::from_value(described)
                .map_err(|error| HostError::new(format!("the platform described no channel: {error}")))
        }
    }

    /// A query ended, the platform lets go of its channel
    pub fn forget_channel_query(&self, query_id: f64) {
        if let Ok(channels) = self.member("channels") {
            let _ = call(&channels, "forget", &[JsValue::from_f64(query_id)]);
        }
    }

    /// The SHA-256 digest of bytes, computed by the platform
    pub fn sha256(&self, bytes: &[u8]) -> impl Future<Output = Result<Vec<u8>, HostError>> + 'static {
        let call = self.member("crypto").and_then(|crypto| call(&crypto, "sha256", &[Uint8Array::from(bytes).into()]));
        async move {
            let digest = settled(call).await?;
            if !digest.is_object() {
                return Err(HostError::new("the platform returned no digest"));
            }
            // The bytes may come from another realm, they are copied by value
            Ok(Uint8Array::new(&digest).to_vec())
        }
    }

    /// The OAuth flows of the platform
    fn oauth(&self) -> Result<JsValue, HostError> {
        self.member("oauth")
    }

    /// A PKCE challenge of the platform
    pub fn oauth_pkce(&self) -> impl Future<Output = Result<JsValue, HostError>> + 'static {
        settled(self.oauth().and_then(|oauth| call(&oauth, "pkce", &[])))
    }

    /// How the platform takes the user of a setup through the redirect page
    pub fn oauth_flow_info(&self, setup_id: &str) -> JsValue {
        self.oauth().and_then(|oauth| call(&oauth, "flowInfo", &[JsValue::from_str(setup_id)])).unwrap_or(JsValue::NULL)
    }

    /// Run an OAuth flow of a setup until its callback, the token stops it. `method` is the member of the flow, `args`
    /// follow the id of the setup and the id of the flow.
    pub fn oauth_authorize(
        &self,
        method: &str,
        setup_id: &str,
        args: &[JsValue],
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<JsValue, HostError>> + 'static {
        let flow = self.next_id();
        let oauth = self.oauth();
        let mut all = vec![JsValue::from_str(setup_id), JsValue::from_f64(flow)];
        all.extend_from_slice(args);
        // A flow that is cancelled rejects after the runtime stopped waiting, its rejection is handled right away. The
        // handler lives as long as the page, a flow is rare.
        let sent = oauth.clone().and_then(|oauth| call(&oauth, method, &all)).map(|sent| {
            let promise = Promise::resolve(&sent);
            let handler = Closure::<dyn FnMut(JsValue)>::new(|_| {});
            let _ = promise.catch(&handler);
            handler.forget();
            promise
        });
        // Aborts the flow unless it settled: on a cancellation, and when the caller drops the future first, e.g. a
        // setup that stops waiting on the same token
        let abort = AbortOnDrop { target: sent.as_ref().is_ok().then(|| oauth.ok()).flatten(), id: flow };
        let token = cancellation.clone();
        async move {
            let mut abort = abort;
            let promise = sent?;
            match token.run(JsFuture::from(promise)).await {
                None => Err(HostError::cancelled()),
                Some(result) => {
                    abort.disarm();
                    result.map_err(host_error)
                }
            }
        }
    }

    /// Load the spec of the client functions of an extension, the JSON text
    pub fn load_spec(&self, extension: &str) -> impl Future<Output = Result<String, HostError>> + 'static {
        let call = self
            .member("extensions")
            .and_then(|extensions| call(&extensions, "loadSpec", &[JsValue::from_str(extension)]));
        async move { settled(call).await?.as_string().ok_or_else(|| HostError::new("a spec that isn't text")) }
    }

    /// Does the platform keep anything?
    pub fn has_storage(&self) -> bool {
        self.member("storage").is_ok()
    }

    /// Call a member of the storage of the platform
    pub fn storage_call(&self, name: &str, args: &[JsValue]) -> Result<JsValue, HostError> {
        let storage = self.member("storage").map_err(|_| HostError::new("the platform has no storage"))?;
        call(&storage, name, args)
    }

    /// The folder of a workbook whose files the platform keeps in a folder of its own, e.g. a native workbook folder.
    /// None for the workbooks of the storage root and for a storage without such folders.
    pub fn workbook_folder(&self, workbook_id: &str) -> Option<JsValue> {
        let storage = self.member("storage").ok()?;
        if Reflect::get(&storage, &JsValue::from_str("workbookFolder")).ok().is_none_or(|f| !f.is_function()) {
            return None;
        }
        call(&storage, "workbookFolder", &[JsValue::from_str(workbook_id)]).ok().filter(|folder| folder.is_object())
    }

    /// Call a member of the storage of the platform and await it
    pub fn storage_await(
        &self,
        name: &str,
        args: &[JsValue],
    ) -> impl Future<Output = Result<JsValue, HostError>> + 'static {
        settled(self.storage_call(name, args))
    }

    /// Call a member of the archives of the platform and await it
    pub fn archives_call(
        &self,
        name: &str,
        args: &[JsValue],
    ) -> impl Future<Output = Result<JsValue, HostError>> + 'static {
        let archives =
            self.member("archives").map_err(|_| HostError::new("the platform writes and reads no workbook archives"));
        settled(archives.and_then(|archives| call(&archives, name, args)))
    }

    /// Call a member of the stored results and await it
    fn results_call(&self, name: &str, args: &[JsValue]) -> impl Future<Output = Result<JsValue, HostError>> + 'static {
        settled(self.results().and_then(|results| call(&results, name, args)))
    }

    /// Forget the object of a handle
    pub fn release_handle(&self, handle: Handle) {
        if let Ok(handles) = self.member("handles") {
            let _ = call(&handles, "release", &[JsValue::from_f64(handle as f64)]);
        }
    }

    /// A random id
    pub fn random_uuid(&self) -> Result<String, HostError> {
        let crypto = self.member("crypto")?;
        call(&crypto, "randomUuid", &[])?.as_string().ok_or_else(|| HostError::new("the platform returned no id"))
    }

    /// The compute database, an error until the host set it up
    fn compute(&self) -> Result<JsValue, HostError> {
        self.member("compute").map_err(|_| HostError::new("the platform has no compute database"))
    }

    /// Is there a compute database?
    pub fn has_compute(&self) -> bool {
        self.compute().is_ok()
    }

    /// The stored results, an error without
    fn results(&self) -> Result<JsValue, HostError> {
        self.member("results").map_err(|_| HostError::new("the platform stores no results"))
    }

    /// Call a member of the channels of the host
    fn channels(&self, name: &str, args: &[JsValue]) -> Result<JsValue, HostError> {
        call(&self.member("channels")?, name, args)
    }

    /// Run a query on its channel of the host, the batches go into the table
    pub fn channel_open(
        &self,
        query_id: f64,
        table: Handle,
    ) -> impl Future<Output = Result<bool, HostError>> + 'static {
        let call = self.channels("open", &[JsValue::from_f64(query_id), JsValue::from_f64(table as f64)]);
        async move { settled(call).await.map(|value| value.is_truthy()) }
    }

    /// The next message of the stream of a query on a channel
    pub fn channel_next(&self, query_id: f64) -> impl Future<Output = Result<JsValue, HostError>> + 'static {
        let call = self.channels("next", &[JsValue::from_f64(query_id)]);
        settled(call)
    }

    /// Cancel the query of a channel at the backend
    pub fn channel_cancel(&self, query_id: f64) -> impl Future<Output = Result<(), HostError>> + 'static {
        let call = self.channels("cancel", &[JsValue::from_f64(query_id)]);
        async move { settled(call).await.map(|_| ()) }
    }

    /// Does the platform store the results of the scripts?
    pub fn has_results(&self) -> bool {
        self.results().is_ok()
    }

    /// Mount the results of a workbook in the compute database
    pub fn results_mount(&self, workbook_id: &str) -> impl Future<Output = Result<(), HostError>> + 'static {
        let call = self.results_call("mount", &[JsValue::from_str(workbook_id)]);
        async move { call.await.map(|_| ()) }
    }

    /// Unmount the results of a workbook that was deleted or replaced
    pub fn results_unmount(&self, workbook_id: &str) -> impl Future<Output = Result<(), HostError>> + 'static {
        let call = self.results_call("unmount", &[JsValue::from_str(workbook_id)]);
        async move { call.await.map(|_| ()) }
    }

    /// The files of the results of a workbook
    pub fn results_files(
        &self,
        workbook_id: &str,
    ) -> impl Future<Output = Result<Vec<ResultFileStat>, HostError>> + 'static {
        let call = self.results_call("files", &[JsValue::from_str(workbook_id)]);
        async move {
            let files = call.await?;
            if !Array::is_array(&files) {
                return Err(HostError::new("the files of the results are not a list"));
            }
            let number = |file: &JsValue, name: &str| {
                field(file, name).and_then(|n| n.as_f64()).filter(|n| n.is_finite() && *n >= 0.0).unwrap_or(0.0)
            };
            Ok(Array::from(&files)
                .iter()
                .filter_map(|file| {
                    let name = field(&file, "name")?.as_string()?;
                    Some(ResultFileStat {
                        name,
                        size: number(&file, "size") as u64,
                        mtime_ms: number(&file, "mtimeMs"),
                    })
                })
                .collect())
        }
    }

    /// Pin a file of the results of a workbook, the id of the pin
    pub fn results_pin(&self, workbook_id: &str, name: &str) -> impl Future<Output = Result<u64, HostError>> + 'static {
        let call = self.results_call("pin", &[JsValue::from_str(workbook_id), JsValue::from_str(name)]);
        async move {
            let id = call.await?.as_f64().ok_or_else(|| HostError::new("the platform returned no pin"))?;
            Ok(id.max(0.0) as u64)
        }
    }

    /// Release a pin of a file of the results
    pub fn results_release(&self, id: u64) -> impl Future<Output = ()> + 'static {
        let call = self.results_call("release", &[JsValue::from_f64(id as f64)]);
        async move {
            let _ = call.await;
        }
    }

    /// Read a file of the results of a workbook into a table of the handle table, none if the file is gone
    pub fn results_read(
        &self,
        workbook_id: &str,
        name: &str,
    ) -> impl Future<Output = Result<Option<RuntimeCachedTable>, HostError>> + 'static {
        let call = self.results_call("read", &[JsValue::from_str(workbook_id), JsValue::from_str(name)]);
        async move {
            let read = call.await?;
            if read.is_null() || read.is_undefined() {
                return Ok(None);
            }
            serde_wasm_bindgen::from_value(read)
                .map(Some)
                .map_err(|error| HostError::new(format!("the platform returned no table: {error}")))
        }
    }

    /// Write a table as a file of the results of a workbook, the rows. The host takes the table when it is called.
    pub fn results_write(
        &self,
        workbook_id: &str,
        name: &str,
        table: Handle,
    ) -> impl Future<Output = Result<u64, HostError>> + 'static {
        let args = [JsValue::from_str(workbook_id), JsValue::from_str(name), JsValue::from_f64(table as f64)];
        let call = self.results_call("write", &args);
        async move { Ok(call.await?.as_f64().unwrap_or(0.0).max(0.0) as u64) }
    }

    /// The Blob of a file of the results of a workbook
    pub fn results_file(
        &self,
        workbook_id: &str,
        name: &str,
    ) -> impl Future<Output = Result<JsValue, HostError>> + 'static {
        self.results_call("file", &[JsValue::from_str(workbook_id), JsValue::from_str(name)])
    }

    /// Stream a file of the handle table into a new file of the results of a workbook, checked against the CRC-32
    pub fn results_import(
        &self,
        workbook_id: &str,
        name: &str,
        file: Handle,
        crc32: Option<u32>,
    ) -> impl Future<Output = Result<(), HostError>> + 'static {
        let crc32 = crc32.map(|crc| JsValue::from_f64(crc as f64)).unwrap_or(JsValue::NULL);
        let args = [JsValue::from_str(workbook_id), JsValue::from_str(name), JsValue::from_f64(file as f64), crc32];
        let call = self.results_call("import", &args);
        async move { call.await.map(|_| ()) }
    }

    /// Rename a file of the results of a workbook that nobody reads, false if it is read and stays
    pub fn results_move(
        &self,
        workbook_id: &str,
        from: &str,
        to: &str,
    ) -> impl Future<Output = Result<bool, HostError>> + 'static {
        let args = [JsValue::from_str(workbook_id), JsValue::from_str(from), JsValue::from_str(to)];
        let call = self.results_call("move", &args);
        async move { Ok(call.await?.as_bool() != Some(false)) }
    }

    /// Remove a file of the results of a workbook that nobody reads, false if it is read and stays
    pub fn results_remove(
        &self,
        workbook_id: &str,
        name: &str,
    ) -> impl Future<Output = Result<bool, HostError>> + 'static {
        let call = self.results_call("remove", &[JsValue::from_str(workbook_id), JsValue::from_str(name)]);
        async move { Ok(call.await?.as_bool() != Some(false)) }
    }

    /// The attachments of the runs, an error without a compute database that reads Parquet files
    fn mounts(&self) -> Result<JsValue, HostError> {
        self.member("mounts").map_err(|_| HostError::new("Scripts that read attachments need the compute database"))
    }

    /// Can the platform mount files of runs?
    pub fn has_mounts(&self) -> bool {
        self.mounts().is_ok()
    }

    /// Call a member of the attachments of the runs and await it
    pub fn mounts_call(
        &self,
        name: &str,
        args: &[JsValue],
    ) -> impl Future<Output = Result<JsValue, HostError>> + 'static {
        settled(self.mounts().and_then(|mounts| call(&mounts, name, args)))
    }

    /// Send a request with the fetch of the platform, a successful response may keep its body with the host. The fetch
    /// is aborted when the token is cancelled or when the future is dropped before it completed, e.g. by a query that
    /// stopped waiting for it.
    pub fn send(
        &self,
        request: HttpRequest,
        cancellation: &CancellationToken,
        keep_body: bool,
    ) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        let id = self.next_id();
        let http = self.member("http");
        let token = cancellation.clone();
        let sent = if token.is_cancelled() {
            None
        } else {
            Some(http.clone().and_then(|http| call(&http, "fetch", &[JsValue::from_f64(id), request_value(&request)])))
        };
        // Aborts a fetch that was sent unless it settled, also when the future is dropped before it was polled
        let abort =
            AbortOnDrop { target: sent.as_ref().is_some_and(|sent| sent.is_ok()).then(|| http.ok()).flatten(), id };
        async move {
            let mut abort = abort;
            let Some(sent) = sent else {
                return Err(HostError::cancelled());
            };
            let promise = Promise::resolve(&sent?);
            let settled = token.run(JsFuture::from(promise)).await;
            match settled {
                None => Err(HostError::cancelled()),
                Some(Ok(value)) => {
                    abort.disarm();
                    response_keeping(&value, keep_body)
                }
                Some(Err(value)) => {
                    abort.disarm();
                    Err(host_error(value))
                }
            }
        }
    }
}

/// Aborts work that the platform started when it is dropped, unless it was disarmed once the work settled: a fetch of
/// `http` or a flow of `oauth`, by its id
struct AbortOnDrop {
    target: Option<JsValue>,
    id: f64,
}

impl AbortOnDrop {
    fn disarm(&mut self) {
        self.target = None;
    }
}

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        if let Some(target) = self.target.take() {
            let _ = call(&target, "abort", &[JsValue::from_f64(self.id)]);
        }
    }
}

/// Closes the channel of a connect of the platform once it is connected, when the future of the connect is dropped
/// before it settled. Disarmed once the connect settled.
struct CloseOnDrop {
    promise: Option<Promise>,
    platform: JsPlatform,
}

impl CloseOnDrop {
    fn disarm(&mut self) {
        self.promise = None;
    }
}

impl Drop for CloseOnDrop {
    fn drop(&mut self) {
        let Some(promise) = self.promise.take() else { return };
        let platform = self.platform.clone();
        let close = Closure::once(move |value: JsValue| {
            if let Some(handle) = as_handle(&value) {
                platform.push_close(handle);
            }
        });
        let ignore = Closure::<dyn FnMut(JsValue)>::new(|_| {});
        let _ = promise.then(&close).catch(&ignore);
        close.forget();
        ignore.forget();
    }
}

/// The context of a call of the compute platform as a JS object
fn context_js(context: &ComputeContext) -> Result<JsValue, HostError> {
    let context = ComputeCallContext {
        table_id: context.table_id,
        title: context.title.to_string(),
        connection_id: context.connection_id.clone(),
        client_context: context.client_context.clone(),
        run: context.run,
    };
    Ts::from_rust(&context).map(JsValue::from).map_err(|e| HostError::new(e.to_string()))
}

impl Host for JsPlatform {
    fn settings(&self) -> RuntimeSettings {
        self.inner.settings
    }

    fn now(&self) -> f64 {
        self.member("clock")
            .and_then(|clock| call(&clock, "now", &[]))
            .ok()
            .and_then(|now| now.as_f64())
            .unwrap_or_else(js_sys::Date::now)
    }

    fn sleep(&self, ms: f64) -> impl std::future::Future<Output = ()> + 'static {
        let fenced = self.is_fenced();
        let slept = self.member("clock").and_then(|clock| call(&clock, "sleep", &[JsValue::from_f64(ms)]));
        async move {
            // A task of a runtime that shut down waits forever instead of calling the platform again
            if fenced {
                std::future::pending::<()>().await;
            }
            let _ = settled(slept).await;
        }
    }

    fn spawn(&self, task: LocalTask) {
        spawn_local(task);
    }

    fn log(&self, level: LogLevel, message: &str, details: &[(&str, &str)]) {
        let _ = self.call_own(
            "log",
            &[JsValue::from_str(level.name()), JsValue::from_str(message), details_value(details).into()],
        );
    }
}

impl HttpHost for JsPlatform {
    fn fetch(
        &self,
        request: HttpRequest,
        cancellation: &CancellationToken,
    ) -> impl Future<Output = Result<HttpResponse, HostError>> + 'static {
        self.send(request, cancellation, false)
    }
}

impl ComputeHost for JsPlatform {
    async fn import_table(
        &self,
        data_frame: u64,
        table_name: &str,
        table: Handle,
        row_number_field: &str,
        context: &ComputeContext,
    ) -> Result<(), HostError> {
        let compute = self.compute()?;
        // The table goes to the compute database as the object of its handle, its rows never enter the module
        let table = self.handle(table);
        if table.is_undefined() {
            return Err(HostError::new("the result to import is gone"));
        }
        let args = [
            JsValue::from_f64(data_frame as f64),
            JsValue::from_str(table_name),
            table,
            JsValue::from_str(row_number_field),
            context_js(context)?,
        ];
        settled(call(&compute, "importTable", &args)).await?;
        Ok(())
    }

    async fn create_table(
        &self,
        data_frame: u64,
        table_name: &str,
        sql: &str,
        context: &ComputeContext,
    ) -> Result<(), HostError> {
        let compute = self.compute()?;
        let args = [
            JsValue::from_f64(data_frame as f64),
            JsValue::from_str(table_name),
            JsValue::from_str(sql),
            context_js(context)?,
        ];
        settled(call(&compute, "createTable", &args)).await?;
        Ok(())
    }

    async fn query(&self, sql: &str, context: &ComputeContext) -> Result<Vec<u8>, HostError> {
        let compute = self.compute()?;
        let value = settled(call(&compute, "query", &[JsValue::from_str(sql), context_js(context)?])).await?;
        if !value.is_object() {
            return Err(HostError::new("the compute database returned no Arrow IPC stream"));
        }
        // The bytes may come from another realm, they are copied by value
        Ok(Uint8Array::new(&value).to_vec())
    }

    async fn query_table(&self, sql: &str, context: &ComputeContext) -> Result<KeptTable, HostError> {
        let compute = self.compute()?;
        let table = settled(call(&compute, "queryTable", &[JsValue::from_str(sql), context_js(context)?])).await?;
        // The table joins the handle table without an await, a cancelled run leaves nothing behind
        let handle = self.register(&table)?;
        match self.describe_table(handle) {
            Ok(shape) => Ok(KeptTable { handle, shape }),
            Err(error) => {
                self.release_handle(handle);
                Err(error)
            }
        }
    }

    async fn drop_table(&self, data_frame: u64, table_name: &str) -> Result<(), HostError> {
        let compute = self.compute()?;
        let sql =
            format!("DROP TABLE IF EXISTS {}", dashql_core_runtime::catalog_loader::sql::quote_identifier(table_name));
        settled(call(
            &compute,
            "dropTable",
            &[JsValue::from_f64(data_frame as f64), JsValue::from_str(table_name), JsValue::from_str(&sql)],
        ))
        .await?;
        Ok(())
    }

    fn register_table(&self, ipc: &[u8]) -> Result<Handle, HostError> {
        let tables = self.member("tables")?;
        let table = call(&tables, "begin", &[Uint8Array::from(ipc).into()])?;
        let handle = as_handle(&table).ok_or_else(|| HostError::new("the tables returned no handle"))?;
        call(&tables, "finish", &[table])?;
        Ok(handle)
    }

    fn release(&self, handle: Handle) {
        if let Ok(handles) = self.member("handles") {
            let _ = call(&handles, "release", &[JsValue::from_f64(handle as f64)]);
        }
    }

    fn cancel(&self, run: RunId) {
        if let Ok(compute) = self.compute() {
            let _ = call(&compute, "cancel", &[JsValue::from_f64(run as f64)]);
        }
    }

    /// A step of a task changed a computation: its slice waits for the next frame, its aborts apply at once
    fn changed(&self, effects: &[ComputationEffect]) {
        self.push_effects(effects);
        self.mark(Slice::Computations);
        self.signal(false);
    }
}

/// A token of the lifetime of a computation in the handle table, the runtime aborts and releases it with the
/// computation
pub fn lifetime_token() -> JsValue {
    Object::new().into()
}

thread_local! {
    /// The formatters of the wall clock in named zones with their `formatToParts`, none for a zone that `Intl` doesn't
    /// know
    static ZONE_FORMATTERS: RefCell<std::collections::HashMap<String, Option<(JsValue, Function)>>> = RefCell::new(Default::default());
}

/// The offsets of named time zones from `Intl.DateTimeFormat` of the host, e.g. for the timestamps of Trino with a
/// named zone. The crate has no time zone database.
pub struct IntlTimeZones;

impl IntlTimeZones {
    /// The formatter of the wall clock in a zone and its `formatToParts`, none for an unknown zone
    fn formatter(zone: &str) -> Option<(JsValue, Function)> {
        ZONE_FORMATTERS.with(|formatters| {
            if let Some(formatter) = formatters.borrow().get(zone) {
                return formatter.clone();
            }
            let formatter = (|| {
                let intl = Reflect::get(&js_sys::global(), &JsValue::from_str("Intl")).ok()?;
                let constructor =
                    Reflect::get(&intl, &JsValue::from_str("DateTimeFormat")).ok()?.dyn_into::<Function>().ok()?;
                let options = Object::new();
                let set = |key: &str, value: &str| {
                    Reflect::set(&options, &JsValue::from_str(key), &JsValue::from_str(value)).ok()
                };
                set("timeZone", zone)?;
                set("hourCycle", "h23")?;
                set("era", "short")?;
                for field in ["year", "month", "day", "hour", "minute"] {
                    set(field, "numeric")?;
                }
                // Throws a RangeError for an unknown zone, `construct` catches it
                let args = Array::of2(&JsValue::from_str("en-US"), &options);
                let formatter = Reflect::construct(&constructor, &args).ok()?;
                let format =
                    Reflect::get(&formatter, &JsValue::from_str("formatToParts")).ok()?.dyn_into::<Function>().ok()?;
                Some((formatter, format))
            })();
            formatters.borrow_mut().insert(zone.to_string(), formatter.clone());
            formatter
        })
    }
}

impl dashql_core_runtime::trino::TimeZoneOffsets for IntlTimeZones {
    /// The wall clock in the zone at the instant minus the instant
    fn offset_ms(&self, zone: &str, instant: i64) -> Option<i64> {
        let (formatter, format) = Self::formatter(zone)?;
        let parts = format.call1(&formatter, &JsValue::from_f64(instant as f64)).ok()?;
        let (mut year, mut month, mut day, mut hour, mut minute, mut bc) = (None, None, None, None, None, false);
        for part in Array::from(&parts).iter() {
            let kind = field(&part, "type").and_then(|kind| kind.as_string()).unwrap_or_default();
            let value = field(&part, "value").and_then(|value| value.as_string()).unwrap_or_default();
            let number = || value.parse::<i64>().ok();
            match kind.as_str() {
                "year" => year = number(),
                "month" => month = number(),
                "day" => day = number(),
                "hour" => hour = number(),
                "minute" => minute = number(),
                "era" => bc = value == "BC",
                _ => {}
            }
        }
        let year = if bc { 1 - year? } else { year? };
        let wall = dashql_core_runtime::time::utc_ms(year, month?, day?, hour?, minute?, 0, 0)?;
        Some(wall - instant)
    }
}
