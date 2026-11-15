import type { DashQL } from './api.js';

// The storage format of workbooks in the Rust runtime (`dashql_core_runtime::workbook_format`), without I/O: the
// workbook file with its validation and migrations, the file lists, bundles, the workbook tables, the archives of
// imports and exports, the connections of imports and the eviction of the query result cache. Files, ZIP archives and
// the Parquet files of the embedded Hyper stay with the host.
//
// The calls cross as JSON, workbook tables as Arrow IPC. The bytes of attachments and results stay with the host, a
// bundle names them with tokens of the host (`bytes`).

/// A workbook file as JSON, `dashql-workbook.json`
export type WorkbookFileJson = object;

/// The catalog of a connection that a bundle carries
export interface WorkbookBundleCatalogJson {
    connectionId: string;
    relations: string | null;
    functions: string | null;
}

/// A bundle whose bytes are tokens of the host
export interface WorkbookBundleJson {
    workbook: WorkbookFileJson;
    catalogs: WorkbookBundleCatalogJson[];
    scripts: { name: string; sql: string }[];
    data: { name: string; bytes: string }[];
    results?: { key: string; bytes: string; crc32?: number }[];
}

/// The rows of the workbook tables by table name, and the data tables with tokens of the host
export interface WorkbookTablesJson {
    /// The data tables of the attachments and results
    data: { tableName: string; bytes: string; crc32?: number }[];
}

/// A change of a folder that a migration made
export type WorkbookFolderChange = { kind: 'write'; name: string; text: string } | { kind: 'remove'; name: string };

/// The outcome of a migration of a workbook folder
export type WorkbookMigrationOutcome = 'current' | 'migrated' | 'missing' | 'unsupported' | 'newer';

/// The columns of a workbook table
export interface WorkbookTableSchema {
    name: string;
    columns: { name: string; type: 'text' | 'integer' | 'boolean'; nullable: boolean }[];
}

/// The constants of the format
export interface WorkbookFormatConstants {
    formatVersion: number;
    catalogCopyFormatVersion: number;
    storageVersion: number;
    /// The top-level files of a workbook folder that the migrations read
    migrationFiles: string[];
    tables: WorkbookTableSchema[];
}

/// What the host reads of an archive
export type WorkbookArchivePlan =
    | {
        kind: 'tables';
        entries: ({ index: number; table: string } | { index: number; data: string; storedSlice: boolean })[];
    }
    | {
        kind: 'folder';
        entries: (
            | { index: number; kind: 'text'; path: string }
            | { index: number; kind: 'script'; name: string }
            | { index: number; kind: 'attachment'; name: string }
            | { index: number; kind: 'result'; key: string }
        )[];
        scriptError: string | null;
    };

/// An entry of a `.dashql` archive, in the order the host adds them
export interface WorkbookArchiveEntry {
    fileName: string;
    /// A workbook table, written as Parquet from its rows
    table: string | null;
    /// A data table of the tables, written as it is
    data: string | null;
    /// Stored without compression, else deflated
    stored: boolean;
}

/// A resolver of the connections of a workbook, the connections cross as JSON `{connectionId, params}`
export interface WorkbookConnectionResolver {
    /// The connection of the app for a connection of the workbook, null if it is unknown. `copy` is the JSON of the copy
    /// that the workbook file holds, null if it holds none.
    resolve(connectionId: string, copy: string | null): string | null;
    /// The connection that scripts on unknown connections run on
    fallback(): string;
    /// A script references a connection that couldn't be resolved
    unresolved(connectionId: string): void;
}

/// The scripts of a workbook file resolved to connections of the app
export interface ResolvedWorkbookScriptsJson {
    scripts: { name: string; connectionId: string; unresolvedConnectionId: string | null }[];
    pendingConnectionId: string | null;
    workbook: WorkbookFileJson;
}

/// The storage format of workbooks, its calls need the module instantiated
export class DashQLWorkbookFormat {
    constructor(protected readonly bindings: DashQL['bindings']) { }

    /// Run an operation on JSON arguments
    protected call<T>(op: string, args: object = {}): T {
        return JSON.parse(this.bindings.workbookFormat(op, JSON.stringify(args))) as T;
    }

    /// The constants of the format: the versions, the files of the migrations and the workbook tables
    constants(): WorkbookFormatConstants {
        return this.call('constants');
    }
    /// Validate a workbook file before it is restored, the code of the error or null
    validate(workbook: unknown): string | null {
        return this.call<{ error: string | null }>('validate', { workbook }).error;
    }
    /// A short explanation of a validation error
    describeValidationError(error: string): string {
        return this.call<{ description: string }>('describeValidationError', { error }).description;
    }
    /// Are the params those of the embedded Hyper of the app?
    isLocalHyperWasmParams(params: unknown): boolean {
        return this.call<{ result: boolean }>('isLocalHyperWasmParams', { params }).result;
    }
    /// Is a string a UUID in the canonical shape?
    isValidUuid(value: string): boolean {
        return this.call<{ result: boolean }>('isValidUuid', { value }).result;
    }
    /// The names of attachments in natural order
    workbookAttachments(names: readonly string[]): string[] {
        return this.call<{ names: string[] }>('workbookAttachments', { names }).names;
    }
    /// Migrate the top-level files of a workbook folder in memory to a format version, the current one by default.
    /// Returns what to write and remove.
    migrate(files: readonly [string, string][], targetVersion?: number): { result: WorkbookMigrationOutcome; changes: WorkbookFolderChange[] } {
        return this.call('migrate', { files, targetVersion });
    }
    /// Rename the `sidb` key of the params of stored connections to `dbcom`
    renameSidbConnections(connections: unknown[]): unknown[] {
        return this.call<{ connections: unknown[] }>('renameSidbConnections', { connections }).connections;
    }
    /// Migrate the top-level files of a workbook folder in memory and read them with the catalogs of its connections
    readBundleHead(files: readonly [string, string][], errorPrefix: string): { workbook: WorkbookFileJson; catalogs: WorkbookBundleCatalogJson[]; filesValid: boolean } {
        return this.call('readBundleHead', { files, errorPrefix });
    }
    /// The workbook file of a bundle with the given scripts and attachments
    assembleBundle(workbook: unknown, scripts: readonly string[], data: readonly string[]): WorkbookFileJson {
        return this.call<{ workbook: WorkbookFileJson }>('assembleBundle', { workbook, scripts, data }).workbook;
    }
    /// The workbook file of a stored workbook with sanitized file lists and the given scripts and attachments
    storedBundle(workbook: unknown, scripts: readonly string[], data: readonly string[]): WorkbookFileJson {
        return this.call<{ workbook: WorkbookFileJson }>('storedBundle', { workbook, scripts, data }).workbook;
    }
    /// Reconcile the file lists of a stored workbook file with the stored files
    reconcileStoredFiles(workbook: unknown, scripts: readonly string[], data: readonly string[]): { workbook: WorkbookFileJson; write: boolean } {
        return this.call('reconcileStoredFiles', { workbook, scripts, data });
    }
    /// Give the connections of a workbook fresh ids, the scripts and the catalogs follow them
    regenerateConnectionIds(workbook: unknown, catalogs: readonly WorkbookBundleCatalogJson[]): { workbook: WorkbookFileJson; catalogs: WorkbookBundleCatalogJson[] } {
        return this.call('regenerateConnectionIds', { workbook, catalogs });
    }
    /// Keep the connections that the scripts use and their catalogs
    pruneConnections(workbook: unknown, catalogs: readonly WorkbookBundleCatalogJson[]): { workbook: WorkbookFileJson; catalogs: WorkbookBundleCatalogJson[] } {
        return this.call('pruneConnections', { workbook, catalogs });
    }
    /// Rename the connections of catalogs, connections that become one keep the first catalog
    renameCatalogs(catalogs: readonly WorkbookBundleCatalogJson[], ids: Record<string, string>): WorkbookBundleCatalogJson[] {
        return this.call<{ catalogs: WorkbookBundleCatalogJson[] }>('renameCatalogs', { catalogs, ids }).catalogs;
    }
    /// Drop the catalog files that don't parse
    filterInvalidCatalogs(catalogs: readonly WorkbookBundleCatalogJson[]): { catalogs: WorkbookBundleCatalogJson[]; invalidFiles: string[] } {
        return this.call('filterInvalidCatalogs', { catalogs });
    }
    /// Check a bundle and prepare its write
    prepareBundleWrite(bundle: WorkbookBundleJson, backend: 'opfs' | 'native', options: { targetWorkbookId?: string; suffixNameWithCopy?: boolean; targetIsFresh?: boolean }): { workbookId: string; workbook: WorkbookFileJson; rollbackOnFailure: boolean } {
        return this.call('prepareBundleWrite', { bundle, backend, options });
    }
    /// The catalog files that seed a connection from a bundle
    catalogSeedFiles(catalog: WorkbookBundleCatalogJson, hasCatalog: boolean): [string, string][] {
        return this.call<{ files: [string, string][] }>('catalogSeedFiles', { catalog, hasCatalog }).files;
    }
    /// What differs between two bundles, null if nothing
    bundleDifference(expected: WorkbookBundleJson, actual: WorkbookBundleJson): string | null {
        return this.call<{ difference: string | null }>('bundleDifference', { expected, actual }).difference;
    }
    /// Is the portable content of two bundles the same?
    bundlesEqual(a: WorkbookBundleJson, b: WorkbookBundleJson): boolean {
        return this.call<{ equal: boolean }>('bundlesEqual', { a, b }).equal;
    }
    /// The rows of a bundle, the core reads the catalog files
    bundleToTables(bundle: WorkbookBundleJson): WorkbookTablesJson {
        return this.call<{ tables: WorkbookTablesJson }>('bundleToTables', { bundle }).tables;
    }
    /// The rows of a bundle that leaves the app: the params sanitized for sharing, without the draft script and the
    /// link to a published workbook
    sharedTables(bundle: WorkbookBundleJson): WorkbookTablesJson {
        return this.call<{ tables: WorkbookTablesJson }>('sharedTables', { bundle }).tables;
    }
    /// The bundle of a set of tables, the workbook file migrated like a workbook folder
    tablesToBundle(tables: WorkbookTablesJson, errorPrefix?: string): WorkbookBundleJson {
        return this.call<{ bundle: WorkbookBundleJson }>('tablesToBundle', { tables, errorPrefix }).bundle;
    }
    /// The entries of the archive of workbook tables
    archiveEntries(tables: WorkbookTablesJson): WorkbookArchiveEntry[] {
        return this.call<{ entries: WorkbookArchiveEntry[] }>('archiveEntries', { tables }).entries;
    }
    /// Decide what the entries of an archive are
    planArchive(entries: readonly { filename: string; directory: boolean }[]): WorkbookArchivePlan {
        return this.call('planArchive', { entries });
    }
    /// The bundle of an archive of a workbook folder that the host read
    readFolderArchive(plan: WorkbookArchivePlan, files: { texts: [string, string][]; scripts: { name: string; sql: string }[]; data: { name: string; bytes: string }[]; results: { key: string; bytes: string; crc32?: number }[] }): WorkbookBundleJson {
        return this.call<{ bundle: WorkbookBundleJson }>('readFolderArchive', { plan, files }).bundle;
    }
    /// The workbook file and catalogs of a shared export
    sharedExportHead(workbook: unknown, catalogs: readonly WorkbookBundleCatalogJson[], liveParams: Record<string, unknown>, options: { withLoginHint?: boolean; withCatalog?: boolean; preserveUUIDs?: boolean; connectionNames?: Record<string, string> }): { workbook: WorkbookFileJson; catalogs: WorkbookBundleCatalogJson[] } {
        return this.call('sharedExportHead', { workbook, catalogs, liveParams, options });
    }
    /// The workbook of a shared connection
    connectionLinkWorkbook(params: unknown, name: string | null, withLoginHint: boolean, createdAt: string): WorkbookFileJson {
        return this.call<{ workbook: WorkbookFileJson }>('connectionLinkWorkbook', { params, name, withLoginHint, createdAt }).workbook;
    }
    /// Decide how the connections of an imported workbook map to the connections of the app
    planConnectionImport<P>(workbook: unknown, entries: readonly unknown[]): P[] {
        return this.call<{ plan: P[] }>('planConnectionImport', { workbook, entries }).plan;
    }
    /// Rewrite the connection references of an imported workbook
    applyConnectionImportPlan(workbook: unknown, plan: readonly unknown[], choices: Record<string, unknown>, entries: readonly unknown[]): { workbook: WorkbookFileJson; connectionIds: [string, string][] } {
        return this.call('applyConnectionImportPlan', { workbook, plan, choices, entries });
    }
    /// Did resolving the connections change the references of the workbook?
    connectionRefsChanged(before: unknown, after: unknown): boolean {
        return this.call<{ result: boolean }>('connectionRefsChanged', { before, after }).result;
    }
    /// Does a resolved workbook file differ from the stored one in its scripts or connections?
    resolutionChanged(stored: unknown, resolved: unknown): boolean {
        return this.call<{ result: boolean }>('resolutionChanged', { stored, resolved }).result;
    }
    /// Which results of a workbook an import adds to the cache, by their sizes
    planResultImport(sizes: readonly number[], maxBytes: number, maxFiles: number): { add: boolean[]; dropped: number } {
        return this.call('planResultImport', { sizes, maxBytes, maxFiles });
    }
    /// The rows of a workbook table as Arrow IPC
    encodeTable(name: string, rows: readonly object[]): Uint8Array {
        return this.bindings.encodeWorkbookTable(name, JSON.stringify(rows));
    }
    /// The rows of a workbook table of Arrow IPC
    decodeTable<R = Record<string, unknown>>(name: string, ipc: Uint8Array): R[] {
        return JSON.parse(this.bindings.decodeWorkbookTable(name, ipc)) as R[];
    }
    /// A link that carries an archive inline
    workbookLink(archive: Uint8Array, linkBase: string): string {
        return this.bindings.workbookLink(archive, linkBase);
    }
    /// Resolve the scripts of a workbook file to the connections of the app
    resolveWorkbookScripts(workbook: unknown, fileNames: readonly string[], resolver: WorkbookConnectionResolver): ResolvedWorkbookScriptsJson {
        return JSON.parse(this.bindings.resolveWorkbookScripts(JSON.stringify(workbook), JSON.stringify(fileNames), resolver)) as ResolvedWorkbookScriptsJson;
    }
    /// Start an eviction of the query result cache, least recently used first
    cacheEviction(files: readonly { name: string; size: number; mtimeMs: number; lastAccessMs: number }[], maxBytes: number, maxFiles: number): DashQLCacheEviction {
        return new DashQLCacheEviction(new this.bindings.CacheEviction(JSON.stringify(files), maxBytes, maxFiles));
    }
}

/// An eviction of the query result cache: delete the candidate and report it, until there is none
export class DashQLCacheEviction {
    constructor(protected readonly native: InstanceType<DashQL['bindings']['CacheEviction']>) { }

    /// The next file to delete, null once the cache fits
    nextCandidate(): string | null {
        return this.native.nextCandidate() ?? null;
    }
    /// The candidate was deleted, or was gone already
    deleted(): void {
        this.native.deleted();
    }
    /// The candidate is read and stays
    kept(): void {
        this.native.kept();
    }
    /// Free the eviction
    destroy(): void {
        this.native.free();
    }
}
