import type { DashQL } from './api.js';

// The parts of the storage format of workbooks in the Rust runtime (`dashql_core_runtime::workbook_format`) that the
// storage of the platform calls itself: the validation of a workbook file, the migrations of workbook folders and of
// the stored connections, the scripts of a workbook folder that changed outside the app, and the eviction of the query
// result cache. The imports and exports are commands of the runtime (`Runtime.readImport`, `Runtime.exportWorkbook`).
//
// The calls cross as JSON.

/// A workbook file as JSON, `dashql-workbook.json`
export type WorkbookFileJson = object;

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
    /// Migrate the top-level files of a workbook folder in memory to a format version, the current one by default.
    /// Returns what to write and remove.
    migrate(files: readonly [string, string][], targetVersion?: number): { result: WorkbookMigrationOutcome; changes: WorkbookFolderChange[] } {
        return this.call('migrate', { files, targetVersion });
    }
    /// Rename the `sidb` key of the params of stored connections to `dbcom`
    renameSidbConnections(connections: unknown[]): unknown[] {
        return this.call<{ connections: unknown[] }>('renameSidbConnections', { connections }).connections;
    }
    /// Does a resolved workbook file differ from the stored one in its scripts or connections?
    resolutionChanged(stored: unknown, resolved: unknown): boolean {
        return this.call<{ result: boolean }>('resolutionChanged', { stored, resolved }).result;
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
