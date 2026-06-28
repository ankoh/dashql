import type * as app_manifest from '@ankoh/dashql-jsonschema/app_manifest.js';
import type * as app_session from '@ankoh/dashql-jsonschema/app_session.js';

// Storage file and folder naming conventions
export const STORAGE_MANIFEST_FILE = 'dashql-manifest.json';
export const STORAGE_SESSIONS_FOLDER = 'sessions';
export const STORAGE_SESSION_FILE = 'dashql-session.json';
export const STORAGE_NOTEBOOK_FOLDER = 'notebook';
export const STORAGE_SCRIPT_SCHEMA = 'dashql-relations.sql';
export const STORAGE_SCRIPT_FUNCTIONS = 'dashql-functions.sql';
export const STORAGE_SCRIPT_DRAFT = 'dashql-draft.sql';
export const STORAGE_SCRIPT_EXTENSION = '.sql';

// Re-export JSON Schema types
export type SessionEntry = app_manifest.SessionEntry;
export type StorageManifest = app_manifest.StorageManifest;
export type AppSettings = app_manifest.AppSettings;
export type SessionData = app_session.SessionData;
export type NotebookMetadata = app_session.NotebookMetadata;
export type ConnectionParams = app_session.ConnectionParams;

/// The kind of filesystem backend
export enum StorageBackendType {
    /// Origin Private File System (browser-only)
    OPFS = 'opfs',
    /// Native filesystem (Tauri only)
    Native = 'native',
}

/// Storage interface for DashQL.
///
/// Identity model: the session UUID is authoritative. Every per-session method is keyed by the bare
/// `sessionId` (the UUID). Backends translate that UUID into their own physical layout:
///   - OPFS writes `sessions/<uuid>/…` under the OPFS root.
///   - The native backend is constructed for a single directory and writes that session's files
///     directly into it.
/// There is no storage-prefix concept on this interface anymore; any prefix is purely for display
/// and lives in `session_locator.ts`.
export interface StorageBackend {
    /// Get the backend type
    getBackendType(): StorageBackendType;

    /// Initialize the storage backend (optional)
    initialize?(): Promise<void>;

    /// List all sessions (registry-level)
    listSessions(manifestPath: string): Promise<SessionEntry[]>;

    /// Load persisted app settings from the manifest (registry-level)
    loadAppSettings(): Promise<AppSettings | null>;
    /// Persist app settings to the manifest (registry-level)
    saveAppSettings(settings: AppSettings): Promise<void>;
    /// Load a session by UUID
    loadSession(sessionId: string): Promise<SessionData>;
    /// Save a session
    saveSessionManifest(sessionId: string, data: SessionData): Promise<void>;
    /// Delete a session
    deleteSession(sessionId: string): Promise<void>;

    /// Load session catalog schema SQL
    loadSessionSchema(sessionId: string): Promise<string | null>;
    /// Save session catalog schema SQL
    saveSessionSchema(sessionId: string, sql: string): Promise<void>;

    /// Load session catalog functions SQL
    loadSessionFunctions(sessionId: string): Promise<string | null>;
    /// Save session catalog functions SQL
    saveSessionFunctions(sessionId: string, sql: string): Promise<void>;

    /// Load notebook pages
    loadNotebookPages(sessionId: string): Promise<PageData[]>;
    /// Create a notebook page
    createNotebookPage(sessionId: string, pageName: string): Promise<void>;
    /// Delete a notebook page
    deleteNotebookPage(sessionId: string, pageName: string): Promise<void>;

    /// Load a notebook script
    loadNotebookScript(sessionId: string, pageName: string, scriptName: string): Promise<ScriptData>;
    /// Save a notebook script
    saveNotebookScript(sessionId: string, pageName: string, scriptName: string, sql: string): Promise<void>;
    /// Delete a notebook script
    deleteNotebookScript(sessionId: string, pageName: string, scriptName: string): Promise<void>;
    /// Reorder notebook scripts (provide all script names in desired order)
    reorderNotebookScript(sessionId: string, pageName: string, orderedScriptNames: string[]): Promise<void>;

    /// Load a notebook script draft
    loadNotebookScriptDraft(sessionId: string): Promise<string | null>;
    /// Save a notebook script draft
    saveNotebookScriptDraft(sessionId: string, sql: string): Promise<void>;

    /// Clear all storage (delete all sessions and reset manifest)
    clearAllStorage?(): Promise<void>;
}

/// A backend that also owns the session registry (the root manifest).
///
/// Only the OPFS backend implements this: the OPFS root manifest is the single registry of every
/// session, regardless of where each session's files physically live. The composite backend uses
/// these methods to keep the manifest in sync when a session is relocated to a native directory
/// (the manifest entry stays in OPFS; only the files move).
export interface SessionRegistryBackend extends StorageBackend {
    /// Insert or replace a session's registry entry (matched by UUID), without touching files.
    upsertSessionEntry(entry: SessionEntry): Promise<void>;
    /// Remove a session's registry entry (matched by UUID), without touching files.
    removeSessionEntry(sessionId: string): Promise<void>;
    /// Delete a session's files only, leaving the registry entry intact.
    deleteSessionFiles(sessionId: string): Promise<void>;
}

// Page data contains all scripts in a page
export interface PageData {
    /// The page name (matches folder name: "page-1", "page-2", "my-analysis", etc.)
    name: string;
    /// The scripts in this page
    scripts: ScriptData[];
}

// Script data represents a single SQL script
export interface ScriptData {
    /// The script name (matches filename: "01-script.sql", "02-query.sql", etc.)
    name: string;
    /// The sql text
    sql: string;
}
