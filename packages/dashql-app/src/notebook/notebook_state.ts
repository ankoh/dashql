import * as core from '../core/index.js';
import * as Immutable from 'immutable';

import { analyzeScript, DashQLCompletionState, DashQLProcessorUpdateOut, DashQLScriptBuffers } from '../view/editor/dashql_processor.js';
import { deriveFocusFromCompletionCandidates, deriveFocusFromScriptCursor, SemanticUserFocus } from './focus.js';
import { ConnectorInfo } from '../connection/connector_info.js';
import { resolveVisualizeQuery, ScriptTextByPath } from '../connection/visualize_executor.js';
import { VariantKind } from '../utils/index.js';
import { REPLACE_NOTEBOOK, CREATE_NOTEBOOK_PAGE, DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE, DEBOUNCE_DURATION_NOTEBOOK_WRITE, DELETE_NOTEBOOK_PAGE, DELETE_NOTEBOOK_SCRIPT, groupDraftWrites, groupNotebookWrites, groupPageRenames, groupPageWrites, groupScriptDeletes, groupScriptRenames, groupScriptWrites, RENAME_NOTEBOOK_PAGE, RENAME_NOTEBOOK_SCRIPT, StorageWriter, WRITE_NOTEBOOK_DRAFT, WRITE_NOTEBOOK_SCRIPT } from '../platform/storage/storage_writer.js';
import { NotebookStateWithoutId } from './notebook_state_registry.js';
import { Logger, stringifyError } from '../platform/logger/logger.js';
import { NotebookScriptAnnotations, NotebookPage, NotebookPageScript, NotebookMetadata as NotebookMetadataType, createEmptyAnnotations, createPageScript, generateScriptFileName, planScriptInsertion, normalizePageName, formatPageOrderPrefix, normalizeScriptName, scriptOrderPrefixString, formatScriptOrderPrefix, scriptDisplayName, uniqueScriptBase } from './notebook_types.js';

const LOG_CTX = 'notebook_state';

/// A script key
export type ScriptKey = number;
/// A script data map
export type ScriptDataMap = { [scriptKey: number]: ScriptData };
/// A page map keyed by folder name
export type NotebookPageMap = { [folderName: string]: NotebookPage };

/// A notebook metadata
export interface NotebookMetadata {
    /// The file name of the notebook
    fileName: string;
}

/// A notebook user focus
export interface NotebookUserFocus {
    /// The folder name of the selected page (empty if none)
    folderName: string;
    /// The file name of the selected entry within the page (empty if none)
    fileName: string;
    /// Monotonic counter incremented only by explicit navigation (Next/Prev Script/Page), used to trigger auto-scroll
    interactionCounter: number;
}

/// The state of the notebook
export interface NotebookState {
    /// The notebook state contains many references into the Wasm heap.
    /// It therefore makes sense that notebook state users resolve the "right" module through here.
    instance: core.DashQL;
    /// The session identifier - fully qualified path (e.g., "opfs://sessions/<uuid>")
    sessionId: string;
    /// The notebook metadata
    notebookMetadata: NotebookMetadataType;
    /// The connector info
    connectorInfo: ConnectorInfo;
    /// The connection catalog
    connectionCatalog: core.DashQLCatalog;
    /// The script registry
    scriptRegistry: core.DashQLScriptRegistry;
    /// The scripts
    scripts: ScriptDataMap;
    /// The notebook pages keyed by folder name. View order is by name.
    notebookPages: NotebookPageMap;
    /// The uncommitted script id for the notebook-level composer.
    uncommittedScriptId: number;
    /// The notebook focus (selected page and entry by name)
    notebookUserFocus: NotebookUserFocus;
    /// The semantic user focus info (if any)
    semanticUserFocus: SemanticUserFocus | null;
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
    annotations: NotebookScriptAnnotations;
    /// The statistics
    statistics: Immutable.List<core.FlatBufferPtr<core.buffers.statistics.ScriptStatistics>>;
    /// The cursor
    cursor: core.FlatBufferPtr<core.buffers.cursor.ScriptCursor> | null;
    /// The completion state.
    completion: DashQLCompletionState | null;
    /// The latest query id
    latestQueryId: number | null;
    /// The file name of this script (empty string for uncommitted/draft script)
    fileName: string;
    /// The folder name of the page this script belongs to (empty string for uncommitted/draft script)
    folderName: string;
}

export const SELECT_PAGE = Symbol('SELECT_PAGE');
export const CREATE_PAGE = Symbol('CREATE_PAGE');
export const DELETE_PAGE = Symbol('DELETE_PAGE');
export const SELECT_NEXT_PAGE = Symbol('SELECT_NEXT_PAGE');
export const SELECT_PREV_PAGE = Symbol('SELECT_PREV_PAGE');
export const SELECT_NEXT_ENTRY = Symbol('SELECT_NEXT_ENTRY');
export const SELECT_PREV_ENTRY = Symbol('SELECT_PREV_ENTRY');
export const SELECT_ENTRY = Symbol('SELECT_ENTRY');
export const ANALYZE_OUTDATED_SCRIPT = Symbol('ANALYZE_OUTDATED_SCRIPT');
export const UPDATE_FROM_PROCESSOR = Symbol('UPDATE_FROM_PROCESSOR');
export const CATALOG_DID_UPDATE = Symbol('CATALOG_DID_UPDATE');
export const REGISTER_QUERY = Symbol('REGISTER_QUERY');
export const CREATE_NOTEBOOK_ENTRY = Symbol('CREATE_NOTEBOOK_ENTRY');
export const DELETE_NOTEBOOK_ENTRY = Symbol('DELETE_NOTEBOOK_ENTRY');
export const UPDATE_NOTEBOOK_ENTRY = Symbol('UPDATE_NOTEBOOK_ENTRY');
export const UPDATE_PAGE_FOLDER_NAME = Symbol('UPDATE_PAGE_FOLDER_NAME');
export const REORDER_PAGES = Symbol('REORDER_PAGES');
export const REORDER_NOTEBOOK_SCRIPTS = Symbol('REORDER_NOTEBOOK_SCRIPTS');
export const PROMOTE_UNCOMMITTED_SCRIPT = Symbol('PROMOTE_UNCOMMITTED_SCRIPT');
export const SET_SCRIPT_TEXT = Symbol('SET_SCRIPT_TEXT');
export const CREATE_NOTEBOOK_ENTRY_WITH_TEXT = Symbol('CREATE_NOTEBOOK_ENTRY_WITH_TEXT');

export type NotebookStateAction =
    | VariantKind<typeof SELECT_PAGE, string>
    | VariantKind<typeof CREATE_PAGE, null>
    | VariantKind<typeof DELETE_PAGE, string>
    | VariantKind<typeof SELECT_NEXT_PAGE, null>
    | VariantKind<typeof SELECT_PREV_PAGE, null>
    | VariantKind<typeof SELECT_NEXT_ENTRY, null>
    | VariantKind<typeof SELECT_PREV_ENTRY, null>
    | VariantKind<typeof SELECT_ENTRY, string>
    | VariantKind<typeof ANALYZE_OUTDATED_SCRIPT, ScriptKey>
    | VariantKind<typeof UPDATE_FROM_PROCESSOR, DashQLProcessorUpdateOut>
    | VariantKind<typeof CATALOG_DID_UPDATE, null>
    | VariantKind<typeof REGISTER_QUERY, [ScriptKey, number]>
    | VariantKind<typeof CREATE_NOTEBOOK_ENTRY, null>
    | VariantKind<typeof DELETE_NOTEBOOK_ENTRY, string>
    | VariantKind<typeof UPDATE_NOTEBOOK_ENTRY, { fileName: string, newFileName: string }>
    | VariantKind<typeof UPDATE_PAGE_FOLDER_NAME, { folderName: string, newFolderName: string }>
    | VariantKind<typeof REORDER_PAGES, string[]>  // folder names in the desired new view order
    | VariantKind<typeof REORDER_NOTEBOOK_SCRIPTS, string[]>  // file names of the selected page in the desired new feed order
    | VariantKind<typeof PROMOTE_UNCOMMITTED_SCRIPT, null>
    | VariantKind<typeof SET_SCRIPT_TEXT, { scriptKey: ScriptKey, text: string }>
    | VariantKind<typeof CREATE_NOTEBOOK_ENTRY_WITH_TEXT, { text: string }>
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
        latestQueryId: null,
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
function uniqueFolderName(baseName: string, pages: NotebookPageMap, excludeFolder: string = ''): string {
    const base = normalizePageName(baseName);
    const takenCleanNames = new Set<string>();
    for (const key in pages) {
        if (key === excludeFolder) continue;
        takenCleanNames.add(normalizePageName(key));
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
export function getSortedFolderNames(pages: NotebookPageMap): string[] {
    return sortFolderNamesNumerically(Object.keys(pages));
}

/// Sort raw folder names with the numeric-aware ordering used for the tab bar. Exposed so callers
/// that only have the names (and not a full NotebookPageMap) order them identically.
export function sortFolderNamesNumerically(folderNames: string[]): string[] {
    return [...folderNames].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/// Returns the sorted list of file names within a page.
///
/// File names may carry a numeric ordering prefix ("2_extract.sql"); sorting numerically (matching
/// the storage backends' natural sort on load) yields the intended feed order and keeps a script in
/// place when its prefix width grows (e.g. "9_x.sql" before "10_y.sql").
export function getSortedFileNames(page: NotebookPage): string[] {
    return Object.keys(page.scripts).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/// Returns the currently selected page, or undefined if none.
export function getSelectedPage(state: NotebookState): NotebookPage | undefined {
    const folder = state.notebookUserFocus.folderName;
    if (folder && state.notebookPages[folder]) return state.notebookPages[folder];
    // Fall back to the first page in sorted order
    const folders = getSortedFolderNames(state.notebookPages);
    return folders.length > 0 ? state.notebookPages[folders[0]] : undefined;
}

/// Returns the script entries of the selected page, sorted by file name.
export function getSelectedPageEntries(state: NotebookState): NotebookPageScript[] {
    const page = getSelectedPage(state);
    if (!page) return [];
    return getSortedFileNames(page).map(name => page.scripts[name]);
}

/// Returns the uncommitted script data for the notebook-level composer, or null if none.
export function getUncommittedScriptData(state: NotebookState): ScriptData | null {
    if (state.uncommittedScriptId === 0) return null;
    return state.scripts[state.uncommittedScriptId] ?? null;
}

/// Returns the currently selected entry (script ref) in the selected page, or undefined.
export function getSelectedEntry(state: NotebookState): NotebookPageScript | undefined {
    const page = getSelectedPage(state);
    if (!page) return undefined;
    const file = state.notebookUserFocus.fileName;
    if (file && page.scripts[file]) return page.scripts[file];
    // Fall back to first sorted entry
    const files = getSortedFileNames(page);
    return files.length > 0 ? page.scripts[files[0]] : undefined;
}

/// Returns the index of the selected entry in the sorted entry list, or -1.
export function getSelectedEntryIndex(state: NotebookState): number {
    const page = getSelectedPage(state);
    if (!page) return -1;
    const file = state.notebookUserFocus.fileName;
    if (!file) return -1;
    const files = getSortedFileNames(page);
    return files.indexOf(file);
}

/// Returns the index of the selected page in the sorted page list, or -1.
export function getSelectedPageIndex(state: NotebookState): number {
    const folders = getSortedFolderNames(state.notebookPages);
    return folders.indexOf(state.notebookUserFocus.folderName);
}

/// Apply a script re-pad plan (from planScriptInsertion) to a page in place: rename the listed
/// scripts in the page-scripts map and the scripts map, follow the focused file, and persist each as
/// delete-old + write-new. Re-padding only changes a script's prefix width (and normalises a legacy
/// "-" separator), never its clean name, so the catalog path is stable and no re-analyze is needed.
/// Returns the updated maps and focus; the caller weaves them into the new state it is building.
function applyScriptRepad(
    repad: { oldFileName: string; newFileName: string }[],
    folderName: string,
    pageScripts: { [fileName: string]: NotebookPageScript },
    scripts: ScriptDataMap,
    focusFileName: string,
    sessionId: string,
    storage: StorageWriter | null,
): { pageScripts: { [fileName: string]: NotebookPageScript }; scripts: ScriptDataMap; focusFileName: string } {
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
                groupScriptDeletes(sessionId, folderName, oldFileName),
                { type: DELETE_NOTEBOOK_SCRIPT, value: [sessionId, folderName, oldFileName] },
                DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
            );
        }
        const sql = nextScripts[entry.scriptId]?.script.toString() ?? '';
        storage?.write(
            groupScriptWrites(sessionId, folderName, newFileName),
            { type: WRITE_NOTEBOOK_SCRIPT, value: [sessionId, folderName, newFileName, sql] },
            DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
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
/// untouched (no rename, no disk churn) — this keeps a still-lean session lean until something
/// actually moves it. Persists each real rename as delete-old + create-new (no backend has an atomic
/// folder rename), mirroring REORDER_PAGES/UPDATE_PAGE_FOLDER_NAME. Returns null when nothing moved.
///
/// `unpersistedFolder` names a page that exists only in the staged in-memory `state` and was never
/// written to disk (the freshly created page in CREATE_PAGE): there is nothing on disk to rename, so
/// it is created under its final prefixed name instead of moved.
function reprefixPages(
    order: string[],
    state: NotebookState,
    storage: StorageWriter | null,
    unpersistedFolder: string = '',
): NotebookState | null {
    const total = order.length;
    const renames: { oldFolder: string; newFolder: string }[] = [];
    const newPages: NotebookPageMap = {};
    const newScripts: ScriptDataMap = { ...state.scripts };
    for (let i = 0; i < order.length; ++i) {
        const oldFolder = order[i];
        const page = state.notebookPages[oldFolder];
        const newFolder = `${formatPageOrderPrefix(i + 1, total)}${normalizePageName(oldFolder)}`;
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

    const newFocusFolder = renames.find(r => r.oldFolder === state.notebookUserFocus.folderName)?.newFolder
        ?? state.notebookUserFocus.folderName;

    const next: NotebookState = {
        ...state,
        notebookPages: newPages,
        scripts: newScripts,
        notebookUserFocus: { ...state.notebookUserFocus, folderName: newFocusFolder },
    };

    // Persist each moved page as an in-place folder rename (the backend moves its contents with it —
    // no per-script rewrite). Renames live in their own `rename:` keyspace keyed by the source folder,
    // so a content write of the destination folder never coalesces onto, and clobbers, a pending move.
    // Page clean names are unique (uniqueFolderName), so within one reorder the rename destinations are
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
                groupPageWrites(next.sessionId, newFolder),
                { type: CREATE_NOTEBOOK_PAGE, value: [next.sessionId, newFolder, scriptEntries] },
                DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
            );
            continue;
        }
        storage?.write(
            groupPageRenames(next.sessionId, oldFolder),
            { type: RENAME_NOTEBOOK_PAGE, value: [next.sessionId, oldFolder, newFolder] },
            DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
        );
    }
    return next;
}

export function reduceNotebookState(state: NotebookState, action: NotebookStateAction, storageArg: StorageWriter, logger: Logger, active: boolean): NotebookState {
    // Suppress storage writes when the connection is not yet active
    const storage = active ? storageArg : null;
    switch (action.type) {
        case SELECT_PAGE: {
            const folderName = action.value;
            if (!state.notebookPages[folderName]) return state;
            const page = state.notebookPages[folderName];
            const files = getSortedFileNames(page);
            const fileName = files.length > 0 ? files[0] : '';
            return {
                ...clearSemanticUserFocus(state),
                notebookUserFocus: { folderName, fileName, interactionCounter: state.notebookUserFocus.interactionCounter + 1 },
            };
        }
        case CREATE_PAGE: {
            const folderName = uniqueFolderName('Untitled', state.notebookPages);
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
                latestQueryId: null,
                fileName,
                folderName,
            };

            const entry = createPageScript(scriptKey, fileName);
            const newPage: NotebookPage = {
                folderName,
                scripts: { [fileName]: entry },
            };

            // Stage the new (still prefix-free) page, then densely re-prefix every page so the new one
            // lands fully to the right with a numeric prefix. Re-prefixing also normalises any
            // still-unprefixed sibling (e.g. a legacy "vis_data" -> "3_vis_data"), keeping the on-disk
            // tab order uniform. The new page is appended last in the desired order; passing it as the
            // unpersisted folder makes reprefixPages emit only its create (never a delete-of-nothing).
            const staged: NotebookState = {
                ...clearSemanticUserFocus(state),
                scripts: {
                    ...state.scripts,
                    [scriptKey]: scriptData,
                },
                notebookPages: { ...state.notebookPages, [folderName]: newPage },
                notebookUserFocus: { folderName, fileName, interactionCounter: state.notebookUserFocus.interactionCounter + 1 },
            };
            const order = [...getSortedFolderNames(state.notebookPages), folderName];
            const reprefixed = reprefixPages(order, staged, storage, folderName);
            // A freshly created page is always prefix-free while its target carries a prefix, so it
            // always moves and reprefixPages returns non-null (emitting the create under the final
            // name). The `?? staged` is a defensive fallback that should not be reached in practice.
            return reprefixed ?? staged;
        }
        case DELETE_PAGE: {
            // Prevent deleting the last remaining page
            const folders = getSortedFolderNames(state.notebookPages);
            if (folders.length <= 1) return state;

            const folderToDelete = action.value;
            if (!state.notebookPages[folderToDelete]) {
                console.warn("Delete references invalid page");
                return state;
            }

            const newPages: NotebookPageMap = { ...state.notebookPages };
            delete newPages[folderToDelete];

            // Pick a new focused page: previous in sorted order, else first remaining
            let newFolder = state.notebookUserFocus.folderName;
            if (folderToDelete === newFolder) {
                const idx = folders.indexOf(folderToDelete);
                const remaining = folders.filter(f => f !== folderToDelete);
                newFolder = remaining[Math.max(0, idx - 1)] ?? remaining[0] ?? '';
            }
            const newPage = newPages[newFolder];
            const newFiles = newPage ? getSortedFileNames(newPage) : [];
            const newFile = newFiles[0] ?? '';

            const next: NotebookState = {
                ...destroyDeadScripts({
                    ...clearSemanticUserFocus(state),
                    notebookPages: newPages,
                    notebookUserFocus: {
                        folderName: newFolder,
                        fileName: newFile,
                        interactionCounter: state.notebookUserFocus.interactionCounter + 1,
                    }
                })
            };

            storage?.write(
                groupPageWrites(next.sessionId, folderToDelete),
                { type: DELETE_NOTEBOOK_PAGE, value: [next.sessionId, folderToDelete] },
                DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
            );
            return next;
        }
        case SELECT_NEXT_PAGE: {
            const folders = getSortedFolderNames(state.notebookPages);
            const cur = folders.indexOf(state.notebookUserFocus.folderName);
            const nextIdx = Math.min(Math.max(cur, 0) + 1, folders.length - 1);
            const folderName = folders[nextIdx] ?? state.notebookUserFocus.folderName;
            const page = state.notebookPages[folderName];
            const files = page ? getSortedFileNames(page) : [];
            const fileName = files.includes(state.notebookUserFocus.fileName)
                ? state.notebookUserFocus.fileName
                : (files[0] ?? '');
            return {
                ...clearSemanticUserFocus(state),
                notebookUserFocus: { folderName, fileName, interactionCounter: state.notebookUserFocus.interactionCounter + 1 },
            };
        }
        case SELECT_PREV_PAGE: {
            const folders = getSortedFolderNames(state.notebookPages);
            const cur = folders.indexOf(state.notebookUserFocus.folderName);
            const prevIdx = Math.max((cur < 0 ? 0 : cur) - 1, 0);
            const folderName = folders[prevIdx] ?? state.notebookUserFocus.folderName;
            const page = state.notebookPages[folderName];
            const files = page ? getSortedFileNames(page) : [];
            const fileName = files.includes(state.notebookUserFocus.fileName)
                ? state.notebookUserFocus.fileName
                : (files[0] ?? '');
            return {
                ...clearSemanticUserFocus(state),
                notebookUserFocus: { folderName, fileName, interactionCounter: state.notebookUserFocus.interactionCounter + 1 },
            };
        }
        case SELECT_NEXT_ENTRY: {
            const page = getSelectedPage(state);
            const files = page ? getSortedFileNames(page) : [];
            const cur = files.indexOf(state.notebookUserFocus.fileName);
            const nextIdx = Math.min(Math.max(cur, 0) + 1, files.length - 1);
            const fileName = files[nextIdx] ?? state.notebookUserFocus.fileName;
            return {
                ...clearSemanticUserFocus(state),
                notebookUserFocus: { ...state.notebookUserFocus, fileName, interactionCounter: state.notebookUserFocus.interactionCounter + 1 },
            };
        }
        case SELECT_PREV_ENTRY: {
            const page = getSelectedPage(state);
            const files = page ? getSortedFileNames(page) : [];
            const cur = files.indexOf(state.notebookUserFocus.fileName);
            const prevIdx = Math.max((cur < 0 ? 0 : cur) - 1, 0);
            const fileName = files[prevIdx] ?? state.notebookUserFocus.fileName;
            return {
                ...clearSemanticUserFocus(state),
                notebookUserFocus: { ...state.notebookUserFocus, fileName, interactionCounter: state.notebookUserFocus.interactionCounter + 1 },
            };
        }
        case SELECT_ENTRY: {
            const fileName = action.value;
            const page = getSelectedPage(state);
            if (!page || !page.scripts[fileName]) return state;
            return {
                ...clearSemanticUserFocus(state),
                notebookUserFocus: { ...state.notebookUserFocus, fileName },
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
            return analyzeOutdatedScriptInNotebook(state, action.value, logger);

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
                statistics: rotateScriptStatistics(prevScript.statistics, prevScript.script.getStatistics() ?? null),
                annotations: deriveScriptAnnotations(
                    update.scriptBuffers,
                    prevScript.script.toString(),
                    makeScriptLookup(state.notebookPages, state.scripts),
                ),
            };
            // Update semantic user focus
            let semanticUserFocus: SemanticUserFocus | null = prevFocus;
            switch (focusUpdate) {
                case FocusUpdate.Clear:
                    destroySemanticUserFocus(state.semanticUserFocus);
                    semanticUserFocus = null;
                    break;
                case FocusUpdate.UpdateFromCursor:
                    destroySemanticUserFocus(state.semanticUserFocus);
                    semanticUserFocus = deriveFocusFromScriptCursor(state.scriptRegistry, update.scriptKey, nextScript);
                    break;
                case FocusUpdate.UpdateFromCompletion:
                    destroySemanticUserFocus(state.semanticUserFocus);
                    semanticUserFocus = deriveFocusFromCompletionCandidates(state.scriptRegistry, update.scriptKey, nextScript);
                    break;
            }
            let nextState: NotebookState = {
                ...state,
                scripts: {
                    ...state.scripts,
                    [update.scriptKey]: nextScript
                },
                semanticUserFocus,
            };

            // Update the script in the registry
            state.scriptRegistry.addScript(nextScript.script);

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
                        groupDraftWrites(nextState.sessionId),
                        { type: WRITE_NOTEBOOK_DRAFT, value: [nextState.sessionId, sql] },
                        DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
                    );
                } else {
                    storage?.write(
                        groupScriptWrites(nextState.sessionId, scriptData.folderName, scriptData.fileName),
                        { type: WRITE_NOTEBOOK_SCRIPT, value: [nextState.sessionId, scriptData.folderName, scriptData.fileName, sql] },
                        DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
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

        case DELETE_NOTEBOOK_ENTRY: {
            const page = getSelectedPage(state);
            if (!page || !page.scripts[action.value]) return state;
            const deletedFileName = action.value;
            const deletedEntry = page.scripts[deletedFileName];
            const folderName = page.folderName;

            const remainingFiles = getSortedFileNames(page).filter(n => n !== deletedFileName);

            // If this would empty the page
            if (remainingFiles.length === 0) {
                // If there's only one page total, prevent deletion (can't have empty notebook)
                const folders = getSortedFolderNames(state.notebookPages);
                if (folders.length <= 1) {
                    logger.info("Refusing to delete script", {}, LOG_CTX);
                    return state;
                }
                // Multiple pages exist - delete the entire page instead
                const newPages: NotebookPageMap = { ...state.notebookPages };
                delete newPages[folderName];

                const idx = folders.indexOf(folderName);
                const remainingFolders = folders.filter(f => f !== folderName);
                const newFolder = remainingFolders[Math.max(0, idx - 1)] ?? remainingFolders[0] ?? '';
                const newPage = newPages[newFolder];
                const newFiles = newPage ? getSortedFileNames(newPage) : [];

                const next: NotebookState = {
                    ...destroyDeadScripts({
                        ...clearSemanticUserFocus(state),
                        notebookPages: newPages,
                        notebookUserFocus: {
                            folderName: newFolder,
                            fileName: newFiles[0] ?? '',
                            interactionCounter: state.notebookUserFocus.interactionCounter + 1,
                        }
                    })
                };

                storage?.write(
                    groupPageWrites(next.sessionId, folderName),
                    { type: DELETE_NOTEBOOK_PAGE, value: [next.sessionId, folderName] },
                    DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
                );
                return next;
            }

            // Normal case: delete the entry from the page
            const newPageScripts = { ...page.scripts };
            delete newPageScripts[deletedFileName];
            const newPages: NotebookPageMap = {
                ...state.notebookPages,
                [folderName]: { ...page, scripts: newPageScripts },
            };

            // Adjust focus if needed
            let newFile = state.notebookUserFocus.fileName;
            if (newFile === deletedFileName) {
                const oldIdx = getSortedFileNames(page).indexOf(deletedFileName);
                newFile = remainingFiles[Math.max(0, oldIdx - 1)] ?? remainingFiles[0] ?? '';
            }

            const next = destroyDeadScripts({
                ...clearSemanticUserFocus(state),
                notebookPages: newPages,
                notebookUserFocus: { ...state.notebookUserFocus, fileName: newFile },
            });
            storage?.write(
                groupScriptDeletes(next.sessionId, folderName, deletedEntry.fileName),
                { type: DELETE_NOTEBOOK_SCRIPT, value: [next.sessionId, folderName, deletedEntry.fileName] },
                DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
            );
            return next;
        }

        case CREATE_NOTEBOOK_ENTRY: {
            const page = getSelectedPage(state);
            if (!page) return state;

            const folderName = page.folderName;
            // Plan the insertion: name the new script (sorts last) and re-pad existing scripts if the
            // prefix width grew (e.g. the 10th script). Re-pads are applied to the base maps first.
            const plan = planScriptInsertion(page.scripts);
            const fileName = plan.newFileName;
            const repadded = applyScriptRepad(plan.repad, folderName, page.scripts, state.scripts, state.notebookUserFocus.fileName, state.sessionId, storage);

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
                latestQueryId: null,
                fileName,
                folderName,
            };

            const entry: NotebookPageScript = createPageScript(scriptKey, fileName);
            const newPage: NotebookPage = {
                ...page,
                scripts: { ...repadded.pageScripts, [fileName]: entry },
            };

            const next: NotebookState = {
                ...clearSemanticUserFocus(state),
                scripts: {
                    ...repadded.scripts,
                    [scriptKey]: scriptData,
                },
                notebookPages: { ...state.notebookPages, [folderName]: newPage },
                notebookUserFocus: { ...state.notebookUserFocus, fileName },
            };
            storage?.write(
                groupScriptWrites(next.sessionId, folderName, fileName),
                { type: WRITE_NOTEBOOK_SCRIPT, value: [next.sessionId, folderName, fileName, ''] },
                DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
            );
            return next;
        }

        case UPDATE_NOTEBOOK_ENTRY: {
            const page = getSelectedPage(state);
            if (!page) {
                console.warn("Update references invalid notebook entry");
                return state;
            }
            const { fileName: oldFileName, newFileName: requestedName } = action.value;
            const entry = page.scripts[oldFileName];
            if (!entry) {
                console.warn("Update references invalid notebook entry");
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
            const renamedEntry: NotebookPageScript = { ...entry, fileName: newFileName };
            const newPageScripts = { ...page.scripts };
            if (renamed) delete newPageScripts[oldFileName];
            newPageScripts[newFileName] = renamedEntry;

            const newPages: NotebookPageMap = {
                ...state.notebookPages,
                [page.folderName]: { ...page, scripts: newPageScripts },
            };

            // Update the script data fileName; mark analysis outdated on rename so the catalog path gets updated
            const scriptId = entry.scriptId;
            const updatedScriptData = state.scripts[scriptId];
            const newScripts = updatedScriptData ? {
                ...state.scripts,
                [scriptId]: {
                    ...updatedScriptData,
                    fileName: newFileName,
                    scriptAnalysis: renamed
                        ? { ...updatedScriptData.scriptAnalysis, outdated: true }
                        : updatedScriptData.scriptAnalysis,
                }
            } : state.scripts;

            // Keep focus on this script across the rename
            const focusFile = state.notebookUserFocus.fileName === oldFileName
                ? newFileName
                : state.notebookUserFocus.fileName;

            const next = {
                ...state,
                notebookPages: newPages,
                scripts: newScripts,
                notebookUserFocus: { ...state.notebookUserFocus, fileName: focusFile },
            };
            if (renamed) {
                // Rename the file in place: its SQL is unchanged, so move it rather than delete-old +
                // rewrite-new. The new clean base is disambiguated unique within the page, so the
                // rename target never collides with another script's existing name.
                storage?.write(
                    groupScriptRenames(next.sessionId, page.folderName, oldFileName),
                    { type: RENAME_NOTEBOOK_SCRIPT, value: [next.sessionId, page.folderName, oldFileName, newFileName] },
                    DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
                );
            } else {
                // No rename: just persist the current contents under the unchanged name.
                const sql = updatedScriptData ? updatedScriptData.script.toString() : '';
                storage?.write(
                    groupScriptWrites(next.sessionId, page.folderName, newFileName),
                    { type: WRITE_NOTEBOOK_SCRIPT, value: [next.sessionId, page.folderName, newFileName, sql] },
                    DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
                );
            }
            return next;
        }

        case UPDATE_PAGE_FOLDER_NAME: {
            const { folderName: oldFolderName, newFolderName: requestedName } = action.value;
            const page = state.notebookPages[oldFolderName];
            if (!page) {
                console.warn("Update references invalid folder name");
                return state;
            }
            // Only the clean (display) part of the name changes here; the numeric ordering prefix is
            // (re-)derived below so the page keeps its tab slot. A rename that leaves the clean name
            // unchanged is a no-op (don't churn the disk or prefix a still-lean session).
            const cleanName = uniqueFolderName(requestedName, state.notebookPages, oldFolderName);
            if (normalizePageName(oldFolderName) === cleanName) {
                return state;
            }

            // Land the renamed page directly at its final prefixed name, holding its current slot:
            // its position is its index in the current view order, padded to the notebook's width.
            // This always gives the page a numeric prefix (even one that had none, e.g. "vis_data").
            const viewOrder = getSortedFolderNames(state.notebookPages);
            const slot = viewOrder.indexOf(oldFolderName);
            const newFolderName = `${formatPageOrderPrefix(slot + 1, viewOrder.length)}${cleanName}`;

            // Update this page's scripts with the new folder name and mark them outdated: the clean
            // name changed, so the catalog path changes and the scripts must re-analyze.
            const newScripts = { ...state.scripts };
            for (const fileName in page.scripts) {
                const entry = page.scripts[fileName];
                const scriptData = newScripts[entry.scriptId];
                if (scriptData) {
                    newScripts[entry.scriptId] = {
                        ...scriptData,
                        folderName: newFolderName,
                        scriptAnalysis: { ...scriptData.scriptAnalysis, outdated: true },
                    };
                }
            }

            const newPages: NotebookPageMap = { ...state.notebookPages };
            delete newPages[oldFolderName];
            newPages[newFolderName] = { ...page, folderName: newFolderName };

            const newFocusFolder = state.notebookUserFocus.folderName === oldFolderName
                ? newFolderName
                : state.notebookUserFocus.folderName;

            const renamedState: NotebookState = {
                ...state,
                notebookPages: newPages,
                scripts: newScripts,
                notebookUserFocus: { ...state.notebookUserFocus, folderName: newFocusFolder },
            };

            // Persist the clean rename as an in-place folder rename: the page's script files move with
            // it untouched (their file names and SQL are unchanged — only the folder path changes, and
            // the catalog path is recomputed in-memory from the new clean name). No per-script rewrite.
            storage?.write(
                groupPageRenames(renamedState.sessionId, oldFolderName),
                { type: RENAME_NOTEBOOK_PAGE, value: [renamedState.sessionId, oldFolderName, newFolderName] },
                DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
            );

            // Densely re-prefix the remaining pages so any still-unprefixed sibling is normalised and
            // the notebook converges to a uniform "<n>_<clean>" listing. The renamed page already sits
            // at its target name (its prefix matches its slot), so reprefixPages leaves it untouched.
            const reprefixed = reprefixPages(viewOrder.map(f => f === oldFolderName ? newFolderName : f), renamedState, storage);
            return reprefixed ?? renamedState;
        }

        case REORDER_PAGES: {
            const requestedOrder = action.value;

            // Build the target order: the requested folders (that still exist, de-duplicated),
            // then any pages the caller omitted, appended in their current view order so none are
            // dropped. The result is a total order over exactly the current pages.
            const seen = new Set<string>();
            const order: string[] = [];
            for (const folder of requestedOrder) {
                if (state.notebookPages[folder] && !seen.has(folder)) {
                    seen.add(folder);
                    order.push(folder);
                }
            }
            const currentOrder = getSortedFolderNames(state.notebookPages);
            for (const folder of currentOrder) {
                if (!seen.has(folder)) {
                    seen.add(folder);
                    order.push(folder);
                }
            }

            // If the resolved order matches the current view order, change nothing — a same-order
            // reorder must not churn the disk or prefix a still-lean session. (The tab UI already
            // suppresses drop-in-place; this keeps the reducer consistent for any caller.)
            if (order.length === currentOrder.length && order.every((f, i) => f === currentOrder[i])) {
                return state;
            }

            // Assign a dense ordering prefix to each page in the new order, persisting each move.
            return reprefixPages(order, state, storage) ?? state;
        }

        case REORDER_NOTEBOOK_SCRIPTS: {
            // Reorder the scripts within the *selected* page. Mirrors REORDER_PAGES but at file level:
            // dense "<n>_clean.sql" prefixes assigned in the new order, with the clean (SQL-visible)
            // file name held stable so cross-script references survive the reorder.
            const page = getSelectedPage(state);
            if (!page) {
                return state;
            }
            const requestedOrder = action.value;

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
            const currentOrder = getSortedFileNames(page);
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
            const newPageScripts: { [fileName: string]: NotebookPageScript } = {};
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
            const newPages: NotebookPageMap = {
                ...state.notebookPages,
                [folderName]: { ...page, scripts: newPageScripts },
            };

            // Follow the focused file across its rename.
            const renamedFocus = renames.find(r => r.oldFile === state.notebookUserFocus.fileName)?.newFile;
            const newFocusFile = renamedFocus ?? state.notebookUserFocus.fileName;

            const next: NotebookState = {
                ...state,
                notebookPages: newPages,
                scripts: newScripts,
                notebookUserFocus: { ...state.notebookUserFocus, fileName: newFocusFile },
            };

            // Persist each moved script as delete-old + write-new (no atomic file rename exists; this
            // mirrors UPDATE_NOTEBOOK_ENTRY). Deletes and writes use distinct group keys. Clean file
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
                    groupScriptDeletes(next.sessionId, folderName, oldFile),
                    { type: DELETE_NOTEBOOK_SCRIPT, value: [next.sessionId, folderName, oldFile] },
                    DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
                );
            }
            for (const { newFile } of renames) {
                const entry = newPageScripts[newFile];
                const sd = newScripts[entry.scriptId];
                const sql = sd ? sd.script.toString() : '';
                storage?.write(
                    groupScriptWrites(next.sessionId, folderName, newFile),
                    { type: WRITE_NOTEBOOK_SCRIPT, value: [next.sessionId, folderName, newFile, sql] },
                    DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
                );
            }
            return next;
        }

        case PROMOTE_UNCOMMITTED_SCRIPT: {
            const page = getSelectedPage(state);
            if (!page || state.uncommittedScriptId == 0) {
                return state;
            }
            const folderName = page.folderName;
            // Plan the insertion (new script sorts last; re-pad existing scripts on a width change).
            const plan = planScriptInsertion(page.scripts);
            const fileName = plan.newFileName;
            const repadded = applyScriptRepad(plan.repad, folderName, page.scripts, state.scripts, state.notebookUserFocus.fileName, state.sessionId, storage);

            // Append the uncommitted script as a new committed entry
            const promotedEntry = createPageScript(state.uncommittedScriptId, fileName);

            // Update the promoted script metadata
            const promotedScriptData = repadded.scripts[state.uncommittedScriptId];
            const updatedPromotedScript = promotedScriptData ? {
                ...promotedScriptData,
                fileName,
                folderName,
            } : promotedScriptData;

            // Create a new empty uncommitted script
            const [newUncommittedKey, newUncommittedData] = createEmptyScriptData(state.instance, state.connectionCatalog);

            const newPage: NotebookPage = {
                ...page,
                scripts: { ...repadded.pageScripts, [fileName]: promotedEntry },
            };

            const next: NotebookState = {
                ...clearSemanticUserFocus(state),
                scripts: {
                    ...repadded.scripts,
                    [state.uncommittedScriptId]: updatedPromotedScript,
                    [newUncommittedKey]: newUncommittedData,
                },
                notebookPages: { ...state.notebookPages, [folderName]: newPage },
                uncommittedScriptId: newUncommittedKey,
                notebookUserFocus: { ...state.notebookUserFocus, fileName },
            };
            const sql = updatedPromotedScript ? updatedPromotedScript.script.toString() : '';
            storage?.write(
                groupScriptWrites(next.sessionId, folderName, fileName),
                { type: WRITE_NOTEBOOK_SCRIPT, value: [next.sessionId, folderName, fileName, sql] },
                DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
            );
            storage?.write(
                groupDraftWrites(next.sessionId),
                { type: WRITE_NOTEBOOK_DRAFT, value: [next.sessionId, ''] },
                DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
            );
            return next;
        }

        case SET_SCRIPT_TEXT: {
            const { scriptKey, text } = action.value;
            const scriptData = state.scripts[scriptKey];
            if (!scriptData) {
                logger.warn("SET_SCRIPT_TEXT references invalid script", { scriptKey: scriptKey.toString() }, LOG_CTX);
                return state;
            }
            // Rewrite the script text in-place
            scriptData.script.replaceText(text);
            // Re-analyze through the path-aware helper (destroys the stale buffers, refreshes
            // buffers + annotations incl. visualizeQuery, reloads the script into the catalog)
            const scriptLookup = makeScriptLookup(state.notebookPages, state.scripts);
            const nextScriptData = analyzeNotebookScript(scriptData, state.scriptRegistry, state.connectionCatalog, scriptLookup, logger);

            const nextState: NotebookState = {
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
                    groupDraftWrites(nextState.sessionId),
                    { type: WRITE_NOTEBOOK_DRAFT, value: [nextState.sessionId, sql] },
                    DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
                );
            } else {
                storage?.write(
                    groupScriptWrites(nextState.sessionId, nextScriptData.folderName, nextScriptData.fileName),
                    { type: WRITE_NOTEBOOK_SCRIPT, value: [nextState.sessionId, nextScriptData.folderName, nextScriptData.fileName, sql] },
                    DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
                );
            }
            return nextState;
        }

        case CREATE_NOTEBOOK_ENTRY_WITH_TEXT: {
            const page = getSelectedPage(state);
            if (!page) return state;

            const { text } = action.value;
            const folderName = page.folderName;
            // Plan the insertion (new script sorts last; re-pad existing scripts on a width change).
            const plan = planScriptInsertion(page.scripts);
            const fileName = plan.newFileName;
            const repadded = applyScriptRepad(plan.repad, folderName, page.scripts, state.scripts, state.notebookUserFocus.fileName, state.sessionId, storage);

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
                latestQueryId: null,
                fileName,
                folderName,
            };

            const entry: NotebookPageScript = createPageScript(scriptKey, fileName);
            const newPage: NotebookPage = {
                ...page,
                scripts: { ...repadded.pageScripts, [fileName]: entry },
            };
            const newPages: NotebookPageMap = { ...state.notebookPages, [folderName]: newPage };
            const newScripts: ScriptDataMap = { ...repadded.scripts, [scriptKey]: scriptData };

            // Analyze before persisting so annotations (incl. resolved visualizeQuery for a
            // SCRIPT_REFERENCE to an existing entry) are ready. The lookup spans the new
            // page/script maps so cross-script references resolve.
            scriptData = analyzeNotebookScript(scriptData, state.scriptRegistry, state.connectionCatalog, makeScriptLookup(newPages, newScripts), logger);
            newScripts[scriptKey] = scriptData;

            const next: NotebookState = {
                ...clearSemanticUserFocus(state),
                scripts: newScripts,
                notebookPages: newPages,
                notebookUserFocus: { ...state.notebookUserFocus, fileName },
            };
            const sql = scriptData.script.toString();
            storage?.write(
                groupScriptWrites(next.sessionId, folderName, fileName),
                { type: WRITE_NOTEBOOK_SCRIPT, value: [next.sessionId, folderName, fileName, sql] },
                DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
            );
            return next;
        }
    }
}

export function destroySemanticUserFocus(focus: SemanticUserFocus | null) {
    if (focus?.registryColumnInfo) {
        focus.registryColumnInfo.destroy();
    }
}
export function clearSemanticUserFocus<V extends NotebookStateWithoutId>(state: V): V {
    if (state.semanticUserFocus?.registryColumnInfo) {
        state.semanticUserFocus.registryColumnInfo.destroy();
    }
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
    data.cursor?.destroy();
    for (const stats of data.statistics) {
        stats.destroy();
    }
}

export function destroyState(state: NotebookState): NotebookState {
    // Clear the semantic user focus
    if (state.semanticUserFocus?.registryColumnInfo) {
        state.semanticUserFocus?.registryColumnInfo.destroy();
    }
    // Drop the script from the connection catalog
    for (const scriptData of Object.values(state.scripts)) {
        if (scriptData.script) {
            state.connectionCatalog.dropScript(scriptData.script);
        }
    }
    // Destroy the script registry
    state.scriptRegistry.destroy();
    // Destroy all the script data
    for (const key in state.scripts) {
        const script = state.scripts[key];
        destroyScriptData(script);
    }
    return state;
}

function destroyDeadScripts(state: NotebookState): NotebookState {
    // Determine script liveness: any script referenced in any page is live
    let deadScripts = new Map<number, ScriptData>();
    for (const key in state.scripts) {
        deadScripts.set(+key, state.scripts[key]);
    }
    for (const folder in state.notebookPages) {
        const page = state.notebookPages[folder];
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
            state.scriptRegistry.dropScript(v.script);
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
    scriptText: string,
    lookupScriptText: ScriptTextByPath,
): NotebookScriptAnnotations {
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

    // Resolve the first VISUALIZE statement (if any) into its executable SQL +
    // parsed Vega-Lite spec. We do this once at analysis time so consumers
    // don't have to touch the flatbuffer or re-parse JSON.
    const visualizeQuery = resolveVisualizeQuery(data, scriptText, lookupScriptText);

    return {
        tableRefs: [],
        tableDefs: tableDefsFlat,
        restrictedColumns: [],
        visualizeQuery,
    };
}

export function makeScriptLookup(pages: NotebookPageMap, scripts: ScriptDataMap): ScriptTextByPath {
    // SQL references address pages and scripts by their clean names (without the ordering prefix),
    // so resolve against indexes keyed by clean name. Fall back to the raw key for direct lookups by
    // an already-prefixed name. If two entries strip to the same clean name (only possible
    // transiently mid-rename), the lexicographically-first prefixed key wins, matching feed order.
    const byCleanName = new Map<string, NotebookPage>();
    for (const key of Object.keys(pages).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))) {
        const clean = normalizePageName(key);
        if (!byCleanName.has(clean)) byCleanName.set(clean, pages[key]);
    }
    // Per page, an index from clean display file name (no prefix, no ".sql") to script id, built in
    // numeric file order. References are written against the display name (dashql.notebook."x/foo").
    const filesByCleanName = new Map<NotebookPage, Map<string, number>>();
    const cleanFilesFor = (page: NotebookPage): Map<string, number> => {
        let index = filesByCleanName.get(page);
        if (!index) {
            index = new Map<string, number>();
            for (const file of Object.keys(page.scripts).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))) {
                const clean = scriptDisplayName(file);
                if (!index.has(clean)) index.set(clean, page.scripts[file].scriptId);
            }
            filesByCleanName.set(page, index);
        }
        return index;
    };
    return (folder, file) => {
        const page = pages[folder] ?? byCleanName.get(folder);
        if (page == null) return null;
        // Resolve by raw key (direct lookup) or by clean display name (the reference namespace).
        const scriptId = page.scripts[file]?.scriptId ?? cleanFilesFor(page).get(scriptDisplayName(file));
        if (scriptId == null) return null;
        return scripts[scriptId]?.script.toString() ?? null;
    };
}

/// Resolve the executable SQL text for a script.
///
/// For a VISUALIZE statement this is the extracted inner query (Hyper does not
/// understand the `visualize` keyword); for any other statement it is the raw
/// script text.
///
/// Scripts are analyzed eagerly at load (see analyzeAllScriptsInNotebook) and
/// kept analyzed as they are edited, so the cached `annotations.visualizeQuery`
/// is the normal source of truth here.
///
/// The synchronous re-analyze below is only a defensive fallback for the rare
/// case of a script that has never been analyzed yet (e.g. created mid-session
/// and neither rendered in an editor nor edited). We must NOT fall back to the
/// raw script text instead: that would send `visualize (...)` verbatim to the
/// backend, which is exactly the bug eager analysis exists to prevent. These
/// fallback buffers are deliberately throwaway — they are analyzed without
/// setNotebookPath() and are WASM pointers owned and freed here, so they must
/// not be handed back into the reducer.
export function getExecutableQueryText(notebook: NotebookState, scriptData: ScriptData): string {
    const scriptText = scriptData.script.toString();

    // Analyzed copy available? Trust the cached annotation.
    if (scriptData.scriptAnalysis.buffers.analyzed) {
        return scriptData.annotations.visualizeQuery?.sql ?? scriptText;
    }

    // Never analyzed: resolve on demand so we don't send un-extracted text.
    const buffers = analyzeScript(scriptData.script);
    try {
        const resolved = resolveVisualizeQuery(
            buffers,
            scriptText,
            makeScriptLookup(notebook.notebookPages, notebook.scripts),
        );
        return resolved?.sql ?? scriptText;
    } finally {
        buffers.destroy(buffers);
    }
}

export function analyzeNotebookScript(scriptData: ScriptData, registry: core.DashQLScriptRegistry, catalog: core.DashQLCatalog, scriptLookup: ScriptTextByPath, _logger: Logger): ScriptData {
    const next: ScriptData = { ...scriptData };
    next.scriptAnalysis.buffers.destroy(next.scriptAnalysis.buffers);

    // Set the notebook path so the analyzer registers this script in the catalog.
    // Register under the *clean display* folder and file names — folder without its ordering prefix,
    // file without its ordering prefix AND without the ".sql" extension — so the SQL-visible
    // reference namespace matches what is shown in the UI and is stable across reorders. A script
    // "1_foo.sql" in page "2_sales" is referenced as dashql.notebook."sales/foo".
    if (next.folderName && next.fileName) {
        next.script.setNotebookPath(`${normalizePageName(next.folderName)}/${scriptDisplayName(next.fileName)}`);
    }

    // Analyze the script
    next.scriptAnalysis = {
        buffers: analyzeScript(next.script),
        outdated: false,
    }
    // Rotate the script statistics
    next.statistics = rotateScriptStatistics(next.statistics, next.script.getStatistics() ?? null);
    // Derive script annotations (incl. resolved VISUALIZE query)
    next.annotations = deriveScriptAnnotations(
        next.scriptAnalysis.buffers,
        next.script.toString(),
        scriptLookup,
    );

    // Update the script in the registry
    registry.addScript(next.script);

    // Always load scripts into the catalog so they can be referenced by qualified name
    catalog.loadScript(next.script, scriptData.scriptKey);

    // Update the cursor?
    if (next.cursor != null) {
        const cursor = next.cursor.read();
        const textOffset = cursor.textOffset();
        next.cursor.destroy();
        next.cursor = next.script.moveCursor(textOffset);
    }
    return next;
}

export function analyzeOutdatedScriptInNotebook<V extends NotebookStateWithoutId>(state: V, scriptKey: number, logger: Logger): V {
    const scriptData = state.scripts[scriptKey];
    if (!scriptData || !scriptData.scriptAnalysis.outdated) {
        return state;
    }
    // Create the next notebook state
    const nextScriptData = analyzeNotebookScript(scriptData, state.scriptRegistry, state.connectionCatalog, makeScriptLookup(state.notebookPages, state.scripts), logger);
    const next = {
        ...clearSemanticUserFocus(state),
        scripts: {
            ...state.scripts,
            [scriptKey]: nextScriptData
        }
    };

    // Re-derive the semantic user focus if there is still a cursor
    if (nextScriptData.cursor != null) {
        next.semanticUserFocus = deriveFocusFromScriptCursor(state.scriptRegistry, scriptKey, nextScriptData);
    }
    return next;
}

/// Progress hooks for analyzeAllScriptsInNotebook.
///
/// The work is synchronous, so these fire while the caller is blocked — they are
/// for driving a ProgressCounter (accurate per-script accounting), not for
/// repainting mid-loop.
export interface AnalyzeAllScriptsProgress {
    /// Reports how many scripts will be analyzed, before any work starts.
    onScriptCount?: (count: number) => void;
    /// Reports the outcome of a single script once both passes are done.
    onScriptDone?: (ok: boolean) => void;
}

/// Returns notebook script keys in script-feed order: pages top-down (sorted
/// folders, then sorted files within each), followed by the uncommitted composer
/// script. Any scripts not reachable through the pages/composer are appended so
/// none are silently dropped.
export function getScriptKeysInFeedOrder<V extends NotebookStateWithoutId>(state: V): number[] {
    const ordered: number[] = [];
    const seen = new Set<number>();
    const push = (scriptKey: number) => {
        if (state.scripts[scriptKey] != null && !seen.has(scriptKey)) {
            seen.add(scriptKey);
            ordered.push(scriptKey);
        }
    };
    for (const folder of getSortedFolderNames(state.notebookPages)) {
        const page = state.notebookPages[folder];
        for (const fileName of getSortedFileNames(page)) {
            push(page.scripts[fileName].scriptId);
        }
    }
    if (state.uncommittedScriptId !== 0) {
        push(state.uncommittedScriptId);
    }
    // Backstop: include any remaining scripts (e.g. orphaned) so analysis covers them.
    for (const key in state.scripts) {
        push(+key);
    }
    return ordered;
}

/// Analyze every script in a notebook eagerly, in a single top-down pass.
///
/// This is meant to be run once at load time so that every script has at least
/// one analyzed copy (and derived annotations, incl. the resolved VISUALIZE
/// query) before the user can interact with it. Without this, scripts start out
/// `outdated` with `analyzed: null` and only get analyzed lazily (when rendered
/// in an editor, edited, or executed) — which is what caused the first-run
/// VISUALIZE bug where the raw `visualize (...)` text was sent to the backend.
///
/// Scripts are analyzed in script-feed order (top-down). Notebook references
/// point upward — a script references entries declared above it in the feed — so
/// by the time we analyze a script, every script it depends on has already been
/// analyzed and loaded into the catalog. A single pass therefore resolves
/// cross-script references (qualified-name table refs, SCRIPT_REFERENCE
/// visualizations) without a second reconciliation pass. The catalog must
/// already be populated (schema loaded) when this is called.
///
/// Failures are isolated per script: one un-analyzable script is logged and
/// reported via `progress.onScriptDone(false)` but does not abort analysis of
/// the rest of the notebook.
export function analyzeAllScriptsInNotebook<V extends NotebookStateWithoutId>(state: V, logger: Logger, progress?: AnalyzeAllScriptsProgress): V {
    const scripts = { ...state.scripts };
    const orderedKeys = getScriptKeysInFeedOrder(state);
    progress?.onScriptCount?.(orderedKeys.length);

    // The text-based lookup used for SCRIPT_REFERENCE sources is independent of
    // analysis, so one lookup over the (shared) script objects covers the pass.
    const scriptLookup = makeScriptLookup(state.notebookPages, scripts);

    for (const scriptKey of orderedKeys) {
        let ok = false;
        try {
            scripts[scriptKey] = analyzeNotebookScript(scripts[scriptKey], state.scriptRegistry, state.connectionCatalog, scriptLookup, logger);
            ok = true;
        } catch (e) {
            logger.warn("Failed to analyze notebook script", { scriptKey: scriptKey.toString(), error: stringifyError(e) }, LOG_CTX);
        }
        progress?.onScriptDone?.(ok);
    }
    return { ...state, scripts };
}
