import type * as app_session from '@ankoh/dashql-jsonschema/app_session.js';

/**
 * Notebook type definitions (migrated from protobuf)
 *
 * These types represent the runtime state of the notebook editor.
 * Storage format types (NotebookMetadata, NotebookOriginType) come from JSON Schema.
 */

// Re-export storage format types from JSON Schema
export type NotebookMetadata = app_session.NotebookMetadata;
export type NotebookOriginType = NonNullable<app_session.NotebookMetadata['originType']>;

/** Script annotations derived from analysis */
export interface NotebookScriptAnnotations {
    /** The table references */
    tableRefs: string[];
    /** The table definitions */
    tableDefs: string[];
    /** The restricted columns */
    restrictedColumns: string[];
}

/** A script in the notebook (runtime representation) */
export interface NotebookScript {
    /** The script id */
    scriptId: number;
    /** The script text */
    scriptText: string;
    /** The script annotations */
    annotations: NotebookScriptAnnotations;
}

/** A script reference in a notebook page */
export interface NotebookPageScript {
    /** The script id */
    scriptId: number;
    /** The title */
    title: string;
}

/** A notebook page containing script references */
export interface NotebookPage {
    /** The entries (script references) */
    scripts: NotebookPageScript[];
}

/** Complete notebook structure (runtime representation) */
export interface Notebook {
    /** The connection params (if any) */
    connectionParams?: any; // ConnectionParams from JSON Schema
    /** The scripts */
    scripts: NotebookScript[];
    /** The notebook pages */
    notebookPages: NotebookPage[];
    /** The notebook metadata */
    notebookMetadata: NotebookMetadata;
    /** The uncommitted script id (0 = unset) */
    uncommittedScriptId: number;
}

/** Helper to create empty annotations */
export function createEmptyAnnotations(): NotebookScriptAnnotations {
    return {
        tableRefs: [],
        tableDefs: [],
        restrictedColumns: [],
    };
}

/** Helper to create empty metadata */
export function createEmptyMetadata(): NotebookMetadata {
    return {
        originType: 'LOCAL',
        originalFileName: '',
        originalHttpUrl: '',
    };
}

/** Helper to create an empty page */
export function createEmptyPage(): NotebookPage {
    return {
        scripts: [],
    };
}

/** Helper to create a page script entry */
export function createPageScript(scriptId: number, title: string = ''): NotebookPageScript {
    return {
        scriptId,
        title,
    };
}
