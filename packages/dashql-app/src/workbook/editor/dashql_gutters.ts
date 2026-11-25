import * as dashql from '@akohn/dashql';

import { foldedRanges } from '@codemirror/language';
import { gutter, GutterMarker } from '@codemirror/view';
import { Transaction, StateField, RangeSet, RangeSetBuilder } from '@codemirror/state';

import { editorDiagnostics } from './dashql_script_references.js';
import { DashQLProcessorPlugin } from './dashql_processor.js';
import { DashQLScriptKey } from '@akohn/dashql/platform/workbook/script_editor_state';
import { revealEditorOffset } from './dashql_inline_diagnostics.js';
import { findVegaLiteSpecs, isFolded, toggleVegaLiteSpecAtLine, VegaLiteFoldMarker } from './dashql_vis_folding.js';

import icons from '@akohn/dashql-svg-symbols';

import './dashql_gutters.css';

/// The marker of a line with an error, its title is the message of the first error of the line
class ErrorMarker extends GutterMarker {
    constructor(readonly message: string) {
        super();
    }
    eq(other: GutterMarker): boolean {
        return other instanceof ErrorMarker && other.message === this.message;
    }
    toDOM() {
        const marker = document.createElement('span');
        marker.className = 'dashql-gutter-error';
        marker.dataset.testid = 'gutter-error';
        marker.title = this.message;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('width', '14px');
        svg.setAttribute('height', '14px');
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', `${icons}#x_circle_16`);
        svg.appendChild(use);
        marker.appendChild(svg);
        return marker;
    }
}

const ERROR_MARKER = new ErrorMarker('');

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
        const diagnostics = editorDiagnostics(transaction.state);
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
        // The message of the first error of a line, by the start of the line
        const errorLines: Map<number, string> = new Map();
        for (const diagnostic of diagnostics ?? []) {
            if (diagnostic.severity !== dashql.buffers.editor.EditorDiagnosticSeverity.ERROR) continue;
            const loc = diagnostic.textSpan;
            if (loc == null) continue;
            const line = lineAt(Number(loc.offset));
            if (!errorLines.has(line)) errorLines.set(line, typeof diagnostic.message === 'string' ? diagnostic.message : '');
        }
        const foldLines: Map<number, boolean> = new Map();
        for (const spec of findVegaLiteSpecs(processor.editorUpdate)) {
            foldLines.set(lineAt(spec.from), !isFolded(transaction.state, spec));
        }
        const builder = new RangeSetBuilder<GutterMarker>();
        for (const line of [...new Set([...errorLines.keys(), ...foldLines.keys()])].sort((l, r) => l - r)) {
            const open = foldLines.get(line);
            const error = errorLines.get(line);
            builder.add(line, line, open == null ? new ErrorMarker(error ?? '') : new VegaLiteFoldMarker(open, error != null));
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
        // A click folds a Vega-Lite spec, or places the cursor at the error of the line
        click: (view, line) => {
            if (toggleVegaLiteSpecAtLine(view, line.from, line.to)) return true;
            const error = (editorDiagnostics(view.state) ?? []).find(diagnostic => {
                const loc = diagnostic.textSpan;
                if (loc == null || diagnostic.severity !== dashql.buffers.editor.EditorDiagnosticSeverity.ERROR) return false;
                const offset = Math.min(Number(loc.offset), view.state.doc.length);
                return offset >= line.from && offset <= line.to;
            });
            if (error?.textSpan == null) return false;
            revealEditorOffset(view, Number(error.textSpan.offset));
            return true;
        },
    },
});

export const DashQLGutterPlugin = [GutterState, GutterExtension];
