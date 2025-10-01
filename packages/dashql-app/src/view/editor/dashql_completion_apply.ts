import * as dashql from '@ankoh/dashql-core';

import { EditorView } from '@codemirror/view';
import { StateEffect } from '@codemirror/state';

import { DashQLCompletionSelectCandidateEffect } from './dashql_processor.js';
import { readColumnIdentifierSnippet } from '../../view/snippet/script_template_snippet.js';
import { Completion } from './autocomplete/index.js';

/// A DashQL completion storing the backing completion buffer and a candidate
export interface DashQLCompletionCandidate extends Completion {
    /// The completion buffer from core
    completion: dashql.FlatBufferPtr<dashql.buffers.completion.Completion>;
    /// The current candidate id
    candidateId: number;
}

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
    const c = completion as DashQLCompletionCandidate;
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

    // Effect to apply a completion
    const effect: StateEffect<any> = DashQLCompletionSelectCandidateEffect.of({
        buffer: c.completion,
        candidateId: c.candidateId,
        catalogObjectId: null,
        templateId: null,
    });

    view.dispatch({
        changes: [changeSpec],
        selection: { anchor: newCursor },
        effects: [effect],
    });
}

function applyExtendedCompletion(view: EditorView, completion: Completion) {
    const c = completion as DashQLCompletionCandidate;
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
