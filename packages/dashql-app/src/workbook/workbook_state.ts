import * as core from '@ankoh/dashql-core';
import * as pb from '@ankoh/dashql-protobuf';

import * as Immutable from 'immutable';

import { ScriptMetadata, ScriptOriginType, ScriptType } from './script_metadata.js';
import { ScriptLoadingStatus } from './script_loader.js';
import { analyzeScript, DashQLCompletionState, DashQLProcessorUpdateOut, DashQLScriptBuffers } from '../view/editor/dashql_processor.js';
import { ScriptLoadingInfo } from './script_loader.js';
import { deriveFocusFromCompletionCandidates, deriveFocusFromScriptCursor, UserFocus } from './focus.js';
import { ConnectorInfo } from '../connection/connector_info.js';
import { VariantKind } from '../utils/index.js';

/// A script key
export type ScriptKey = number;
/// A script data map
export type ScriptDataMap = { [scriptKey: number]: ScriptData };

export interface WorkbookMetadata {
    /// The file name of the workbook
    fileName: string;
}

/// The state of the workbook
export interface WorkbookState {
    /// The workbook state contains many references into the Wasm heap.
    /// It therefore makes sense that workbook state users resolve the "right" module through here.
    instance: core.DashQL;
    /// The workbook id
    workbookId: number;
    /// The workbook metadata
    workbookMetadata: WorkbookMetadata;
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
    /// The workbook entries.
    /// A workbook defines a layout for a set of scripts and links script data to query executions.
    workbookEntries: WorkbookEntry[]
    /// The selected workbook entry
    selectedWorkbookEntry: number;
    /// The user focus info (if any)
    userFocus: UserFocus | null;
}

/// A workbook workbook entry
export interface WorkbookEntry {
    /// The script key of this workbook entry
    scriptKey: ScriptKey;
    /// The latest query id (if the script was executed)
    queryId: number | null;
    /// The title of the workbook entry
    title: string | null;
}

/// A script data
export interface ScriptData {
    /// The script key
    scriptKey: number;
    /// The script
    script: core.DashQLScript | null;
    /// The metadata
    metadata: ScriptMetadata;
    /// The loading info
    loading: ScriptLoadingInfo;
    /// The processed scripts
    processed: DashQLScriptBuffers;
    /// The analysis was done against an outdated catalog?
    outdatedAnalysis: boolean;
    /// The statistics
    statistics: Immutable.List<core.FlatBufferPtr<core.buffers.statistics.ScriptStatistics>>;
    /// The cursor
    cursor: core.FlatBufferPtr<core.buffers.cursor.ScriptCursor> | null;
    /// The completion state.
    completion: DashQLCompletionState | null;
}

export const DESTROY = Symbol('DESTROY');
export const RESTORE_WORKBOOK = Symbol('RESTORE_WORKBOOK');
export const SELECT_NEXT_ENTRY = Symbol('SELECT_NEXT_ENTRY');
export const SELECT_PREV_ENTRY = Symbol('SELECT_PREV_ENTRY');
export const SELECT_ENTRY = Symbol('SELECT_ENTRY');
export const UPDATE_SCRIPT = Symbol('UPDATE_SCRIPT');
export const UPDATE_FROM_PROCESSOR = Symbol('UPDATE_FROM_PROCESSOR');
export const CATALOG_DID_UPDATE = Symbol('CATALOG_DID_UPDATE');
export const SCRIPT_LOADING_STARTED = Symbol('SCRIPT_LOADING_STARTED');
export const SCRIPT_LOADING_SUCCEEDED = Symbol('SCRIPT_LOADING_SUCCEEDED');
export const SCRIPT_LOADING_FAILED = Symbol('SCRIPT_LOADING_FAILED');
export const REGISTER_QUERY = Symbol('REGISTER_QUERY');
export const REORDER_WORKBOOK_ENTRIES = Symbol('REORDER_WORKBOOK_ENTRIES');
export const CREATE_WORKBOOK_ENTRY = Symbol('CREATE_WORKBOOK_ENTRY');
export const DELETE_WORKBOOK_ENTRY = Symbol('DELETE_WORKBOOK_ENTRY');
export const UPDATE_WORKBOOK_ENTRY = Symbol('UPDATE_WORKBOOK_ENTRY');

export type WorkbookStateAction =
    | VariantKind<typeof DESTROY, null>
    | VariantKind<typeof RESTORE_WORKBOOK, pb.dashql.workbook.Workbook>
    | VariantKind<typeof SELECT_NEXT_ENTRY, null>
    | VariantKind<typeof SELECT_PREV_ENTRY, null>
    | VariantKind<typeof SELECT_ENTRY, number>
    | VariantKind<typeof UPDATE_SCRIPT, ScriptKey>
    | VariantKind<typeof UPDATE_FROM_PROCESSOR, DashQLProcessorUpdateOut>
    | VariantKind<typeof CATALOG_DID_UPDATE, null>
    | VariantKind<typeof SCRIPT_LOADING_STARTED, ScriptKey>
    | VariantKind<typeof SCRIPT_LOADING_SUCCEEDED, [ScriptKey, string]>
    | VariantKind<typeof SCRIPT_LOADING_FAILED, [ScriptKey, any]>
    | VariantKind<typeof REGISTER_QUERY, [number, ScriptKey, number]>
    | VariantKind<typeof REORDER_WORKBOOK_ENTRIES, { oldIndex: number, newIndex: number }>
    | VariantKind<typeof CREATE_WORKBOOK_ENTRY, null>
    | VariantKind<typeof DELETE_WORKBOOK_ENTRY, number>
    | VariantKind<typeof UPDATE_WORKBOOK_ENTRY, { entryIndex: number, title: string | null }>
    ;

const SCHEMA_SCRIPT_CATALOG_RANK = 1e9;
const STATS_HISTORY_LIMIT = 20;

enum FocusUpdate {
    Clear,
    UpdateFromCursor,
    UpdateFromCompletion,
};

export function reduceWorkbookState(state: WorkbookState, action: WorkbookStateAction): WorkbookState {
    switch (action.type) {
        case DESTROY:
            return destroyState({ ...state });

        case RESTORE_WORKBOOK: {
            // Stop if there's no instance set
            if (!state.instance) {
                return state;
            }
            // Shallow copy the workbook root
            const next = {
                ...state,
            };
            // Delete all old scripts
            for (const k in next.scripts) {
                const script = next.scripts[k];
                // Unload the script from the catalog (if it's a schema script)
                if (script.script && script.metadata.scriptType === ScriptType.SCHEMA) {
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

                const metadata: ScriptMetadata = {
                    scriptType: s.scriptType == pb.dashql.workbook.ScriptType.Schema ? ScriptType.SCHEMA : ScriptType.QUERY,
                    originalScriptName: null,
                    originalSchemaName: null,
                    originType: ScriptOriginType.LOCAL,
                    originalHttpURL: null,
                    annotations: null,
                    immutable: false,
                };

                const scriptData: ScriptData = {
                    scriptKey: s.scriptId,
                    script,
                    metadata,
                    loading: {
                        status: ScriptLoadingStatus.SUCCEEDED,
                        error: null,
                        startedAt: null,
                        finishedAt: null,
                    },
                    processed: {
                        scanned: null,
                        parsed: null,
                        analyzed: null,
                        destroy: () => { },
                    },
                    outdatedAnalysis: true,
                    statistics: Immutable.List(),
                    cursor: null,
                    completion: null,
                }
                next.scripts[s.scriptId] = scriptData;
            };

            // First analyze all schema scripts
            for (const k in next.scripts) {
                const s = next.scripts[k];
                if (s.metadata.scriptType == ScriptType.SCHEMA) {
                    s.processed = analyzeScript(s.script!);
                    s.statistics = rotateScriptStatistics(s.statistics, s.script!.getStatistics() ?? null);
                    s.outdatedAnalysis = false;
                    next.connectionCatalog.loadScript(s.script!, SCHEMA_SCRIPT_CATALOG_RANK);
                }
                // Update the script in the registry
                state.scriptRegistry.addScript(s.script!);
            }

            // All other scripts are marked via `outdatedAnalysis`
            return next;
        }

        case SELECT_NEXT_ENTRY:
            return {
                ...clearUserFocus(state),
                selectedWorkbookEntry: Math.max(Math.min(state.selectedWorkbookEntry + 1, state.workbookEntries.length - 1), 0),
            };
        case SELECT_PREV_ENTRY:
            return {
                ...clearUserFocus(state),
                selectedWorkbookEntry: Math.max(state.selectedWorkbookEntry - 1, 0),
            };
        case SELECT_ENTRY:
            return {
                ...clearUserFocus(state),
                selectedWorkbookEntry: Math.max(Math.min(action.value, state.workbookEntries.length - 1), 0),
            };

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

        case UPDATE_SCRIPT: {
            const scriptKey = action.value;
            const script = state.scripts[scriptKey];
            if (!script) {
                return state;
            }

            // Is the script outdated?
            if (script.outdatedAnalysis) {
                const copy: ScriptData = { ...script };
                copy.processed.destroy(copy.processed);

                // Analyze the script
                copy.processed = analyzeScript(copy.script!);
                // Rotate the script statistics
                copy.statistics = rotateScriptStatistics(copy.statistics, copy.script!.getStatistics() ?? null);
                copy.outdatedAnalysis = false;

                // Update the script in the registry
                state.scriptRegistry.addScript(copy.script!);

                // Update the cursor?
                if (copy.script && copy.cursor != null) {
                    const cursor = copy.cursor.read();
                    const textOffset = cursor.textOffset();
                    copy.cursor.destroy();
                    copy.cursor = copy.script.moveCursor(textOffset);
                }

                // Create the next script
                const next = {
                    ...clearUserFocus(state),
                    scripts: {
                        ...state.scripts,
                        [copy.scriptKey]: copy
                    }
                };

                // Update the user focus
                if (next.userFocus != null && copy.cursor != null) {
                    next.userFocus = deriveFocusFromScriptCursor(state.scriptRegistry, scriptKey, copy);
                }
                return next;
            }
            return state;
        }

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
                update.scriptCompletion?.value.buffer.destroy();
                return clearUserFocus(state);
            }
            // Different script? This is also very disturbing
            if (prevScript.script?.ptr !== update.script?.ptr) {
                update.scriptBuffers.destroy(update.scriptBuffers);
                update.scriptCursor?.destroy();
                update.scriptCompletion?.value.buffer.destroy();
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
                if (update.scriptCompletion.value.buffer !== prevScript.completion?.value.buffer) {
                    prevScript.completion?.value.buffer.destroy();
                    if (update.scriptCursor) {
                        focusUpdate = FocusUpdate.UpdateFromCompletion;
                    }
                } else {
                    // Did the completion index change?
                    if (update.scriptCompletion.value.candidateId !== prevScript.completion?.value.candidateId) {
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
            let nextState: WorkbookState = {
                ...state,
                scripts: {
                    ...state.scripts,
                    [update.scriptKey]: nextScript
                },
                userFocus,
            };

            // Update the script in the registry
            if (prevScript.script !== nextScript.script && nextScript.script) {
                state.scriptRegistry.addScript(nextScript.script);
            }

            // Is schema script?
            if (nextScript.metadata.scriptType == ScriptType.SCHEMA) {
                // Update the catalog since the schema might have changed
                nextState.connectionCatalog!.loadScript(nextScript.script!, SCHEMA_SCRIPT_CATALOG_RANK);
                // Mark all query scripts as outdated
                for (const key in nextState.scripts) {
                    const script = nextState.scripts[key];
                    if (script.metadata.scriptType == ScriptType.QUERY) {
                        nextState.scripts[key] = {
                            ...script,
                            outdatedAnalysis: true
                        };
                    }
                }
            }
            return nextState;
        }

        case SCRIPT_LOADING_STARTED:
            return {
                ...state,
                scripts: {
                    ...state.scripts,
                    [action.value]: {
                        ...state.scripts[action.value],
                        loading: {
                            status: ScriptLoadingStatus.STARTED,
                            startedAt: new Date(),
                            finishedAt: null,
                            error: null,
                        },
                    },
                },
            };
        case SCRIPT_LOADING_FAILED: {
            const [scriptKey, error] = action.value;
            const prevScript = state.scripts[scriptKey];
            if (!prevScript) {
                return state;
            }
            return {
                ...state,
                scripts: {
                    ...state.scripts,
                    [scriptKey]: {
                        ...prevScript,
                        loading: {
                            status: ScriptLoadingStatus.FAILED,
                            startedAt: prevScript.loading.startedAt,
                            finishedAt: new Date(),
                            error,
                        },
                    },
                },
            };
        }
        case SCRIPT_LOADING_SUCCEEDED: {
            const [scriptKey, content] = action.value;
            const prevScript = state.scripts[scriptKey];
            if (!prevScript) {
                return state;
            }
            // Create new state
            const next = {
                ...state,
                scripts: {
                    ...state.scripts,
                    [scriptKey]: {
                        ...prevScript,
                        loading: {
                            status: ScriptLoadingStatus.SUCCEEDED,
                            startedAt: prevScript.loading.startedAt,
                            finishedAt: new Date(),
                            error: null,
                        },
                    },
                },
            };
            try {
                // Destroy the old buffers
                prevScript.processed.destroy(prevScript.processed);

                // Analyze the new script
                const script = prevScript.script!;
                script.replaceText(content);
                const analysis = analyzeScript(script);

                // Clear cursor and completion
                prevScript?.cursor?.destroy();
                prevScript?.completion?.value.buffer.destroy();

                // Update the script data
                const prev = next.scripts[scriptKey];
                next.scripts[scriptKey] = {
                    ...prev,
                    processed: analysis,
                    statistics: rotateScriptStatistics(prev.statistics, script.getStatistics() ?? null),
                    cursor: null,
                    completion: null
                };

                // Update the script in the registry
                state.scriptRegistry.addScript(script);

                // Did we load a schema script?
                if (prevScript.metadata.scriptType == ScriptType.SCHEMA) {
                    // Load the script into the catalog
                    next.connectionCatalog.loadScript(script, SCHEMA_SCRIPT_CATALOG_RANK);

                    // Mark all query scripts as outdated
                    for (const key in next.scripts) {
                        const script = next.scripts[key];
                        if (script.metadata.scriptType == ScriptType.QUERY) {
                            next.scripts[key] = {
                                ...script,
                                outdatedAnalysis: true
                            };
                        }
                    }
                }
            } catch (e: any) {
                console.error(e);
                next.scripts[scriptKey] = {
                    ...next.scripts[scriptKey],
                    loading: {
                        status: ScriptLoadingStatus.FAILED,
                        startedAt: prevScript.loading.startedAt,
                        finishedAt: new Date(),
                        error: e,
                    },
                };
            }
            return next;
        }

        case REGISTER_QUERY: {
            const [entryId, scriptKey, queryId] = action.value;
            if (entryId >= state.workbookEntries.length) {
                console.warn("orphan query references invalid workbook entry");
                return state;
            } else if (state.workbookEntries[entryId].scriptKey != scriptKey) {
                console.warn("orphan query references invalid workbook script");
                return state;
            } else {
                const entries = [...state.workbookEntries];
                entries[entryId] = { ...entries[entryId], queryId };
                return {
                    ...state,
                    workbookEntries: entries
                };
            }
        }

        case REORDER_WORKBOOK_ENTRIES: {
            const { oldIndex, newIndex } = action.value;
            const newEntries = [...state.workbookEntries];
            const [movedEntry] = newEntries.splice(oldIndex, 1);
            newEntries.splice(newIndex, 0, movedEntry);

            // Calculate how the reordering affects the selected index
            let newSelectedIndex = state.selectedWorkbookEntry;

            if (state.selectedWorkbookEntry === oldIndex) {
                // We reordered the selected element
                newSelectedIndex = newIndex;
            } else if (oldIndex < state.selectedWorkbookEntry && newIndex >= state.selectedWorkbookEntry) {
                // We moved one element below the selection above it and have to decrement the selection
                newSelectedIndex--;
            } else if (oldIndex > state.selectedWorkbookEntry && newIndex <= state.selectedWorkbookEntry) {
                // We moved one element above the selection below it and have to increment the selection
                newSelectedIndex++;
            }

            return {
                ...clearUserFocus(state),
                workbookEntries: newEntries,
                selectedWorkbookEntry: newSelectedIndex,
            };
        }

        case DELETE_WORKBOOK_ENTRY: {
            // Refuse to delete the last entry or non-existing entries
            if (state.workbookEntries.length <= 1 || action.value >= state.workbookEntries.length) {
                return state;
            }
            // Delete the entries
            const newEntries = [...state.workbookEntries];
            newEntries.splice(action.value, 1);
            // Update the selected workbook entry
            let newSelectedIndex = state.selectedWorkbookEntry;
            if (state.selectedWorkbookEntry === action.value) {
                // We deleted the selected index
                newSelectedIndex = 0;
            } else if (action.value < state.selectedWorkbookEntry) {
                // We deleted one entry below the selected, decrement the selection index
                newSelectedIndex--;
            }
            return destroyDeadScripts({
                ...clearUserFocus(state),
                workbookEntries: newEntries,
                selectedWorkbookEntry: newSelectedIndex,
            });
        }

        case CREATE_WORKBOOK_ENTRY: {
            // Generate a new script key
            const scriptKey = state.nextScriptKey;
            // Create a new script
            const script = state.instance.createScript(state.connectionCatalog, scriptKey);
            // Create script data
            const scriptData: ScriptData = {
                scriptKey,
                script,
                metadata: {
                    scriptType: ScriptType.QUERY,
                    originalScriptName: null,
                    originalSchemaName: null,
                    originType: ScriptOriginType.LOCAL,
                    originalHttpURL: null,
                    annotations: null,
                    immutable: false,
                },
                loading: {
                    status: ScriptLoadingStatus.SUCCEEDED,
                    error: null,
                    startedAt: null,
                    finishedAt: null,
                },
                processed: {
                    scanned: null,
                    parsed: null,
                    analyzed: null,
                    destroy: () => { },
                },
                outdatedAnalysis: true,
                statistics: Immutable.List(),
                cursor: null,
                completion: null,
            };

            // Create workbook entry
            const entry: WorkbookEntry = {
                scriptKey,
                queryId: null,
                title: null,
            };
            return {
                ...clearUserFocus(state),
                nextScriptKey: state.nextScriptKey + 1,
                scripts: {
                    ...state.scripts,
                    [scriptKey]: scriptData,
                },
                workbookEntries: [...state.workbookEntries, entry],
                selectedWorkbookEntry: state.workbookEntries.length,
            };
        }

        case UPDATE_WORKBOOK_ENTRY: {
            const { entryIndex, title } = action.value;
            if (entryIndex >= state.workbookEntries.length) {
                console.warn("update references invalid workbook entry");
                return state;
            }
            const entries = [...state.workbookEntries];
            entries[entryIndex] = { ...entries[entryIndex], title };
            return {
                ...state,
                workbookEntries: entries
            };
        }
    }
}

export function destroyUserFocus(focus: UserFocus | null) {
    if (focus?.registryColumnInfo) {
        focus.registryColumnInfo.destroy();
    }
}
export function clearUserFocus(state: WorkbookState): WorkbookState {
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
    data.completion?.value.buffer.destroy();
    data.cursor?.destroy();
    for (const stats of data.statistics) {
        stats.destroy();
    }
}

export function destroyState(state: WorkbookState): WorkbookState {
    if (state.userFocus?.registryColumnInfo) {
        state.userFocus?.registryColumnInfo.destroy();
    }
    state.scriptRegistry.destroy();
    for (const key in state.scripts) {
        const script = state.scripts[key];
        destroyScriptData(script);
    }
    return state;
}

function destroyDeadScripts(state: WorkbookState): WorkbookState {
    // Determine script liveness
    let deadScripts = new Map<number, ScriptData>();
    for (const key in state.scripts) {
        deadScripts.delete(+key);
    }
    // Mark workbook entries as live
    for (const entry of state.workbookEntries) {
        deadScripts.delete(entry.scriptKey);
    }
    // Nothing to cleanup?
    if (deadScripts.size == 0) {
        return state;
    }
    // Copy scripts
    const cleanedScripts: ScriptDataMap = { ...state.scripts };
    // Delete scripts
    for (const [k, v] of deadScripts) {
        if (v.script && v.metadata.scriptType === ScriptType.SCHEMA) {
            state.connectionCatalog.dropScript(v.script);
        }
        destroyScriptData(v);
        delete cleanedScripts[k];
    }
    return { ...state, scripts: cleanedScripts };
}

function rotateScriptStatistics(
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
