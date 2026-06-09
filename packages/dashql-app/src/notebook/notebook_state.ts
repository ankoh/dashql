import * as core from '../core/index.js';
import * as Immutable from 'immutable';

import { analyzeScript, DashQLCompletionState, DashQLProcessorUpdateOut, DashQLScriptBuffers } from '../view/editor/dashql_processor.js';
import { deriveFocusFromCompletionCandidates, deriveFocusFromScriptCursor, SemanticUserFocus } from './focus.js';
import { ConnectorInfo } from '../connection/connector_info.js';
import { VariantKind } from '../utils/index.js';
import { REPLACE_NOTEBOOK, CREATE_NOTEBOOK_PAGE, DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE, DEBOUNCE_DURATION_NOTEBOOK_WRITE, DELETE_NOTEBOOK_PAGE, DELETE_NOTEBOOK_SCRIPT, groupDraftWrites, groupNotebookWrites, groupPageWrites, groupScriptDeletes, groupScriptWrites, StorageWriter, WRITE_NOTEBOOK_DRAFT, WRITE_NOTEBOOK_SCRIPT } from '../platform/storage/storage_writer.js';
import { NotebookStateWithoutId } from './notebook_state_registry.js';
import { Logger } from '../platform/logger/logger.js';
import { NotebookScriptAnnotations, NotebookPage, NotebookPageScript, NotebookMetadata as NotebookMetadataType, createEmptyAnnotations, createPageScript, generateScriptFileName } from './notebook_types.js';

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
export const PROMOTE_UNCOMMITTED_SCRIPT = Symbol('PROMOTE_UNCOMMITTED_SCRIPT');

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
    | VariantKind<typeof PROMOTE_UNCOMMITTED_SCRIPT, null>
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

function uniqueFolderName(baseName: string, pages: NotebookPageMap, excludeFolder: string = ''): string {
    const taken = (name: string) => name !== excludeFolder && pages[name] !== undefined;
    if (!taken(baseName)) return baseName;
    let suffix = 2;
    while (taken(`${baseName} ${suffix}`)) suffix++;
    return `${baseName} ${suffix}`;
}

enum FocusUpdate {
    Clear,
    UpdateFromCursor,
    UpdateFromCompletion,
};

/// Returns the sorted list of folder names for view-layer iteration.
export function getSortedFolderNames(pages: NotebookPageMap): string[] {
    return Object.keys(pages).sort((a, b) => a.localeCompare(b));
}

/// Returns the sorted list of file names within a page.
export function getSortedFileNames(page: NotebookPage): string[] {
    return Object.keys(page.scripts).sort((a, b) => a.localeCompare(b));
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

            const next: NotebookState = {
                ...clearSemanticUserFocus(state),
                scripts: {
                    ...state.scripts,
                    [scriptKey]: scriptData,
                },
                notebookPages: { ...state.notebookPages, [folderName]: newPage },
                notebookUserFocus: { folderName, fileName, interactionCounter: state.notebookUserFocus.interactionCounter + 1 },
            };

            storage?.write(
                groupPageWrites(next.sessionId, folderName),
                { type: CREATE_NOTEBOOK_PAGE, value: [next.sessionId, folderName, [{ scriptId: scriptKey, fileName, sql: '' }]] },
                DEBOUNCE_DURATION_NOTEBOOK_WRITE
            );
            return next;
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
                annotations: deriveScriptAnnotations(update.scriptBuffers),
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
            const fileName = generateScriptFileName(page.scripts);

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
                scripts: { ...page.scripts, [fileName]: entry },
            };

            const next: NotebookState = {
                ...clearSemanticUserFocus(state),
                scripts: {
                    ...state.scripts,
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
            const { fileName: oldFileName, newFileName } = action.value;
            const entry = page.scripts[oldFileName];
            if (!entry) {
                console.warn("Update references invalid notebook entry");
                return state;
            }
            // Disallow rename to an existing file in the same page
            if (oldFileName !== newFileName && page.scripts[newFileName]) {
                console.warn("Rename target file name already exists");
                return state;
            }
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
            // Delete old file, write new file
            if (renamed) {
                storage?.write(
                    groupScriptDeletes(next.sessionId, page.folderName, oldFileName),
                    { type: DELETE_NOTEBOOK_SCRIPT, value: [next.sessionId, page.folderName, oldFileName] },
                    DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
                );
            }
            const sql = updatedScriptData ? updatedScriptData.script.toString() : '';
            storage?.write(
                groupScriptWrites(next.sessionId, page.folderName, newFileName),
                { type: WRITE_NOTEBOOK_SCRIPT, value: [next.sessionId, page.folderName, newFileName, sql] },
                DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
            );
            return next;
        }

        case UPDATE_PAGE_FOLDER_NAME: {
            const { folderName: oldFolderName, newFolderName: requestedName } = action.value;
            const page = state.notebookPages[oldFolderName];
            if (!page) {
                console.warn("Update references invalid folder name");
                return state;
            }
            const newFolderName = uniqueFolderName(requestedName, state.notebookPages, oldFolderName);
            const renamed = oldFolderName !== newFolderName;

            // Update all scripts in this page with the new folder name; mark outdated on rename for catalog path update
            const newScripts = { ...state.scripts };
            for (const fileName in page.scripts) {
                const entry = page.scripts[fileName];
                const scriptData = newScripts[entry.scriptId];
                if (scriptData) {
                    newScripts[entry.scriptId] = {
                        ...scriptData,
                        folderName: newFolderName,
                        scriptAnalysis: renamed
                            ? { ...scriptData.scriptAnalysis, outdated: true }
                            : scriptData.scriptAnalysis,
                    };
                }
            }

            const newPages: NotebookPageMap = { ...state.notebookPages };
            if (renamed) delete newPages[oldFolderName];
            newPages[newFolderName] = { ...page, folderName: newFolderName };

            const newFocusFolder = state.notebookUserFocus.folderName === oldFolderName
                ? newFolderName
                : state.notebookUserFocus.folderName;

            const next: NotebookState = {
                ...state,
                notebookPages: newPages,
                scripts: newScripts,
                notebookUserFocus: { ...state.notebookUserFocus, folderName: newFocusFolder },
            };
            // Delete old page folder, create new one with all scripts
            if (renamed) {
                storage?.write(
                    groupPageWrites(next.sessionId, oldFolderName),
                    { type: DELETE_NOTEBOOK_PAGE, value: [next.sessionId, oldFolderName] },
                    DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
                );
                const scriptEntries = Object.values(page.scripts).map(entry => {
                    const sd = newScripts[entry.scriptId];
                    return { scriptId: entry.scriptId, fileName: entry.fileName, sql: sd ? sd.script.toString() : '' };
                });
                storage?.write(
                    groupPageWrites(next.sessionId, newFolderName),
                    { type: CREATE_NOTEBOOK_PAGE, value: [next.sessionId, newFolderName, scriptEntries] },
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
            const fileName = generateScriptFileName(page.scripts);

            // Append the uncommitted script as a new committed entry
            const promotedEntry = createPageScript(state.uncommittedScriptId, fileName);

            // Update the promoted script metadata
            const promotedScriptData = state.scripts[state.uncommittedScriptId];
            const updatedPromotedScript = promotedScriptData ? {
                ...promotedScriptData,
                fileName,
                folderName,
            } : promotedScriptData;

            // Create a new empty uncommitted script
            const [newUncommittedKey, newUncommittedData] = createEmptyScriptData(state.instance, state.connectionCatalog);

            const newPage: NotebookPage = {
                ...page,
                scripts: { ...page.scripts, [fileName]: promotedEntry },
            };

            const next: NotebookState = {
                ...clearSemanticUserFocus(state),
                scripts: {
                    ...state.scripts,
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

function deriveScriptAnnotations(data: DashQLScriptBuffers): NotebookScriptAnnotations {
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

    return {
        tableRefs: [],
        tableDefs: tableDefsFlat,
        restrictedColumns: [],
    };
}

export function analyzeNotebookScript(scriptData: ScriptData, registry: core.DashQLScriptRegistry, catalog: core.DashQLCatalog, _logger: Logger): ScriptData {
    const next: ScriptData = { ...scriptData };
    next.scriptAnalysis.buffers.destroy(next.scriptAnalysis.buffers);

    // Set the notebook path so the analyzer registers this script in the catalog
    if (next.folderName && next.fileName) {
        next.script.setNotebookPath(`${next.folderName}/${next.fileName}`);
    }

    // Analyze the script
    next.scriptAnalysis = {
        buffers: analyzeScript(next.script),
        outdated: false,
    }
    // Rotate the script statistics
    next.statistics = rotateScriptStatistics(next.statistics, next.script.getStatistics() ?? null);
    // Derive script annotations
    next.annotations = deriveScriptAnnotations(next.scriptAnalysis.buffers);

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
    const nextScriptData = analyzeNotebookScript(scriptData, state.scriptRegistry, state.connectionCatalog, logger);
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
