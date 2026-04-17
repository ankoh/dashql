import type * as app_manifest from '@ankoh/dashql-jsonschema/app_manifest.js';
import type * as app_session from '@ankoh/dashql-jsonschema/app_session.js';

// Storage file and folder naming conventions
export const STORAGE_MANIFEST_FILE = 'dashql-manifest.json';
export const STORAGE_SESSION_FILE = 'dashql-session.json';
export const STORAGE_NOTEBOOK_FOLDER = 'notebook';
export const STORAGE_SCRIPT_SCHEMA = 'dashql-schema.sql';
export const STORAGE_SCRIPT_DRAFT = 'dashql-draft.sql';
export const STORAGE_SCRIPT_EXTENSION = '.sql';

// Re-export JSON Schema types
export type SessionEntry = app_manifest.SessionEntry;
export type StorageManifest = app_manifest.StorageManifest;
export type SessionData = app_session.SessionData;
export type NotebookMetadata = app_session.NotebookMetadata;
export type ConnectionParams = app_session.ConnectionParams;

/// Storage interface for DashQL
export interface StorageBackend {
    /// Initialize the storage backend (optional)
    initialize?(): Promise<void>;

    /// List all sessions
    listSessions(manifestPath: string): Promise<SessionEntry[]>;
    /// Load a session by path
    loadSession(sessionPath: string): Promise<SessionData>;
    /// Save a session
    saveSession(sessionPath: string, data: SessionData): Promise<void>;
    /// Delete a session
    deleteSession(sessionPath: string): Promise<void>;

    /// Load session catalog schema SQL
    loadSessionSchema(sessionPath: string): Promise<string | null>;
    /// Save session catalog schema SQL
    saveSessionSchema(sessionPath: string, sql: string): Promise<void>;

    /// Load notebook pages
    loadNotebookPages(sessionPath: string): Promise<PageData[]>;
    /// Create a notebook page
    createNotebookPage(sessionPath: string, pageName: string): Promise<void>;
    /// Delete a notebook page
    deleteNotebookPage(sessionPath: string, pageName: string): Promise<void>;

    /// Load a notebook script
    loadNotebookScript(sessionPath: string, pageName: string, scriptName: string): Promise<ScriptData>;
    /// Save a notebook script
    saveNotebookScript(sessionPath: string, pageName: string, scriptName: string, sql: string): Promise<void>;
    /// Delete a notebook script
    deleteNotebookScript(sessionPath: string, pageName: string, scriptName: string): Promise<void>;
    /// Reorder notebook scripts (provide all script names in desired order)
    reorderNotebookScript(sessionPath: string, pageName: string, orderedScriptNames: string[]): Promise<void>;

    /// Load a notebook script draft
    loadNotebookScriptDraft(sessionPath: string): Promise<string | null>;
    /// Save a notebook script draft
    saveNotebookScriptDraft(sessionPath: string, sql: string): Promise<void>;

    /// Clear all storage (delete all sessions and reset manifest)
    clearAllStorage?(): Promise<void>;
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
