import * as dashql from '@ankoh/dashql-core';

import { StateField, StateEffect, StateEffectType, Text, Transaction } from '@codemirror/state';

import { UserFocus } from '../../workbook/focus.js';
import { VariantKind } from '../../utils/variant.js';

export const DASHQL_COMPLETION_LIMIT = 10;
export const DASHQL_COMPLETION_AVAILABLE = Symbol("DASHQL_COMPLETION_AVAILABLE");
export const DASHQL_COMPLETION_APPLIED_CANDIDATE = Symbol("DASHQL_COMPLETION_APPLIED_CANDIDATE");
export const DASHQL_COMPLETION_APPLIED_QUALIFIED_CANDIDATE = Symbol("DASHQL_COMPLETION_APPLIED_QUALIFIED_CANDIDATE");
export const DASHQL_COMPLETION_APPLIED_TEMPLATE = Symbol("DASHQL_COMPLETION_APPLIED_TEMPLATE");

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

/// Args to apply a candidate
export interface DashQLCompletionAvailableState {
    buffer: dashql.FlatBufferPtr<dashql.buffers.completion.Completion>;
    candidateId: number | null;
    catalogObjectId: number | null;
    templateId: number | null;
}
/// Args to apply a candidate
export interface DashQLCompletionSelectCandidateState extends DashQLCompletionAvailableState {
    candidateId: number;
    catalogObjectId: number | null;
    templateId: number | null;
};
/// Args to apply a qualified candidate
export interface DashQLCompletionSelectQualifiedCandidateState extends DashQLCompletionSelectCandidateState {
    catalogObjectId: number;
    templateId: number | null;
};
/// Args to apply a template
export interface DashQLCompletionSelectTemplateState extends DashQLCompletionSelectQualifiedCandidateState {
    templateId: number;
};

export type DashQLCompletionState =
    | VariantKind<typeof DASHQL_COMPLETION_AVAILABLE, DashQLCompletionAvailableState>
    | VariantKind<typeof DASHQL_COMPLETION_APPLIED_CANDIDATE, DashQLCompletionSelectCandidateState>
    | VariantKind<typeof DASHQL_COMPLETION_APPLIED_QUALIFIED_CANDIDATE, DashQLCompletionSelectQualifiedCandidateState>
    | VariantKind<typeof DASHQL_COMPLETION_APPLIED_TEMPLATE, DashQLCompletionSelectTemplateState>
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

/// Effect to update the state attached to a CodeMirror editor
export const DashQLUpdateEffect: StateEffectType<DashQLProcessorUpdateIn> = StateEffect.define<DashQLProcessorUpdateIn>();

/// Effect to start a completion
export const DashQLCompletionStartEffect: StateEffectType<null> = StateEffect.define<null>();
/// Effect to stop a completion without applying
export const DashQLCompletionAbortEffect: StateEffectType<null> = StateEffect.define<null>();
/// Effect to preview a different candidate
export const DashQLCompletionPreviewCandidateEffect: StateEffectType<number> = StateEffect.define<number>();
/// Effect to apply a completion candidate
export const DashQLCompletionSelectCandidateEffect: StateEffectType<DashQLCompletionSelectCandidateState> = StateEffect.define<DashQLCompletionSelectCandidateState>();
/// Effect to apply a candidate qualification
export const DashQLCompletionSelectQualificationEffect: StateEffectType<DashQLCompletionSelectQualifiedCandidateState> = StateEffect.define<DashQLCompletionSelectQualifiedCandidateState>();
/// Effect to apply a candidate template
export const DashQLCompletionSelectTemplateEffect: StateEffectType<DashQLCompletionSelectTemplateState> = StateEffect.define<DashQLCompletionSelectTemplateState>();

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
function tryStartCompletion(state: DashQLProcessorState, prevState: DashQLProcessorState, buffer: dashql.FlatBufferPtr<dashql.buffers.completion.Completion> | null) {
    if (!buffer) {
        return state;
    }
    if (buffer.read().candidatesLength() == 0) {
        state = copyLazily(state, prevState);
        state.scriptCompletion = null;
    } else {
        state = copyLazily(state, prevState);
        state.scriptCompletion = {
            type: DASHQL_COMPLETION_AVAILABLE,
            value: {
                buffer: buffer,
                candidateId: 0,
                catalogObjectId: null,
                templateId: null,
            }
        };
    }
    return state;
};

// Helper to update a completion based on a transaction
function updateCompletion(state: DashQLProcessorState, prevState: DashQLProcessorState, transaction: Transaction): DashQLProcessorState {
    // We need a script and script cursor to complete.
    if (!state.script || !state.scriptCursor) {
        return state;
    }

    // Check additional completion effects
    for (const effect of transaction.effects) {
        if (effect.is(DashQLCompletionStartEffect)) {
            // Effect to explictly start a completion
            const buffer = state.script!.tryCompleteAtCursor(DASHQL_COMPLETION_LIMIT, state.scriptRegistry);
            state = tryStartCompletion(state, prevState, buffer);

        } else if (effect.is(DashQLCompletionAbortEffect)) {
            // Effect to explictly stop a completion
            if (state.scriptCompletion) {
                state = copyLazily(state, prevState);
                state.scriptCompletion = null;
            }

        } else if (effect.is(DashQLCompletionPreviewCandidateEffect)) {
            // Effect to switch the previews completion candidate
            if (state.scriptCompletion?.type == DASHQL_COMPLETION_AVAILABLE && !transaction.docChanged) {
                const buffer = state.scriptCompletion!.value.buffer;
                state = tryStartCompletion(state, prevState, buffer);
            } else if (state.scriptCompletion) {
                state = copyLazily(state, prevState);
                state.scriptCompletion = null;
            }

        } else if (effect.is(DashQLCompletionSelectCandidateEffect)) {
            // Effect to select a completion candidate
            const buffer = state.script!.trySelectCompletionCandidateAtCursor(
                effect.value.buffer,
                effect.value.candidateId
            );
            if (buffer) {
                state = copyLazily(state, prevState);
                state.scriptCompletion = {
                    type: DASHQL_COMPLETION_APPLIED_CANDIDATE,
                    value: {
                        buffer: buffer,
                        candidateId: 0,
                        catalogObjectId: prevState.scriptCompletion?.value.catalogObjectId ?? null,
                        templateId: prevState.scriptCompletion?.value.templateId ?? null,
                    }
                };
            } else {
                state = copyLazily(state, prevState);
                state.scriptCompletion = null;
            }

        } else if (effect.is(DashQLCompletionSelectQualificationEffect)) {
            // Effect to select a qualified completion candidate
            const buffer = state.script!.trySelectQualifiedCompletionCandidateAtCursor(
                effect.value.buffer,
                effect.value.candidateId,
                effect.value.catalogObjectId,
            );
            if (buffer) {
                state = copyLazily(state, prevState);
                state.scriptCompletion = {
                    type: DASHQL_COMPLETION_APPLIED_QUALIFIED_CANDIDATE,
                    value: {
                        buffer: buffer,
                        candidateId: 0,
                        catalogObjectId: 0,
                        templateId: prevState.scriptCompletion?.value.templateId ?? null,
                    }
                };
            } else {
                state = copyLazily(state, prevState);
                state.scriptCompletion = null;
            }

        } else if (effect.is(DashQLCompletionSelectTemplateEffect)) {
            // Effect to select a candidate template
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

    if (transaction.docChanged && state.scriptCompletion == prevState.scriptCompletion) {
        // We don't have an ongoing completion and there is a new user-input?
        // Get a completion going.
        //
        // For events, refer to https://codemirror.net/docs/ref/
        if ((!state.scriptCompletion || state.scriptCompletion.type != DASHQL_COMPLETION_AVAILABLE) && transaction.isUserEvent("input.type")) {
            const buffer = state.script!.tryCompleteAtCursor(DASHQL_COMPLETION_LIMIT, state.scriptRegistry);
            state = tryStartCompletion(state, prevState, buffer);
        }

        // Doc changed, there is a completion, and the completion did not change?
        // Update the completion if it's ongoing, clear it if it is completed.
        else if (state.scriptCompletion != null) {
            switch (state.scriptCompletion.type) {
                case DASHQL_COMPLETION_AVAILABLE:
                    const buffer = state.script!.tryCompleteAtCursor(DASHQL_COMPLETION_LIMIT, state.scriptRegistry);
                    state = tryStartCompletion(state, prevState, buffer);
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
