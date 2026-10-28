import * as dashql from '@ankoh/dashql-core';

import { codeFolding, foldEffect, foldedRanges, foldGutter, foldKeymap, foldService } from '@codemirror/language';
import { EditorState, Extension, Transaction } from '@codemirror/state';
import { keymap } from '@codemirror/view';

import { DashQLProcessorPlugin, DashQLUpdateEffect } from './dashql_processor.js';

import './dashql_vis_folding.css';

/// The range between the braces of a Vega-Lite spec
export interface VegaLiteSpecRange {
    from: number;
    to: number;
}

/// The ranges between the braces of the non-empty `@vis vegalite` specs of an update
export function findVegaLiteSpecs(update: dashql.buffers.editor.EditorUpdateT | null | undefined): VegaLiteSpecRange[] {
    const specs: VegaLiteSpecRange[] = [];
    for (const span of update?.vegaliteSpecs ?? []) {
        // The core sends the JSON objects with their braces
        const from = Number(span.offset) + 1;
        const to = Number(span.offset + span.length) - 1;
        if (to > from) specs.push({ from, to });
    }
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
        for (const spec of findVegaLiteSpecs(prev.editorUpdate)) {
            if (!isFolded(tr.startState, spec)) open.add(tr.startState.doc.sliceString(spec.from, spec.to));
        }
    }
    const head = tr.newSelection.main.head;
    const effects = findVegaLiteSpecs(update)
        .filter(spec => (head <= spec.from || head > spec.to) && !open.has(tr.newDoc.sliceString(spec.from, spec.to)))
        .map(spec => foldEffect.of(spec));
    return effects.length > 0 ? { effects } : null;
});

/// Lets the Vega-Lite specs be folded from the line of their opening brace
const vegaLiteSpecFolds = foldService.of((state, lineStart, lineEnd) => {
    const processor = state.field(DashQLProcessorPlugin, false);
    return findVegaLiteSpecs(processor?.editorUpdate).find(spec => spec.from >= lineStart && spec.from <= lineEnd) ?? null;
});

/// Folds and unfolds a spec from the gutter next to the line of its opening brace
const vegaLiteSpecGutter = foldGutter({
    markerDOM: open => {
        const marker = document.createElement('span');
        marker.className = 'dashql-vis-fold-marker';
        marker.dataset.testid = 'vis-fold-marker';
        marker.setAttribute('aria-expanded', String(open));
        marker.title = open ? 'Fold the Vega-Lite spec' : 'Unfold the Vega-Lite spec';
        marker.textContent = open ? '▾' : '▸';
        return marker;
    },
});

export const DashQLVisFoldingPlugin: Extension = [
    codeFolding(),
    vegaLiteSpecGutter,
    vegaLiteSpecFolds,
    autoFoldVegaLiteSpecs,
    keymap.of(foldKeymap),
];
