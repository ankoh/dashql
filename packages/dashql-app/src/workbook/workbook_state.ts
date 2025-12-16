import * as core from '@ankoh/dashql-core';
import * as pb from '@ankoh/dashql-protobuf';
import * as buf from '@bufbuild/protobuf';

import * as Immutable from 'immutable';

import { analyzeScript, DashQLCompletionState, DashQLProcessorUpdateOut, DashQLScriptBuffers } from '../view/editor/dashql_processor.js';
import { deriveFocusFromCompletionCandidates, deriveFocusFromScriptCursor, UserFocus } from './focus.js';
import { ConnectorInfo, ConnectorType } from '../connection/connector_info.js';
import { VariantKind } from '../utils/index.js';
import { DEBOUNCE_DURATION_WORKBOOK_SCRIPT_WRITE, DEBOUNCE_DURATION_WORKBOOK_WRITE, groupWorkbookWrites, groupScriptWrites, StorageWriter, WRITE_WORKBOOK_SCRIPT, WRITE_WORKBOOK_STATE } from '../storage/storage_writer.js';
import { WorkbookStateWithoutId } from './workbook_state_registry.js';
import { Logger } from '../platform/logger.js';

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
    workbookMetadata: pb.dashql.workbook.WorkbookMetadata;
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
    workbookEntries: pb.dashql.workbook.WorkbookEntry[];
    /// The selected workbook entry
    selectedWorkbookEntry: number;
    /// The user focus info (if any)
    userFocus: UserFocus | null;
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
    annotations: pb.dashql.workbook.WorkbookScriptAnnotations;
    /// The statistics
    statistics: Immutable.List<core.FlatBufferPtr<core.buffers.statistics.ScriptStatistics>>;
    /// The cursor
    cursor: core.FlatBufferPtr<core.buffers.cursor.ScriptCursor> | null;
    /// The completion state.
    completion: DashQLCompletionState | null;
    /// The latest query id
    latestQueryId: number | null;
}

export const DESTROY = Symbol('DESTROY');
export const RESTORE_WORKBOOK = Symbol('RESTORE_WORKBOOK');
export const SELECT_NEXT_ENTRY = Symbol('SELECT_NEXT_ENTRY');
export const SELECT_PREV_ENTRY = Symbol('SELECT_PREV_ENTRY');
export const SELECT_ENTRY = Symbol('SELECT_ENTRY');
export const ANALYZE_OUTDATED_SCRIPT = Symbol('ANALYZE_OUTDATED_SCRIPT');
export const UPDATE_FROM_PROCESSOR = Symbol('UPDATE_FROM_PROCESSOR');
export const CATALOG_DID_UPDATE = Symbol('CATALOG_DID_UPDATE');
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
    | VariantKind<typeof ANALYZE_OUTDATED_SCRIPT, ScriptKey>
    | VariantKind<typeof UPDATE_FROM_PROCESSOR, DashQLProcessorUpdateOut>
    | VariantKind<typeof CATALOG_DID_UPDATE, null>
    | VariantKind<typeof REGISTER_QUERY, [number, ScriptKey, number]>
    | VariantKind<typeof REORDER_WORKBOOK_ENTRIES, { oldIndex: number, newIndex: number }>
    | VariantKind<typeof CREATE_WORKBOOK_ENTRY, null>
    | VariantKind<typeof DELETE_WORKBOOK_ENTRY, number>
    | VariantKind<typeof UPDATE_WORKBOOK_ENTRY, { entryIndex: number, title: string | null }>
    ;

const STATS_HISTORY_LIMIT = 20;

enum FocusUpdate {
    Clear,
    UpdateFromCursor,
    UpdateFromCompletion,
};

export function reduceWorkbookState(state: WorkbookState, action: WorkbookStateAction, storage: StorageWriter, logger: Logger): WorkbookState {
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
                    annotations: buf.create(pb.dashql.workbook.WorkbookScriptAnnotationsSchema),
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

            // All other scripts are marked via `outdatedAnalysis`
            if (next.connectorInfo.connectorType != ConnectorType.DEMO) {
                storage.write(groupWorkbookWrites(next.workbookId), { type: WRITE_WORKBOOK_STATE, value: [next.workbookId, next] }, DEBOUNCE_DURATION_WORKBOOK_SCRIPT_WRITE);
            }
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

        case ANALYZE_OUTDATED_SCRIPT:
            return analyzeOutdatedScriptInWorkbook(state, action.value, logger);

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
                storage.write(groupScriptWrites(nextState.workbookId, update.scriptKey), { type: WRITE_WORKBOOK_SCRIPT, value: [nextState.workbookId, update.scriptKey, update.script] }, DEBOUNCE_DURATION_WORKBOOK_SCRIPT_WRITE);
            }
            return nextState;
        }

        case REGISTER_QUERY: {
            const [_entryId, scriptKey, queryId] = action.value;
            const scriptData = state.scripts[scriptKey];
            if (!scriptData) {
                console.warn("orphan query references invalid script");
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

            const next = {
                ...clearUserFocus(state),
                workbookEntries: newEntries,
                selectedWorkbookEntry: newSelectedIndex,
            };
            if (next.connectorInfo.connectorType != ConnectorType.DEMO) {
                storage.write(groupWorkbookWrites(next.workbookId), { type: WRITE_WORKBOOK_STATE, value: [next.workbookId, next] }, DEBOUNCE_DURATION_WORKBOOK_WRITE);
            }
            return next;
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
            const next = destroyDeadScripts({
                ...clearUserFocus(state),
                workbookEntries: newEntries,
                selectedWorkbookEntry: newSelectedIndex,
            });
            if (next.connectorInfo.connectorType != ConnectorType.DEMO) {
                storage.write(groupWorkbookWrites(next.workbookId), { type: WRITE_WORKBOOK_STATE, value: [next.workbookId, next] }, DEBOUNCE_DURATION_WORKBOOK_WRITE);
            }
            return next;
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
                processed: {
                    scanned: null,
                    parsed: null,
                    analyzed: null,
                    destroy: () => { },
                },
                outdatedAnalysis: true,
                statistics: Immutable.List(),
                annotations: buf.create(pb.dashql.workbook.WorkbookScriptAnnotationsSchema),
                cursor: null,
                completion: null,
                latestQueryId: null,
            };

            // Create workbook entry
            const entry: pb.dashql.workbook.WorkbookEntry = buf.create(pb.dashql.workbook.WorkbookEntrySchema, {
                scriptId: scriptKey,
            });
            const next: WorkbookState = {
                ...clearUserFocus(state),
                nextScriptKey: state.nextScriptKey + 1,
                scripts: {
                    ...state.scripts,
                    [scriptKey]: scriptData,
                },

                workbookEntries: [...state.workbookEntries, entry],
                selectedWorkbookEntry: state.workbookEntries.length,
            };
            if (next.connectorInfo.connectorType != ConnectorType.DEMO) {
                storage.write(groupScriptWrites(next.workbookId, scriptKey), { type: WRITE_WORKBOOK_SCRIPT, value: [next.workbookId, scriptKey, script] }, DEBOUNCE_DURATION_WORKBOOK_WRITE);
                storage.write(groupWorkbookWrites(next.workbookId), { type: WRITE_WORKBOOK_STATE, value: [next.workbookId, next] }, DEBOUNCE_DURATION_WORKBOOK_WRITE);
            }
            return next;
        }

        case UPDATE_WORKBOOK_ENTRY: {
            const { entryIndex, title } = action.value;
            if (entryIndex >= state.workbookEntries.length) {
                console.warn("update references invalid workbook entry");
                return state;
            }
            const entries = [...state.workbookEntries];
            entries[entryIndex] = buf.create(pb.dashql.workbook.WorkbookEntrySchema, {
                ...entries[entryIndex],
                title: title ?? ""
            });
            const next = {
                ...state,
                workbookEntries: entries
            };
            if (next.connectorInfo.connectorType != ConnectorType.DEMO) {
                storage.write(groupWorkbookWrites(next.workbookId), { type: WRITE_WORKBOOK_STATE, value: [next.workbookId, next] }, DEBOUNCE_DURATION_WORKBOOK_WRITE);
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
export function clearUserFocus<V extends WorkbookStateWithoutId>(state: V): V {
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
        deadScripts.delete(entry.scriptId);
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

function deriveScriptAnnotations(data: DashQLScriptBuffers): pb.dashql.workbook.WorkbookScriptAnnotations {
    if (!data.analyzed) {
        return buf.create(pb.dashql.workbook.WorkbookScriptAnnotationsSchema, {});
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

    return buf.create(pb.dashql.workbook.WorkbookScriptAnnotationsSchema, {
        tableDefs: tableDefsFlat
    });
}

export function analyzeWorkbookScript(scriptData: ScriptData, registry: core.DashQLScriptRegistry, catalog: core.DashQLCatalog, _logger: Logger): ScriptData {
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

export function analyzeOutdatedScriptInWorkbook<V extends WorkbookStateWithoutId>(state: V, scriptKey: number, logger: Logger): V {
    const scriptData = state.scripts[scriptKey];
    if (!scriptData || !scriptData.outdatedAnalysis) {
        return state;
    }
    // Create the next workbook state
    const nextScriptData = analyzeWorkbookScript(scriptData, state.scriptRegistry, state.connectionCatalog, logger);
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
