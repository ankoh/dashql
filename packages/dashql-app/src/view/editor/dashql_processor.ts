import * as dashql from '@ankoh/dashql-core';

import { StateField, StateEffect, StateEffectType, Text, Transaction } from '@codemirror/state';

import { UserFocus } from '../../workbook/focus.js';
import { CompletionPatch, computePatches, UpdatePatchStartingFrom } from './dashql_completion_patches.js';

export const DASHQL_COMPLETION_LIMIT = 10;

/// The configuration of the DashQL config
export interface DashQLProcessorConfig {
    /// Show the completion details
    showCompletionDetails: boolean;
}

/// A script key
export type DashQLScriptKey = number;
/// A collection of FlatBuffers for a script
export interface DashQLScriptBuffers {
    /// The scanned script
    scanned: dashql.FlatBufferPtr<dashql.buffers.parser.ScannedScript> | null;
    /// The parsed script
    parsed: dashql.FlatBufferPtr<dashql.buffers.parser.ParsedScript> | null;
    /// The analyzed script
    analyzed: dashql.FlatBufferPtr<dashql.buffers.analyzer.AnalyzedScript> | null;
    /// Destroy the state.
    /// The user is responsible for cleanup up FlatBufferRefs that are no longer needed.
    /// E.g. one strategy may be to destroy the "old" state once a script with the same script key is emitted.
    destroy: (state: DashQLScriptBuffers) => void;
}

/// A completion status
export enum DashQLCompletionStatus {
    AVAILABLE,
    SELECTED_CANDIDATE,
    SELECTED_CATALOG_OBJECT,
    SELECTED_TEMPLATE,
}

/// A completion state
export interface DashQLCompletionState {
    /// The status
    status: DashQLCompletionStatus;
    /// The completion buffer
    buffer: dashql.FlatBufferPtr<dashql.buffers.completion.Completion>;
    /// The currently selected candidate id.
    /// 0 if there are no candidates.
    candidateId: number;
    /// The patches to apply the candidate
    candidatePatch: CompletionPatch[];
    /// The currently selected catalog object id.
    /// 0 if there are no objects.
    catalogObjectId: number;
    /// The patches to apply the catalog object
    catalogObjectPatch: CompletionPatch[];
    /// The currently selected template id
    /// 0 if there are no templates.
    templateId: number;
    /// The patches to apply the template
    templatePatch: CompletionPatch[];
}

/// A state that is pushed from the processor to the outside
export interface DashQLProcessorUpdateOut {
    /// The key of the currently active script
    scriptKey: DashQLScriptKey;
    /// The currently active script in the editor
    script: dashql.DashQLScript | null;
    /// The previous processed script buffers (if any)
    scriptBuffers: DashQLScriptBuffers;
    /// The script cursor
    scriptCursor: dashql.FlatBufferPtr<dashql.buffers.cursor.ScriptCursor> | null;
    /// The completion candidate state (if any)
    scriptCompletion: DashQLCompletionState | null;
};
/// A state that is propagated from the outside into processor
export type DashQLProcessorUpdateIn = DashQLProcessorUpdateOut & {
    /// The config
    config: DashQLProcessorConfig;
    /// The registry script retirstry
    scriptRegistry: dashql.DashQLScriptRegistry | null;
    /// The derive focus info
    derivedFocus: UserFocus | null;

    /// This callback is called when the editor updates the script, the cursor, completions.
    /// The callee is responsible for keeping FlatBufferPtrs alive and clean them up once they get overwritten.
    onUpdate: (out: DashQLProcessorUpdateOut) => void;
}
/// The state of a DashQL processor
export type DashQLProcessorState = DashQLProcessorUpdateIn;

/// Analyze a new script
export function analyzeScript(script: dashql.DashQLScript): DashQLScriptBuffers {
    try {
        script.analyze();

        const scanned = script.getScanned();
        const parsed = script.getParsed();
        const analyzed = script.getAnalyzed();
        return { scanned, parsed, analyzed, destroy: destroyBuffers };

    } catch (e: any) {
        console.error(e);
    }
    return { scanned: null, parsed: null, analyzed: null, destroy: destroyBuffers };
}

/// Destory the buffers
const destroyBuffers = (state: DashQLScriptBuffers) => {
    if (state.scanned != null) {
        state.scanned.destroy();
        state.scanned = null;
    }
    if (state.parsed != null) {
        state.parsed.destroy();
        state.parsed = null;
    }
    if (state.analyzed != null) {
        state.analyzed.destroy();
        state.analyzed = null;
    }
    return state;
};

/// Effect to update the state attached to a CodeMirror editor
export const DashQLUpdateEffect: StateEffectType<DashQLProcessorUpdateIn> = StateEffect.define<DashQLProcessorUpdateIn>();

/// Effect to start a completion
export const DashQLCompletionStartEffect: StateEffectType<null> = StateEffect.define<null>();
/// Effect to stop a completion without applying
export const DashQLCompletionAbortEffect: StateEffectType<null> = StateEffect.define<null>();
/// Effect to preview a different candidate
export const DashQLCompletionPreviewCandidateEffect: StateEffectType<number> = StateEffect.define<number>();
/// Effect to select a completion candidate
export const DashQLCompletionSelectCandidateEffect: StateEffectType<null> = StateEffect.define<null>();
/// Effect to select a catalog object
export const DashQLCompletionSelectCatalogObjectEffect: StateEffectType<null> = StateEffect.define<null>();
/// Effect to select a template
export const DashQLCompletionSelectTemplateEffect: StateEffectType<null> = StateEffect.define<null>();

// Copy an object if it equals another object
function copyLazily(nextState: DashQLProcessorState, prevState: DashQLProcessorState): DashQLProcessorState {
    return nextState === prevState ? { ...prevState } : nextState;
};

/// A processor for DashQL scripts
export const DashQLProcessorPlugin: StateField<DashQLProcessorState> = StateField.define<DashQLProcessorState>({
    // Create the initial state
    create: () => {
        // By default, the DashQL script is not configured
        const config: DashQLProcessorState = {
            config: {
                showCompletionDetails: false,
            },

            scriptRegistry: null,
            scriptKey: 0,
            script: null,
            scriptBuffers: {
                scanned: null,
                parsed: null,
                analyzed: null,
                destroy: destroyBuffers,
            },
            scriptCursor: null,
            scriptCompletion: null,

            derivedFocus: null,

            onUpdate: () => { },
        };
        return config;
    },
    // Mirror the DashQL state
    update: (prevState: DashQLProcessorState, transaction: Transaction) => {
        let state: DashQLProcessorState = prevState;

        // Did the selection change?
        const prevSelection = transaction.startState.selection.asSingle();
        const newSelection = transaction.newSelection.asSingle();
        const selectionChanged = !prevSelection.eq(newSelection);
        const selection: number | null = newSelection.main.to;

        // Did the user provide us with a new DashQL script?
        let externalUpdate = false;
        for (const effect of transaction.effects) {
            // DashQL update effect?
            if (effect.is(DashQLUpdateEffect)) {
                state = {
                    ...state,
                    ...effect.value,
                };

                // Script changed?
                // Signaled either through a completely new script or through a new script buffer
                if (
                    prevState.script !== state.script ||
                    prevState.scriptBuffers !== state.scriptBuffers
                ) {
                    return state;
                }

                // Is a redundant update?
                const redundantUpdate = prevState.script == effect.value.script
                    && prevState.scriptBuffers == effect.value.scriptBuffers
                    && prevState.scriptCursor == effect.value.scriptCursor
                    && prevState.derivedFocus == effect.value.derivedFocus
                    && !transaction.docChanged
                    && !selectionChanged;

                if (redundantUpdate) {
                    return prevState;
                }
                externalUpdate = true;
            }
        }

        // No script at all?
        // Then abort early, nothing to do here
        if (state.script == null) {
            return state;
        }

        // Did the doc change?
        if (transaction.docChanged) {
            // Apply all text changes to the the script.
            // This is the crucial place where we mirror all text changes to the Webassembly B-tree Rope!
            state = copyLazily(state, prevState);
            transaction.changes.iterChanges(
                (fromA: number, toA: number, fromB: number, _toB: number, inserted: Text) => {
                    if (toA - fromA > 0) {
                        state.script!.eraseTextRange(fromA, toA - fromA);
                    }
                    if (inserted.length > 0) {
                        let writer = fromB;
                        for (const text of inserted.iter()) {
                            state.script!.insertTextAt(writer, text);
                            writer += text.length;
                        }
                    }
                },
            );
            state.scriptBuffers = analyzeScript(state.script!);
            state.scriptCursor = state.script!.moveCursor(selection ?? 0);

        } else if (selectionChanged) {
            // Doc did not change, update the script cursor if the selection changed.
            // This is the place where we handle events of normal cursor movements.
            state = copyLazily(state, prevState);
            state.scriptCursor = state.script!.moveCursor(selection ?? 0);
        }

        // Check additional completion effects
        state = updateCompletion(state, prevState, transaction);

        // Did anything change?
        // Then tell the user about it.
        // It's the responsibility of the user to persist anything here and cleanup whatever is now dead.
        // We cannot do that on behalf of the user since CodeMirror lacks "destroy" lifecycle hooks.
        if (prevState !== state && !externalUpdate) {
            state.onUpdate(state);
        }
        return state;
    },
});

// Helper to start a completion
function tryStartCompletion(state: DashQLProcessorState, prevState: DashQLProcessorState, buffer: dashql.FlatBufferPtr<dashql.buffers.completion.Completion> | null, text: Text, cursor: number) {
    if (!buffer) {
        return state;
    }
    if (buffer.read().candidatesLength() == 0) {
        // No candidates?
        // Drop the completion...
        buffer.destroy();
        state = copyLazily(state, prevState);
        state.scriptCompletion = null;
    } else {
        // Mark the new completion available
        state = copyLazily(state, prevState);
        state.scriptCompletion = {
            status: DashQLCompletionStatus.AVAILABLE,
            buffer: buffer,
            candidateId: 0,
            candidatePatch: [],
            catalogObjectId: 0,
            catalogObjectPatch: [],
            templateId: 0,
            templatePatch: [],
        };
        state.scriptCompletion = computePatches(state.scriptCompletion, text, cursor, UpdatePatchStartingFrom.Candidate);
    }
    return state;
};

// Helper to determine if a user event triggers completions.
// For events, refer to https://codemirror.net/docs/ref/
function userEventCanStartCompletion(transaction: Transaction, prevCursor: dashql.FlatBufferPtr<dashql.buffers.cursor.ScriptCursor> | null) {
    switch (transaction.annotation(Transaction.userEvent)) {
        case "input.type":
        case "delete.selection":
        case "delete.forward":
            return true;
        case "delete.backward":
            // When deleting backward, we only start the completion if we're deleting something from a token.
            // That means the previous cursor must not be AFTER_SYMBOL or BEFORE_SYMBOL
            switch (prevCursor?.read().scannerRelativePosition()) {
                case dashql.buffers.cursor.RelativeSymbolPosition.AFTER_SYMBOL:
                case dashql.buffers.cursor.RelativeSymbolPosition.BEFORE_SYMBOL:
                    return false;
                default:
                    return true;
            }
        case "input.paste":
        case "delete.cut":
        case "input.drop":
            return false;
    }
    return false;
}


// Helper to update a completion based on a transaction
function updateCompletion(state: DashQLProcessorState, prevState: DashQLProcessorState, transaction: Transaction): DashQLProcessorState {
    // We need a script and script cursor to complete.
    if (!state.script || !state.scriptCursor) {
        return state;
    }
    const cursorOffset = state.scriptCursor.read().textOffset();

    // Check additional completion effects
    for (const effect of transaction.effects) {
        if (effect.is(DashQLCompletionStartEffect)) {
            // Effect to explictly start a completion
            const buffer = state.script!.tryCompleteAtCursor(DASHQL_COMPLETION_LIMIT, state.scriptRegistry);
            state = tryStartCompletion(state, prevState, buffer, transaction.newDoc, cursorOffset);
            continue;

        }

        // All other effects require an active completion
        if (state.scriptCompletion == null) {
            continue;
        }
        const completionBuffer = state.scriptCompletion.buffer.read();

        const resetCompletion = () => {
            state = copyLazily(state, prevState);
            state.scriptCompletion = null;
        };

        if (effect.is(DashQLCompletionAbortEffect)) {
            resetCompletion();
            break;

        } else if (effect.is(DashQLCompletionPreviewCandidateEffect)) {
            // Effect to switch the previews completion candidate
            if (state.scriptCompletion.status == DashQLCompletionStatus.AVAILABLE && !transaction.docChanged) {
                // XXX This is not correct, we need to update the ids
                state = tryStartCompletion(state, prevState, state.scriptCompletion.buffer, transaction.newDoc, cursorOffset);
            } else {
                resetCompletion();
                break;
            }

        } else if (effect.is(DashQLCompletionSelectCandidateEffect)) {
            // Clear completion if the candidate index is invalid
            if (state.scriptCompletion.candidateId >= completionBuffer.candidatesLength()) {
                resetCompletion();
                break;
            }
            // Try to select a completion candidate at a cursor
            const buffer = state.script!.trySelectCompletionCandidateAtCursor(
                state.scriptCompletion.buffer,
                state.scriptCompletion.candidateId,
            );
            if (buffer) {
                state = copyLazily(state, prevState);
                state.scriptCompletion = {
                    ...state.scriptCompletion!,
                    status: DashQLCompletionStatus.SELECTED_CANDIDATE,
                    buffer: buffer,
                    candidateId: 0
                };
            } else {
                resetCompletion();
                break;
            }

        } else if (effect.is(DashQLCompletionSelectCatalogObjectEffect)) {
            // Clear completion if the candidate index is invalid
            if (state.scriptCompletion.candidateId >= completionBuffer.candidatesLength()) {
                resetCompletion();
                break;
            }
            // Clear completion if the catalog object is invalid
            const ca = completionBuffer.candidates(state.scriptCompletion.candidateId)!;
            if (state.scriptCompletion.catalogObjectId >= ca.catalogObjectsLength()) {
                resetCompletion();
                break;
            }

            // Effect to select a qualified completion candidate
            const buffer = state.script!.trySelectQualifiedCompletionCandidateAtCursor(
                state.scriptCompletion.buffer,
                state.scriptCompletion.candidateId,
                state.scriptCompletion.catalogObjectId,
            );
            if (buffer) {
                state = copyLazily(state, prevState);
                state.scriptCompletion = {
                    ...state.scriptCompletion!,
                    status: DashQLCompletionStatus.SELECTED_CATALOG_OBJECT,
                    buffer: buffer,
                    candidateId: 0,
                    catalogObjectId: 0,
                };
            } else {
                resetCompletion();
                break;
            }

        } else if (effect.is(DashQLCompletionSelectTemplateEffect)) {
            // Clear completion if the candidate index is invalid
            if (state.scriptCompletion.candidateId >= completionBuffer.candidatesLength()) {
                resetCompletion();
                break;
            }
            // Clear completion if the catalog object or the template is invalid
            const ca = completionBuffer.candidates(state.scriptCompletion.candidateId)!;
            if (state.scriptCompletion.catalogObjectId >= ca.catalogObjectsLength() || state.scriptCompletion.templateId >= ca.completionTemplatesLength()) {
                resetCompletion();
                break;
            }

            // Effect to select a candidate template
            state = copyLazily(state, prevState);
            state.scriptCompletion = {
                ...state.scriptCompletion!,
                status: DashQLCompletionStatus.SELECTED_TEMPLATE,
            };
        }
    }

    if (transaction.docChanged && state.scriptCompletion == prevState.scriptCompletion) {
        // We don't have an ongoing completion and there is a new user-input?
        // Get a completion going.
        const noActiveCompletion = !state.scriptCompletion || state.scriptCompletion.status != DashQLCompletionStatus.AVAILABLE;
        if (noActiveCompletion && userEventCanStartCompletion(transaction, prevState.scriptCursor)) {
            const buffer = state.script!.tryCompleteAtCursor(DASHQL_COMPLETION_LIMIT, state.scriptRegistry);
            state = tryStartCompletion(state, prevState, buffer, transaction.newDoc, cursorOffset);
        }

        // Doc changed, there is a completion, and the completion did not change?
        // Update the completion if it's ongoing, clear it if it is completed.
        else if (state.scriptCompletion != null) {
            switch (state.scriptCompletion.status) {
                case DashQLCompletionStatus.AVAILABLE:
                    const buffer = state.script!.tryCompleteAtCursor(DASHQL_COMPLETION_LIMIT, state.scriptRegistry);
                    state = tryStartCompletion(state, prevState, buffer, transaction.newDoc, cursorOffset);
                    break;
                default:
                    state = copyLazily(state, prevState);
                    state.scriptCompletion = null;
                    break;
            }
        }
    }
    return state;
}
