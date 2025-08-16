import * as dashql from '@ankoh/dashql-core';

import { autocompletion } from '@codemirror/autocomplete';
import { EditorView } from '@codemirror/view';
import { ChangeSpec } from '@codemirror/state';
import { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { getNameTagName, unpackNameTags } from '../../utils/index.js';
import { DashQLCompletionHint } from './dashql_completion_hint.js';
import { DashQLProcessorState, DashQLProcessor } from './dashql_processor.js';

const COMPLETION_LIMIT = 32;

/// A DashQL completion storing the backing completion buffer and a candidate
export interface DashQLCompletion extends Completion {
    /// The processor
    state: DashQLProcessorState;
    /// The completion buffer from core
    completion: dashql.FlatBufferPtr<dashql.buffers.completion.Completion>;
    /// The current candidate id
    candidateId: number;
}

/// Update the completions
function updateCompletions(
    _current: CompletionResult,
    _from: number,
    _to: number,
    _context: CompletionContext,
): CompletionResult | null {
    return null;
}

/// Preview a completion candidate
function showExternalCompletionInfo(completion: Completion) {
    const candidate = completion as DashQLCompletion;

    // Call the existing preview function.
    // This will make the editor highlight, for example, the catalog entry in the catalog viewer.
    candidate.state.onCompletionPeek(candidate.state.scriptKey, candidate.state.targetScript!, candidate.completion, candidate.candidateId);

    return null;
};

function applyCompletion(view: EditorView, completion: Completion, _from: number, _to: number) {
    const c = completion as DashQLCompletion;
    const coreCompletion = c.completion.read();
    if (coreCompletion.candidatesLength() <= c.candidateId) {
        console.warn("invalid candidate id");
        return;
    }
    // Get the completion candidate
    const candidate = coreCompletion.candidates(c.candidateId)!;
    if (!candidate.replaceTextAt) {
        console.warn("candidate replaceTextAt is null");
        return;
    }

    const changes: ChangeSpec[] = [];
    // XXX The location of the trailing to might include eof?
    //     We shouldn't need to clamp here but should rather fix it on the wasm side
    const replaceTextAt = candidate.replaceTextAt()!;
    const replaceFrom = Math.min(replaceTextAt.offset(), view.state.doc.length);
    const replaceTo = Math.min(replaceFrom + replaceTextAt.length(), view.state.doc.length);
    const completionText = candidate.completionText()!;
    changes.push({
        from: replaceFrom,
        to: replaceTo,
        insert: completionText,
    });
    const newCursor = replaceFrom + completionText.length;
    view.dispatch({
        changes,
        selection: { anchor: newCursor },
        // effects: CLEAR_COMPLETION_HINTS.of(null),
    });
}

/// Derived from this example:
/// https://codemirror.net/examples/autocompletion/
export async function completeDashQL(context: CompletionContext): Promise<CompletionResult> {
    const processor = context.state.field(DashQLProcessor);
    const completions: DashQLCompletion[] = [];

    let offset = context.pos;
    if (processor.targetScript !== null && processor.scriptCursor !== null) {
        const cursor = processor.scriptCursor.read();
        const relativePos = cursor.scannerRelativePosition();
        const performCompletion =
            relativePos == dashql.buffers.cursor.RelativeSymbolPosition.BEGIN_OF_SYMBOL ||
            relativePos == dashql.buffers.cursor.RelativeSymbolPosition.MID_OF_SYMBOL ||
            relativePos == dashql.buffers.cursor.RelativeSymbolPosition.END_OF_SYMBOL;
        if (performCompletion) {
            const completionPtr = processor.targetScript.completeAtCursor(COMPLETION_LIMIT, processor.scriptRegistry);
            const completion = completionPtr.read();
            for (let i = 0; i < completion.candidatesLength(); ++i) {
                const candidate = completion.candidates(i)!;
                let tagName: string | undefined = undefined;
                for (const tag of unpackNameTags(candidate.nameTags())) {
                    tagName = getNameTagName(tag);
                    break;
                }
                let candidateDetail = tagName;
                if (processor.config.showCompletionDetails) {
                    candidateDetail = `${candidateDetail}, score=${candidate.score}`;
                }
                completions.push({
                    state: processor,
                    completion: completionPtr,
                    candidateId: i,
                    label: candidate.completionText()!,
                    detail: candidateDetail,
                    info: showExternalCompletionInfo,
                    apply: applyCompletion,
                });
            }
            offset = cursor.scannerSymbolOffset();

            // Note that this callback is responsible for storing the completionPtr.
            // We are not cleaning up completion pointers!
            processor.onCompletionStart(processor.scriptKey, processor.targetScript!, completionPtr);
        }
    }

    return {
        from: offset,
        options: completions,
        filter: false,
        update: updateCompletions,
    };
}

// 
// // Keymap for completion hints
// export const COMPLETION_HINT_KEYMAP = [
//     {
//         key: 'Tab',
//         run: (view: EditorView): boolean => {
//             const state = view.state.field(COMPLETION_HINT_STATE);
//             if (state.hints) {
//                 const textChange: ChangeSpec = {
//                     from: state.hints.candidate.hint.at,
//                     insert: state.hints.candidate.hint.text
//                 };
//                 view.dispatch({
//                     changes: textChange,
//                     selection: { anchor: state.hints.candidate.hint.at + state.hints.candidate.hint.text.length },
//                     effects: CLEAR_COMPLETION_HINTS.of(null),
//                 });
//                 return true;
//             }
//             return false;
//         }
//     },
//     {
//         key: 'Escape',
//         run: (view: EditorView): boolean => {
//             const state = view.state.field(COMPLETION_HINT_STATE);
//             if (state.hints) {
//                 view.dispatch({
//                     effects: CLEAR_COMPLETION_HINTS.of(null)
//                 });
//                 return true;
//             }
//             return false;
//         }
//     }
// ];


export const DashQLCompletion = [
    autocompletion({
        override: [completeDashQL],
    }),
    DashQLCompletionHint
];
