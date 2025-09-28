import * as dashql from '@ankoh/dashql-core';
import { StateField, StateEffect, StateEffectType, Text, Transaction } from '@codemirror/state';
import { UserFocus } from '../../workbook/focus.js';
import { selectedCompletion, selectedCompletionIndex } from '@codemirror/autocomplete';
import { VariantKind } from 'utils/variant.js';
import { DashQLCompletionCandidate } from './dashql_completion.js';

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

export const DASHQL_COMPLETION_STARTED = Symbol("DASHQL_COMPLETION_STARTED");
export const DASHQL_COMPLETION_APPLIED_CANDIDATE = Symbol("DASHQL_COMPLETION_APPLIED_CANDIDATE");
export const DASHQL_COMPLETION_APPLIED_QUALIFIED_CANDIDATE = Symbol("DASHQL_COMPLETION_APPLIED_QUALIFIED_CANDIDATE");
export const DASHQL_COMPLETION_APPLIED_TEMPLATE = Symbol("DASHQL_COMPLETION_APPLIED_TEMPLATE");

/// Args to apply a candidate
export interface DashQLCompletionStartedState {
    buffer: dashql.FlatBufferPtr<dashql.buffers.completion.Completion>;
    candidateId: number | null;
    catalogObjectId: number | null;
    templateId: number | null;
}
/// Args to apply a candidate
export interface DashQLCompletionApplyCandidateState extends DashQLCompletionStartedState {
    candidateId: number;
    catalogObjectId: number | null;
    templateId: number | null;
};
/// Args to apply a qualified candidate
export interface DashQLCompletionApplyQualifiedCandidateState extends DashQLCompletionApplyCandidateState {
    catalogObjectId: number;
    templateId: number | null;
};
/// Args to apply a template
export interface DashQLCompletionApplyTemplateState extends DashQLCompletionApplyQualifiedCandidateState {
    templateId: number;
};

export type DashQLCompletionState =
    | VariantKind<typeof DASHQL_COMPLETION_STARTED, DashQLCompletionStartedState>
    | VariantKind<typeof DASHQL_COMPLETION_APPLIED_CANDIDATE, DashQLCompletionApplyCandidateState>
    | VariantKind<typeof DASHQL_COMPLETION_APPLIED_QUALIFIED_CANDIDATE, DashQLCompletionApplyQualifiedCandidateState>
    | VariantKind<typeof DASHQL_COMPLETION_APPLIED_TEMPLATE, DashQLCompletionApplyTemplateState>
    ;

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

/// Effect to update a DashQL script attached to a CodeMirror editor
export const DashQLUpdateEffect: StateEffectType<DashQLProcessorUpdateIn> = StateEffect.define<DashQLProcessorUpdateIn>();
/// Effect to apply a completion candidate
export const DashQLCompletionStartEffect: StateEffectType<DashQLCompletionStartedState> = StateEffect.define<DashQLCompletionStartedState>();
/// Effect to apply a completion candidate
export const DashQLCompletionAppliedCandidateEffect: StateEffectType<DashQLCompletionApplyCandidateState> = StateEffect.define<DashQLCompletionApplyCandidateState>();
/// Effect to apply a candidate qualification
export const DashQLCompletionAppliedQualificationEffect: StateEffectType<DashQLCompletionApplyQualifiedCandidateState> = StateEffect.define<DashQLCompletionApplyQualifiedCandidateState>();
/// Effect to apply a candidate template
export const DashQLCompletionAppliedTemplateEffect: StateEffectType<DashQLCompletionApplyTemplateState> = StateEffect.define<DashQLCompletionApplyTemplateState>();

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

        } else if (selectionChanged) {
            // Doc did not change, update the script cursor if the selection changed.
            // This is the place where we handle events of normal cursor movements.
            state = copyLazily(state, prevState);
            state.scriptCursor = state.script!.moveCursor(selection ?? 0);
        }

        // Check the completion state
        for (const effect of transaction.effects) {
            if (effect.is(DashQLCompletionStartEffect)) {
                state = copyLazily(state, prevState);
                state.scriptCompletion = {
                    type: DASHQL_COMPLETION_STARTED,
                    value: effect.value
                };

            } else if (effect.is(DashQLCompletionAppliedCandidateEffect)) {
                state = copyLazily(state, prevState);
                const next = state.script!.trySelectCompletionCandidateAtCursor(
                    effect.value.buffer,
                    effect.value.candidateId
                );
                if (next != null) {
                    state.scriptCompletion = {
                        type: DASHQL_COMPLETION_APPLIED_CANDIDATE,
                        value: {
                            buffer: next,
                            candidateId: 0,
                            catalogObjectId: prevState.scriptCompletion?.value.catalogObjectId ?? null,
                            templateId: prevState.scriptCompletion?.value.templateId ?? null,
                        }
                    };
                } else {
                    state.scriptCompletion = null;
                }
            } else if (effect.is(DashQLCompletionAppliedQualificationEffect)) {
                state = copyLazily(state, prevState);
                const next = state.script!.trySelectQualifiedCompletionCandidateAtCursor(
                    effect.value.buffer,
                    effect.value.candidateId,
                    effect.value.catalogObjectId,
                );
                if (next != null) {
                    state.scriptCompletion = {
                        type: DASHQL_COMPLETION_APPLIED_QUALIFIED_CANDIDATE,
                        value: {
                            buffer: next,
                            candidateId: 0,
                            catalogObjectId: 0,
                            templateId: prevState.scriptCompletion?.value.templateId ?? null,
                        }
                    };
                } else {
                    state.scriptCompletion = null;
                }
            } else if (effect.is(DashQLCompletionAppliedTemplateEffect)) {
                state = copyLazily(state, prevState);
                state.scriptCompletion = {
                    type: DASHQL_COMPLETION_APPLIED_TEMPLATE,
                    value: {
                        buffer: effect.value.buffer,
                        candidateId: effect.value.candidateId,
                        catalogObjectId: effect.value.catalogObjectId,
                        templateId: effect.value.templateId,
                    }
                };
            }
        }

        // Completion state stayed the same?
        // Then we chekc if the selected completion index changed.
        if (state.scriptCompletion && state.scriptCompletion == prevState.scriptCompletion) {
            // Then check if the selection index changed
            const completion = selectedCompletion(transaction.state) as (DashQLCompletionCandidate | null);
            const completionIndex = selectedCompletionIndex(transaction.state);
            if (state.scriptCompletion.value.buffer === completion?.completion && state.scriptCompletion.value.candidateId != completionIndex) {
                state = copyLazily(state, prevState);
                state.scriptCompletion = {
                    type: DASHQL_COMPLETION_STARTED,
                    value: {
                        buffer: completion.completion,
                        candidateId: completionIndex,
                        catalogObjectId: null,
                        templateId: null,
                    }
                };
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
