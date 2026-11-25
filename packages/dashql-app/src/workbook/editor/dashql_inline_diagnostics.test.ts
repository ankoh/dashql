import * as dashql from '@akohn/dashql';

import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView, WidgetType } from '@codemirror/view';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DashQLProcessorPlugin, DashQLUpdateEffect } from './dashql_processor.js';
import { DashQLInlineDiagnosticsPlugin, inlineDiagnosticDecorations, lineDiagnostics } from './dashql_inline_diagnostics.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => {
    dql!.resetUnsafe();
});

// The first statement is fine, the second one doesn't parse
const TEXT = 'select 1;\nselect * from where;\nselect 2;';

const { EditorDiagnosticSeverity, EditorDiagnosticSource, EditorDiagnosticT, EditorTextSpanT } = dashql.buffers.editor;

/// An editor of an analyzed script, the processor holds the update of its session
function mountEditor(extensions = [DashQLProcessorPlugin, DashQLInlineDiagnosticsPlugin]) {
    const catalog = dql!.createCatalog();
    const scriptSession = dql!.createScriptSession(catalog);
    scriptSession.replaceText(0n, TEXT);
    const editorUpdate = scriptSession.analyze();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
        parent,
        state: EditorState.create({ doc: TEXT, selection: EditorSelection.cursor(0), extensions }),
    });
    view.dispatch({
        effects: DashQLUpdateEffect.of({
            scriptKey: scriptSession.getCatalogEntryId(),
            scriptSession,
            editorUpdate,
            scriptCompletion: null,
            scriptPendingDiff: null,
            textVersion: scriptSession.getTextVersion(),
            onUpdate: () => {},
        }),
    });
    return { view, editorUpdate, dispose: () => { view.destroy(); parent.remove(); } };
}

function diagnostic(severity: dashql.buffers.editor.EditorDiagnosticSeverity, message: string, offset: number | null) {
    return new EditorDiagnosticT(EditorDiagnosticSource.ANALYZER, severity, message, offset == null ? null : new EditorTextSpanT(BigInt(offset), 1n));
}

describe('Inline diagnostics', () => {
    it('picks one diagnostic per line, an error before a warning', () => {
        const state = EditorState.create({ doc: 'select 1;\nselect 2;\nselect 3;' });
        const lines = lineDiagnostics(state, [
            diagnostic(EditorDiagnosticSeverity.WARNING, 'warning a', 0),
            diagnostic(EditorDiagnosticSeverity.ERROR, 'error b', 2),
            diagnostic(EditorDiagnosticSeverity.WARNING, 'warning c', 12),
            diagnostic(EditorDiagnosticSeverity.ERROR, 'no place', null),
            // An analysis of a longer text is clamped to the document
            diagnostic(EditorDiagnosticSeverity.ERROR, 'past the end', 100),
        ]);
        expect(lines).toEqual([
            { lineFrom: 0, lineTo: 9, severity: 'error', message: 'error b', from: 2, more: 1 },
            { lineFrom: 10, lineTo: 19, severity: 'warning', message: 'warning c', from: 12, more: 0 },
            { lineFrom: 20, lineTo: 29, severity: 'error', message: 'past the end', from: 29, more: 0 },
        ]);
        expect(lineDiagnostics(state, null)).toEqual([]);
    });

    it('shows the message of an error at the end of its line, a press places the cursor there', () => {
        const { view, editorUpdate, dispose } = mountEditor();
        try {
            const errors = (editorUpdate.diagnostics ?? []).filter(d => d.severity === EditorDiagnosticSeverity.ERROR && d.textSpan != null);
            expect(errors.length).toBeGreaterThan(0);
            const first = errors[0];
            const offset = Number(first.textSpan!.offset);
            const line = view.state.doc.lineAt(offset);
            expect(line.number).toBe(2);

            const messages = view.dom.querySelectorAll<HTMLElement>('[data-testid="inline-diagnostic"]');
            expect(messages.length).toBe(1);
            const message = messages[0];
            expect(message.dataset.severity).toBe('error');
            expect(message.textContent).toContain(first.message);
            // The message is in the line of the error, the line is tinted
            const lineElement = message.closest('.cm-line')!;
            expect(lineElement.classList.contains('dashql-diagnostic-line-error')).toBe(true);
            expect(lineElement.textContent).toContain('select * from where;');

            message.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
            expect(view.state.selection.main.head).toBe(offset);
        } finally {
            dispose();
        }
    });

    it('leaves out the line that is being edited', () => {
        const { view, dispose } = mountEditor([DashQLProcessorPlugin]);
        try {
            const widgets = (editedLine: number | null) => {
                const lines: number[] = [];
                inlineDiagnosticDecorations(view.state, editedLine).between(0, view.state.doc.length, (from, _to, decoration) => {
                    if (decoration.spec.widget instanceof WidgetType) lines.push(view.state.doc.lineAt(from).number);
                });
                return lines;
            };
            expect(widgets(null)).toEqual([2]);
            expect(widgets(view.state.doc.line(1).from)).toEqual([2]);
            expect(widgets(view.state.doc.line(2).from)).toEqual([]);
        } finally {
            dispose();
        }
    });
});
