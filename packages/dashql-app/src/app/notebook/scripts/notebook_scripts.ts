import * as core from '../../../core/index.js';
import * as Immutable from 'immutable';

import { analyzeScript, DashQLCompletionState, DashQLPendingDiff, DashQLProcessorUpdateOut, DashQLScriptBuffers } from './editor/dashql_processor.js';
import { deriveFocusFromCompletionCandidates, deriveFocusFromScriptCursor, SemanticUserFocus } from './focus.js';
import { ConnectorInfo } from '../connections/connector_info.js';
import { VariantKind } from '../../../utils/index.js';
import {
    CREATE_SCRIPT_FOLDER as STORAGE_CREATE_SCRIPT_FOLDER,
    DEBOUNCE_DURATION_SCRIPT_WRITE,
    DEBOUNCE_DURATION_NOTEBOOK_WRITE,
    DELETE_SCRIPT_FOLDER as STORAGE_DELETE_SCRIPT_FOLDER,
    DELETE_SCRIPT as STORAGE_DELETE_SCRIPT,
    groupDraftWrites,
    groupNotebookWrites,
    groupScriptFolderRenames,
    groupScriptFolderWrites,
    groupScriptDeletes,
    groupScriptRenames,
    groupScriptWrites,
    RENAME_SCRIPT_FOLDER as STORAGE_RENAME_SCRIPT_FOLDER,
    RENAME_SCRIPT as STORAGE_RENAME_SCRIPT,
    StorageWriter,
    WRITE_SCRIPT_DRAFT,
    WRITE_SCRIPT,
} from '../persistence/storage_writer.js';
import type { NotebookScriptsInput } from './notebook_scripts_registry.js';
import { Logger, LoggerLike, LoggableException, stringifyError } from '../../../platform/logger/logger.js';
import { ScriptAnnotations, ScriptFolder, ScriptRef, NotebookMetadata as NotebookMetadataType, ResolvedVisualizeQuery, createEmptyAnnotations, createScriptRef, generateScriptFileName, planScriptInsertion, normalizeScriptFolderName, formatScriptFolderOrderPrefix, normalizeScriptName, scriptOrderPrefixString, formatScriptOrderPrefix, scriptDisplayName, uniqueScriptBase } from './script_types.js';
import { parseUmapSpec } from '../compute/ui/visualization/umap/umap_spec.js';

const LOG_CTX = 'notebook_scripts';

/// A script key
export type ScriptKey = number;
/// A script data map
export type ScriptDataMap = { [scriptKey: number]: ScriptData };
/// A page map keyed by folder name
export type ScriptFolderMap = { [folderName: string]: ScriptFolder };

/// A notebook user focus
export interface ScriptFocus {
    /// The folder name of the selected page (empty if none)
    folderName: string;
    /// The file name of the selected entry within the page (empty if none)
    fileName: string;
    /// Monotonic counter incremented only by explicit navigation (Next/Prev Script/Page), used to trigger auto-scroll
    interactionCounter: number;
}

/// The runtime state of a notebook's scripts
export interface NotebookScripts {
    /// Notebook scripts contain many references into the Wasm heap.
    /// Consumers therefore resolve the "right" module through here.
    instance: core.DashQL;
    /// The notebook identifier.
    notebookId: string;
    /// Runtime connection associated with this notebook.
    connectionId: string;
    /// The notebook metadata
    notebookMetadata: NotebookMetadataType;
    /// The connector info
    connectorInfo: ConnectorInfo;
    /// The connection catalog
    connectionCatalog: core.DashQLCatalog;
    /// The scripts
    scripts: ScriptDataMap;
    /// The notebook pages keyed by folder name. View order is by name.
    scriptFolders: ScriptFolderMap;
    /// The uncommitted script id for the notebook-level composer.
    uncommittedScriptId: number;
    /// The notebook focus (selected page and entry by name)
    scriptFocus: ScriptFocus;
    /// The semantic user focus info (if any)
    semanticUserFocus: SemanticUserFocus | null;
}

/// Storage-shaped notebook content used when an external filesystem change replaces the persisted
/// notebook. Keeping this type here prevents the native watcher from knowing about WASM lifetime
/// and catalog invariants.
export interface NotebookScriptsStorageSnapshot {
    folders: Array<{
        name: string;
        scripts: Array<{ name: string; sql: string }>;
    }>;
    draft: string | null;
}

export function notebookScriptsMatchStorageSnapshot(state: NotebookScripts, snapshot: NotebookScriptsStorageSnapshot): boolean {
    const diskPages = new Set(snapshot.folders.map(folder => folder.name));
    const memoryPages = new Set(Object.keys(state.scriptFolders));
    // "Untitled" is virtual when the disk has no pages, matching startup restoration.
    if (diskPages.size === 0 && memoryPages.size === 1 && memoryPages.has('Untitled')) {
        memoryPages.clear();
    }
    if (diskPages.size !== memoryPages.size || [...diskPages].some(page => !memoryPages.has(page))) {
        return false;
    }
    const diskScripts = new Map<string, string>();
    for (const folder of snapshot.folders) {
        for (const script of folder.scripts) {
            diskScripts.set(`${folder.name}/${script.name}`, script.sql);
        }
    }
    const memoryScripts = Object.values(state.scripts).filter(script => script.folderName && script.fileName);
    if (memoryScripts.length !== diskScripts.size) {
        return false;
    }
    for (const script of memoryScripts) {
        if (diskScripts.get(`${script.folderName}/${script.fileName}`) !== script.script.toString()) {
            return false;
        }
    }
    const draft = state.scripts[state.uncommittedScriptId]?.script.toString() ?? '';
    return draft === (snapshot.draft ?? '');
}

/// A script analysis
export interface ScriptAnalysis {
    /// The processed script buffers
    buffers: DashQLScriptBuffers;
    /// Is outdated?
    outdated: boolean;
}

/// A script data
export interface ScriptData {
    /// The script key
    scriptKey: number;
    /// The script
    script: core.DashQLScript;
    /// The script analysis
    scriptAnalysis: ScriptAnalysis;
    /// The derived annotations for the ui
    annotations: ScriptAnnotations;
    /// The statistics
    statistics: Immutable.List<core.FlatBufferPtr<core.buffers.statistics.ScriptStatistics>>;
    /// The cursor
    cursor: core.FlatBufferPtr<core.buffers.cursor.ScriptCursor> | null;
    /// The completion state.
    completion: DashQLCompletionState | null;
    /// A pending, staged rewrite (agent suggestion) shown as an in-place diff.
    /// Set by SET_SCRIPT_TEXT for agent edits; cleared once the user accepts/rejects it in the
    /// editor (which round-trips back through UPDATE_FROM_PROCESSOR).
    pendingDiff: DashQLPendingDiff | null;
    /// The latest query id
    latestQueryId: number | null;
    /// The latest agent-run id
    latestAgentRunId: number | null;
    /// The file name of this script (empty string for uncommitted/draft script)
    fileName: string;
    /// The folder name of the page this script belongs to (empty string for uncommitted/draft script)
    folderName: string;
}

export const SELECT_SCRIPT_FOLDER = Symbol('SELECT_SCRIPT_FOLDER');
export const CREATE_SCRIPT_FOLDER = Symbol('CREATE_SCRIPT_FOLDER');
export const DELETE_SCRIPT_FOLDER = Symbol('DELETE_SCRIPT_FOLDER');
export const SELECT_NEXT_SCRIPT_FOLDER = Symbol('SELECT_NEXT_SCRIPT_FOLDER');
export const SELECT_PREV_SCRIPT_FOLDER = Symbol('SELECT_PREV_SCRIPT_FOLDER');
export const SELECT_NEXT_SCRIPT = Symbol('SELECT_NEXT_SCRIPT');
export const SELECT_PREV_SCRIPT = Symbol('SELECT_PREV_SCRIPT');
export const SELECT_SCRIPT = Symbol('SELECT_SCRIPT');
export const SELECT_SCRIPT_PATH = Symbol('SELECT_SCRIPT_PATH');
export const ANALYZE_OUTDATED_SCRIPT = Symbol('ANALYZE_OUTDATED_SCRIPT');
export const UPDATE_FROM_PROCESSOR = Symbol('UPDATE_FROM_PROCESSOR');
export const CATALOG_DID_UPDATE = Symbol('CATALOG_DID_UPDATE');
export const REGISTER_QUERY = Symbol('REGISTER_QUERY');
export const REGISTER_AGENT_RUN = Symbol('REGISTER_AGENT_RUN');
export const CREATE_SCRIPT = Symbol('CREATE_SCRIPT');
export const DELETE_SCRIPT = Symbol('DELETE_SCRIPT');
export const RENAME_SCRIPT = Symbol('RENAME_SCRIPT');
export const RENAME_SCRIPT_FOLDER = Symbol('RENAME_SCRIPT_FOLDER');
export const REORDER_SCRIPT_FOLDERS = Symbol('REORDER_SCRIPT_FOLDERS');
export const REORDER_SCRIPTS = Symbol('REORDER_SCRIPTS');
export const PROMOTE_UNCOMMITTED_SCRIPT = Symbol('PROMOTE_UNCOMMITTED_SCRIPT');
export const SET_SCRIPT_TEXT = Symbol('SET_SCRIPT_TEXT');
export const CREATE_SCRIPT_WITH_TEXT = Symbol('CREATE_SCRIPT_WITH_TEXT');
export const ACCEPT_PENDING_DIFF = Symbol('ACCEPT_PENDING_DIFF');
export const REJECT_PENDING_DIFF = Symbol('REJECT_PENDING_DIFF');

export type NotebookScriptsAction =
    | VariantKind<typeof SELECT_SCRIPT_FOLDER, string>
    | VariantKind<typeof CREATE_SCRIPT_FOLDER, null>
    | VariantKind<typeof DELETE_SCRIPT_FOLDER, string>
    | VariantKind<typeof SELECT_NEXT_SCRIPT_FOLDER, null>
    | VariantKind<typeof SELECT_PREV_SCRIPT_FOLDER, null>
    | VariantKind<typeof SELECT_NEXT_SCRIPT, null>
    | VariantKind<typeof SELECT_PREV_SCRIPT, null>
    | VariantKind<typeof SELECT_SCRIPT, string>
    | VariantKind<typeof SELECT_SCRIPT_PATH, { folderName: string; fileName: string }>
    | VariantKind<typeof ANALYZE_OUTDATED_SCRIPT, ScriptKey>
    | VariantKind<typeof UPDATE_FROM_PROCESSOR, DashQLProcessorUpdateOut>
    | VariantKind<typeof CATALOG_DID_UPDATE, null>
    | VariantKind<typeof REGISTER_QUERY, [ScriptKey, number]>
    | VariantKind<typeof REGISTER_AGENT_RUN, [ScriptKey, number]>
    | VariantKind<typeof CREATE_SCRIPT, null>
    | VariantKind<typeof DELETE_SCRIPT, string>
    | VariantKind<typeof RENAME_SCRIPT, { fileName: string, newFileName: string }>
    | VariantKind<typeof RENAME_SCRIPT_FOLDER, { folderName: string, newFolderName: string }>
    | VariantKind<typeof REORDER_SCRIPT_FOLDERS, string[]>  // folder names in the desired new view order
    | VariantKind<typeof REORDER_SCRIPTS, { folderName: string; fileNames: string[] }>
    | VariantKind<typeof PROMOTE_UNCOMMITTED_SCRIPT, null>
    | VariantKind<typeof SET_SCRIPT_TEXT, { scriptKey: ScriptKey, text: string, withDiff?: boolean }>
    | VariantKind<typeof CREATE_SCRIPT_WITH_TEXT, { text: string }>
    | VariantKind<typeof ACCEPT_PENDING_DIFF, ScriptKey>
    | VariantKind<typeof REJECT_PENDING_DIFF, ScriptKey>
    ;

const STATS_HISTORY_LIMIT = 20;

export function createEmptyScriptData(instance: core.DashQL, catalog: core.DashQLCatalog, fileName: string = '', folderName: string = ''): [number, ScriptData] {
    const script = instance.createScript(catalog);
    const scriptKey = script.getCatalogEntryId();
    const scriptData: ScriptData = {
        scriptKey,
        script,
        scriptAnalysis: {
            buffers: {
                parsed: null,
                analyzed: null,
                destroy: () => { },
            },
            outdated: true,
        },
        statistics: Immutable.List(),
        annotations: createEmptyAnnotations(),
        cursor: null,
        completion: null,
        pendingDiff: null,
        latestQueryId: null,
        latestAgentRunId: null,
        fileName,
        folderName,
    };
    return [scriptKey, scriptData];
}

/// Find a clean (prefix-free) page name that collides with no other page's clean name.
///
/// Collisions are checked on clean names because the ordering prefix is not part of a page's
/// identity — two pages may not share a clean name even if their prefixes differ. The returned
/// value is always prefix-free; callers re-apply an ordering prefix as needed.
function uniqueScriptFolderName(baseName: string, pages: ScriptFolderMap, excludeFolder: string = ''): string {
    const base = normalizeScriptFolderName(baseName);
    const takenCleanNames = new Set<string>();
    for (const key in pages) {
        if (key === excludeFolder) continue;
        takenCleanNames.add(normalizeScriptFolderName(key));
    }
    let candidate = base;
    for (let suffix = 2; takenCleanNames.has(candidate); ++suffix) {
        candidate = `${base} ${suffix}`;
    }
    return candidate;
}

enum FocusUpdate {
    Clear,
    UpdateFromCursor,
    UpdateFromCompletion,
};

/// Returns the sorted list of folder names for view-layer iteration.
///
/// Folder names may carry a numeric ordering prefix ("03_main"); sorting numerically (matching
/// the storage backends' natural sort on load) yields the intended tab order and keeps a page
/// in place when its prefix width grows (e.g. "9_x" before "10_y").
export function getSortedScriptFolderNames(pages: ScriptFolderMap): string[] {
    return sortScriptFolderNamesNumerically(Object.keys(pages));
}

/// Sort raw folder names with the numeric-aware ordering used for the tab bar. Exposed so callers
/// that only have the names (and not a full ScriptFolderMap) order them identically.
export function sortScriptFolderNamesNumerically(folderNames: string[]): string[] {
    return [...folderNames].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/// Returns the sorted list of file names within a page.
///
/// File names may carry a numeric ordering prefix ("2_extract.sql"); sorting numerically (matching
/// the storage backends' natural sort on load) yields the intended feed order and keeps a script in
/// place when its prefix width grows (e.g. "9_x.sql" before "10_y.sql").
export function getSortedScriptFileNames(page: ScriptFolder): string[] {
    return Object.keys(page.scripts).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/// Returns the currently selected page, or undefined if none.
export function getSelectedScriptFolder(state: NotebookScripts): ScriptFolder | undefined {
    const folder = state.scriptFocus.folderName;
    if (folder && state.scriptFolders[folder]) return state.scriptFolders[folder];
    // Fall back to the first page in sorted order
    const folders = getSortedScriptFolderNames(state.scriptFolders);
    return folders.length > 0 ? state.scriptFolders[folders[0]] : undefined;
}

/// Returns the script entries of the selected page, sorted by file name.
export function getSelectedScriptRefs(state: NotebookScripts): ScriptRef[] {
    const page = getSelectedScriptFolder(state);
    if (!page) return [];
    return getSortedScriptFileNames(page).map(name => page.scripts[name]);
}

/// Returns the uncommitted script data for the notebook-level composer, or null if none.
export function getUncommittedScriptData(state: NotebookScripts): ScriptData | null {
    if (state.uncommittedScriptId === 0) return null;
    return state.scripts[state.uncommittedScriptId] ?? null;
}

/// Returns the currently selected entry (script ref) in the selected page, or undefined.
export function getSelectedScriptRef(state: NotebookScripts): ScriptRef | undefined {
    const page = getSelectedScriptFolder(state);
    if (!page) return undefined;
    const file = state.scriptFocus.fileName;
    if (file && page.scripts[file]) return page.scripts[file];
    // Fall back to first sorted entry
    const files = getSortedScriptFileNames(page);
    return files.length > 0 ? page.scripts[files[0]] : undefined;
}

/// Returns the index of the selected entry in the sorted entry list, or -1.
export function getSelectedScriptIndex(state: NotebookScripts): number {
    const page = getSelectedScriptFolder(state);
    if (!page) return -1;
    const file = state.scriptFocus.fileName;
    if (!file) return -1;
    const files = getSortedScriptFileNames(page);
    return files.indexOf(file);
}

/// Returns the index of the selected page in the sorted page list, or -1.
export function getSelectedScriptFolderIndex(state: NotebookScripts): number {
    const folders = getSortedScriptFolderNames(state.scriptFolders);
    return folders.indexOf(state.scriptFocus.folderName);
}

/// Apply a script re-pad plan (from planScriptInsertion) to a page in place: rename the listed
/// scripts in the page-scripts map and the scripts map, follow the focused file, and persist each as
/// delete-old + write-new. Re-padding only changes a script's prefix width (and normalises a legacy
/// "-" separator), never its clean name, so the catalog path is stable and no re-analyze is needed.
/// Returns the updated maps and focus; the caller weaves them into the new state it is building.
function applyScriptRepad(
    repad: { oldFileName: string; newFileName: string }[],
    folderName: string,
    pageScripts: { [fileName: string]: ScriptRef },
    scripts: ScriptDataMap,
    focusFileName: string,
    notebookId: string,
    storage: StorageWriter | null,
): { pageScripts: { [fileName: string]: ScriptRef }; scripts: ScriptDataMap; focusFileName: string } {
    if (repad.length === 0) {
        return { pageScripts, scripts, focusFileName };
    }
    const nextPageScripts = { ...pageScripts };
    const nextScripts = { ...scripts };
    let nextFocus = focusFileName;
    // A re-pad target path that is also some entry's source path must not be deleted: the write for
    // that path already carries the correct content, and the delete (a separate keyspace from the
    // write) would otherwise race it and could clobber the file on disk. This guards the mixed
    // width/separator legacy case where clean names are not unique within the page.
    const targetFiles = new Set(repad.map(r => r.newFileName));
    for (const { oldFileName, newFileName } of repad) {
        const entry = nextPageScripts[oldFileName];
        if (!entry) continue;
        delete nextPageScripts[oldFileName];
        nextPageScripts[newFileName] = { ...entry, fileName: newFileName };
        const sd = nextScripts[entry.scriptId];
        if (sd) nextScripts[entry.scriptId] = { ...sd, fileName: newFileName };
        if (nextFocus === oldFileName) nextFocus = newFileName;
        // Suppress the delete (but never the write) when this entry's old path is reused as another
        // entry's new path — the write for it already carries the correct content.
        if (!targetFiles.has(oldFileName)) {
            storage?.write(
                groupScriptDeletes(notebookId, folderName, oldFileName),
                { type: STORAGE_DELETE_SCRIPT, value: [notebookId, folderName, oldFileName] },
                DEBOUNCE_DURATION_SCRIPT_WRITE
            );
        }
        const sql = nextScripts[entry.scriptId]?.script.toString() ?? '';
        storage?.write(
            groupScriptWrites(notebookId, folderName, newFileName),
            { type: WRITE_SCRIPT, value: [notebookId, folderName, newFileName, sql] },
            DEBOUNCE_DURATION_SCRIPT_WRITE
        );
    }
    return { pageScripts: nextPageScripts, scripts: nextScripts, focusFileName: nextFocus };
}

/// Re-assign a dense numeric ordering prefix to every page in `order`, persisting each moved page.
///
/// `order` is the desired left-to-right tab order over exactly the current pages. Each page is
/// renamed to "<n>_<clean>" for its 1-based position, zero-padded to a uniform width — so *every*
/// page ends up prefixed (a page that arrived without one, e.g. "vis_data", gains "3_vis_data") and
/// a plain numeric sort reproduces `order`. The clean name is held stable, so the catalog path is
/// unchanged and no re-analyze is needed. A page already keyed exactly at its target name is left
/// untouched (no rename, no disk churn) — this keeps a still-lean notebook lean until something
/// actually moves it. Persists each real rename as delete-old + create-new (no backend has an atomic
/// folder rename), mirroring REORDER_SCRIPT_FOLDERS/RENAME_SCRIPT_FOLDER. Returns null when nothing moved.
///
/// `unpersistedFolder` names a page that exists only in the staged in-memory `state` and was never
/// written to disk (the freshly created page in CREATE_SCRIPT_FOLDER): there is nothing on disk to rename, so
/// it is created under its final prefixed name instead of moved.
function reprefixPages(
    order: string[],
    state: NotebookScripts,
    storage: StorageWriter | null,
    unpersistedFolder: string = '',
): NotebookScripts | null {
    const total = order.length;
    const renames: { oldFolder: string; newFolder: string }[] = [];
    const newPages: ScriptFolderMap = {};
    const newScripts: ScriptDataMap = { ...state.scripts };
    for (let i = 0; i < order.length; ++i) {
        const oldFolder = order[i];
        const page = state.scriptFolders[oldFolder];
        const newFolder = `${formatScriptFolderOrderPrefix(i + 1, total)}${normalizeScriptFolderName(oldFolder)}`;
        if (newFolder === oldFolder) {
            newPages[oldFolder] = page;
            continue;
        }
        renames.push({ oldFolder, newFolder });
        // The clean name is unchanged, so the catalog path is stable; no re-analyze needed.
        for (const fileName in page.scripts) {
            const entry = page.scripts[fileName];
            const sd = newScripts[entry.scriptId];
            if (sd) newScripts[entry.scriptId] = { ...sd, folderName: newFolder };
        }
        newPages[newFolder] = { ...page, folderName: newFolder };
    }

    if (renames.length === 0) {
        return null;
    }

    const newFocusFolder = renames.find(r => r.oldFolder === state.scriptFocus.folderName)?.newFolder
        ?? state.scriptFocus.folderName;

    const next: NotebookScripts = {
        ...state,
        scriptFolders: newPages,
        scripts: newScripts,
        scriptFocus: { ...state.scriptFocus, folderName: newFocusFolder },
    };

    // Persist each moved page as an in-place folder rename (the backend moves its contents with it —
    // no per-script rewrite). Renames live in their own `rename:` keyspace keyed by the source folder,
    // so a content write of the destination folder never coalesces onto, and clobbers, a pending move.
    // Page clean names are unique (uniqueScriptFolderName), so within one reorder the rename destinations are
    // disjoint from the sources — no permutation forms a swap cycle that an atomic rename would break.
    //
    // The freshly created page (`unpersistedFolder`) has nothing on disk to move, so it is created
    // under its final prefixed name instead.
    for (const { oldFolder, newFolder } of renames) {
        if (oldFolder === unpersistedFolder) {
            const page = newPages[newFolder];
            const scriptEntries = Object.values(page.scripts).map(entry => {
                const sd = newScripts[entry.scriptId];
                return { scriptId: entry.scriptId, fileName: entry.fileName, sql: sd ? sd.script.toString() : '' };
            });
            storage?.write(
                groupScriptFolderWrites(next.notebookId, newFolder),
                { type: STORAGE_CREATE_SCRIPT_FOLDER, value: [next.notebookId, newFolder, scriptEntries] },
                DEBOUNCE_DURATION_SCRIPT_WRITE
            );
            continue;
        }
        storage?.write(
            groupScriptFolderRenames(next.notebookId, oldFolder),
            { type: STORAGE_RENAME_SCRIPT_FOLDER, value: [next.notebookId, oldFolder, newFolder] },
            DEBOUNCE_DURATION_SCRIPT_WRITE
        );
    }
    return next;
}

export function reduceNotebookScripts(state: NotebookScripts, action: NotebookScriptsAction, storageArg: StorageWriter, logger: Logger, active: boolean): NotebookScripts {
    // Suppress storage writes when the connection is not yet active
    const storage = active ? storageArg : null;
    switch (action.type) {
        case SELECT_SCRIPT_FOLDER: {
            const folderName = action.value;
            if (!state.scriptFolders[folderName]) return state;
            const page = state.scriptFolders[folderName];
            const files = getSortedScriptFileNames(page);
            const fileName = files.length > 0 ? files[0] : '';
            return {
                ...clearSemanticUserFocus(state),
                scriptFocus: { folderName, fileName, interactionCounter: state.scriptFocus.interactionCounter + 1 },
            };
        }
        case CREATE_SCRIPT_FOLDER: {
            const folderName = uniqueScriptFolderName('Untitled', state.scriptFolders);
            const fileName = generateScriptFileName({});

            // Create a new script for the new page
            const script = state.instance.createScript(state.connectionCatalog);
            const scriptKey = script.getCatalogEntryId();
            const scriptData: ScriptData = {
                scriptKey,
                script,
                scriptAnalysis: {
                    buffers: {
                        parsed: null,
                        analyzed: null,
                        destroy: () => { },
                    },
                    outdated: true,
                },
                statistics: Immutable.List(),
                annotations: createEmptyAnnotations(),
                cursor: null,
                completion: null,
                pendingDiff: null,
                latestQueryId: null,
                latestAgentRunId: null,
                fileName,
                folderName,
            };

            const entry = createScriptRef(scriptKey, fileName);
            const newPage: ScriptFolder = {
                folderName,
                scripts: { [fileName]: entry },
            };

            // Stage the new (still prefix-free) page, then densely re-prefix every page so the new one
            // lands fully to the right with a numeric prefix. Re-prefixing also normalises any
            // still-unprefixed sibling (e.g. a legacy "vis_data" -> "3_vis_data"), keeping the on-disk
            // tab order uniform. The new page is appended last in the desired order; passing it as the
            // unpersisted folder makes reprefixPages emit only its create (never a delete-of-nothing).
            const staged: NotebookScripts = {
                ...clearSemanticUserFocus(state),
                scripts: {
                    ...state.scripts,
                    [scriptKey]: scriptData,
                },
                scriptFolders: { ...state.scriptFolders, [folderName]: newPage },
                scriptFocus: { folderName, fileName, interactionCounter: state.scriptFocus.interactionCounter + 1 },
            };
            const order = [...getSortedScriptFolderNames(state.scriptFolders), folderName];
            const reprefixed = reprefixPages(order, staged, storage, folderName);
            // A freshly created page is always prefix-free while its target carries a prefix, so it
            // always moves and reprefixPages returns non-null (emitting the create under the final
            // name). The `?? staged` is a defensive fallback that should not be reached in practice.
            return reprefixed ?? staged;
        }
        case DELETE_SCRIPT_FOLDER: {
            // Prevent deleting the last remaining page
            const folders = getSortedScriptFolderNames(state.scriptFolders);
            if (folders.length <= 1) return state;

            const folderToDelete = action.value;
            if (!state.scriptFolders[folderToDelete]) {
                logger.warn("DELETE_SCRIPT_FOLDER references invalid folder", { folderName: folderToDelete }, LOG_CTX);
                return state;
            }

            const newPages: ScriptFolderMap = { ...state.scriptFolders };
            delete newPages[folderToDelete];

            // Pick a new focused page: previous in sorted order, else first remaining
            let newFolder = state.scriptFocus.folderName;
            if (folderToDelete === newFolder) {
                const idx = folders.indexOf(folderToDelete);
                const remaining = folders.filter(f => f !== folderToDelete);
                newFolder = remaining[Math.max(0, idx - 1)] ?? remaining[0] ?? '';
            }
            const newPage = newPages[newFolder];
            const newFiles = newPage ? getSortedScriptFileNames(newPage) : [];
            const newFile = newFiles[0] ?? '';

            const next: NotebookScripts = {
                ...destroyDeadScripts({
                    ...clearSemanticUserFocus(state),
                    scriptFolders: newPages,
                    scriptFocus: {
                        folderName: newFolder,
                        fileName: newFile,
                        interactionCounter: state.scriptFocus.interactionCounter + 1,
                    }
                })
            };

            storage?.write(
                groupScriptFolderWrites(next.notebookId, folderToDelete),
                { type: STORAGE_DELETE_SCRIPT_FOLDER, value: [next.notebookId, folderToDelete] },
                DEBOUNCE_DURATION_SCRIPT_WRITE
            );
            return next;
        }
        case SELECT_NEXT_SCRIPT_FOLDER: {
            const folders = getSortedScriptFolderNames(state.scriptFolders);
            const cur = folders.indexOf(state.scriptFocus.folderName);
            const nextIdx = Math.min(Math.max(cur, 0) + 1, folders.length - 1);
            const folderName = folders[nextIdx] ?? state.scriptFocus.folderName;
            const page = state.scriptFolders[folderName];
            const files = page ? getSortedScriptFileNames(page) : [];
            const fileName = files[0] ?? '';
            return {
                ...clearSemanticUserFocus(state),
                scriptFocus: { folderName, fileName, interactionCounter: state.scriptFocus.interactionCounter + 1 },
            };
        }
        case SELECT_PREV_SCRIPT_FOLDER: {
            const folders = getSortedScriptFolderNames(state.scriptFolders);
            const cur = folders.indexOf(state.scriptFocus.folderName);
            const prevIdx = Math.max((cur < 0 ? 0 : cur) - 1, 0);
            const folderName = folders[prevIdx] ?? state.scriptFocus.folderName;
            const page = state.scriptFolders[folderName];
            const files = page ? getSortedScriptFileNames(page) : [];
            const fileName = files[0] ?? '';
            return {
                ...clearSemanticUserFocus(state),
                scriptFocus: { folderName, fileName, interactionCounter: state.scriptFocus.interactionCounter + 1 },
            };
        }
        case SELECT_NEXT_SCRIPT: {
            const page = getSelectedScriptFolder(state);
            const files = page ? getSortedScriptFileNames(page) : [];
            const cur = files.indexOf(state.scriptFocus.fileName);
            const nextIdx = Math.min(Math.max(cur, 0) + 1, files.length - 1);
            const fileName = files[nextIdx] ?? state.scriptFocus.fileName;
            return {
                ...clearSemanticUserFocus(state),
                scriptFocus: { ...state.scriptFocus, fileName, interactionCounter: state.scriptFocus.interactionCounter + 1 },
            };
        }
        case SELECT_PREV_SCRIPT: {
            const page = getSelectedScriptFolder(state);
            const files = page ? getSortedScriptFileNames(page) : [];
            const cur = files.indexOf(state.scriptFocus.fileName);
            const prevIdx = Math.max((cur < 0 ? 0 : cur) - 1, 0);
            const fileName = files[prevIdx] ?? state.scriptFocus.fileName;
            return {
                ...clearSemanticUserFocus(state),
                scriptFocus: { ...state.scriptFocus, fileName, interactionCounter: state.scriptFocus.interactionCounter + 1 },
            };
        }
        case SELECT_SCRIPT: {
            const fileName = action.value;
            const page = getSelectedScriptFolder(state);
            if (!page || !page.scripts[fileName]) return state;
            return {
                ...clearSemanticUserFocus(state),
                scriptFocus: { ...state.scriptFocus, fileName },
            };
        }
        case SELECT_SCRIPT_PATH: {
            const { folderName, fileName } = action.value;
            const page = state.scriptFolders[folderName];
            if (!page || !page.scripts[fileName]) return state;
            return {
                ...clearSemanticUserFocus(state),
                scriptFocus: {
                    folderName,
                    fileName,
                    interactionCounter: state.scriptFocus.interactionCounter + 1,
                },
            };
        }

        case CATALOG_DID_UPDATE: {
            const scripts = { ...state.scripts };
            for (const scriptKey in scripts) {
                const prev = scripts[scriptKey];
                scripts[scriptKey] = {
                    ...prev,
                    scriptAnalysis: {
                        ...prev.scriptAnalysis,
                        outdated: true,
                    }
                };
            }
            return {
                ...state,
                scripts
            };
        }

        case ANALYZE_OUTDATED_SCRIPT:
            return analyzeOutdatedScript(state, action.value, logger);

        case UPDATE_FROM_PROCESSOR: {
            // Destroy the previous buffers
            const update = action.value;
            const prevScript = state.scripts[update.scriptKey];
            const prevFocus = state.semanticUserFocus;
            // If the script key does not refer to a value we know, we cannot keep the new script alive.
            // Drop the update.
            if (!prevScript) {
                update.scriptBuffers.destroy(update.scriptBuffers);
                update.scriptCursor?.destroy();
                update.scriptCompletion?.buffer.destroy();
                return clearSemanticUserFocus(state);
            }
            // Different script? This is also very disturbing
            if (prevScript.script.ptr !== update.script?.ptr) {
                update.scriptBuffers.destroy(update.scriptBuffers);
                update.scriptCursor?.destroy();
                update.scriptCompletion?.buffer.destroy();
                return clearSemanticUserFocus(state);
            }
            // Did the buffers change?
            let focusUpdate: FocusUpdate | null = null;
            if (prevScript.scriptAnalysis.buffers !== update.scriptBuffers) {
                prevScript.scriptAnalysis.buffers.destroy(prevScript.scriptAnalysis.buffers);
                focusUpdate = FocusUpdate.Clear;
            }
            // Did the cursor change?
            if (prevScript.cursor !== update.scriptCursor) {
                prevScript.cursor?.destroy();
                if (update.scriptCursor) {
                    focusUpdate = FocusUpdate.UpdateFromCursor;
                }
            }
            // Did the completion change?
            if (update.scriptCompletion) {
                if (update.scriptCompletion.buffer !== prevScript.completion?.buffer) {
                    prevScript.completion?.buffer.destroy();
                    if (update.scriptCursor) {
                        focusUpdate = FocusUpdate.UpdateFromCompletion;
                    }
                } else {
                    // Did the completion index change?
                    if (update.scriptCompletion.candidateId !== prevScript.completion?.candidateId) {
                        if (update.scriptCursor) {
                            focusUpdate = FocusUpdate.UpdateFromCompletion;
                        }
                    }
                }
            }
            // Did the pending diff change? The editor clears it on accept/reject (and auto-accept);
            // free the superseded buffer, mirroring the completion-buffer discipline above.
            if (update.scriptPendingDiff !== prevScript.pendingDiff) {
                prevScript.pendingDiff?.diffBuffer.destroy();
            }
            // Construct the new script data
            const nextScriptAnalysis: ScriptAnalysis = {
                buffers: update.scriptBuffers,
                outdated: false,
            };
            let nextScript: ScriptData = {
                ...prevScript,
                scriptAnalysis: nextScriptAnalysis,
                cursor: update.scriptCursor,
                completion: update.scriptCompletion,
                pendingDiff: update.scriptPendingDiff,
                statistics: rotateScriptStatistics(prevScript.statistics, prevScript.script.getStatistics() ?? null),
                annotations: deriveScriptAnnotations(
                    update.scriptBuffers,
                    prevScript.script,
                    logger,
                ),
            };
            // Update semantic user focus
            let semanticUserFocus: SemanticUserFocus | null = prevFocus;
            switch (focusUpdate) {
                case FocusUpdate.Clear:
                    semanticUserFocus = null;
                    break;
                case FocusUpdate.UpdateFromCursor:
                    semanticUserFocus = deriveFocusFromScriptCursor(update.scriptKey, nextScript);
                    break;
                case FocusUpdate.UpdateFromCompletion:
                    semanticUserFocus = deriveFocusFromCompletionCandidates(update.scriptKey, nextScript);
                    break;
            }
            let nextState: NotebookScripts = {
                ...state,
                scripts: {
                    ...state.scripts,
                    [update.scriptKey]: nextScript
                },
                semanticUserFocus,
            };

            // Re-load the catalog and mark scripts outdated when the analysis actually changed.
            const buffersChanged = prevScript.scriptAnalysis.buffers !== update.scriptBuffers;
            if (buffersChanged) {
                // Always load into catalog so scripts can be referenced by qualified name
                nextState.connectionCatalog!.loadScript(nextScript.script, nextScript.scriptKey);
                // Mark all other scripts as outdated.
                // Eventually, we could restrict to those that are depending?
                for (const key in nextState.scripts) {
                    const script = nextState.scripts[key];
                    nextState.scripts[key] = {
                        ...script,
                        scriptAnalysis: {
                            ...script.scriptAnalysis,
                            outdated: true,
                        }
                    };
                }
            }
            // Persist only the updated script, not the entire notebook
            const scriptKey = update.scriptKey;
            const scriptData = nextState.scripts[scriptKey];
            if (scriptData) {
                const sql = scriptData.script.toString();
                if (scriptData.folderName === '' || scriptData.fileName === '') {
                    storage?.write(
                        groupDraftWrites(nextState.notebookId),
                        { type: WRITE_SCRIPT_DRAFT, value: [nextState.notebookId, sql] },
                        DEBOUNCE_DURATION_SCRIPT_WRITE
                    );
                } else {
                    storage?.write(
                        groupScriptWrites(nextState.notebookId, scriptData.folderName, scriptData.fileName),
                        { type: WRITE_SCRIPT, value: [nextState.notebookId, scriptData.folderName, scriptData.fileName, sql] },
                        DEBOUNCE_DURATION_SCRIPT_WRITE
                    );
                }
            }
            return nextState;
        }

        case REGISTER_QUERY: {
            const [scriptKey, queryId] = action.value;
            const scriptData = state.scripts[scriptKey];
            if (!scriptData) {
                logger.warn("Orphan query references invalid script", {
                    scriptKey: scriptKey.toString(),
                    queryId: queryId.toString(),
                }, LOG_CTX);
                return state;
            } else {
                const next = { ...state };
                next.scripts[scriptKey] = {
                    ...scriptData,
                    latestQueryId: queryId,
                };
                return next;
            }
        }

        case REGISTER_AGENT_RUN: {
            const [scriptKey, runId] = action.value;
            const scriptData = state.scripts[scriptKey];
            if (!scriptData) {
                logger.warn("Orphan agent run references invalid script", {
                    scriptKey: scriptKey.toString(),
                    runId: runId.toString(),
                }, LOG_CTX);
                return state;
            } else {
                const next = { ...state };
                next.scripts[scriptKey] = {
                    ...scriptData,
                    latestAgentRunId: runId,
                };
                return next;
            }
        }

        case DELETE_SCRIPT: {
            const page = getSelectedScriptFolder(state);
            if (!page || !page.scripts[action.value]) return state;
            const deletedFileName = action.value;
            const deletedEntry = page.scripts[deletedFileName];
            const folderName = page.folderName;

            const remainingFiles = getSortedScriptFileNames(page).filter(n => n !== deletedFileName);

            // If this would empty the page
            if (remainingFiles.length === 0) {
                // If there's only one page total, prevent deletion (can't have empty notebook)
                const folders = getSortedScriptFolderNames(state.scriptFolders);
                if (folders.length <= 1) {
                    logger.info("Refusing to delete script", {}, LOG_CTX);
                    return state;
                }
                // Multiple pages exist - delete the entire page instead
                const newPages: ScriptFolderMap = { ...state.scriptFolders };
                delete newPages[folderName];

                const idx = folders.indexOf(folderName);
                const remainingFolders = folders.filter(f => f !== folderName);
                const newFolder = remainingFolders[Math.max(0, idx - 1)] ?? remainingFolders[0] ?? '';
                const newPage = newPages[newFolder];
                const newFiles = newPage ? getSortedScriptFileNames(newPage) : [];

                const next: NotebookScripts = {
                    ...destroyDeadScripts({
                        ...clearSemanticUserFocus(state),
                        scriptFolders: newPages,
                        scriptFocus: {
                            folderName: newFolder,
                            fileName: newFiles[0] ?? '',
                            interactionCounter: state.scriptFocus.interactionCounter + 1,
                        }
                    })
                };

                storage?.write(
                    groupScriptFolderWrites(next.notebookId, folderName),
                    { type: STORAGE_DELETE_SCRIPT_FOLDER, value: [next.notebookId, folderName] },
                    DEBOUNCE_DURATION_SCRIPT_WRITE
                );
                return next;
            }

            // Normal case: delete the entry from the page
            const newPageScripts = { ...page.scripts };
            delete newPageScripts[deletedFileName];
            const newPages: ScriptFolderMap = {
                ...state.scriptFolders,
                [folderName]: { ...page, scripts: newPageScripts },
            };

            // Adjust focus if needed
            let newFile = state.scriptFocus.fileName;
            if (newFile === deletedFileName) {
                const oldIdx = getSortedScriptFileNames(page).indexOf(deletedFileName);
                newFile = remainingFiles[Math.max(0, oldIdx - 1)] ?? remainingFiles[0] ?? '';
            }

            const next = destroyDeadScripts({
                ...clearSemanticUserFocus(state),
                scriptFolders: newPages,
                scriptFocus: { ...state.scriptFocus, fileName: newFile },
            });
            storage?.write(
                groupScriptDeletes(next.notebookId, folderName, deletedEntry.fileName),
                { type: STORAGE_DELETE_SCRIPT, value: [next.notebookId, folderName, deletedEntry.fileName] },
                DEBOUNCE_DURATION_SCRIPT_WRITE
            );
            return next;
        }

        case CREATE_SCRIPT: {
            const page = getSelectedScriptFolder(state);
            if (!page) return state;

            const folderName = page.folderName;
            // Plan the insertion: name the new script (sorts last) and re-pad existing scripts if the
            // prefix width grew (e.g. the 10th script). Re-pads are applied to the base maps first.
            const plan = planScriptInsertion(page.scripts);
            const fileName = plan.newFileName;
            const repadded = applyScriptRepad(plan.repad, folderName, page.scripts, state.scripts, state.scriptFocus.fileName, state.notebookId, storage);

            // Create a new script
            const script = state.instance.createScript(state.connectionCatalog);
            const scriptKey = script.getCatalogEntryId();
            // Create script data
            const scriptData: ScriptData = {
                scriptKey,
                script,
                scriptAnalysis: {
                    buffers: {
                        parsed: null,
                        analyzed: null,
                        destroy: () => { },
                    },
                    outdated: true,
                },
                statistics: Immutable.List(),
                annotations: createEmptyAnnotations(),
                cursor: null,
                completion: null,
                pendingDiff: null,
                latestQueryId: null,
                latestAgentRunId: null,
                fileName,
                folderName,
            };

            const entry: ScriptRef = createScriptRef(scriptKey, fileName);
            const newPage: ScriptFolder = {
                ...page,
                scripts: { ...repadded.pageScripts, [fileName]: entry },
            };

            const next: NotebookScripts = {
                ...clearSemanticUserFocus(state),
                scripts: {
                    ...repadded.scripts,
                    [scriptKey]: scriptData,
                },
                scriptFolders: { ...state.scriptFolders, [folderName]: newPage },
                scriptFocus: { ...state.scriptFocus, fileName },
            };
            storage?.write(
                groupScriptWrites(next.notebookId, folderName, fileName),
                { type: WRITE_SCRIPT, value: [next.notebookId, folderName, fileName, ''] },
                DEBOUNCE_DURATION_SCRIPT_WRITE
            );
            return next;
        }

        case RENAME_SCRIPT: {
            const page = getSelectedScriptFolder(state);
            if (!page) {
                logger.warn("RENAME_SCRIPT references invalid selected folder", {
                    folderName: state.scriptFocus.folderName,
                }, LOG_CTX);
                return state;
            }
            const { fileName: oldFileName, newFileName: requestedName } = action.value;
            const entry = page.scripts[oldFileName];
            if (!entry) {
                logger.warn("RENAME_SCRIPT references invalid script", {
                    folderName: page.folderName,
                    fileName: oldFileName,
                }, LOG_CTX);
                return state;
            }
            // The rename input edits the *clean* display name. Normalise whatever the user typed to a
            // bare base (drop any prefix / ".sql" they included), disambiguate it against the other
            // scripts (the clean name is the SQL reference namespace, so it must stay unique), then
            // re-attach this script's existing ordering prefix so it keeps its feed position and the
            // ".sql" extension. An empty base is ignored.
            const requestedBase = scriptDisplayName(requestedName.trim());
            if (!requestedBase) {
                return state;
            }
            const cleanBase = uniqueScriptBase(requestedBase, page.scripts, oldFileName);
            const newFileName = `${scriptOrderPrefixString(oldFileName)}${cleanBase}.sql`;
            const renamed = oldFileName !== newFileName;
            const renamedEntry: ScriptRef = { ...entry, fileName: newFileName };
            const newPageScripts = { ...page.scripts };
            if (renamed) delete newPageScripts[oldFileName];
            newPageScripts[newFileName] = renamedEntry;

            const newPages: ScriptFolderMap = {
                ...state.scriptFolders,
                [page.folderName]: { ...page, scripts: newPageScripts },
            };

            // Update the script data fileName. On rename we must re-analyze *immediately* rather than
            // just marking the analysis outdated: the clean file name is the script's SQL reference
            // namespace, so the analyzer has to re-register it in the catalog under the new notebook
            // path. Deferring this (waiting until the script is next viewed) leaves the catalog holding
            // the old notebook-path table declaration, so cross-script references — and VISUALIZE
            // script-ref completion — keep resolving to the stale name.
            const scriptId = entry.scriptId;
            const updatedScriptData = state.scripts[scriptId];
            const newScripts = { ...state.scripts };
            if (updatedScriptData) {
                const renamedScriptData: ScriptData = { ...updatedScriptData, fileName: newFileName };
                if (renamed) {
                    // Re-analyze through the path-aware helper so the analyzer picks up the new notebook
                    // path and reloads the script into the catalog under its new name.
                    newScripts[scriptId] = analyzeScriptData(renamedScriptData, state.connectionCatalog, logger);
                    // The catalog entry changed name; mark all other scripts outdated so cross-script
                    // references (qualified-name table refs, VISUALIZE script refs) re-resolve.
                    for (const key in newScripts) {
                        if (+key === scriptId) continue;
                        const other = newScripts[key];
                        newScripts[key] = {
                            ...other,
                            scriptAnalysis: { ...other.scriptAnalysis, outdated: true },
                        };
                    }
                } else {
                    newScripts[scriptId] = renamedScriptData;
                }
            }

            // Keep focus on this script across the rename
            const focusFile = state.scriptFocus.fileName === oldFileName
                ? newFileName
                : state.scriptFocus.fileName;

            const next = {
                ...(renamed ? clearSemanticUserFocus(state) : state),
                scriptFolders: newPages,
                scripts: newScripts,
                scriptFocus: { ...state.scriptFocus, fileName: focusFile },
            };
            if (renamed) {
                // Rename the file in place: its SQL is unchanged, so move it rather than delete-old +
                // rewrite-new. The new clean base is disambiguated unique within the page, so the
                // rename target never collides with another script's existing name.
                storage?.write(
                    groupScriptRenames(next.notebookId, page.folderName, oldFileName),
                    { type: STORAGE_RENAME_SCRIPT, value: [next.notebookId, page.folderName, oldFileName, newFileName] },
                    DEBOUNCE_DURATION_SCRIPT_WRITE
                );
            } else {
                // No rename: just persist the current contents under the unchanged name.
                const sql = updatedScriptData ? updatedScriptData.script.toString() : '';
                storage?.write(
                    groupScriptWrites(next.notebookId, page.folderName, newFileName),
                    { type: WRITE_SCRIPT, value: [next.notebookId, page.folderName, newFileName, sql] },
                    DEBOUNCE_DURATION_SCRIPT_WRITE
                );
            }
            return next;
        }

        case RENAME_SCRIPT_FOLDER: {
            const { folderName: oldFolderName, newFolderName: requestedName } = action.value;
            const page = state.scriptFolders[oldFolderName];
            if (!page) {
                logger.warn("RENAME_SCRIPT_FOLDER references invalid folder", {
                    folderName: oldFolderName,
                }, LOG_CTX);
                return state;
            }
            // Only the clean (display) part of the name changes here; the numeric ordering prefix is
            // (re-)derived below so the page keeps its tab slot. A rename that leaves the clean name
            // unchanged is a no-op (don't churn the disk or prefix a still-lean notebook).
            const cleanName = uniqueScriptFolderName(requestedName, state.scriptFolders, oldFolderName);
            if (normalizeScriptFolderName(oldFolderName) === cleanName) {
                return state;
            }

            // Land the renamed page directly at its final prefixed name, holding its current slot:
            // its position is its index in the current view order, padded to the notebook's width.
            // This always gives the page a numeric prefix (even one that had none, e.g. "vis_data").
            const viewOrder = getSortedScriptFolderNames(state.scriptFolders);
            const slot = viewOrder.indexOf(oldFolderName);
            const newFolderName = `${formatScriptFolderOrderPrefix(slot + 1, viewOrder.length)}${cleanName}`;

            // Re-analyze the renamed page's scripts immediately so their new catalog paths are
            // registered before any dependent script is executed. Deferring this left the catalog
            // under the old folder name and made VISUALIZE references fall through unresolved.
            const newScripts = { ...state.scripts };
            for (const fileName of getSortedScriptFileNames(page)) {
                const entry = page.scripts[fileName];
                const scriptData = newScripts[entry.scriptId];
                if (scriptData) {
                    const renamedScriptData: ScriptData = {
                        ...scriptData,
                        folderName: newFolderName,
                    };
                    newScripts[entry.scriptId] = analyzeScriptData(
                        renamedScriptData,
                        state.connectionCatalog,
                        logger,
                    );
                }
            }

            // The catalog entries above changed names. Their dependents still carry analysis against
            // the old path and must resolve again, while the renamed source scripts remain fresh.
            const renamedScriptIds = new Set(Object.values(page.scripts).map(entry => entry.scriptId));
            for (const key in newScripts) {
                if (renamedScriptIds.has(+key)) continue;
                const scriptData = newScripts[key];
                newScripts[key] = {
                    ...scriptData,
                    scriptAnalysis: { ...scriptData.scriptAnalysis, outdated: true },
                };
            }

            const newPages: ScriptFolderMap = { ...state.scriptFolders };
            delete newPages[oldFolderName];
            newPages[newFolderName] = { ...page, folderName: newFolderName };

            const newFocusFolder = state.scriptFocus.folderName === oldFolderName
                ? newFolderName
                : state.scriptFocus.folderName;

            const renamedState: NotebookScripts = {
                ...state,
                scriptFolders: newPages,
                scripts: newScripts,
                scriptFocus: { ...state.scriptFocus, folderName: newFocusFolder },
            };

            // Persist the clean rename as an in-place folder rename: the page's script files move with
            // it untouched (their file names and SQL are unchanged — only the folder path changes, and
            // the catalog path is recomputed in-memory from the new clean name). No per-script rewrite.
            storage?.write(
                groupScriptFolderRenames(renamedState.notebookId, oldFolderName),
                { type: STORAGE_RENAME_SCRIPT_FOLDER, value: [renamedState.notebookId, oldFolderName, newFolderName] },
                DEBOUNCE_DURATION_SCRIPT_WRITE
            );

            // Densely re-prefix the remaining pages so any still-unprefixed sibling is normalised and
            // the notebook converges to a uniform "<n>_<clean>" listing. The renamed page already sits
            // at its target name (its prefix matches its slot), so reprefixPages leaves it untouched.
            const reprefixed = reprefixPages(viewOrder.map(f => f === oldFolderName ? newFolderName : f), renamedState, storage);
            return reprefixed ?? renamedState;
        }

        case REORDER_SCRIPT_FOLDERS: {
            const requestedOrder = action.value;

            // Build the target order: the requested folders (that still exist, de-duplicated),
            // then any pages the caller omitted, appended in their current view order so none are
            // dropped. The result is a total order over exactly the current pages.
            const seen = new Set<string>();
            const order: string[] = [];
            for (const folder of requestedOrder) {
                if (state.scriptFolders[folder] && !seen.has(folder)) {
                    seen.add(folder);
                    order.push(folder);
                }
            }
            const currentOrder = getSortedScriptFolderNames(state.scriptFolders);
            for (const folder of currentOrder) {
                if (!seen.has(folder)) {
                    seen.add(folder);
                    order.push(folder);
                }
            }

            // If the resolved order matches the current view order, change nothing — a same-order
            // reorder must not churn the disk or prefix a still-lean notebook. (The tab UI already
            // suppresses drop-in-place; this keeps the reducer consistent for any caller.)
            if (order.length === currentOrder.length && order.every((f, i) => f === currentOrder[i])) {
                return state;
            }

            // Assign a dense ordering prefix to each page in the new order, persisting each move.
            return reprefixPages(order, state, storage) ?? state;
        }

        case REORDER_SCRIPTS: {
            // Reorder scripts within an explicitly named page. Mirrors REORDER_SCRIPT_FOLDERS but at file level:
            // dense "<n>_clean.sql" prefixes assigned in the new order, with the clean (SQL-visible)
            // file name held stable so cross-script references survive the reorder.
            const page = state.scriptFolders[action.value.folderName];
            if (!page) {
                return state;
            }
            const requestedOrder = action.value.fileNames;

            // Build the target order: the requested files (that still exist, de-duplicated), then any
            // files the caller omitted, appended in their current feed order so none are dropped.
            const seen = new Set<string>();
            const order: string[] = [];
            for (const file of requestedOrder) {
                if (page.scripts[file] && !seen.has(file)) {
                    seen.add(file);
                    order.push(file);
                }
            }
            const currentOrder = getSortedScriptFileNames(page);
            for (const file of currentOrder) {
                if (!seen.has(file)) {
                    seen.add(file);
                    order.push(file);
                }
            }

            // Same order as the current feed → change nothing (don't churn the disk).
            if (order.length === currentOrder.length && order.every((f, i) => f === currentOrder[i])) {
                return state;
            }

            // Assign a dense ordering prefix to each script in the new order, keeping its clean name.
            // A script already at its target name is left untouched (no rename, no disk churn).
            const total = order.length;
            const renames: { oldFile: string; newFile: string }[] = [];
            const newPageScripts: { [fileName: string]: ScriptRef } = {};
            const newScripts: ScriptDataMap = { ...state.scripts };
            for (let i = 0; i < order.length; ++i) {
                const oldFile = order[i];
                const entry = page.scripts[oldFile];
                const newFile = `${formatScriptOrderPrefix(i + 1, total)}${normalizeScriptName(oldFile)}`;
                if (newFile === oldFile) {
                    newPageScripts[oldFile] = entry;
                    continue;
                }
                renames.push({ oldFile, newFile });
                // The clean name is unchanged, so the catalog path is stable; no re-analyze needed.
                const sd = newScripts[entry.scriptId];
                if (sd) newScripts[entry.scriptId] = { ...sd, fileName: newFile };
                newPageScripts[newFile] = { ...entry, fileName: newFile };
            }

            if (renames.length === 0) {
                return state;
            }

            const folderName = page.folderName;
            const newPages: ScriptFolderMap = {
                ...state.scriptFolders,
                [folderName]: { ...page, scripts: newPageScripts },
            };

            // Follow the focused file across its rename.
            const focusIsInPage = state.scriptFocus.folderName === page.folderName;
            const renamedFocus = focusIsInPage
                ? renames.find(r => r.oldFile === state.scriptFocus.fileName)?.newFile
                : undefined;
            const newFocusFile = renamedFocus ?? state.scriptFocus.fileName;

            const next: NotebookScripts = {
                ...state,
                scriptFolders: newPages,
                scripts: newScripts,
                scriptFocus: { ...state.scriptFocus, fileName: newFocusFile },
            };

            // Persist each moved script as delete-old + write-new (no atomic file rename exists; this
            // mirrors RENAME_SCRIPT). Deletes and writes use distinct group keys. Clean file
            // names are NOT guaranteed unique within a page (legacy "01-script.sql"/"02-script.sql"
            // both clean to "script", and the re-pad normaliser can produce "1_script.sql"/
            // "2_script.sql"), so a permutation can map one script's new name onto another's old name
            // (e.g. swapping "1_script.sql" and "2_script.sql"). For any such reused path the write
            // already rewrites it with the moved script's content, so its delete must be suppressed —
            // otherwise the delete (on a separate keyspace from the write) races the write and can
            // clobber the file on disk.
            const targetFiles = new Set(renames.map(r => r.newFile));
            for (const { oldFile } of renames) {
                if (targetFiles.has(oldFile)) continue;
                storage?.write(
                    groupScriptDeletes(next.notebookId, folderName, oldFile),
                    { type: STORAGE_DELETE_SCRIPT, value: [next.notebookId, folderName, oldFile] },
                    DEBOUNCE_DURATION_SCRIPT_WRITE
                );
            }
            for (const { newFile } of renames) {
                const entry = newPageScripts[newFile];
                const sd = newScripts[entry.scriptId];
                const sql = sd ? sd.script.toString() : '';
                storage?.write(
                    groupScriptWrites(next.notebookId, folderName, newFile),
                    { type: WRITE_SCRIPT, value: [next.notebookId, folderName, newFile, sql] },
                    DEBOUNCE_DURATION_SCRIPT_WRITE
                );
            }
            return next;
        }

        case PROMOTE_UNCOMMITTED_SCRIPT: {
            const page = getSelectedScriptFolder(state);
            if (!page || state.uncommittedScriptId == 0) {
                return state;
            }
            const folderName = page.folderName;
            // Plan the insertion (new script sorts last; re-pad existing scripts on a width change).
            const plan = planScriptInsertion(page.scripts);
            const fileName = plan.newFileName;
            const repadded = applyScriptRepad(plan.repad, folderName, page.scripts, state.scripts, state.scriptFocus.fileName, state.notebookId, storage);

            // Append the uncommitted script as a new committed entry
            const promotedEntry = createScriptRef(state.uncommittedScriptId, fileName);

            // Update the promoted script metadata
            const promotedScriptData = repadded.scripts[state.uncommittedScriptId];
            const updatedPromotedScript = promotedScriptData ? {
                ...promotedScriptData,
                fileName,
                folderName,
            } : promotedScriptData;

            // Create a new empty uncommitted script
            const [newUncommittedKey, newUncommittedData] = createEmptyScriptData(state.instance, state.connectionCatalog);

            const newPage: ScriptFolder = {
                ...page,
                scripts: { ...repadded.pageScripts, [fileName]: promotedEntry },
            };

            const next: NotebookScripts = {
                ...clearSemanticUserFocus(state),
                scripts: {
                    ...repadded.scripts,
                    [state.uncommittedScriptId]: updatedPromotedScript,
                    [newUncommittedKey]: newUncommittedData,
                },
                scriptFolders: { ...state.scriptFolders, [folderName]: newPage },
                uncommittedScriptId: newUncommittedKey,
                scriptFocus: { ...state.scriptFocus, fileName },
            };
            const sql = updatedPromotedScript ? updatedPromotedScript.script.toString() : '';
            storage?.write(
                groupScriptWrites(next.notebookId, folderName, fileName),
                { type: WRITE_SCRIPT, value: [next.notebookId, folderName, fileName, sql] },
                DEBOUNCE_DURATION_SCRIPT_WRITE
            );
            storage?.write(
                groupDraftWrites(next.notebookId),
                { type: WRITE_SCRIPT_DRAFT, value: [next.notebookId, ''] },
                DEBOUNCE_DURATION_SCRIPT_WRITE
            );
            return next;
        }

        case SET_SCRIPT_TEXT: {
            const { scriptKey, text, withDiff } = action.value;
            const scriptData = state.scripts[scriptKey];
            if (!scriptData) {
                logger.warn("SET_SCRIPT_TEXT references invalid script", { scriptKey: scriptKey.toString() }, LOG_CTX);
                return state;
            }
            // Compute a staged diff against the prior text *before* we overwrite it (a genuine text
            // change is required — an unchanged rewrite produces no overlay). The prior script still
            // holds the old text here; diff it against a throwaway target seeded with the new text.
            const priorText = scriptData.script.toString();
            let pendingDiff: DashQLPendingDiff | null = null;
            if (withDiff && text !== priorText) {
                pendingDiff = computePendingDiff(state.instance, state.connectionCatalog, scriptData.script, text, priorText, logger);
            }
            // A staged diff on this script replaces any earlier one — free the superseded buffer.
            if (scriptData.pendingDiff != null) {
                scriptData.pendingDiff.diffBuffer.destroy();
            }
            // Rewrite the script text in-place
            scriptData.script.replaceText(text);
            // Re-analyze through the path-aware helper (destroys the stale buffers, refreshes
            // buffers + annotations incl. visualizeQuery, reloads the script into the catalog)
            const nextScriptData = analyzeScriptData(scriptData, state.connectionCatalog, logger);
            nextScriptData.pendingDiff = pendingDiff;

            const nextState: NotebookScripts = {
                ...clearSemanticUserFocus(state),
                scripts: {
                    ...state.scripts,
                    [scriptKey]: nextScriptData,
                },
            };
            // The text changed and was reloaded into the catalog; mark all other scripts
            // outdated so cross-script references re-resolve (mirrors UPDATE_FROM_PROCESSOR).
            for (const key in nextState.scripts) {
                if (+key === scriptKey) continue;
                const other = nextState.scripts[key];
                nextState.scripts[key] = {
                    ...other,
                    scriptAnalysis: { ...other.scriptAnalysis, outdated: true },
                };
            }

            // Persist only the updated script (same tail as UPDATE_FROM_PROCESSOR)
            const sql = nextScriptData.script.toString();
            if (nextScriptData.folderName === '' || nextScriptData.fileName === '') {
                storage?.write(
                    groupDraftWrites(nextState.notebookId),
                    { type: WRITE_SCRIPT_DRAFT, value: [nextState.notebookId, sql] },
                    DEBOUNCE_DURATION_SCRIPT_WRITE
                );
            } else {
                storage?.write(
                    groupScriptWrites(nextState.notebookId, nextScriptData.folderName, nextScriptData.fileName),
                    { type: WRITE_SCRIPT, value: [nextState.notebookId, nextScriptData.folderName, nextScriptData.fileName, sql] },
                    DEBOUNCE_DURATION_SCRIPT_WRITE
                );
            }
            return nextState;
        }

        case ACCEPT_PENDING_DIFF: {
            // Keep the current (new) text — SET_SCRIPT_TEXT already applied and persisted it — and
            // just drop the staged diff. Mirrors the editor's DashQLDiffAcceptEffect path, which
            // clears scriptPendingDiff without touching the rope.
            const scriptKey = action.value;
            const scriptData = state.scripts[scriptKey];
            if (!scriptData || scriptData.pendingDiff == null) {
                return state;
            }
            scriptData.pendingDiff.diffBuffer.destroy();
            return {
                ...state,
                scripts: {
                    ...state.scripts,
                    [scriptKey]: { ...scriptData, pendingDiff: null },
                },
            };
        }

        case REJECT_PENDING_DIFF: {
            // Restore the verbatim prior text and drop the staged diff. This reproduces the
            // editor's DashQLDiffRejectEffect path (restore priorText + clear) via the same tail as
            // SET_SCRIPT_TEXT, so a diff rejected from the feed and one rejected from the Details
            // editor leave identical notebook scripts state.
            const scriptKey = action.value;
            const scriptData = state.scripts[scriptKey];
            if (!scriptData || scriptData.pendingDiff == null) {
                return state;
            }
            const priorText = scriptData.pendingDiff.priorText;
            scriptData.pendingDiff.diffBuffer.destroy();
            // Rewrite the script text in-place and re-analyze through the path-aware helper.
            scriptData.script.replaceText(priorText);
            const nextScriptData = analyzeScriptData(scriptData, state.connectionCatalog, logger);
            nextScriptData.pendingDiff = null;

            const nextState: NotebookScripts = {
                ...clearSemanticUserFocus(state),
                scripts: {
                    ...state.scripts,
                    [scriptKey]: nextScriptData,
                },
            };
            // The text changed and was reloaded into the catalog; mark all other scripts
            // outdated so cross-script references re-resolve (mirrors SET_SCRIPT_TEXT).
            for (const key in nextState.scripts) {
                if (+key === scriptKey) continue;
                const other = nextState.scripts[key];
                nextState.scripts[key] = {
                    ...other,
                    scriptAnalysis: { ...other.scriptAnalysis, outdated: true },
                };
            }

            // Persist only the updated script (same tail as SET_SCRIPT_TEXT)
            const sql = nextScriptData.script.toString();
            if (nextScriptData.folderName === '' || nextScriptData.fileName === '') {
                storage?.write(
                    groupDraftWrites(nextState.notebookId),
                    { type: WRITE_SCRIPT_DRAFT, value: [nextState.notebookId, sql] },
                    DEBOUNCE_DURATION_SCRIPT_WRITE
                );
            } else {
                storage?.write(
                    groupScriptWrites(nextState.notebookId, nextScriptData.folderName, nextScriptData.fileName),
                    { type: WRITE_SCRIPT, value: [nextState.notebookId, nextScriptData.folderName, nextScriptData.fileName, sql] },
                    DEBOUNCE_DURATION_SCRIPT_WRITE
                );
            }
            return nextState;
        }

        case CREATE_SCRIPT_WITH_TEXT: {
            const page = getSelectedScriptFolder(state);
            if (!page) return state;

            const { text } = action.value;
            const folderName = page.folderName;
            // Plan the insertion (new script sorts last; re-pad existing scripts on a width change).
            const plan = planScriptInsertion(page.scripts);
            const fileName = plan.newFileName;
            const repadded = applyScriptRepad(plan.repad, folderName, page.scripts, state.scripts, state.scriptFocus.fileName, state.notebookId, storage);

            // Create a new script seeded with the provided text
            const script = state.instance.createScript(state.connectionCatalog);
            const scriptKey = script.getCatalogEntryId();
            script.replaceText(text);

            let scriptData: ScriptData = {
                scriptKey,
                script,
                scriptAnalysis: {
                    buffers: {
                        parsed: null,
                        analyzed: null,
                        destroy: () => { },
                    },
                    outdated: true,
                },
                statistics: Immutable.List(),
                annotations: createEmptyAnnotations(),
                cursor: null,
                completion: null,
                pendingDiff: null,
                latestQueryId: null,
                latestAgentRunId: null,
                fileName,
                folderName,
            };

            const entry: ScriptRef = createScriptRef(scriptKey, fileName);
            const newPage: ScriptFolder = {
                ...page,
                scripts: { ...repadded.pageScripts, [fileName]: entry },
            };
            const newPages: ScriptFolderMap = { ...state.scriptFolders, [folderName]: newPage };
            const newScripts: ScriptDataMap = { ...repadded.scripts, [scriptKey]: scriptData };

            // Analyze before persisting so derived annotations are ready.
            scriptData = analyzeScriptData(scriptData, state.connectionCatalog, logger);
            newScripts[scriptKey] = scriptData;

            const next: NotebookScripts = {
                ...clearSemanticUserFocus(state),
                scripts: newScripts,
                scriptFolders: newPages,
                scriptFocus: { ...state.scriptFocus, fileName },
            };
            const sql = scriptData.script.toString();
            storage?.write(
                groupScriptWrites(next.notebookId, folderName, fileName),
                { type: WRITE_SCRIPT, value: [next.notebookId, folderName, fileName, sql] },
                DEBOUNCE_DURATION_SCRIPT_WRITE
            );
            return next;
        }
    }
}

export function clearSemanticUserFocus<V extends NotebookScriptsInput>(state: V): V {
    return { ...state, semanticUserFocus: null };
}
export function replaceCursorIfChanged(state: ScriptData, cursor: core.FlatBufferPtr<core.buffers.cursor.ScriptCursor>): ScriptData {
    if (state.cursor && !state.cursor.equals(cursor)) {
        state.cursor.destroy();
    }
    return { ...state, cursor };
}

function destroyScriptData(data: ScriptData) {
    data.scriptAnalysis.buffers.destroy(data.scriptAnalysis.buffers);
    data.script.destroy();
    data.completion?.buffer.destroy();
    data.pendingDiff?.diffBuffer.destroy();
    data.cursor?.destroy();
    for (const stats of data.statistics) {
        stats.destroy();
    }
}

export function destroyNotebookScripts(state: NotebookScripts): NotebookScripts {
    // Drop the script from the connection catalog
    for (const scriptData of Object.values(state.scripts)) {
        if (scriptData.script) {
            state.connectionCatalog.dropScript(scriptData.script);
        }
    }
    // Destroy all the script data
    for (const key in state.scripts) {
        const script = state.scripts[key];
        destroyScriptData(script);
    }
    return state;
}

/// Replace persisted notebook content without scheduling writes back to storage.
///
/// Scripts that remain at the same page/file path retain their WASM identity, query history and UI
/// references. Added and removed paths allocate/free their WASM state here, where the catalog and
/// script-registry lifetime rules are already centralized.
export function replaceNotebookScriptsFromStorage(
    state: NotebookScripts,
    snapshot: NotebookScriptsStorageSnapshot,
    _logger: Logger,
    catalogChanged: boolean = false,
): NotebookScripts {
    const existingByPath = new Map<string, ScriptData>();
    for (const script of Object.values(state.scripts)) {
        if (script.folderName && script.fileName) {
            existingByPath.set(`${script.folderName}/${script.fileName}`, script);
        }
    }

    const scripts: ScriptDataMap = {};
    const scriptFolders: ScriptFolderMap = {};
    let contentChanged = false;

    for (const page of snapshot.folders) {
        const pageScripts: { [fileName: string]: ScriptRef } = {};
        for (const stored of page.scripts) {
            const path = `${page.name}/${stored.name}`;
            let scriptData = existingByPath.get(path);
            if (scriptData) {
                existingByPath.delete(path);
                if (scriptData.script.toString() !== stored.sql) {
                    scriptData.pendingDiff?.diffBuffer.destroy();
                    scriptData.completion?.buffer.destroy();
                    scriptData.script.replaceText(stored.sql);
                    scriptData = {
                        ...scriptData,
                        pendingDiff: null,
                        completion: null,
                        scriptAnalysis: { ...scriptData.scriptAnalysis, outdated: true },
                    };
                    contentChanged = true;
                }
            } else {
                const [scriptKey, created] = createEmptyScriptData(state.instance, state.connectionCatalog, stored.name, page.name);
                created.script.replaceText(stored.sql);
                scriptData = created;
                contentChanged = true;
            }
            scripts[scriptData.scriptKey] = scriptData;
            pageScripts[stored.name] = createScriptRef(scriptData.scriptKey, stored.name);
        }
        scriptFolders[page.name] = { folderName: page.name, scripts: pageScripts };
    }

    // Files no longer present on disk own WASM objects that must be detached before destruction.
    for (const removed of existingByPath.values()) {
        try {
            state.connectionCatalog.dropScript(removed.script);
        } catch {
            // The script may not have completed analysis and therefore may not be in the catalog.
        }
        destroyScriptData(removed);
        contentChanged = true;
    }

    // The composer is not part of a page and retains its identity across reloads.
    let draft = state.scripts[state.uncommittedScriptId];
    if (!draft) {
        const [draftKey, created] = createEmptyScriptData(state.instance, state.connectionCatalog);
        draft = created;
        state = { ...state, uncommittedScriptId: draftKey };
        contentChanged = true;
    }
    const draftSql = snapshot.draft ?? '';
    if (draft.script.toString() !== draftSql) {
        draft.pendingDiff?.diffBuffer.destroy();
        draft.completion?.buffer.destroy();
        draft.script.replaceText(draftSql);
        draft = {
            ...draft,
            pendingDiff: null,
            completion: null,
            scriptAnalysis: { ...draft.scriptAnalysis, outdated: true },
        };
        contentChanged = true;
    }
    scripts[draft.scriptKey] = draft;

    // Match boot restoration: an empty on-disk notebook still has one virtual page in the UI.
    if (Object.keys(scriptFolders).length === 0) {
        scriptFolders['Untitled'] = { folderName: 'Untitled', scripts: {} };
    }

    const folders = getSortedScriptFolderNames(scriptFolders);
    const previousFolder = state.scriptFocus.folderName;
    const folderName = scriptFolders[previousFolder] ? previousFolder : (folders[0] ?? '');
    const files = folderName ? getSortedScriptFileNames(scriptFolders[folderName]) : [];
    const previousFile = state.scriptFocus.fileName;
    const fileName = scriptFolders[folderName]?.scripts[previousFile] ? previousFile : (files[0] ?? '');

    let next: NotebookScripts = {
        ...clearSemanticUserFocus(state),
        scripts,
        scriptFolders,
        scriptFocus: {
            ...state.scriptFocus,
            folderName,
            fileName,
        },
    };

    if (contentChanged || catalogChanged) {
        // Cross-script references can be affected by any add/remove/content or catalog change.
        // Invalidate the notebook and let each script reanalyze at its next explicit use.
        for (const key in next.scripts) {
            next.scripts[key] = {
                ...next.scripts[key],
                scriptAnalysis: { ...next.scripts[key].scriptAnalysis, outdated: true },
            };
        }
    }
    return next;
}

function destroyDeadScripts(state: NotebookScripts): NotebookScripts {
    // Determine script liveness: any script referenced in any page is live
    let deadScripts = new Map<number, ScriptData>();
    for (const key in state.scripts) {
        deadScripts.set(+key, state.scripts[key]);
    }
    for (const folder in state.scriptFolders) {
        const page = state.scriptFolders[folder];
        for (const fileName in page.scripts) {
            deadScripts.delete(page.scripts[fileName].scriptId);
        }
    }
    deadScripts.delete(state.uncommittedScriptId);
    // Nothing to cleanup?
    if (deadScripts.size == 0) {
        return state;
    }
    // Copy scripts
    const cleanedScripts: ScriptDataMap = { ...state.scripts };
    // Delete scripts
    for (const [k, v] of deadScripts) {
        if (v.script) {
            state.connectionCatalog.dropScript(v.script);
        }
        destroyScriptData(v);
        delete cleanedScripts[k];
    }
    return { ...state, scripts: cleanedScripts };
}

export function rotateScriptStatistics(
    log: Immutable.List<core.FlatBufferPtr<core.buffers.statistics.ScriptStatistics>>,
    stats: core.FlatBufferPtr<core.buffers.statistics.ScriptStatistics> | null,
) {
    if (stats == null) {
        return log;
    } else {
        return log.withMutations(m => {
            m.push(stats);
            if (m.size > STATS_HISTORY_LIMIT) {
                m.first()!.destroy();
                m.shift();
            }
        });
    }
}

function deriveScriptAnnotations(
    data: DashQLScriptBuffers,
    script: core.DashQLScript,
    logger?: LoggerLike,
): ScriptAnnotations {
    if (!data.analyzed) {
        return createEmptyAnnotations();
    }
    const reader = data.analyzed.read();

    // Collect the table definitions
    const tableDefs: Set<string> = new Set();
    const tmpTable = new core.buffers.analyzer.Table();
    const tmpQualified = new core.buffers.analyzer.QualifiedTableName();
    for (let i = 0; i < reader.tablesLength(); ++i) {
        const table = reader.tables(i, tmpTable)!;
        const qualified = table.tableName(tmpQualified)!;
        const tableName = qualified.tableName();
        if (tableName) {
            tableDefs.add(tableName);
        }
    }
    let tableDefsFlat: string[] = [...tableDefs.values()];
    tableDefsFlat = tableDefsFlat.sort();

    const visualizeQuery = compileVisualizeQuery(script, logger);

    return {
        tableRefs: [],
        tableDefs: tableDefsFlat,
        restrictedColumns: [],
        visualizeQuery,
    };
}

/// Compile a script into executable SQL.
///
/// Statement classification, executable SQL extraction, and VISUALIZE
/// source extraction all happen in dashql-core.
export function compileQuery(
    scriptData: ScriptData,
    logger?: LoggerLike,
): string {
    const compiled = scriptData.script.compileQuery(executionFormattingConfig());
    try {
        const reader = compiled.read();
        if (reader.errorsLength() > 0) {
            const error = reader.errors(0);
            throw new LoggableException(error?.message() ?? 'Could not compile query', {
                scriptKey: scriptData.scriptKey.toString(),
                folderName: scriptData.folderName,
                fileName: scriptData.fileName,
                errorCode: error?.code().toString(),
            }, LOG_CTX);
        }
        const sql = reader.sql() ?? '';
        if (sql.trim().length == 0) {
            throw new LoggableException('Compile query is empty', {
                scriptKey: scriptData.scriptKey.toString(),
                folderName: scriptData.folderName,
                fileName: scriptData.fileName,
                scritp: scriptData.script.toString(),
            }, LOG_CTX);
        }
        logger?.debug('Compiled script for query execution', { sql }, LOG_CTX);
        return sql;
    } finally {
        compiled.destroy();
    }
}

function executionFormattingConfig(): core.buffers.formatting.FormattingConfigT {
    return new core.buffers.formatting.FormattingConfigT(
        core.buffers.formatting.FormattingDialect.HYPER,
        core.buffers.formatting.FormattingMode.INLINE,
        120,
        2,
        false,
    );
}

function compileVisualizeQuery(script: core.DashQLScript, logger?: LoggerLike): ResolvedVisualizeQuery | null {
    const compiled = script.compileQuery(executionFormattingConfig());
    try {
        const reader = compiled.read();
        if (reader.errorsLength() > 0 ||
            reader.kind() !== core.buffers.execution.ScriptCompilationStatementKind.VISUALIZE) {
            return null;
        }
        const sql = reader.sql();
        const visualization = reader.visualization();
        if (!sql || !visualization) return null;
        logger?.debug('Compiled visualization for execution', { sql }, LOG_CTX);
        if (visualization.renderer() === 'umap') {
            const raw = visualization.umapSpec();
            const umapSpec = raw ? parseUmapSpec(raw) : null;
            return umapSpec ? { renderer: 'umap', sql, umapSpec } : null;
        }
        const raw = visualization.vegaliteSpec();
        if (!raw) return null;
        try {
            return { renderer: 'vegalite', sql, vegaLiteSpec: JSON.parse(raw) };
        } catch {
            return null;
        }
    } finally {
        compiled.destroy();
    }
}

/// Compute a staged, statement-level semantic diff from a script's prior text to a new text.
///
/// `priorScript` still holds the old text; it is parsed here (parsing suffices for the AST the diff
/// needs). The new text is loaded into a throwaway target script created in a fresh catalog so it
/// never touches the notebook's catalog. Returns null (and logs) on any failure, so a diff problem
/// never blocks applying the rewrite. The returned FlatBufferPtr is owned by the caller (stored on
/// ScriptData.pendingDiff, freed when the diff is superseded, accepted/rejected, or the script is
/// destroyed).
function computePendingDiff(
    instance: core.DashQL,
    _catalog: core.DashQLCatalog,
    priorScript: core.DashQLScript,
    newText: string,
    priorText: string,
    logger: Logger,
): DashQLPendingDiff | null {
    let targetCatalog: core.DashQLCatalog | null = null;
    let targetScript: core.DashQLScript | null = null;
    try {
        // Ensure the prior script is parsed (the diff walks the parsed AST).
        priorScript.parse();
        // Seed a throwaway target with the new text in its own catalog (kept out of the notebook's).
        targetCatalog = instance.createCatalog();
        targetScript = instance.createScript(targetCatalog);
        targetScript.insertTextAt(0, newText);
        targetScript.parse();
        const diffBuffer = priorScript.computeDiff(targetScript);
        return { priorText, diffBuffer };
    } catch (e: any) {
        logger.warn("Failed to compute script diff", { error: stringifyError(e) }, LOG_CTX);
        return null;
    } finally {
        targetScript?.destroy();
        targetCatalog?.destroy();
    }
}

export function analyzeScriptData(scriptData: ScriptData, _catalog: core.DashQLCatalog, logger: Logger): ScriptData {
    const next: ScriptData = { ...scriptData };
    next.scriptAnalysis.buffers.destroy(next.scriptAnalysis.buffers);

    // Analyze the script
    // Capture the underlying failure so callers can log it with notebook/script context
    // instead of writing it directly to the console.
    let analyzeError: unknown = null;
    const buffers = analyzeScript(next.script, (error) => { analyzeError = error; });
    if (buffers.analyzed == null) {
        buffers.destroy(buffers);
        throw analyzeError ?? new Error("Failed to analyze script");
    }
    next.scriptAnalysis = { buffers, outdated: false };
    // Rotate the script statistics
    next.statistics = rotateScriptStatistics(next.statistics, next.script.getStatistics() ?? null);
    // Derive script annotations (incl. resolved VISUALIZE query)
    next.annotations = deriveScriptAnnotations(
        next.scriptAnalysis.buffers,
        next.script,
        logger,
    );

    // Update the cursor?
    if (next.cursor != null) {
        const cursor = next.cursor.read();
        const textOffset = cursor.textOffset();
        next.cursor.destroy();
        next.cursor = next.script.moveCursor(textOffset);
    }
    return next;
}

export function analyzeOutdatedScript<V extends NotebookScriptsInput>(state: V, scriptKey: number, logger: Logger): V {
    const scriptData = state.scripts[scriptKey];
    if (!scriptData || !scriptData.scriptAnalysis.outdated) {
        return state;
    }
    // Create the next notebook scripts state
    const nextScriptData = analyzeScriptData(scriptData, state.connectionCatalog, logger);
    const next = {
        ...clearSemanticUserFocus(state),
        scripts: {
            ...state.scripts,
            [scriptKey]: nextScriptData
        }
    };

    // Re-derive the semantic user focus if there is still a cursor
    if (nextScriptData.cursor != null) {
        next.semanticUserFocus = deriveFocusFromScriptCursor(scriptKey, nextScriptData);
    }
    return next;
}
