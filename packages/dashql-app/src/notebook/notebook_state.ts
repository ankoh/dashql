import * as core from '@ankoh/dashql-core';
import * as pb from '@ankoh/dashql-protobuf';
import * as buf from '@bufbuild/protobuf';

import * as Immutable from 'immutable';

import { analyzeScript, DashQLCompletionState, DashQLProcessorUpdateOut, DashQLScriptBuffers } from '../view/editor/dashql_processor.js';
import { deriveFocusFromCompletionCandidates, deriveFocusFromScriptCursor, UserFocus } from './focus.js';
import { ConnectorInfo, ConnectorType } from '../connection/connector_info.js';
import { VariantKind } from '../utils/index.js';
import { DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE, DEBOUNCE_DURATION_NOTEBOOK_WRITE, groupNotebookWrites, groupScriptWrites, StorageWriter, WRITE_NOTEBOOK_SCRIPT, WRITE_NOTEBOOK_STATE, DELETE_NOTEBOOK_STATE, DELETE_NOTEBOOK_SCRIPT } from '../storage/storage_writer.js';
import { NotebookStateWithoutId } from './notebook_state_registry.js';
import { Logger } from '../platform/logger.js';

const LOG_CTX = 'notebook_state';

/// A script key
export type ScriptKey = number;
/// A script data map
export type ScriptDataMap = { [scriptKey: number]: ScriptData };

export interface NotebookMetadata {
    /// The file name of the notebook
    fileName: string;
}

/// The state of the notebook
export interface NotebookState {
    /// The notebook state contains many references into the Wasm heap.
    /// It therefore makes sense that notebook state users resolve the "right" module through here.
    instance: core.DashQL;
    /// The notebook id
    notebookId: number;
    /// The notebook metadata
    notebookMetadata: pb.dashql.notebook.NotebookMetadata;
    /// The connector info
    connectorInfo: ConnectorInfo;
    /// The connector state
    connectionId: number;
    /// The connection catalog
    connectionCatalog: core.DashQLCatalog;
    /// The script registry
    scriptRegistry: core.DashQLScriptRegistry;
    /// The scripts
    scripts: ScriptDataMap;
    /// The next script key
    nextScriptKey: number;
    /// The notebook pages. Each page holds a sequence of script references (entries).
    notebookPages: pb.dashql.notebook.NotebookPage[];
    /// The currently selected page (for editor tabs)
    selectedPageIndex: number;
    /// The selected entry index within the selected page
    selectedEntryInPage: number;
    /// The user focus info (if any)
    userFocus: UserFocus | null;
}

/// Returns the currently selected page, or undefined if none.
export function getSelectedPage(state: NotebookState): pb.dashql.notebook.NotebookPage | undefined {
    if (state.notebookPages.length === 0) return undefined;
    const idx = Math.max(0, Math.min(state.selectedPageIndex, state.notebookPages.length - 1));
    return state.notebookPages[idx];
}

/// Returns the script entries of the selected page.
export function getSelectedPageEntries(state: NotebookState): pb.dashql.notebook.NotebookPageScript[] {
    const page = getSelectedPage(state);
    return page?.scripts ?? [];
}

/// Returns the currently selected entry (script ref) in the selected page, or undefined.
export function getSelectedEntry(state: NotebookState): pb.dashql.notebook.NotebookPageScript | undefined {
    const entries = getSelectedPageEntries(state);
    if (entries.length === 0) return undefined;
    const idx = Math.max(0, Math.min(state.selectedEntryInPage, entries.length - 1));
    return entries[idx];
}

/// A script data
export interface ScriptData {
    /// The script key
    scriptKey: number;
    /// The script
    script: core.DashQLScript | null;
    /// The processed scripts
    processed: DashQLScriptBuffers;
    /// The analysis was done against an outdated catalog?
    outdatedAnalysis: boolean;
    /// The derived annotations for the ui
    annotations: pb.dashql.notebook.NotebookScriptAnnotations;
    /// The statistics
    statistics: Immutable.List<core.FlatBufferPtr<core.buffers.statistics.ScriptStatistics>>;
    /// The cursor
    cursor: core.FlatBufferPtr<core.buffers.cursor.ScriptCursor> | null;
    /// The completion state.
    completion: DashQLCompletionState | null;
    /// The latest query id
    latestQueryId: number | null;
}

export const DELETE_NOTEBOOK = Symbol('DELETE_NOTEBOOK');
export const RESTORE_NOTEBOOK = Symbol('RESTORE_NOTEBOOK');
export const SELECT_PAGE = Symbol('SELECT_PAGE');
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

export type NotebookStateAction =
    | VariantKind<typeof DELETE_NOTEBOOK, null>
    | VariantKind<typeof RESTORE_NOTEBOOK, pb.dashql.notebook.Notebook>
    | VariantKind<typeof SELECT_PAGE, number>
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
    | VariantKind<typeof UPDATE_NOTEBOOK_ENTRY, { entryIndex: number, title: string | null }>
    ;

const STATS_HISTORY_LIMIT = 20;

enum FocusUpdate {
    Clear,
    UpdateFromCursor,
    UpdateFromCompletion,
};

export function reduceNotebookState(state: NotebookState, action: NotebookStateAction, storage: StorageWriter, logger: Logger): NotebookState {
    switch (action.type) {
        case DELETE_NOTEBOOK: {
            // Demo notebooks are not persisted
            if (state.connectorInfo.connectorType != ConnectorType.DEMO) {
                // Delete all the notebook scripts
                for (const scriptData of Object.values(state.scripts)) {
                    storage.write(groupScriptWrites(state.notebookId, scriptData.scriptKey), { type: DELETE_NOTEBOOK_SCRIPT, value: [state.notebookId, scriptData.scriptKey] }, DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE);
                }
                // Delete the notebook itself
                storage.write(groupNotebookWrites(state.notebookId), { type: DELETE_NOTEBOOK_STATE, value: state.notebookId }, DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE);
            }
            // Destroy everything attached to a notebook.
            destroyState({ ...state });
            // The registry dispatch is deleting the state from all maps.
            // We return an emtpy object here to fail fast if this invariant breaks.
            return {} as NotebookState;
        }

        case RESTORE_NOTEBOOK: {
            // Stop if there's no instance set
            if (!state.instance) {
                return state;
            }
            // Shallow copy the notebook root
            const next = {
                ...state,
            };
            // Delete all old scripts
            for (const k in next.scripts) {
                const script = next.scripts[k];
                // Try to unload the script from the catalog
                if (script.script) {
                    next.connectionCatalog.dropScript(script.script);
                }
                // Delete the script data
                destroyScriptData(script);
            }
            next.scripts = {};

            // Load all scripts
            for (const s of action.value.scripts) {
                const script = next.instance!.createScript(next.connectionCatalog, s.scriptId);
                script!.replaceText(s.scriptText);

                const scriptData: ScriptData = {
                    scriptKey: s.scriptId,
                    script,
                    processed: {
                        scanned: null,
                        parsed: null,
                        analyzed: null,
                        destroy: () => { },
                    },
                    outdatedAnalysis: true,
                    statistics: Immutable.List(),
                    annotations: buf.create(pb.dashql.notebook.NotebookScriptAnnotationsSchema),
                    cursor: null,
                    completion: null,
                    latestQueryId: null,
                }
                next.scripts[s.scriptId] = scriptData;
            };

            // Analyze all schema scripts
            for (const k in next.scripts) {
                const s = next.scripts[k];
                s.processed = analyzeScript(s.script!);
                s.statistics = rotateScriptStatistics(s.statistics, s.script!.getStatistics() ?? null);
                s.annotations = deriveScriptAnnotations(s.processed);
                s.outdatedAnalysis = false;

                // Does the script contain table definitions?
                // Then load it into the catalog
                const analyzed = s.processed.analyzed?.read();
                if (analyzed && analyzed.tablesLength() > 0) {
                    next.connectionCatalog.loadScript(s.script!, s.scriptKey);
                }

                // Update the script in the registry
                state.scriptRegistry.addScript(s.script!);
            }

            // Restore pages: use notebook_pages from proto; if empty, create one default page
            const pages = action.value.notebookPages?.length
                ? action.value.notebookPages
                : [buf.create(pb.dashql.notebook.NotebookPageSchema, { scripts: [buf.create(pb.dashql.notebook.NotebookPageScriptSchema, { scriptId: 1, title: "" })] })];
            next.notebookPages = pages;
            next.selectedPageIndex = 0;
            next.selectedEntryInPage = 0;

            // All other scripts are marked via `outdatedAnalysis`
            if (next.connectorInfo.connectorType != ConnectorType.DEMO) {
                storage.write(groupNotebookWrites(next.notebookId), { type: WRITE_NOTEBOOK_STATE, value: [next.notebookId, next] }, DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE);
            }
            return next;
        }

        case SELECT_PAGE: {
            const pageIndex = Math.max(0, Math.min(action.value, state.notebookPages.length - 1));
            const page = state.notebookPages[pageIndex];
            const maxEntry = page && page.scripts.length > 0 ? page.scripts.length - 1 : 0;
            const entryInPage = Math.min(state.selectedEntryInPage, maxEntry);
            return {
                ...clearUserFocus(state),
                selectedPageIndex: pageIndex,
                selectedEntryInPage: entryInPage,
            };
        }
        case SELECT_NEXT_ENTRY: {
            const entries = getSelectedPageEntries(state);
            const nextEntry = Math.max(Math.min(state.selectedEntryInPage + 1, entries.length - 1), 0);
            return {
                ...clearUserFocus(state),
                selectedEntryInPage: nextEntry,
            };
        }
        case SELECT_PREV_ENTRY:
            return {
                ...clearUserFocus(state),
                selectedEntryInPage: Math.max(state.selectedEntryInPage - 1, 0),
            };
        case SELECT_ENTRY: {
            const entries = getSelectedPageEntries(state);
            const idx = Math.max(Math.min(action.value, entries.length - 1), 0);
            return {
                ...clearUserFocus(state),
                selectedEntryInPage: idx,
            };
        }

        case CATALOG_DID_UPDATE: {
            const scripts = { ...state.scripts };
            for (const scriptKey in scripts) {
                const prev = scripts[scriptKey];
                scripts[scriptKey] = {
                    ...prev,
                    outdatedAnalysis: true
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
            const prevFocus = state.userFocus;
            // If the script key does not refer to a value we know, we cannot keep the new script alive.
            // Drop the update.
            if (!prevScript) {
                update.scriptBuffers.destroy(update.scriptBuffers);
                update.scriptCursor?.destroy();
                update.scriptCompletion?.buffer.destroy();
                return clearUserFocus(state);
            }
            // Different script? This is also very disturbing
            if (prevScript.script?.ptr !== update.script?.ptr) {
                update.scriptBuffers.destroy(update.scriptBuffers);
                update.scriptCursor?.destroy();
                update.scriptCompletion?.buffer.destroy();
                return clearUserFocus(state);
            }
            // Did the buffers change?
            let focusUpdate: FocusUpdate | null = null;
            if (prevScript.processed !== update.scriptBuffers) {
                prevScript.processed.destroy(prevScript.processed);
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
            let nextScript: ScriptData = {
                ...prevScript,
                processed: update.scriptBuffers,
                cursor: update.scriptCursor,
                completion: update.scriptCompletion,
                outdatedAnalysis: false,
                statistics: rotateScriptStatistics(prevScript.statistics, prevScript.script?.getStatistics() ?? null),
                annotations: deriveScriptAnnotations(update.scriptBuffers),
            };
            // Update user focus
            let userFocus: UserFocus | null = prevFocus;
            switch (focusUpdate) {
                case FocusUpdate.Clear:
                    destroyUserFocus(state.userFocus);
                    userFocus = null;
                    break;
                case FocusUpdate.UpdateFromCursor:
                    destroyUserFocus(state.userFocus);
                    userFocus = deriveFocusFromScriptCursor(state.scriptRegistry, update.scriptKey, nextScript);
                    break;
                case FocusUpdate.UpdateFromCompletion:
                    destroyUserFocus(state.userFocus);
                    userFocus = deriveFocusFromCompletionCandidates(state.scriptRegistry, update.scriptKey, nextScript);
                    break;
            }
            let nextState: NotebookState = {
                ...state,
                scripts: {
                    ...state.scripts,
                    [update.scriptKey]: nextScript
                },
                userFocus,
            };

            // Update the script in the registry
            if (nextScript.script) {
                state.scriptRegistry.addScript(nextScript.script);
            }

            // Is defining tables?
            const analyzed = nextScript.processed.analyzed?.read();
            if (analyzed && analyzed.tablesLength() > 0) {
                // Update the catalog since the schema might have changed
                nextState.connectionCatalog!.loadScript(nextScript.script!, nextScript.scriptKey);
                // Mark all other scripts as outdated.
                // Eventually, we could restrict to those that are depending?
                for (const key in nextState.scripts) {
                    const script = nextState.scripts[key];
                    nextState.scripts[key] = {
                        ...script,
                        outdatedAnalysis: true
                    };
                }
            }
            if (nextState.connectorInfo.connectorType != ConnectorType.DEMO && update.script != null) {
                storage.write(groupScriptWrites(nextState.notebookId, update.scriptKey), { type: WRITE_NOTEBOOK_SCRIPT, value: [nextState.notebookId, update.scriptKey, nextScript] }, DEBOUNCE_DURATION_NOTEBOOK_SCRIPT_WRITE);
            }
            return nextState;
        }

        case REGISTER_QUERY: {
            const [_pageIndex, _entryIndexInPage, scriptKey, queryId] = action.value;
            const scriptData = state.scripts[scriptKey];
            if (!scriptData) {
                logger.warn("orphan query references invalid script", {
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

            let newSelectedEntryInPage = state.selectedEntryInPage;
            if (state.selectedEntryInPage === oldIndex) {
                newSelectedEntryInPage = newIndex;
            } else if (oldIndex < state.selectedEntryInPage && newIndex >= state.selectedEntryInPage) {
                newSelectedEntryInPage--;
            } else if (oldIndex > state.selectedEntryInPage && newIndex <= state.selectedEntryInPage) {
                newSelectedEntryInPage++;
            }

            const newPages = [...state.notebookPages];
            newPages[state.selectedPageIndex] = buf.create(pb.dashql.notebook.NotebookPageSchema, { scripts: newScripts });

            const next = {
                ...clearUserFocus(state),
                notebookPages: newPages,
                selectedEntryInPage: newSelectedEntryInPage,
            };
            if (next.connectorInfo.connectorType != ConnectorType.DEMO) {
                storage.write(groupNotebookWrites(next.notebookId), { type: WRITE_NOTEBOOK_STATE, value: [next.notebookId, next] }, DEBOUNCE_DURATION_NOTEBOOK_WRITE);
            }
            return next;
        }

        case DELETE_NOTEBOOK_ENTRY: {
            const page = getSelectedPage(state);
            if (!page || page.scripts.length <= 1 || action.value < 0 || action.value >= page.scripts.length) {
                return state;
            }
            const newScripts = page.scripts.filter((_, i) => i !== action.value);
            let newSelectedEntryInPage = state.selectedEntryInPage;
            if (state.selectedEntryInPage === action.value) {
                newSelectedEntryInPage = Math.max(0, action.value - 1);
            } else if (action.value < state.selectedEntryInPage) {
                newSelectedEntryInPage--;
            }
            const newPages = [...state.notebookPages];
            newPages[state.selectedPageIndex] = buf.create(pb.dashql.notebook.NotebookPageSchema, { scripts: newScripts });

            const next = destroyDeadScripts({
                ...clearUserFocus(state),
                notebookPages: newPages,
                selectedEntryInPage: Math.min(newSelectedEntryInPage, newScripts.length - 1),
            });
            if (next.connectorInfo.connectorType != ConnectorType.DEMO) {
                storage.write(groupNotebookWrites(next.notebookId), { type: WRITE_NOTEBOOK_STATE, value: [next.notebookId, next] }, DEBOUNCE_DURATION_NOTEBOOK_WRITE);
            }
            return next;
        }

        case CREATE_NOTEBOOK_ENTRY: {
            // Generate a new script key
            const scriptKey = state.nextScriptKey;
            // Create a new script
            const script = state.instance.createScript(state.connectionCatalog, scriptKey);
            // Create script data
            const scriptData: ScriptData = {
                scriptKey,
                script,
                processed: {
                    scanned: null,
                    parsed: null,
                    analyzed: null,
                    destroy: () => { },
                },
                outdatedAnalysis: true,
                statistics: Immutable.List(),
                annotations: buf.create(pb.dashql.notebook.NotebookScriptAnnotationsSchema),
                cursor: null,
                completion: null,
                latestQueryId: null,
            };

            const page = getSelectedPage(state);
            if (!page) return state;

            const entry: pb.dashql.notebook.NotebookPageScript = buf.create(pb.dashql.notebook.NotebookPageScriptSchema, {
                scriptId: scriptKey,
                title: "",
            });
            const newScripts = [...page.scripts, entry];
            const newPages = [...state.notebookPages];
            newPages[state.selectedPageIndex] = buf.create(pb.dashql.notebook.NotebookPageSchema, { scripts: newScripts });

            const next: NotebookState = {
                ...clearUserFocus(state),
                nextScriptKey: state.nextScriptKey + 1,
                scripts: {
                    ...state.scripts,
                    [scriptKey]: scriptData,
                },
                notebookPages: newPages,
                selectedEntryInPage: newScripts.length - 1,
            };
            if (next.connectorInfo.connectorType != ConnectorType.DEMO) {
                storage.write(groupScriptWrites(next.notebookId, scriptKey), { type: WRITE_NOTEBOOK_SCRIPT, value: [next.notebookId, scriptKey, scriptData] }, DEBOUNCE_DURATION_NOTEBOOK_WRITE);
                storage.write(groupNotebookWrites(next.notebookId), { type: WRITE_NOTEBOOK_STATE, value: [next.notebookId, next] }, DEBOUNCE_DURATION_NOTEBOOK_WRITE);
            }
            return next;
        }

        case UPDATE_NOTEBOOK_ENTRY: {
            const page = getSelectedPage(state);
            if (!page || action.value.entryIndex < 0 || action.value.entryIndex >= page.scripts.length) {
                console.warn("update references invalid notebook entry");
                return state;
            }
            const { entryIndex, title } = action.value;
            const entries = [...page.scripts];
            entries[entryIndex] = buf.create(pb.dashql.notebook.NotebookPageScriptSchema, {
                ...entries[entryIndex],
                title: title ?? ""
            });
            const newPages = [...state.notebookPages];
            newPages[state.selectedPageIndex] = buf.create(pb.dashql.notebook.NotebookPageSchema, { scripts: entries });
            const next = {
                ...state,
                notebookPages: newPages
            };
            if (next.connectorInfo.connectorType != ConnectorType.DEMO) {
                storage.write(groupNotebookWrites(next.notebookId), { type: WRITE_NOTEBOOK_STATE, value: [next.notebookId, next] }, DEBOUNCE_DURATION_NOTEBOOK_WRITE);
            }
            return next;
        }
    }
}

export function destroyUserFocus(focus: UserFocus | null) {
    if (focus?.registryColumnInfo) {
        focus.registryColumnInfo.destroy();
    }
}
export function clearUserFocus<V extends NotebookStateWithoutId>(state: V): V {
    if (state.userFocus?.registryColumnInfo) {
        state.userFocus.registryColumnInfo.destroy();
    }
    return { ...state, userFocus: null };
}
export function replaceCursorIfChanged(state: ScriptData, cursor: core.FlatBufferPtr<core.buffers.cursor.ScriptCursor>): ScriptData {
    if (state.cursor && !state.cursor.equals(cursor)) {
        state.cursor.destroy();
    }
    return { ...state, cursor };
}

function destroyScriptData(data: ScriptData) {
    data.processed.destroy(data.processed);
    data.script?.destroy();
    data.completion?.buffer.destroy();
    data.cursor?.destroy();
    for (const stats of data.statistics) {
        stats.destroy();
    }
}

export function destroyState(state: NotebookState): NotebookState {
    // Clear the user focus
    if (state.userFocus?.registryColumnInfo) {
        state.userFocus?.registryColumnInfo.destroy();
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

function deriveScriptAnnotations(data: DashQLScriptBuffers): pb.dashql.notebook.NotebookScriptAnnotations {
    if (!data.analyzed) {
        return buf.create(pb.dashql.notebook.NotebookScriptAnnotationsSchema, {});
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

    return buf.create(pb.dashql.notebook.NotebookScriptAnnotationsSchema, {
        tableDefs: tableDefsFlat
    });
}

export function analyzeNotebookScript(scriptData: ScriptData, registry: core.DashQLScriptRegistry, catalog: core.DashQLCatalog, logger: Logger): ScriptData {
    const next: ScriptData = { ...scriptData };
    next.processed.destroy(next.processed);

    // Analyze the script
    next.processed = analyzeScript(next.script!);
    // Rotate the script statistics
    next.statistics = rotateScriptStatistics(next.statistics, next.script!.getStatistics() ?? null);
    // Derive script annotations
    next.annotations = deriveScriptAnnotations(next.processed);
    // Not longer outdated
    next.outdatedAnalysis = false;

    // Update the script in the registry
    registry.addScript(next.script!);

    // Contains tables, then also update the catalog
    if (next.processed.analyzed) {
        const analyzed = next.processed.analyzed.read();
        if (analyzed.tablesLength() > 0) {
            catalog.loadScript(next.script!, scriptData.scriptKey);
        }
    }

    // Update the cursor?
    if (next.script && next.cursor != null) {
        const cursor = next.cursor.read();
        const textOffset = cursor.textOffset();
        next.cursor.destroy();
        next.cursor = next.script.moveCursor(textOffset);
    }
    return next;
}

export function analyzeOutdatedScriptInNotebook<V extends NotebookStateWithoutId>(state: V, scriptKey: number, logger: Logger): V {
    const scriptData = state.scripts[scriptKey];
    if (!scriptData || !scriptData.outdatedAnalysis) {
        return state;
    }
    // Create the next notebook state
    const nextScriptData = analyzeNotebookScript(scriptData, state.scriptRegistry, state.connectionCatalog, logger);
    const next = {
        ...clearUserFocus(state),
        scripts: {
            ...state.scripts,
            [scriptKey]: nextScriptData
        }
    };

    // Update the user focus
    if (next.userFocus != null && nextScriptData.cursor != null) {
        next.userFocus = deriveFocusFromScriptCursor(state.scriptRegistry, scriptKey, nextScriptData);
    }
    return next;
}
