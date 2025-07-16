import * as dashql from '@ankoh/dashql-core';

import { EditorView } from '@codemirror/view';
import { ChangeSpec } from '@codemirror/state';
import { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { getNameTagName, unpackNameTags } from '../../utils/index.js';
import { DashQLProcessorState, DashQLProcessor } from './dashql_processor.js';
import { showCompletionHint, clearCompletionHintInView } from './dashql_completion_hint.js';

const COMPLETION_LIMIT = 32;

/// A DashQL completion storing the backing completion buffer and a candidate
interface DashQLCompletion extends Completion {
    /// The processor
    state: DashQLProcessorState;
    /// The completion buffer
    coreCompletion: dashql.buffers.completion.CompletionT;
    /// The candidate id
    candidateId: number;
    /// The editor view for showing hints
    view?: EditorView;
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

/// Preview a completion candidate and show inline hint
const previewCompletion = (completion: Completion) => {
    const candidate = completion as DashQLCompletion;

    // Call the existing preview function.
    // This will make the editor highlight, for example, the catalog entry in the catalog viewer.
    candidate.state.onCompletionPeek(candidate.state.scriptKey, candidate.state.targetScript!, candidate.coreCompletion, candidate.candidateId);

    // Show inline completion hint.
    const candidateData = candidate.coreCompletion.candidates[candidate.candidateId];
    if (candidateData.completionText && candidateData.replaceTextAt && candidate.view) {
        const currentPos = candidate.view.state.selection.main.head;
        const replaceFrom = candidateData.replaceTextAt.offset;
        const replaceTo = replaceFrom + candidateData.replaceTextAt.length;

        // Only show hint if cursor is at the replacement position
        if (currentPos >= replaceFrom && currentPos <= replaceTo) {
            // Calculate the hint text (part that would be inserted after current cursor)
            const currentText = candidate.view.state.doc.sliceString(replaceFrom, currentPos);
            const fullText = candidateData.completionText as string;

            if (fullText.startsWith(currentText)) {
                const hintText = fullText.slice(currentText.length);
                if (hintText.length > 0) {
                    showCompletionHint(candidate.view, currentPos, hintText, candidateData);
                }
            }
        }
    }

    return null;
};

const applyCompletion = (view: EditorView, completion: Completion, _from: number, _to: number) => {
    const c = completion as DashQLCompletion;
    const candidate = c.coreCompletion.candidates[c.candidateId];
    if (!candidate.replaceTextAt) {
        console.warn("candidate replaceTextAt is null");
        return;
    }

    // Clear any existing completion hint
    clearCompletionHintInView(view);

    const changes: ChangeSpec[] = [];
    // XXX The location of the trailing to might include eof?
    //     We shouldn't need to clamp here but should rather fix it on the wasm side
    const replaceFrom = Math.min(candidate.replaceTextAt.offset, view.state.doc.length);
    const replaceTo = Math.min(replaceFrom + candidate.replaceTextAt.length, view.state.doc.length);
    changes.push({
        from: replaceFrom,
        to: replaceTo,
        insert: candidate.completionText as string,
    });
    const newCursor = replaceFrom + (candidate.completionText as string).length;
    view.dispatch({ changes, selection: { anchor: newCursor } });
}

/// Derived from this example:
/// https://codemirror.net/examples/autocompletion/
export async function completeDashQL(context: CompletionContext): Promise<CompletionResult> {
    const processor = context.state.field(DashQLProcessor);
    const completions: DashQLCompletion[] = [];

    let offset = context.pos;
    if (processor.targetScript !== null && processor.scriptCursor !== null) {
        const relativePos = processor.scriptCursor.scannerRelativePosition;
        const performCompletion =
            relativePos == dashql.buffers.cursor.RelativeSymbolPosition.BEGIN_OF_SYMBOL ||
            relativePos == dashql.buffers.cursor.RelativeSymbolPosition.MID_OF_SYMBOL ||
            relativePos == dashql.buffers.cursor.RelativeSymbolPosition.END_OF_SYMBOL;
        if (performCompletion) {
            const completionBuffer = processor.targetScript.completeAtCursor(COMPLETION_LIMIT);
            const completion = completionBuffer.read().unpack();
            completionBuffer.destroy();
            for (let i = 0; i < completion.candidates.length; ++i) {
                const candidate = completion.candidates[i];
                let tagName: string | undefined = undefined;
                for (const tag of unpackNameTags(candidate.nameTags)) {
                    tagName = getNameTagName(tag);
                    break;
                }
                let candidateDetail = tagName;
                if (processor.config.showCompletionDetails) {
                    candidateDetail = `${candidateDetail}, score=${candidate.score}`;
                }
                completions.push({
                    state: processor,
                    coreCompletion: completion,
                    candidateId: i,
                    view: context.view,
                    label: candidate.completionText as string,
                    detail: candidateDetail,
                    info: previewCompletion,
                    apply: applyCompletion,
                });
            }
            offset = processor.scriptCursor.scannerSymbolOffset;
            if (!processor.completionActive) {
                processor.onCompletionStart(processor.scriptKey, processor.targetScript!, completion);
            }
        }
    }

    return {
        from: offset,
        options: completions,
        filter: false,
        update: updateCompletions,
    };
}
