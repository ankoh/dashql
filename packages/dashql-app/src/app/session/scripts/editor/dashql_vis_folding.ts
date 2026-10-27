import * as dashql from '@ankoh/dashql-core';

import { codeFolding, foldEffect, foldedRanges, foldKeymap, foldService } from '@codemirror/language';
import { EditorState, Extension, Text, Transaction } from '@codemirror/state';
import { keymap } from '@codemirror/view';

import { DashQLProcessorPlugin, DashQLUpdateEffect } from './dashql_processor.js';

/// The start of a Vega-Lite spec after the kind of its tag, up to its opening brace
const VEGALITE_SPEC = /^vegalite\s*\{/;

/// The range between the braces of a Vega-Lite spec
export interface VegaLiteSpecRange {
    from: number;
    to: number;
}

/// The position of the brace that closes the JSON object opened before `start`, skipping strings
function findClosingBrace(text: string, start: number): number | null {
    let depth = 1;
    let inString = false;
    for (let i = start; i < text.length; ++i) {
        const c = text[i];
        if (inString) {
            if (c === '\\') ++i;
            else if (c === '"') inString = false;
        } else if (c === '"') {
            inString = true;
        } else if (c === '{') {
            ++depth;
        } else if (c === '}' && --depth === 0) {
            return i;
        }
    }
    return null;
}

// The specs of an update are found once per document
const specCache = new WeakMap<dashql.buffers.editor.EditorUpdateT, { doc: Text; specs: VegaLiteSpecRange[] }>();

/// The ranges between the braces of the non-empty `@vis vegalite` specs in the comments of a document, found through
/// the syntax spans of the update
export function findVegaLiteSpecs(doc: Text, update: dashql.buffers.editor.EditorUpdateT | null | undefined): VegaLiteSpecRange[] {
    if (update == null) return [];
    const cached = specCache.get(update);
    if (cached?.doc === doc) return cached.specs;
    const specs: VegaLiteSpecRange[] = [];
    const spans = update.syntaxSpans;
    const spanText = (i: number) => {
        const span = spans[i].textSpan!;
        return doc.sliceString(Number(span.offset), Number(span.offset + span.length));
    };
    let afterTag = false;
    for (let i = 0; i < spans.length; ++i) {
        const syntax = spans[i];
        if (syntax.textSpan == null || syntax.tokenType === dashql.buffers.parser.ScannerTokenType.COMMENT) continue;
        // The core splits a `@vis` comment into keywords for the tag and the kind, the JSON tokens and the
        // comment text between them
        const keyword = syntax.tokenType === dashql.buffers.parser.ScannerTokenType.KEYWORD ? spanText(i) : null;
        const isKind = afterTag && keyword === 'vegalite';
        afterTag = keyword === '@vis';
        if (!isKind) continue;
        // The comment ends where its spans stop being contiguous
        const from = Number(syntax.textSpan.offset);
        let to = from + Number(syntax.textSpan.length);
        for (let j = i + 1; j < spans.length && Number(spans[j].textSpan?.offset ?? -1) === to; ++j) {
            to += Number(spans[j].textSpan!.length);
        }
        const comment = doc.sliceString(from, Math.min(to, doc.length));
        const match = VEGALITE_SPEC.exec(comment);
        if (match == null) continue;
        const open = match[0].length;
        const close = findClosingBrace(comment, open);
        if (close != null && close > open) specs.push({ from: from + open, to: from + close });
    }
    specCache.set(update, { doc, specs });
    return specs;
}

function isFolded(state: EditorState, spec: VegaLiteSpecRange): boolean {
    let folded = false;
    foldedRanges(state).between(spec.from, spec.to, (from, to) => {
        if (from === spec.from && to === spec.to) folded = true;
    });
    return folded;
}

/// Folds the Vega-Lite specs that a script brings into the editor, e.g. when it is opened or when the agent writes
/// a chart. Specs that the user types or unfolded stay open.
const autoFoldVegaLiteSpecs = EditorState.transactionExtender.of(tr => {
    if (tr.annotation(Transaction.userEvent) != null) return null;
    let update: dashql.buffers.editor.EditorUpdateT | null = null;
    let scriptSession: dashql.DashQLScriptSession | null | undefined = null;
    for (const effect of tr.effects) {
        if (effect.is(DashQLUpdateEffect)) {
            update = effect.value.editorUpdate ?? null;
            scriptSession = effect.value.scriptSession;
        }
    }
    if (update == null) return null;
    const prev = tr.startState.field(DashQLProcessorPlugin, false);
    const initial = prev?.editorUpdate == null || prev.scriptSession !== scriptSession;
    if (!initial && !tr.docChanged) return null;

    // A spec that is open before and kept by the new text stays open
    const open = new Set<string>();
    if (!initial) {
        for (const spec of findVegaLiteSpecs(tr.startState.doc, prev.editorUpdate)) {
            if (!isFolded(tr.startState, spec)) open.add(tr.startState.doc.sliceString(spec.from, spec.to));
        }
    }
    const head = tr.newSelection.main.head;
    const effects = findVegaLiteSpecs(tr.newDoc, update)
        .filter(spec => (head <= spec.from || head > spec.to) && !open.has(tr.newDoc.sliceString(spec.from, spec.to)))
        .map(spec => foldEffect.of(spec));
    return effects.length > 0 ? { effects } : null;
});

/// Lets the Vega-Lite specs be folded from the line of their opening brace
const vegaLiteSpecFolds = foldService.of((state, lineStart, lineEnd) => {
    const processor = state.field(DashQLProcessorPlugin, false);
    return findVegaLiteSpecs(state.doc, processor?.editorUpdate).find(spec => spec.from >= lineStart && spec.from <= lineEnd) ?? null;
});

export const DashQLVisFoldingPlugin: Extension = [
    codeFolding(),
    vegaLiteSpecFolds,
    autoFoldVegaLiteSpecs,
    keymap.of(foldKeymap),
];
