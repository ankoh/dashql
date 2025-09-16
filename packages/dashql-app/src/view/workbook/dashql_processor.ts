import * as dashql from '@ankoh/dashql-core';
import { StateField, StateEffect, StateEffectType, Text, Transaction } from '@codemirror/state';
import { UserFocus } from '../../workbook/focus.js';
import { selectedCompletion, selectedCompletionIndex } from '@codemirror/autocomplete';
import { DashQLCompletion } from './dashql_completion.js';

/// The configuration of the DashQL config
export interface DashQLProcessorConfig {
    /// Show the completion details
    showCompletionDetails: boolean;
}
/// A state of the completion candidate.
/// Tracks if a candidate got applied.
export enum DashQLCompletionState {
    None,
    Started,
    AppliedCandidate,
    AppliedQualification,
    AppliedTemplate,
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
    /// The current completion
    scriptCompletion: dashql.FlatBufferPtr<dashql.buffers.completion.Completion> | null;
    /// The selected completion candidate (if any)
    scriptCompletionCandidate: number | null;
    /// The completion candidate state
    scriptCompletionState: DashQLCompletionState;
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

/// Effect to update a DashQL script attached to a CodeMirror editor
export const DashQLUpdateEffect: StateEffectType<DashQLProcessorUpdateIn> = StateEffect.define<DashQLProcessorUpdateIn>();
/// Effect to apply a completion candidate
type CompletionPtrAndCandidate = [dashql.FlatBufferPtr<dashql.buffers.completion.Completion>, number];
export const DashQLCompletionStartEffect: StateEffectType<CompletionPtrAndCandidate> = StateEffect.define<CompletionPtrAndCandidate>();
/// Effect to focus on a different completion candidate
export const DashQLCompletionPeekEffect: StateEffectType<CompletionPtrAndCandidate> = StateEffect.define<CompletionPtrAndCandidate>();
/// Effect to apply a completion candidate
export const DashQLCompletionAppliedCandidateEffect: StateEffectType<CompletionPtrAndCandidate> = StateEffect.define<CompletionPtrAndCandidate>();
/// Effect to apply a candidate qualification
export const DashQLCompletionAppliedQualificationEffect: StateEffectType<CompletionPtrAndCandidate> = StateEffect.define<CompletionPtrAndCandidate>();
/// Effect to apply a candidate template
export const DashQLCompletionAppliedTemplateEffect: StateEffectType<CompletionPtrAndCandidate> = StateEffect.define<CompletionPtrAndCandidate>();

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
            scriptCompletionCandidate: null,
            scriptCompletionState: DashQLCompletionState.None,

            derivedFocus: null,

            onUpdate: () => { },
        };
        return config;
    },
    // Mirror the DashQL state
    update: (prevState: DashQLProcessorState, transaction: Transaction) => {
        // Did the selection change?
        const prevSelection = transaction.startState.selection.asSingle();
        const newSelection = transaction.newSelection.asSingle();
        const selectionChanged = !prevSelection.eq(newSelection);
        const selection: number | null = newSelection.main.to;
        let state: DashQLProcessorState = prevState;

        // Did the user provide us with a new DashQL script?
        let receivedUpdate = false;
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
                receivedUpdate = true;
            }
        }

        // No script at all?
        // Then abort early, nothing to do here
        if (state.script == null) {
            return state;
        }

        // Check the completion state
        let completionStateChangedTo: DashQLCompletionState | null = null;
        for (const effect of transaction.effects) {
            if (effect.is(DashQLCompletionStartEffect)) {
                state = copyLazily(state, prevState);
                let [candidate, candidateId] = effect.value;
                state.scriptCompletionState = DashQLCompletionState.Started;
                state.scriptCompletion = candidate;
                state.scriptCompletionCandidate = candidateId;
                completionStateChangedTo = state.scriptCompletionState;

            } else if (effect.is(DashQLCompletionPeekEffect)) {
                state = copyLazily(state, prevState);
                let [candidate, candidateId] = effect.value;
                state.scriptCompletion = candidate;
                state.scriptCompletionCandidate = candidateId;
                completionStateChangedTo = state.scriptCompletionState;

            } else if (effect.is(DashQLCompletionAppliedCandidateEffect)) {
                state = copyLazily(state, prevState);
                let [candidate, candidateId] = effect.value;
                state.scriptCompletion = candidate;
                state.scriptCompletionCandidate = candidateId;
                state.scriptCompletionState = DashQLCompletionState.AppliedCandidate;
                completionStateChangedTo = state.scriptCompletionState;

            } else if (effect.is(DashQLCompletionAppliedQualificationEffect)) {
                state = copyLazily(state, prevState);
                let [candidate, candidateId] = effect.value;
                state.scriptCompletion = candidate;
                state.scriptCompletionCandidate = candidateId;
                state.scriptCompletionState = DashQLCompletionState.AppliedQualification;
                completionStateChangedTo = state.scriptCompletionState;

            } else if (effect.is(DashQLCompletionAppliedTemplateEffect)) {
                state = copyLazily(state, prevState);
                let [candidate, candidateId] = effect.value;
                state.scriptCompletion = candidate;
                state.scriptCompletionCandidate = candidateId;
                state.scriptCompletionState = DashQLCompletionState.AppliedTemplate;
                completionStateChangedTo = state.scriptCompletionState;
            }
        }


        if (transaction.docChanged) {
            // Apply all text changes to the the DashQL script.
            // This is the crucial place where we mirror all text changes!
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

            // Analyze the new script
            state.scriptBuffers = analyzeScript(state.script!);
            state.scriptCursor = state.script!.moveCursor(selection ?? 0);

            // Was no completion event?
            // Then we forget about any completion candidate state
            if (completionStateChangedTo == null) {
                state.scriptCompletion = null;
                state.scriptCompletionCandidate = null;
                state.scriptCompletionState = DashQLCompletionState.None;
            }

        } else if (selectionChanged) {
            // Doc did not change, update the script cursor if the selection changed.
            // This is the place where we handle events of normal cursor movements.
            state = copyLazily(state, prevState);
            state.scriptCursor = state.script!.moveCursor(selection ?? 0);
        } else {

            // Did the completion index change?
            const completion = selectedCompletion(transaction.state) as (DashQLCompletion | null);
            const completionIndex = selectedCompletionIndex(transaction.state);
            if (state.scriptCompletion == completion?.completion && state.scriptCompletionCandidate != completionIndex) {
                state = copyLazily(state, prevState);
                state.scriptCompletionCandidate = completionIndex;
            }
        }

        // Did anything change?
        // Then tell the user about it.
        // It's the responsibility of the user to persist anything here and cleanup whatever is now dead.
        // We cannot do that on behalf of the user since CodeMirror lacks "destroy" lifecycle hooks.
        if (prevState !== state && !receivedUpdate) {
            state.onUpdate(state);
        }
        return state;
    },
});
