import * as dashql from '../../../../core/index.js';

import { StateField, StateEffect, StateEffectType, Text, Transaction } from '@codemirror/state';

import { SemanticUserFocus } from '../focus.js';
import { CompletionPatch, computePatches, UpdatePatchStartingFrom } from './dashql_completion_patches.js';

export const DASHQL_COMPLETION_LIMIT = 10;

/// A script key
export type DashQLScriptKey = number;
/// A collection of FlatBuffers for a script
export interface DashQLScriptBuffers {
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
}

/// A pending, staged script rewrite (e.g. an agent suggestion) shown as an in-place diff.
///
/// The editor already holds the *new* (target) text; `priorText` is the verbatim text that was in
/// the script before the rewrite, restored on reject. `diffBuffer` is the statement-level semantic
/// diff (source = prior, target = new) used to highlight the changed statements and sub-ranges.
/// Whole-suggestion accept/reject: accept keeps the new text, reject restores `priorText`, and any
/// genuine user edit auto-accepts.
export interface DashQLPendingDiff {
    /// The verbatim text before the rewrite (restored on reject)
    priorText: string;
    /// The semantic diff from the prior text (source) to the new text (target)
    diffBuffer: dashql.FlatBufferPtr<dashql.buffers.diff.ScriptDiff>;
}

/// A completion state
export interface DashQLCompletionState {
    /// The status
    status: DashQLCompletionStatus;
    /// Show as a passive inline hint only, without the dropdown list or candidate navigation.
    passiveHint: boolean;
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
    /// Override cursor position after applying qualification/function-call patches.
    catalogObjectCursorOffset: number | null;
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
    /// The pending staged rewrite shown as an in-place diff (if any)
    scriptPendingDiff: DashQLPendingDiff | null;
};
/// A state that is propagated from the outside into processor
export type DashQLProcessorUpdateIn = DashQLProcessorUpdateOut & {
    /// The derive focus info
    derivedFocus: SemanticUserFocus | null;

    /// Resolve a notebook script by its catalog entry id for code actions.
    lookupScript?: (scriptKey: DashQLScriptKey) => dashql.DashQLScript | null;
    /// Navigate to a notebook script definition.
    onNavigateToScript?: (scriptKey: DashQLScriptKey) => void;

    /// This callback is called when the editor updates the script, the cursor, completions.
    /// The callee is responsible for keeping FlatBufferPtrs alive and clean them up once they get overwritten.
    onUpdate: (out: DashQLProcessorUpdateOut) => void;
}
/// The state of a DashQL processor
export type DashQLProcessorState = DashQLProcessorUpdateIn;

/// Analyze a new script
export function analyzeScript(script: dashql.DashQLScript, reportError: (error: unknown) => void = console.error): DashQLScriptBuffers {
    try {
        script.analyze();

        const parsed = script.getParsed();
        const analyzed = script.getAnalyzed();
        return { parsed, analyzed, destroy: destroyBuffers };

    } catch (e: unknown) {
        reportError(e);
    }
    return { parsed: null, analyzed: null, destroy: destroyBuffers };
}

/// Destory the buffers
const destroyBuffers = (state: DashQLScriptBuffers) => {
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

/// Effect to select the next candidate
export const DashQLCompletionNextCandidateEffect: StateEffectType<null> = StateEffect.define<null>();
/// Effect to select the previous candidate
export const DashQLCompletionPreviousCandidateEffect: StateEffectType<null> = StateEffect.define<null>();
/// Effect to select the next candidate variant
export const DashQLCompletionNextCandidateVariantEffect: StateEffectType<null> = StateEffect.define<null>();
/// Effect to select the previous candidate variant
export const DashQLCompletionPreviousCandidateVariantEffect: StateEffectType<null> = StateEffect.define<null>();

/// Effect to accept a pending diff (keep the new text, clear the overlay)
export const DashQLDiffAcceptEffect: StateEffectType<null> = StateEffect.define<null>();
/// Effect to reject a pending diff (restore the prior text, clear the overlay)
export const DashQLDiffRejectEffect: StateEffectType<null> = StateEffect.define<null>();

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
            scriptKey: 0,
            script: null,
            scriptBuffers: {
                parsed: null,
                analyzed: null,
                destroy: destroyBuffers,
            },
            scriptCursor: null,
            scriptCompletion: null,
            scriptPendingDiff: null,

            derivedFocus: null as SemanticUserFocus | null,
            lookupScript: undefined,
            onNavigateToScript: undefined,

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
                const keepLocalCompletion = state.script === effect.value.script
                    && state.scriptBuffers === effect.value.scriptBuffers;
                state = {
                    ...state,
                    ...effect.value,
                    // Completion is editor-owned interaction state. An asynchronous notebook
                    // round-trip must not resurrect a completion that was locally dismissed.
                    scriptCompletion: keepLocalCompletion
                        ? state.scriptCompletion
                        : effect.value.scriptCompletion,
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
                    && prevState.scriptPendingDiff == effect.value.scriptPendingDiff
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

        } else if (selectionChanged || state.scriptCursor == null) {
            state = copyLazily(state, prevState);
            state.scriptCursor = state.script!.moveCursor(selection ?? 0);
        }

        // Check additional completion effects
        state = updateCompletion(state, prevState, transaction);

        // Check pending-diff effects (accept / reject) and auto-accept on genuine user edits
        state = updateDiff(state, prevState, transaction, externalUpdate);

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
        const completionBuffer = buffer.read();
        state.scriptCompletion = {
            status: DashQLCompletionStatus.AVAILABLE,
            passiveHint: isPassiveHint(completionBuffer),
            buffer: buffer,
            candidateId: 0,
            candidatePatch: [],
            catalogObjectId: 0,
            catalogObjectPatch: [],
            catalogObjectCursorOffset: null,
        };
        state.scriptCompletion = computePatches(state.scriptCompletion, text, cursor, UpdatePatchStartingFrom.Candidate);
    }
    return state;
};

function isPassiveHint(buffer: dashql.buffers.completion.Completion): boolean {
    const count = buffer.candidatesLength();
    if (count === 0) return false;
    const first = buffer.candidates(0)!;
    const targetLoc = first.targetLocation();
    return targetLoc != null && targetLoc.length() === 0;
}

// Helper to determine if a user event triggers completions.
// For events, refer to https://codemirror.net/docs/ref/
function typingAtTokenStart(transaction: Transaction, prevCursor: dashql.FlatBufferPtr<dashql.buffers.cursor.ScriptCursor> | null) {
    const prevCursorReader = prevCursor?.read();
    return transaction.isUserEvent("input.type")
        && transaction.startState.selection.main.empty
        && prevCursorReader?.scannerRelativePosition() === dashql.buffers.cursor.RelativeSymbolPosition.BEGIN_OF_SYMBOL
        && prevCursorReader.scannerSymbolCompletable();
}

function backwardDeleteInsideCompletableToken(prevCursor: dashql.FlatBufferPtr<dashql.buffers.cursor.ScriptCursor> | null) {
    const cursor = prevCursor?.read();
    switch (cursor?.scannerRelativePosition()) {
        case dashql.buffers.cursor.RelativeSymbolPosition.MID_OF_SYMBOL:
        case dashql.buffers.cursor.RelativeSymbolPosition.END_OF_SYMBOL:
            return cursor.scannerSymbolCompletable();
        default:
            return false;
    }
}

function userEventCanStartCompletion(transaction: Transaction, prevCursor: dashql.FlatBufferPtr<dashql.buffers.cursor.ScriptCursor> | null) {
    switch (transaction.annotation(Transaction.userEvent)) {
        case "delete.selection":
            // Deleting a selection before the cursor can leave the same token under the caret.
            return transaction.changes.mapPos(prevCursor?.read().textOffset() ?? 0) !== transaction.newSelection.main.head
                || backwardDeleteInsideCompletableToken(prevCursor);
        case "delete.forward":
            return true;
        case "delete.backward":
            return backwardDeleteInsideCompletableToken(prevCursor);
        case "input.paste":
        case "delete.cut":
        case "input.drop":
            return false;
    }
    return transaction.isUserEvent("input.type") && !typingAtTokenStart(transaction, prevCursor);
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
            const buffer = state.script!.tryCompleteAtCursor(DASHQL_COMPLETION_LIMIT);
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

        } else if (effect.is(DashQLCompletionNextCandidateEffect) && state.scriptCompletion) {
            state = copyLazily(state, prevState);
            state.scriptCompletion = { ...state.scriptCompletion! };
            const c = state.scriptCompletion?.buffer.read();
            const candidateCount = c?.candidatesLength() ?? 0;
            if (candidateCount > 1 && state.scriptCompletion?.candidateId !== undefined) {
                state.scriptCompletion.candidateId += 1;
                state.scriptCompletion.catalogObjectId = 0;
                if (state.scriptCompletion.candidateId == candidateCount) {
                    state.scriptCompletion.candidateId = 0;
                }
                state.scriptCompletion = computePatches(state.scriptCompletion, transaction.newDoc, transaction.newSelection.main.anchor, UpdatePatchStartingFrom.Candidate)
            }
            break;

        } else if (effect.is(DashQLCompletionPreviousCandidateEffect) && state.scriptCompletion) {
            state = copyLazily(state, prevState);
            state.scriptCompletion = { ...state.scriptCompletion! };
            const c = state.scriptCompletion?.buffer.read();
            const candidateCount = c?.candidatesLength() ?? 0;
            if (candidateCount > 1 && state.scriptCompletion?.candidateId !== undefined) {
                state.scriptCompletion.candidateId -= 1;
                state.scriptCompletion.catalogObjectId = 0;
                if (state.scriptCompletion.candidateId < 0) {
                    state.scriptCompletion.candidateId = candidateCount - 1;
                }
                state.scriptCompletion = computePatches(state.scriptCompletion, transaction.newDoc, transaction.newSelection.main.anchor, UpdatePatchStartingFrom.Candidate)
            }
            break;

        } else if (effect.is(DashQLCompletionNextCandidateVariantEffect) && state.scriptCompletion) {
            state = copyLazily(state, prevState);
            state.scriptCompletion = { ...state.scriptCompletion! };
            const completion = state.scriptCompletion?.buffer.read();
            const candidate = completion.candidates(state.scriptCompletion.candidateId);
            const objectCount = candidate?.catalogObjectsLength() ?? 0;
            if (objectCount > 1 && state.scriptCompletion.catalogObjectId !== undefined) {
                state.scriptCompletion.catalogObjectId += 1;
                if (state.scriptCompletion.catalogObjectId == objectCount) {
                    state.scriptCompletion.catalogObjectId = 0;
                }
                state.scriptCompletion = computePatches(state.scriptCompletion, transaction.newDoc, transaction.newSelection.main.anchor, UpdatePatchStartingFrom.CatalogObject)
            }
            break;

        } else if (effect.is(DashQLCompletionPreviousCandidateVariantEffect) && state.scriptCompletion) {
            state = copyLazily(state, prevState);
            state.scriptCompletion = { ...state.scriptCompletion! };
            const completion = state.scriptCompletion?.buffer.read();
            const candidate = completion.candidates(state.scriptCompletion.candidateId);
            const objectCount = candidate?.catalogObjectsLength() ?? 0;
            if (objectCount > 1 && state.scriptCompletion.catalogObjectId !== undefined) {
                state.scriptCompletion.catalogObjectId -= 1;
                if (state.scriptCompletion.catalogObjectId < 0) {
                    state.scriptCompletion.catalogObjectId = objectCount - 1;
                }
                state.scriptCompletion = computePatches(state.scriptCompletion, transaction.newDoc, transaction.newSelection.main.anchor, UpdatePatchStartingFrom.CatalogObject)
            }
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
            state = copyLazily(state, prevState);
            state.scriptCompletion = {
                ...state.scriptCompletion!,
                status: DashQLCompletionStatus.SELECTED_CANDIDATE,
                candidatePatch: [],
                catalogObjectPatch: [],
                catalogObjectCursorOffset: null,
            };
            state.scriptCompletion = computePatches(state.scriptCompletion, transaction.newDoc, transaction.newSelection.main.anchor, UpdatePatchStartingFrom.CatalogObject);

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

            state = copyLazily(state, prevState);
            state.scriptCompletion = {
                ...state.scriptCompletion!,
                status: DashQLCompletionStatus.SELECTED_CATALOG_OBJECT,
                candidatePatch: [],
                catalogObjectPatch: [],
                catalogObjectCursorOffset: null,
            };

        }
    }

    if (transaction.docChanged && state.scriptCompletion == prevState.scriptCompletion) {
        if (typingAtTokenStart(transaction, prevState.scriptCursor)) {
            state = copyLazily(state, prevState);
            state.scriptCompletion = null;
            return state;
        }
        if (transaction.isUserEvent("delete.backward") && !backwardDeleteInsideCompletableToken(prevState.scriptCursor)) {
            state = copyLazily(state, prevState);
            state.scriptCompletion = null;
            return state;
        }

        // We don't have an ongoing completion and there is a new user-input?
        // Get a completion going.
        const noActiveCompletion = !state.scriptCompletion || state.scriptCompletion.status != DashQLCompletionStatus.AVAILABLE;
        if (noActiveCompletion && userEventCanStartCompletion(transaction, prevState.scriptCursor)) {
            const buffer = state.script!.tryCompleteAtCursor(DASHQL_COMPLETION_LIMIT);
            state = tryStartCompletion(state, prevState, buffer, transaction.newDoc, cursorOffset);
        }

        // Doc changed, there is a completion, and the completion did not change?
        // Update the completion if it's ongoing, clear it if it is completed.
        else if (state.scriptCompletion != null) {
            switch (state.scriptCompletion.status) {
                case DashQLCompletionStatus.AVAILABLE:
                    // If a delete left the cursor between tokens, the word the hint was
                    // anchored on is gone. Clear the completion instead of regenerating it.
                    const newRelPos = state.scriptCursor!.read().scannerRelativePosition();
                    const isDelete = transaction.annotation(Transaction.userEvent)?.startsWith("delete.") ?? false;
                    const cursorBetweenTokens =
                        newRelPos === dashql.buffers.cursor.RelativeSymbolPosition.AFTER_SYMBOL ||
                        newRelPos === dashql.buffers.cursor.RelativeSymbolPosition.BEFORE_SYMBOL;
                    if (isDelete && cursorBetweenTokens) {
                        state = copyLazily(state, prevState);
                        state.scriptCompletion = null;
                        break;
                    }
                    const buffer = state.script!.tryCompleteAtCursor(DASHQL_COMPLETION_LIMIT);
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

// Helper to update the pending diff based on a transaction.
//
// Handles the explicit accept/reject effects and auto-accepts as soon as the user genuinely edits
// the document. The transaction that *starts* a diff carries new script buffers via
// `DashQLUpdateEffect` and returns early (the `scriptBuffers` guard in `update`) before this runs,
// so here we only ever see later user edits or accept/reject effects.
function updateDiff(state: DashQLProcessorState, prevState: DashQLProcessorState, transaction: Transaction, externalUpdate: boolean): DashQLProcessorState {
    // Handle the explicit accept / reject effects.
    for (const effect of transaction.effects) {
        if (effect.is(DashQLDiffAcceptEffect) || effect.is(DashQLDiffRejectEffect)) {
            // Clearing the pending diff drops the overlay. Accept keeps the current (new) text;
            // reject relies on the dispatcher having restored the prior text via `changes` in the
            // same transaction (already mirrored to the rope by the docChanged branch in `update`).
            // The FlatBufferPtr is owned by the notebook's ScriptData and freed there once the
            // cleared state round-trips back through UPDATE_FROM_PROCESSOR.
            if (state.scriptPendingDiff != null) {
                state = copyLazily(state, prevState);
                state.scriptPendingDiff = null;
            }
            return state;
        }
    }

    // No pending diff? Nothing to auto-accept.
    if (state.scriptPendingDiff == null) {
        return state;
    }

    // Auto-accept as soon as the user genuinely edits the document. User-originated doc changes
    // always carry a userEvent annotation; the agent's external text replacement does not (and is
    // additionally guarded by `externalUpdate`), so staging a rewrite never self-accepts.
    if (transaction.docChanged && !externalUpdate && transaction.annotation(Transaction.userEvent) != null) {
        state = copyLazily(state, prevState);
        state.scriptPendingDiff = null;
    }
    return state;
}
