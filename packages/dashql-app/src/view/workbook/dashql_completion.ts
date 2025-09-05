import * as dashql from '@ankoh/dashql-core';

import { autocompletion, selectedCompletion } from '@codemirror/autocomplete';
import { EditorView, keymap } from '@codemirror/view';
import { CompletionContext, CompletionResult, Completion } from '@codemirror/autocomplete';
import { getNameTagName, unpackNameTags } from '../../utils/index.js';
import { DashQLCompletionHintPlugin } from './dashql_completion_hint.js';
import { DashQLProcessorState, DashQLProcessorPlugin } from './dashql_processor.js';
import { readColumnIdentifierSnippet } from '../../view/snippet/script_template_snippet.js';

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

type SingleChangeSpec = {
    from: number;
    to: number;
    insert: string;
}
type CursorOffset = number;

function computeChangeSpecForSimpleCompletion(view: EditorView, candidate: dashql.buffers.completion.CompletionCandidate): [SingleChangeSpec, CursorOffset] | null {
    // XXX The location of the trailing to might include eof?
    //     We shouldn't need to clamp here but should rather fix it on the wasm side
    const targetLocationAt = candidate.targetLocation()!;
    const replaceFrom = Math.min(targetLocationAt.offset(), view.state.doc.length);
    const replaceTo = Math.min(replaceFrom + targetLocationAt.length(), view.state.doc.length);
    const completionText = candidate.completionText()!;
    const newCursor = replaceFrom + completionText.length;
    const changeSpec: SingleChangeSpec = {
        from: replaceFrom,
        to: replaceTo,
        insert: completionText,
    };
    return [changeSpec, newCursor];
}

function computeChangeSpecForExtendedCompletion(view: EditorView, candidate: dashql.buffers.completion.CompletionCandidate, templateId: number, snippetId: number): [SingleChangeSpec[], CursorOffset] | null {
    // Make sure the completion template exists
    if (templateId >= candidate.completionTemplatesLength()) {
        return null;
    }
    const template = candidate.completionTemplates(templateId)!;
    if (template == null) {
        return null;
    }

    // Make sure the completion template snippet exists
    if (snippetId >= template.snippetsLength()) {
        return null;
    }
    const snippet = template.snippets(snippetId);
    if (snippet == null) {
        return null;
    }

    /// Compute the inner completion spec
    const innerCompletion = computeChangeSpecForSimpleCompletion(view, candidate);
    if (innerCompletion == null) {
        return null;
    }
    let [innerCompletionChange, newCursor] = innerCompletion;

    const tmpNode = new dashql.buffers.parser.Node();
    const snippetModel = readColumnIdentifierSnippet(snippet, tmpNode);

    const changes: SingleChangeSpec[] = [];
    if (snippetModel.textBefore.length > 0) {
        changes.push({
            from: innerCompletionChange.from, // XXX From To is not respecting qualified names
            to: innerCompletionChange.from,
            insert: snippetModel.textBefore,
        });
        newCursor += snippetModel.textBefore.length;
    }
    changes.push(innerCompletionChange);
    if (snippetModel.textAfter.length > 0) {
        changes.push({
            from: innerCompletionChange.to,
            to: innerCompletionChange.to,
            insert: snippetModel.textAfter,
        });
        newCursor += snippetModel.textAfter.length;
    }
    return [changes, newCursor];
}

function applyCompletion(view: EditorView, completion: Completion, _from: number, _to: number) {
    const c = completion as DashQLCompletion;
    const coreCompletion = c.completion.read();
    if (c.candidateId >= coreCompletion.candidatesLength()) {
        console.warn("completion candidate id out of bounds");
        return;
    }
    // Get the completion candidate
    const candidate = coreCompletion.candidates(c.candidateId)!;
    if (!candidate.targetLocation) {
        console.warn("candidate targetLocation is null");
        return;
    }

    // Compute the change spec
    const change = computeChangeSpecForSimpleCompletion(view, candidate);
    if (change == null) {
        return;
    }
    const [changeSpec, newCursor] = change!;
    view.dispatch({
        changes: [changeSpec],
        selection: { anchor: newCursor },
    });
}

function applyExtendedCompletion(view: EditorView, completion: Completion) {
    const c = completion as DashQLCompletion;
    const coreCompletion = c.completion.read();
    if (c.candidateId >= coreCompletion.candidatesLength()) {
        console.warn("completion candidate id out of bounds");
        return false;
    }
    // Get the completion candidate
    const candidate = coreCompletion.candidates(c.candidateId)!;
    if (!candidate.targetLocation) {
        console.warn("candidate targetLocation is null");
        return false;
    }

    // Compute the change spec.
    // XXX We always pick [0][0] for now, but it would make sense to let the user "hover" over other templates through the catalog viewer
    const changes = computeChangeSpecForExtendedCompletion(view, candidate, 0, 0);
    if (changes == null) {
        return false;
    }
    const [changeSpec, newCursor] = changes!;
    view.dispatch({
        changes: changeSpec,
        selection: { anchor: newCursor },
    });
    return true;
}

/// Derived from this example:
/// https://codemirror.net/examples/autocompletion/
export async function completeDashQL(context: CompletionContext): Promise<CompletionResult> {
    const processor = context.state.field(DashQLProcessorPlugin);
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

export const COMPLETION_KEYMAP = [
    {
        key: 'Tab',

        // We use tab to complete the extended completion templates.
        // This mimics the new LLM-based IDES where ENTER completes the "immediate" candidate, and tab complets accepts the advanced suggestion
        run: (view: EditorView): boolean => {
            // Is there an active completion?
            const completion = selectedCompletion(view.state);
            if (completion == null) {
                return false;
            }

            applyExtendedCompletion(view, completion);
            return true;
        }
    },
];


export const DashQLCompletionPlugin = [
    autocompletion({
        override: [completeDashQL],
    }),
    DashQLCompletionHintPlugin,
    keymap.of(COMPLETION_KEYMAP)
];
