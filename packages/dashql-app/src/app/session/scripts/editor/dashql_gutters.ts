import * as dashql from '@ankoh/dashql-core';

import { foldedRanges } from '@codemirror/language';
import { gutter, GutterMarker } from '@codemirror/view';
import { Transaction, StateField, RangeSet, RangeSetBuilder } from '@codemirror/state';

import { DashQLProcessorPlugin, DashQLScriptKey } from './dashql_processor.js';
import { findVegaLiteSpecs, isFolded, toggleVegaLiteSpecAtLine, VegaLiteFoldMarker } from './dashql_vis_folding.js';

import icons from '@ankoh/dashql-svg-symbols';

import './dashql_gutters.css';

class ErrorMarker extends GutterMarker {
    eq(other: GutterMarker): boolean {
        return other instanceof ErrorMarker;
    }
    toDOM() {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('class', 'dashql-gutter-error');
        svg.setAttribute('width', '14px');
        svg.setAttribute('height', '14px');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `${icons}#close_circle`);
        svg.appendChild(use);
        return svg;
    }
}

const ERROR_MARKER = new ErrorMarker();

interface State {
    scriptKey: DashQLScriptKey | null;
    /// The diagnostics the error lines were derived from, an update that omits an unchanged analysis keeps them
    diagnostics: dashql.buffers.editor.EditorDiagnosticT[] | null;
    /// The Vega-Lite specs and folds the fold markers were derived from
    vegaliteSpecs: dashql.buffers.editor.EditorTextSpanT[] | null;
    folds: ReturnType<typeof foldedRanges> | null;
    /// The error and fold markers share one gutter to keep it narrow
    markers: RangeSet<GutterMarker>;
}

const GutterState: StateField<State> = StateField.define<State>({
    // Create the initial state
    create: () => ({
        scriptKey: null,
        diagnostics: null,
        vegaliteSpecs: null,
        folds: null,
        markers: RangeSet.empty,
    }),
    update: (state: State, transaction: Transaction) => {
        // Program and folds untouched?
        const processor = transaction.state.field(DashQLProcessorPlugin);
        const diagnostics = processor.editorUpdate?.diagnostics ?? null;
        const vegaliteSpecs = processor.editorUpdate?.vegaliteSpecs ?? null;
        const folds = foldedRanges(transaction.state);
        if (
            processor.scriptKey === state.scriptKey &&
            diagnostics === state.diagnostics &&
            vegaliteSpecs === state.vegaliteSpecs &&
            folds === state.folds
        ) {
            return state;
        }

        // The analysis may lag behind the text
        const doc = transaction.state.doc;
        const lineAt = (offset: number) => doc.lineAt(Math.min(offset, doc.length)).from;
        const errorLines: Set<number> = new Set();
        for (const diagnostic of diagnostics ?? []) {
            if (diagnostic.severity !== dashql.buffers.editor.EditorDiagnosticSeverity.ERROR) continue;
            const loc = diagnostic.textSpan;
            if (loc == null) continue;
            errorLines.add(lineAt(Number(loc.offset)));
        }
        const foldLines: Map<number, boolean> = new Map();
        for (const spec of findVegaLiteSpecs(processor.editorUpdate)) {
            foldLines.set(lineAt(spec.from), !isFolded(transaction.state, spec));
        }
        const builder = new RangeSetBuilder<GutterMarker>();
        for (const line of [...new Set([...errorLines, ...foldLines.keys()])].sort((l, r) => l - r)) {
            const open = foldLines.get(line);
            const error = errorLines.has(line);
            builder.add(line, line, open == null ? ERROR_MARKER : new VegaLiteFoldMarker(open, error));
        }
        return {
            scriptKey: processor.scriptKey,
            diagnostics,
            vegaliteSpecs,
            folds,
            markers: builder.finish(),
        };
    },
});

const GutterExtension = gutter({
    class: 'dashql-gutter-markers',
    markers: view => view.state.field(GutterState).markers,
    initialSpacer() {
        return ERROR_MARKER;
    },
    domEventHandlers: {
        click: (view, line) => toggleVegaLiteSpecAtLine(view, line.from, line.to),
    },
});

export const DashQLGutterPlugin = [GutterState, GutterExtension];
