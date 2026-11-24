import type * as app_manifest from '@akohn/dashql-jsonschema/app_manifest.js';
import type * as app_workbook from '@akohn/dashql-jsonschema/app_workbook.js';
import type { WorkbookEntry as WorkbookTreeEntry, WorkbookTreeFolder } from './workbook_tree.js';

import type { FileStamp } from '../file_system.js';

// Storage file and folder naming conventions
export const STORAGE_MANIFEST_FILE = 'dashql-manifest.json';
export const STORAGE_WORKBOOKS_FOLDER = 'workbooks';
export const STORAGE_WORKBOOK_FILE = 'dashql-workbook.json';
export const STORAGE_SCRIPTS_FOLDER = 'scripts';
export const STORAGE_ATTACHMENTS_FOLDER = 'attachments';
/// The `.gitignore` of a native workbook folder, the runtime decides its entries (docs/design/native_file_sync.md)
export const STORAGE_GITIGNORE_FILE = '.gitignore';
export const STORAGE_SHELL_FOLDER = 'shell';
/// The folder that holds the files of the connections, e.g. `connections/<uuid>/…`
export const STORAGE_CONNECTIONS_FOLDER = 'connections';
/// The monitoring database with the extract of the Hyper log that earlier versions kept in the folder of a connection,
/// e.g. `connections/<uuid>/monitoring.hyper`. The app writes it no more, it is deleted with the files of the connection
/// and it is not part of workbook bundles.
export const STORAGE_CONNECTION_MONITORING_FILE = 'monitoring.hyper';

/// The relations of the catalog, as the last catalog refresh described them
export const STORAGE_CATALOG_RELATIONS = 'dashql-catalog-relations.sql';
/// The functions of the catalog
export const STORAGE_CATALOG_FUNCTIONS = 'dashql-catalog-functions.sql';

export interface DataFile {
    name: string;
    sizeBytes: number;
    /// The time of the last modification in milliseconds since the epoch, 0 if the backend doesn't know it
    mtimeMs?: number;
}

/// Browser-originated attachments stay as Blobs until OPFS consumes them, avoiding a renderer-memory
/// copy for large picker/drop files. Other persistence paths use bytes.
export type DataFileContent = Uint8Array | Blob;

/// The extension of attachments: a workbook attaches Parquet files only, scripts read them as table parameters
export const ATTACHMENT_EXTENSION = '.parquet';

/// Is a file name the name of an attachment, a Parquet file? Listings leave other files out.
export function isAttachmentFileName(name: string): boolean {
    return name.length > ATTACHMENT_EXTENSION.length && name.toLowerCase().endsWith(ATTACHMENT_EXTENSION);
}

export function validateDataFileName(name: string): void {
    if (!name || name === '.' || name === '..' || /[/\\\0]/.test(name)) {
        throw new Error(`Invalid data file basename: ${name}`);
    }
    if (!isAttachmentFileName(name)) {
        throw new Error(`Only Parquet files can be attached: ${name}`);
    }
}

// Re-export JSON Schema types
export type WorkbookEntry = WorkbookTreeEntry;
export type StorageManifest = app_manifest.StorageManifest;
export type AppSettings = app_manifest.AppSettings;
export type ConnectionEntry = app_manifest.ConnectionEntry;
export type WorkbookData = app_workbook.WorkbookData;
export type WorkbookCloudLink = app_workbook.WorkbookCloudLink;
export type WorkbookScript = app_workbook.WorkbookScript;
export type WorkbookConnection = app_workbook.WorkbookConnection;
export type ConnectionParams = WorkbookConnection['params'];

/// The kind of filesystem backend
export enum StorageBackendType {
    /// Origin Private File System (browser-only)
    OPFS = 'opfs',
    /// Native filesystem (Electron only)
    Native = 'native',
}

/// Storage interface for DashQL.
///
/// Identity model: the workbook UUID is authoritative. Every per-workbook method is keyed by the bare
/// `workbookId` (the UUID). Backends translate that UUID into their own physical layout:
///   - OPFS writes `workbooks/<uuid>/…` under the OPFS root.
///   - The native backend is constructed for a single directory and writes that workbook's files
///     directly into it.
/// There is no storage-prefix concept on this interface anymore; any prefix is purely for display
/// and lives in `workbook_locator.ts`.
export interface StorageBackend {
    /// Get the backend type
    getBackendType(): StorageBackendType;

    /// Initialize the storage backend (optional)
    initialize?(): Promise<void>;

    /// List all workbooks in the order of the sidebar (registry-level)
    listWorkbooks(): Promise<WorkbookEntry[]>;

    /// Load persisted app settings from the manifest (registry-level)
    loadAppSettings(): Promise<AppSettings | null>;
    /// Persist app settings to the manifest (registry-level)
    saveAppSettings(settings: AppSettings): Promise<void>;
    /// Load a workbook by UUID
    loadWorkbook(workbookId: string): Promise<WorkbookData>;
    /// Save a workbook. The writes of the workbook file and of the scripts take what they expect on disk (`ExpectedStamp`),
    /// a backend that keeps stamps resolves with the stamp of what it wrote.
    saveWorkbookManifest(workbookId: string, data: WorkbookData, expected?: ExpectedStamp): Promise<FileStamp | null | void>;
    /// Delete a workbook
    deleteWorkbook(workbookId: string): Promise<void>;
    /// The text of the `.gitignore` of the folder of a workbook, null without one. Only a native folder has one.
    loadGitignore?(workbookId: string): Promise<string | null>;
    /// Write the `.gitignore` of the folder of a workbook
    saveGitignore?(workbookId: string, text: string): Promise<void>;

    /// Load the workbook's flat, naturally ordered script files. The order of the feed is the order
    /// of the scripts in the workbook file.
    loadScripts(workbookId: string): Promise<ScriptData[]>;
    /// Load a workbook script
    loadScript(workbookId: string, scriptName: string): Promise<ScriptData>;
    /// Save a workbook script
    saveScript(workbookId: string, scriptName: string, sql: string, expected?: ExpectedStamp): Promise<FileStamp | null | void>;
    /// Delete a workbook script, a missing script is deleted already
    deleteScript(workbookId: string, scriptName: string, expected?: ExpectedStamp): Promise<void>;
    /// Rename a script file, preserving its contents and its stamp (no rewrite from memory). A missing source is renamed
    /// already.
    renameScript(workbookId: string, oldScriptName: string, newScriptName: string, expectedFrom?: ExpectedStamp, expectedTo?: ExpectedStamp): Promise<void>;

    listDataFiles(workbookId: string): Promise<DataFile[]>;
    loadDataFile(workbookId: string, name: string): Promise<Uint8Array>;
    saveDataFile(workbookId: string, name: string, content: DataFileContent): Promise<void>;
    deleteDataFile(workbookId: string, name: string): Promise<void>;
    renameDataFile(workbookId: string, oldName: string, newName: string): Promise<void>;

    /// Clear all storage (delete all workbooks and reset manifest)
    clearAllStorage?(): Promise<void>;
}

/// A backend that also owns the workbook registry (the workbook tree) and the root manifest.
///
/// Only the OPFS backend implements this: the OPFS workbook tree is the single registry of every
/// workbook, regardless of where each workbook's files physically live. The composite backend uses
/// these methods to keep the tree in sync when a workbook is relocated to a native directory
/// (the tree entry stays in OPFS; only the files move).
///
/// The folders of the tree are paths of folder names from the root, the root is the empty path.
export interface WorkbookRegistryBackend extends StorageBackend {
    /// Load the workbook tree, the folders and workbooks of the sidebar
    loadWorkbookTree(): Promise<WorkbookTreeFolder>;
    /// Insert or replace a workbook's registry entry (matched by UUID), without touching files.
    /// A registered workbook keeps its place, a new one is appended to the folder (the root by default).
    upsertWorkbookEntry(entry: WorkbookEntry, folderPath?: readonly string[]): Promise<void>;
    /// Remove a workbook's registry entry (matched by UUID), without touching files.
    removeWorkbookEntry(workbookId: string): Promise<void>;
    /// Move a workbook to a position in a folder, without touching files. The index counts the
    /// workbooks of the folder without the moved one. An unregistered workbook is placed as an OPFS
    /// workbook.
    moveWorkbook(workbookId: string, folderPath: string[], index: number): Promise<void>;
    /// Create a folder in an existing folder
    createFolder(path: string[]): Promise<void>;
    /// Move a folder into another folder under a name (its current name by default), renaming
    /// moves it within its parent
    moveFolder(path: string[], parentPath: string[], name?: string): Promise<void>;
    /// Delete a folder, its workbooks move to the parent folder
    deleteFolder(path: string[]): Promise<void>;
    /// Delete a workbook's files only, leaving the registry entry intact.
    deleteWorkbookFiles(workbookId: string, options?: DeleteWorkbookFilesOptions): Promise<void>;

    /// Load the whole manifest. A manifest without connections was written before connections were
    /// global, the `connections` field is then left absent.
    loadManifest(): Promise<StorageManifest>;
    /// Update the connections of the manifest exclusively.
    /// The update receives the current connections (undefined if the manifest has none yet) and
    /// returns the new connections, or null when nothing changed.
    updateConnections(update: (connections: ConnectionEntry[] | undefined) => ConnectionEntry[] | null): Promise<void>;
    /// Load a file of a connection (e.g. its catalog relations), null if it doesn't exist
    loadConnectionFile(connectionId: string, fileName: string): Promise<string | null>;
    /// Save a file of a connection
    saveConnectionFile(connectionId: string, fileName: string, text: string): Promise<void>;
    /// Create the folder of a connection when missing, e.g. for Hyper to create a database in it
    createConnectionFolder(connectionId: string): Promise<void>;
    /// Delete all files of a connection
    deleteConnectionFiles(connectionId: string): Promise<void>;
}

/// What `deleteWorkbookFiles` leaves
export interface DeleteWorkbookFilesOptions {
    /// Keep the stored results of the scripts (`results/`), e.g. of a workbook that moved to a native folder: the
    /// results of a native workbook stay in the origin private file system (`workbook_results.md`)
    keepResults?: boolean;
}

/// Does a backend own the workbook registry?
export function isWorkbookRegistryBackend(backend: StorageBackend): backend is WorkbookRegistryBackend {
    return typeof (backend as Partial<WorkbookRegistryBackend>).updateConnections === 'function';
}

/// What a write expects of the file it replaces, as the runtime recorded it: `undefined` for any file, `null` for no
/// file, else its stamp. A backend that keeps stamps refuses a write whose file differs (`ExternalScriptChangeError`).
export type ExpectedStamp = FileStamp | null | undefined;

/// Does the stamp of a file on disk match what a write expects?
export function matchesExpectedStamp(actual: FileStamp | null, expected: ExpectedStamp): boolean {
    if (expected === undefined) return true;
    if (actual == null || expected == null) return actual == expected;
    return actual.size === expected.size && actual.mtimeMs === expected.mtimeMs;
}

/// The folder of a workbook is gone, e.g. a native folder that was moved or deleted. A write into it fails the same way
/// until it is back, the runtime stops retrying it.
export class WorkbookFolderMissingError extends Error {
    constructor(dir: string) {
        super(`The workbook folder ${dir} is missing`);
        this.name = 'WorkbookFolderMissingError';
    }
}

/// A script file or the workbook file changed outside the app since the runtime last wrote or acknowledged it.
/// Thrown instead of overwriting the external version.
export class ExternalScriptChangeError extends Error {
    /// The workbook id
    readonly workbookId: string;
    /// The file name, a script or `dashql-workbook.json`
    readonly fileName: string;

    constructor(workbookId: string, fileName: string) {
        super(`file ${fileName} of workbook ${workbookId} changed outside the app`);
        this.name = 'ExternalScriptChangeError';
        this.workbookId = workbookId;
        this.fileName = fileName;
    }
}

// Script data represents a single SQL script
export interface ScriptData {
    /// The script name, the file name in scripts/ (e.g. "extract.sql")
    name: string;
    /// The sql text
    sql: string;
}
