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
    /** The explicit file name (e.g., "01-script.sql") */
    fileName: string;
}

/** A notebook page containing script references, keyed by file name */
export interface NotebookPage {
    /** The folder name for this page */
    folderName: string;
    /** The entries (script references) keyed by file name */
    scripts: { [fileName: string]: NotebookPageScript };
}

/** Complete notebook structure (runtime representation) */
export interface Notebook {
    /** The connection params (if any) */
    connectionParams?: any; // ConnectionParams from JSON Schema
    /** The scripts */
    scripts: NotebookScript[];
    /** The notebook pages keyed by folder name */
    notebookPages: { [folderName: string]: NotebookPage };
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

/** Helper to generate a script file name that doesn't collide with existing entries */
export function generateScriptFileName(existingScripts: { [fileName: string]: NotebookPageScript }): string {
    const count = Object.keys(existingScripts).length;
    let index = count + 1;
    let candidate = `${String(index).padStart(2, '0')}-script.sql`;
    while (existingScripts[candidate] !== undefined) {
        index++;
        candidate = `${String(index).padStart(2, '0')}-script.sql`;
    }
    return candidate;
}

/** Helper to create an empty page */
export function createEmptyPage(folderName: string = 'Untitled'): NotebookPage {
    return {
        folderName,
        scripts: {},
    };
}

/** Helper to create a page script entry */
export function createPageScript(scriptId: number, fileName: string): NotebookPageScript {
    return {
        scriptId,
        fileName,
    };
}
