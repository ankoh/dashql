import type * as app_manifest from '@ankoh/dashql-jsonschema/app_manifest.js';
import type * as app_notebook from '@ankoh/dashql-jsonschema/app_notebook.js';

import type { CacheFileStat } from './query_result_cache_eviction.js';

// Storage file and folder naming conventions
export const STORAGE_MANIFEST_FILE = 'dashql-manifest.json';
export const STORAGE_NOTEBOOKS_FOLDER = 'notebooks';
export const STORAGE_NOTEBOOK_FILE = 'dashql-notebook.json';
export const STORAGE_SCRIPTS_FOLDER = 'scripts';
export const STORAGE_CACHE_FOLDER = 'cache';
export const STORAGE_CACHE_EXTENSION = '.arrow';
/// Suffix of the empty "last access" marker that sits beside each cached `.arrow` file, e.g.
/// `<hash>.arrow.last_access`. Its own mtime is the entry's last-access time and is bumped (by
/// rewriting the empty file) on every cache hit — this is how the FIFO-by-write-time cache is turned
/// into an LRU without rewriting the (potentially large) payload. The marker is advisory: the
/// `.arrow` files are authoritative, so a missing marker just falls back to the payload's own mtime.
export const STORAGE_CACHE_ACCESS_SUFFIX = '.last_access';

/// A cached query result loaded from disk: the Arrow IPC bytes plus the entry's write time.
export interface CachedQueryResult {
    /// The Arrow IPC (stream) bytes of the cached result.
    bytes: Uint8Array;
    /// When the cache entry was written (the `.arrow` file's mtime, in epoch milliseconds). This is
    /// a write time, not a last-access time: a cache hit does not re-touch the file.
    cachedAtMs: number;
}
export const STORAGE_SCRIPT_SCHEMA = 'dashql-relations.sql';
export const STORAGE_SCRIPT_FUNCTIONS = 'dashql-functions.sql';
export const STORAGE_SCRIPT_DRAFT = 'dashql-draft.sql';
export const STORAGE_SCRIPT_EXTENSION = '.sql';

// Re-export JSON Schema types
export type NotebookEntry = app_manifest.NotebookEntry;
export type StorageManifest = app_manifest.StorageManifest;
export type AppSettings = app_manifest.AppSettings;
export type NotebookData = app_notebook.NotebookData;
export type NotebookMetadata = app_notebook.NotebookMetadata;
export type ConnectionParams = NotebookData['connectionParams'];

/// The kind of filesystem backend
export enum StorageBackendType {
    /// Origin Private File System (browser-only)
    OPFS = 'opfs',
    /// Native filesystem (Tauri only)
    Native = 'native',
}

/// Storage interface for DashQL.
///
/// Identity model: the notebook UUID is authoritative. Every per-notebook method is keyed by the bare
/// `notebookId` (the UUID). Backends translate that UUID into their own physical layout:
///   - OPFS writes `notebooks/<uuid>/…` under the OPFS root.
///   - The native backend is constructed for a single directory and writes that notebook's files
///     directly into it.
/// There is no storage-prefix concept on this interface anymore; any prefix is purely for display
/// and lives in `notebook_locator.ts`.
export interface StorageBackend {
    /// Get the backend type
    getBackendType(): StorageBackendType;

    /// Initialize the storage backend (optional)
    initialize?(): Promise<void>;

    /// List all notebooks (registry-level)
    listNotebooks(manifestPath: string): Promise<NotebookEntry[]>;

    /// Load persisted app settings from the manifest (registry-level)
    loadAppSettings(): Promise<AppSettings | null>;
    /// Persist app settings to the manifest (registry-level)
    saveAppSettings(settings: AppSettings): Promise<void>;
    /// Load a notebook by UUID
    loadNotebook(notebookId: string): Promise<NotebookData>;
    /// Save a notebook
    saveNotebookManifest(notebookId: string, data: NotebookData): Promise<void>;
    /// Delete a notebook
    deleteNotebook(notebookId: string): Promise<void>;

    /// Load notebook catalog schema SQL
    loadNotebookSchema(notebookId: string): Promise<string | null>;
    /// Save notebook catalog schema SQL
    saveNotebookSchema(notebookId: string, sql: string): Promise<void>;

    /// Load notebook catalog functions SQL
    loadNotebookFunctions(notebookId: string): Promise<string | null>;
    /// Save notebook catalog functions SQL
    saveNotebookFunctions(notebookId: string, sql: string): Promise<void>;

    /// Load script folders
    loadScriptFolders(notebookId: string): Promise<ScriptFolderData[]>;
    /// Create a script folder
    createScriptFolder(notebookId: string, folderName: string): Promise<void>;
    /// Delete a script folder
    deleteScriptFolder(notebookId: string, folderName: string): Promise<void>;
    /// Rename a script folder, moving its contents with it.
    ///
    /// This is the in-place alternative to delete-old + recreate-new: it keeps the scripts inside the
    /// folder exactly as they are on disk (no per-script rewrite). Native does an atomic directory
    /// rename; OPFS, which has no atomic directory rename, moves each file into a fresh folder and
    /// removes the old one. Callers must guarantee `oldFolderName` exists and `newFolderName` does not.
    renameScriptFolder(notebookId: string, oldFolderName: string, newFolderName: string): Promise<void>;

    /// Load a notebook script
    loadScript(notebookId: string, folderName: string, scriptName: string): Promise<ScriptData>;
    /// Save a notebook script
    saveScript(notebookId: string, folderName: string, scriptName: string, sql: string): Promise<void>;
    /// Delete a notebook script
    deleteScript(notebookId: string, folderName: string, scriptName: string): Promise<void>;
    /// Rename a script file within a folder, preserving its contents (no rewrite from
    /// memory). Native renames the file; OPFS moves it (with a copy+delete fallback). Callers must
    /// guarantee `oldScriptName` exists and `newScriptName` does not.
    renameScript(notebookId: string, folderName: string, oldScriptName: string, newScriptName: string): Promise<void>;

    /// Load a notebook script draft
    loadScriptDraft(notebookId: string): Promise<string | null>;
    /// Save a notebook script draft
    saveScriptDraft(notebookId: string, sql: string): Promise<void>;

    /// Load a cached query result by content hash, or null on a cache miss.
    ///
    /// The cache lives in a `cache/` folder inside the notebook's storage; entries are named
    /// `<hash>.arrow`. This is a best-effort cache: callers must treat any failure as a miss and fall
    /// back to normal execution (the executor never lets a cache error surface into the query path).
    /// On a hit the returned entry carries both the Arrow IPC bytes and the file's write time
    /// (`cachedAt`), so the UI can show how old the cached result is.
    loadQueryResultCache(notebookId: string, hash: string): Promise<CachedQueryResult | null>;
    /// Record a cache access by bumping the entry's `<hash>.arrow.last_access` marker's mtime (an
    /// empty file, rewritten so its mtime advances). This is the LRU signal consumed by eviction; it
    /// deliberately does *not* re-touch the payload `.arrow`, so the payload's mtime stays meaningful
    /// as the "cached at" timestamp. Best-effort: callers invoke this on a cache hit and ignore
    /// failures (a missing marker degrades eviction to write-time/FIFO for that entry).
    touchQueryResultCacheAccess(notebookId: string, hash: string): Promise<void>;
    /// Store a query result (Arrow IPC bytes) under `<hash>.arrow` in the notebook's `cache/` folder,
    /// evicting least-recently-used entries first to stay under the size and count thresholds.
    saveQueryResultCache(notebookId: string, hash: string, bytes: Uint8Array): Promise<void>;
    /// List the notebook's cached query results with their size and recency metadata (one entry per
    /// `<hash>.arrow` payload; the `.last_access` markers are folded in as `lastAccessMs`). Returns an
    /// empty array when the notebook has no cache folder yet. This is the read side of the same
    /// listing the eviction policy walks, exposed for the internals cache inspector.
    listQueryResultCache(notebookId: string): Promise<CacheFileStat[]>;
    /// Query result is cached
    hasCachedQueryResult(notebookId: string, hash: string): Promise<boolean>;
    /// Delete a single cached query result by content hash. A no-op when the entry is already gone.
    deleteQueryResultCache(notebookId: string, hash: string): Promise<void>;

    /// Clear all storage (delete all notebooks and reset manifest)
    clearAllStorage?(): Promise<void>;
}

/// A backend that also owns the notebook registry (the root manifest).
///
/// Only the OPFS backend implements this: the OPFS root manifest is the single registry of every
/// notebook, regardless of where each notebook's files physically live. The composite backend uses
/// these methods to keep the manifest in sync when a notebook is relocated to a native directory
/// (the manifest entry stays in OPFS; only the files move).
export interface NotebookRegistryBackend extends StorageBackend {
    /// Insert or replace a notebook's registry entry (matched by UUID), without touching files.
    upsertNotebookEntry(entry: NotebookEntry): Promise<void>;
    /// Remove a notebook's registry entry (matched by UUID), without touching files.
    removeNotebookEntry(notebookId: string): Promise<void>;
    /// Reorder the registry entries to match the given UUID order (the user-facing notebook order),
    /// without touching files. Ids not in the manifest are ignored; manifest entries not listed are
    /// kept at the end in their current relative order.
    reorderNotebooks(orderedIds: string[]): Promise<void>;
    /// Delete a notebook's files only, leaving the registry entry intact.
    deleteNotebookFiles(notebookId: string): Promise<void>;
}

// Script folder data contains all scripts in a folder
export interface ScriptFolderData {
    /// The folder name
    name: string;
    /// The scripts in this folder
    scripts: ScriptData[];
}

// Script data represents a single SQL script
export interface ScriptData {
    /// The script name (matches filename: "01-script.sql", "02-query.sql", etc.)
    name: string;
    /// The sql text
    sql: string;
}
