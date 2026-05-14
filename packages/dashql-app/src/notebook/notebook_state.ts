import * as core from '../core/index.js';
import * as Immutable from 'immutable';

import { analyzeScript, DashQLCompletionState, DashQLProcessorUpdateOut, DashQLScriptBuffers } from '../view/editor/dashql_processor.js';
import { deriveFocusFromCompletionCandidates, deriveFocusFromScriptCursor, SemanticUserFocus } from './focus.js';
import { ConnectorInfo } from '../connection/connector_info.js';
import { VariantKind } from '../utils/index.js';
import { REPLACE_NOTEBOOK, CREATE_NOTEBOOK_PAGE, DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE, DEBOUNCE_DURATION_NOTEBOOK_WRITE, DELETE_NOTEBOOK_PAGE, DELETE_NOTEBOOK_SCRIPT, groupNotebookWrites, groupPageWrites, groupScriptDeletes, groupScriptWrites, StorageWriter, WRITE_NOTEBOOK_SCRIPT } from '../platform/storage/storage_writer.js';
import { NotebookStateWithoutId } from './notebook_state_registry.js';
import { Logger } from '../platform/logger/logger.js';
import { NotebookScriptAnnotations, NotebookPage, NotebookPageScript, NotebookMetadata as NotebookMetadataType, createEmptyAnnotations, createPageScript, generateScriptFileName } from './notebook_types.js';

const LOG_CTX = 'notebook_state';

/// A script key
export type ScriptKey = number;
/// A script data map
export type ScriptDataMap = { [scriptKey: number]: ScriptData };

/// A notebook metadata
export interface NotebookMetadata {
    /// The file name of the notebook
    fileName: string;
}

/// A notebook user focus
export interface NotebookUserFocus {
    /// The currently selected page index (for editor tabs)
    pageIndex: number;
    /// The selected entry index within the selected page
    entryInPage: number;
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
    /// The notebook pages. Each page holds a sequence of script references (entries).
    notebookPages: NotebookPage[];
    /// The uncommitted script id for the notebook-level composer.
    uncommittedScriptId: number;
    /// The notebook focus (selected page and entry)
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
    /// The page index this script belongs to (-1 for uncommitted/draft script)
    pageIndex: number;
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
export const REORDER_NOTEBOOK_ENTRIES = Symbol('REORDER_NOTEBOOK_ENTRIES');
export const CREATE_NOTEBOOK_ENTRY = Symbol('CREATE_NOTEBOOK_ENTRY');
export const DELETE_NOTEBOOK_ENTRY = Symbol('DELETE_NOTEBOOK_ENTRY');
export const UPDATE_NOTEBOOK_ENTRY = Symbol('UPDATE_NOTEBOOK_ENTRY');
export const UPDATE_PAGE_FOLDER_NAME = Symbol('UPDATE_PAGE_FOLDER_NAME');
export const PROMOTE_UNCOMMITTED_SCRIPT = Symbol('PROMOTE_UNCOMMITTED_SCRIPT');

export type NotebookStateAction =
    | VariantKind<typeof SELECT_PAGE, number>
    | VariantKind<typeof CREATE_PAGE, null>
    | VariantKind<typeof DELETE_PAGE, number>
    | VariantKind<typeof SELECT_NEXT_PAGE, null>
    | VariantKind<typeof SELECT_PREV_PAGE, null>
    | VariantKind<typeof SELECT_NEXT_ENTRY, null>
    | VariantKind<typeof SELECT_PREV_ENTRY, null>
    | VariantKind<typeof SELECT_ENTRY, number>
    | VariantKind<typeof ANALYZE_OUTDATED_SCRIPT, ScriptKey>
    | VariantKind<typeof UPDATE_FROM_PROCESSOR, DashQLProcessorUpdateOut>
    | VariantKind<typeof CATALOG_DID_UPDATE, null>
    | VariantKind<typeof REGISTER_QUERY, [number, number, ScriptKey, number]>
    | VariantKind<typeof REORDER_NOTEBOOK_ENTRIES, { oldIndex: number, newIndex: number }>
    | VariantKind<typeof CREATE_NOTEBOOK_ENTRY, null>
    | VariantKind<typeof DELETE_NOTEBOOK_ENTRY, number>
    | VariantKind<typeof UPDATE_NOTEBOOK_ENTRY, { entryIndex: number, fileName: string }>
    | VariantKind<typeof UPDATE_PAGE_FOLDER_NAME, { pageIndex: number, folderName: string }>
    | VariantKind<typeof PROMOTE_UNCOMMITTED_SCRIPT, null>
    ;

const STATS_HISTORY_LIMIT = 20;

export function createEmptyScriptData(instance: core.DashQL, catalog: core.DashQLCatalog, pageIndex: number = -1, fileName: string = '', folderName: string = ''): [number, ScriptData] {
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
        pageIndex,
        fileName,
        folderName,
    };
    return [scriptKey, scriptData];
}

enum FocusUpdate {
    Clear,
    UpdateFromCursor,
    UpdateFromCompletion,
};

export function reduceNotebookState(state: NotebookState, action: NotebookStateAction, storageArg: StorageWriter, logger: Logger, active: boolean): NotebookState {
    // Suppress storage writes when the connection is not yet active
    const storage = active ? storageArg : null;
    switch (action.type) {
        case SELECT_PAGE: {
            const pageIndex = Math.max(0, Math.min(action.value, state.notebookPages.length - 1));
            const page = state.notebookPages[pageIndex];
            const maxEntry = page && page.scripts.length > 0 ? page.scripts.length - 1 : 0;
            const entryInPage = Math.min(state.notebookUserFocus.entryInPage, maxEntry);
            return {
                ...clearSemanticUserFocus(state),
                notebookUserFocus: { pageIndex, entryInPage },
            };
        }
        case CREATE_PAGE: {
            // Create a new page
            const newPage: NotebookPage = {
                folderName: 'Untitled',
                scripts: [],
            };

            const newPages = [...state.notebookPages, newPage];
            const newPageIndex = newPages.length - 1;
            const fileName = generateScriptFileName(0);

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
                pageIndex: newPageIndex,
                fileName: fileName,
                folderName: 'Untitled',
            };

            const entry = createPageScript(scriptKey, fileName);
            newPage.scripts.push(entry);

            const next: NotebookState = {
                ...clearSemanticUserFocus(state),
                scripts: {
                    ...state.scripts,
                    [scriptKey]: scriptData,
                },
                notebookPages: newPages,
                notebookUserFocus: { pageIndex: newPages.length - 1, entryInPage: 0 },
            };

            storage?.write(
                groupPageWrites(next.sessionId, newPage.folderName),
                { type: CREATE_NOTEBOOK_PAGE, value: [next.sessionId, newPage.folderName, [{ scriptId: scriptKey, fileName, sql: '' }]] },
                DEBOUNCE_DURATION_NOTEBOOK_WRITE
            );
            return next;
        }
        case DELETE_PAGE: {
            // Prevent deleting the last remaining page
            if (state.notebookPages.length <= 1) {
                return state;
            }

            const pageIndexToDelete = action.value;
            if (pageIndexToDelete < 0 || pageIndexToDelete >= state.notebookPages.length) {
                console.warn("Delete references invalid page index");
                return state;
            }

            // Remove the page
            const newPages = state.notebookPages.filter((_, idx) => idx !== pageIndexToDelete);

            // Calculate new focus: select previous page, or next if deleting first page
            let newPageIndex = state.notebookUserFocus.pageIndex;
            if (pageIndexToDelete === state.notebookUserFocus.pageIndex) {
                // Deleting current page - select previous (or 0 if deleting first)
                newPageIndex = Math.max(0, pageIndexToDelete - 1);
            } else if (pageIndexToDelete < state.notebookUserFocus.pageIndex) {
                // Deleting a page before current - adjust index
                newPageIndex = state.notebookUserFocus.pageIndex - 1;
            }

            const deletedPage = state.notebookPages[pageIndexToDelete];
            const next: NotebookState = {
                ...destroyDeadScripts({
                    ...clearSemanticUserFocus(state),
                    notebookPages: newPages,
                    notebookUserFocus: {
                        pageIndex: newPageIndex,
                        entryInPage: 0
                    }
                })
            };

            storage?.write(
                groupPageWrites(next.sessionId, deletedPage.folderName),
                { type: DELETE_NOTEBOOK_PAGE, value: [next.sessionId, deletedPage.folderName] },
                DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
            );
            return next;
        }
        case SELECT_NEXT_PAGE: {
            const nextPageIndex = Math.min(state.notebookUserFocus.pageIndex + 1, state.notebookPages.length - 1);
            const nextPage = state.notebookPages[nextPageIndex];
            const maxEntry = nextPage && nextPage.scripts.length > 0 ? nextPage.scripts.length - 1 : 0;
            const entryInPage = Math.min(state.notebookUserFocus.entryInPage, maxEntry);
            return {
                ...clearSemanticUserFocus(state),
                notebookUserFocus: { pageIndex: nextPageIndex, entryInPage },
            };
        }
        case SELECT_PREV_PAGE: {
            const prevPageIndex = Math.max(state.notebookUserFocus.pageIndex - 1, 0);
            const prevPage = state.notebookPages[prevPageIndex];
            const maxEntry = prevPage && prevPage.scripts.length > 0 ? prevPage.scripts.length - 1 : 0;
            const entryInPage = Math.min(state.notebookUserFocus.entryInPage, maxEntry);
            return {
                ...clearSemanticUserFocus(state),
                notebookUserFocus: { pageIndex: prevPageIndex, entryInPage },
            };
        }
        case SELECT_NEXT_ENTRY: {
            const entries = getSelectedPageEntries(state);
            const nextEntry = Math.max(Math.min(state.notebookUserFocus.entryInPage + 1, entries.length - 1), 0);
            return {
                ...clearSemanticUserFocus(state),
                notebookUserFocus: { ...state.notebookUserFocus, entryInPage: nextEntry },
            };
        }
        case SELECT_PREV_ENTRY:
            return {
                ...clearSemanticUserFocus(state),
                notebookUserFocus: { ...state.notebookUserFocus, entryInPage: Math.max(state.notebookUserFocus.entryInPage - 1, 0) },
            };
        case SELECT_ENTRY: {
            const entries = getSelectedPageEntries(state);
            const idx = Math.max(Math.min(action.value, entries.length - 1), 0);
            return {
                ...clearSemanticUserFocus(state),
                notebookUserFocus: { ...state.notebookUserFocus, entryInPage: idx },
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

            // Is defining tables?
            const analyzed = nextScript.scriptAnalysis.buffers.analyzed?.read();
            if (analyzed && analyzed.tablesLength() > 0) {
                // Update the catalog since the schema might have changed
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

                storage?.write(
                    groupScriptWrites(nextState.sessionId, scriptData.folderName, scriptData.fileName),
                    { type: WRITE_NOTEBOOK_SCRIPT, value: [nextState.sessionId, scriptData.folderName, scriptData.fileName, sql] },
                    DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
                );
            }
            return nextState;
        }

        case REGISTER_QUERY: {
            const [_pageIndex, _entryIndexInPage, scriptKey, queryId] = action.value;
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

        case REORDER_NOTEBOOK_ENTRIES: {
            const page = getSelectedPage(state);
            if (!page) return state;
            const { oldIndex, newIndex } = action.value;
            const newScripts = [...page.scripts];
            if (oldIndex < 0 || oldIndex >= newScripts.length || newIndex < 0 || newIndex >= newScripts.length) return state;
            const [movedEntry] = newScripts.splice(oldIndex, 1);
            newScripts.splice(newIndex, 0, movedEntry);

            let newEntryInPage = state.notebookUserFocus.entryInPage;
            if (state.notebookUserFocus.entryInPage === oldIndex) {
                newEntryInPage = newIndex;
            } else if (oldIndex < state.notebookUserFocus.entryInPage && newIndex >= state.notebookUserFocus.entryInPage) {
                newEntryInPage--;
            } else if (oldIndex > state.notebookUserFocus.entryInPage && newIndex <= state.notebookUserFocus.entryInPage) {
                newEntryInPage++;
            }

            const newPages = [...state.notebookPages];
            newPages[state.notebookUserFocus.pageIndex] = { ...page, scripts: newScripts };

            const next = {
                ...clearSemanticUserFocus(state),
                notebookPages: newPages,
                notebookUserFocus: { ...state.notebookUserFocus, entryInPage: newEntryInPage },
            };
            storage?.write(groupNotebookWrites(next.sessionId), { type: REPLACE_NOTEBOOK, value: next }, DEBOUNCE_DURATION_NOTEBOOK_WRITE);
            return next;
        }

        case DELETE_NOTEBOOK_ENTRY: {
            const page = getSelectedPage(state);
            if (!page || action.value < 0 || action.value >= page.scripts.length) {
                return state;
            }
            const deletedEntry = page.scripts[action.value];

            // If this is the last entry in the page
            if (page.scripts.length <= 1) {
                // If there's only one page total, prevent deletion (can't have empty notebook)
                if (state.notebookPages.length <= 1) {
                    logger.info("Refusing to delete script", {}, LOG_CTX);
                    return state;
                }
                // Multiple pages exist - delete the entire page instead
                const currentPageIndex = state.notebookUserFocus.pageIndex;
                const newPages = state.notebookPages.filter((_, idx) => idx !== currentPageIndex);

                // Calculate new focus: select previous page, or next if deleting first page
                const newPageIndex = Math.max(0, currentPageIndex - 1);

                const next: NotebookState = {
                    ...destroyDeadScripts({
                        ...clearSemanticUserFocus(state),
                        notebookPages: newPages,
                        notebookUserFocus: {
                            pageIndex: newPageIndex,
                            entryInPage: 0
                        }
                    })
                };

                storage?.write(
                    groupPageWrites(next.sessionId, page.folderName),
                    { type: DELETE_NOTEBOOK_PAGE, value: [next.sessionId, page.folderName] },
                    DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
                );
                return next;
            }

            // Normal case: delete the entry from the page
            const newScripts = page.scripts.filter((_entry: NotebookPageScript, i: number) => i !== action.value);
            let newEntryInPage = state.notebookUserFocus.entryInPage;
            if (state.notebookUserFocus.entryInPage === action.value) {
                newEntryInPage = Math.max(0, action.value - 1);
            } else if (action.value < state.notebookUserFocus.entryInPage) {
                newEntryInPage--;
            }
            const newPages = [...state.notebookPages];
            newPages[state.notebookUserFocus.pageIndex] = { ...page, scripts: newScripts };

            const next = destroyDeadScripts({
                ...clearSemanticUserFocus(state),
                notebookPages: newPages,
                notebookUserFocus: { ...state.notebookUserFocus, entryInPage: Math.min(newEntryInPage, newScripts.length - 1) },
            });
            storage?.write(
                groupScriptDeletes(next.sessionId, page.folderName, deletedEntry.fileName),
                { type: DELETE_NOTEBOOK_SCRIPT, value: [next.sessionId, page.folderName, deletedEntry.fileName] },
                DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
            );
            return next;
        }

        case CREATE_NOTEBOOK_ENTRY: {
            const page = getSelectedPage(state);
            if (!page) return state;

            const pageIndex = state.notebookUserFocus.pageIndex;
            const fileName = generateScriptFileName(page.scripts.length);

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
                pageIndex,
                fileName,
                folderName: page.folderName,
            };

            const entry: NotebookPageScript = createPageScript(scriptKey, fileName);
            const newScripts = [...page.scripts, entry];
            const newPages = [...state.notebookPages];
            newPages[pageIndex] = { ...page, scripts: newScripts };

            const next: NotebookState = {
                ...clearSemanticUserFocus(state),
                scripts: {
                    ...state.scripts,
                    [scriptKey]: scriptData,
                },
                notebookPages: newPages,
                notebookUserFocus: { ...state.notebookUserFocus, entryInPage: newScripts.length - 1 },
            };
            storage?.write(
                groupScriptWrites(next.sessionId, page.folderName, fileName),
                { type: WRITE_NOTEBOOK_SCRIPT, value: [next.sessionId, page.folderName, fileName, ''] },
                DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
            );
            return next;
        }

        case UPDATE_NOTEBOOK_ENTRY: {
            const page = getSelectedPage(state);
            if (!page || action.value.entryIndex < 0 || action.value.entryIndex >= page.scripts.length) {
                console.warn("Update references invalid notebook entry");
                return state;
            }
            const { entryIndex, fileName } = action.value;
            const oldFileName = page.scripts[entryIndex].fileName;
            const renamedEntry: NotebookPageScript = { ...page.scripts[entryIndex], fileName };
            const scriptId = renamedEntry.scriptId;
            // Re-sort entries by fileName so the feed order tracks the storage ordering
            const entries = page.scripts
                .map((entry, i) => i === entryIndex ? renamedEntry : entry)
                .sort((a, b) => a.fileName.localeCompare(b.fileName));

            // Keep focus on the same script across the reorder
            const focusedScriptId = page.scripts[state.notebookUserFocus.entryInPage]?.scriptId ?? scriptId;
            const remappedEntryInPage = entries.findIndex(e => e.scriptId === focusedScriptId);

            const newPages = [...state.notebookPages];
            newPages[state.notebookUserFocus.pageIndex] = { ...page, scripts: entries };

            // Update the script data fileName
            const updatedScriptData = state.scripts[scriptId];
            const newScripts = updatedScriptData ? {
                ...state.scripts,
                [scriptId]: { ...updatedScriptData, fileName }
            } : state.scripts;

            const next = {
                ...state,
                notebookPages: newPages,
                scripts: newScripts,
                notebookUserFocus: {
                    ...state.notebookUserFocus,
                    entryInPage: Math.max(0, remappedEntryInPage),
                },
            };
            // Delete old file, write new file
            if (oldFileName !== fileName) {
                storage?.write(
                    groupScriptDeletes(next.sessionId, page.folderName, oldFileName),
                    { type: DELETE_NOTEBOOK_SCRIPT, value: [next.sessionId, page.folderName, oldFileName] },
                    DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
                );
            }
            const sql = updatedScriptData ? updatedScriptData.script.toString() : '';
            storage?.write(
                groupScriptWrites(next.sessionId, page.folderName, fileName),
                { type: WRITE_NOTEBOOK_SCRIPT, value: [next.sessionId, page.folderName, fileName, sql] },
                DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
            );
            return next;
        }

        case UPDATE_PAGE_FOLDER_NAME: {
            const { pageIndex, folderName } = action.value;
            if (pageIndex < 0 || pageIndex >= state.notebookPages.length) {
                console.warn("Update references invalid page index");
                return state;
            }
            const oldFolderName = state.notebookPages[pageIndex].folderName;
            const newPages = [...state.notebookPages];
            newPages[pageIndex] = { ...newPages[pageIndex], folderName };

            // Update all scripts in this page with the new folder name
            const page = state.notebookPages[pageIndex];
            let newScripts = { ...state.scripts };
            for (const entry of page.scripts) {
                const scriptData = newScripts[entry.scriptId];
                if (scriptData) {
                    newScripts[entry.scriptId] = { ...scriptData, folderName };
                }
            }

            const next = {
                ...state,
                notebookPages: newPages,
                scripts: newScripts
            };
            // Delete old page folder, create new one with all scripts
            if (oldFolderName !== folderName) {
                storage?.write(
                    groupPageWrites(next.sessionId, oldFolderName),
                    { type: DELETE_NOTEBOOK_PAGE, value: [next.sessionId, oldFolderName] },
                    DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE
                );
                const scriptEntries = page.scripts.map(entry => {
                    const sd = newScripts[entry.scriptId];
                    return { scriptId: entry.scriptId, fileName: entry.fileName, sql: sd ? sd.script.toString() : '' };
                });
                storage?.write(
                    groupPageWrites(next.sessionId, folderName),
                    { type: CREATE_NOTEBOOK_PAGE, value: [next.sessionId, folderName, scriptEntries] },
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
            const pageIndex = state.notebookUserFocus.pageIndex;
            const fileName = generateScriptFileName(page.scripts.length);

            // Append the uncommitted script as a new committed entry
            const promotedEntry = createPageScript(state.uncommittedScriptId, fileName);
            const newPageScripts = [...page.scripts, promotedEntry];

            // Update the promoted script metadata
            const promotedScriptData = state.scripts[state.uncommittedScriptId];
            const updatedPromotedScript = promotedScriptData ? {
                ...promotedScriptData,
                pageIndex,
                fileName,
                folderName: page.folderName,
            } : promotedScriptData;

            // Create a new empty uncommitted script
            const [newUncommittedKey, newUncommittedData] = createEmptyScriptData(state.instance, state.connectionCatalog);
            const newPages = [...state.notebookPages];
            newPages[pageIndex] = {
                ...page,
                scripts: newPageScripts,
            };
            const next: NotebookState = {
                ...clearSemanticUserFocus(state),
                scripts: {
                    ...state.scripts,
                    [state.uncommittedScriptId]: updatedPromotedScript,
                    [newUncommittedKey]: newUncommittedData,
                },
                notebookPages: newPages,
                uncommittedScriptId: newUncommittedKey,
                notebookUserFocus: { ...state.notebookUserFocus, entryInPage: newPageScripts.length - 1 },
            };
            const sql = updatedPromotedScript ? updatedPromotedScript.script.toString() : '';
            storage?.write(
                groupScriptWrites(next.sessionId, page.folderName, fileName),
                { type: WRITE_NOTEBOOK_SCRIPT, value: [next.sessionId, page.folderName, fileName, sql] },
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
    for (const page of state.notebookPages) {
        for (const entry of page.scripts) {
            deadScripts.delete(entry.scriptId);
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

    // Contains tables, then also update the catalog
    if (next.scriptAnalysis.buffers.analyzed) {
        const analyzed = next.scriptAnalysis.buffers.analyzed.read();
        if (analyzed.tablesLength() > 0) {
            catalog.loadScript(next.script, scriptData.scriptKey);
        }
    }

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

    // Update the semantic user focus
    if (next.semanticUserFocus != null && nextScriptData.cursor != null) {
        next.semanticUserFocus = deriveFocusFromScriptCursor(state.scriptRegistry, scriptKey, nextScriptData);
    }
    return next;
}

/// Returns the currently selected page, or undefined if none.
export function getSelectedPage(state: NotebookState): NotebookPage | undefined {
    if (state.notebookPages.length === 0) return undefined;
    const idx = Math.max(0, Math.min(state.notebookUserFocus.pageIndex, state.notebookPages.length - 1));
    return state.notebookPages[idx];
}

/// Returns the script entries of the selected page.
export function getSelectedPageEntries(state: NotebookState): NotebookPageScript[] {
    const page = getSelectedPage(state);
    return page?.scripts ?? [];
}

/// Returns the uncommitted script data for the notebook-level composer, or null if none.
export function getUncommittedScriptData(state: NotebookState): ScriptData | null {
    if (state.uncommittedScriptId === 0) return null;
    return state.scripts[state.uncommittedScriptId] ?? null;
}

/// Returns the currently selected entry (script ref) in the selected page, or undefined.
export function getSelectedEntry(state: NotebookState): NotebookPageScript | undefined {
    const entries = getSelectedPageEntries(state);
    if (entries.length === 0) return undefined;
    const idx = Math.max(0, Math.min(state.notebookUserFocus.entryInPage, entries.length - 1));
    return entries[idx];
}
