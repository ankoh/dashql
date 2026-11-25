import * as dashql from '@akohn/dashql';

import { EditorSelection, RangeSetBuilder, type EditorState } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from '@codemirror/view';

import icons from '@akohn/dashql-svg-symbols';

import { editorDiagnostics } from './dashql_script_references.js';

import './dashql_inline_diagnostics.css';

// The diagnostics of a script at the lines where they occur: a line with an error is tinted and every line with a
// diagnostic shows its message at its end. The underline of the span comes from the decorations, the marker from the
// gutter. The line that is being edited shows neither, a statement that is being typed is incomplete most of the time.

/// The diagnostic that a line shows at its end
export interface LineDiagnostic {
    /// The start of the line
    lineFrom: number;
    /// The end of the line
    lineTo: number;
    severity: 'error' | 'warning';
    message: string;
    /// Where the diagnostic starts, a click on the message places the cursor there
    from: number;
    /// The other diagnostics that start on the line
    more: number;
}

/// The diagnostics of the lines of a document, by the line they start on: the first error of a line, else its first
/// warning. The analysis may lag behind the text, its offsets are clamped to the document.
export function lineDiagnostics(state: EditorState, diagnostics: readonly dashql.buffers.editor.EditorDiagnosticT[] | null): LineDiagnostic[] {
    const doc = state.doc;
    const lines = new Map<number, LineDiagnostic>();
    for (const diagnostic of diagnostics ?? []) {
        const span = diagnostic.textSpan;
        if (span == null) continue;
        const from = Math.max(0, Math.min(Number(span.offset), doc.length));
        const line = doc.lineAt(from);
        const severity = diagnostic.severity === dashql.buffers.editor.EditorDiagnosticSeverity.WARNING ? 'warning' : 'error';
        const message = typeof diagnostic.message === 'string' ? diagnostic.message : '';
        const shown = lines.get(line.from);
        if (shown == null) {
            lines.set(line.from, { lineFrom: line.from, lineTo: line.to, severity, message, from, more: 0 });
        } else if (shown.severity === 'warning' && severity === 'error') {
            lines.set(line.from, { ...shown, severity, message, from, more: shown.more + 1 });
        } else {
            shown.more += 1;
        }
    }
    return [...lines.values()].sort((l, r) => l.lineFrom - r.lineFrom);
}

/// Place the cursor at an offset of the editor, scroll it into view and focus the editor. The cursor tooltip then shows
/// the diagnostic at the offset.
export function revealEditorOffset(view: EditorView, offset: number): void {
    const pos = Math.max(0, Math.min(offset, view.state.doc.length));
    view.dispatch({
        selection: EditorSelection.cursor(pos),
        effects: EditorView.scrollIntoView(pos, { y: 'center' }),
        userEvent: 'select',
    });
    view.focus();
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/// The message of a diagnostic at the end of its line
class DiagnosticMessageWidget extends WidgetType {
    constructor(readonly diagnostic: LineDiagnostic) {
        super();
    }
    eq(other: WidgetType): boolean {
        if (!(other instanceof DiagnosticMessageWidget)) return false;
        const l = this.diagnostic;
        const r = other.diagnostic;
        return l.severity === r.severity && l.message === r.message && l.from === r.from && l.more === r.more;
    }
    toDOM(view: EditorView): HTMLElement {
        const { severity, message, from, more } = this.diagnostic;
        const dom = document.createElement('span');
        dom.className = `dashql-inline-diagnostic dashql-inline-diagnostic-${severity}`;
        dom.dataset.testid = 'inline-diagnostic';
        dom.dataset.severity = severity;
        dom.title = more > 0 ? `${message} (${more} more on this line)` : message;

        const svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('class', 'dashql-inline-diagnostic-icon');
        svg.setAttribute('width', '12px');
        svg.setAttribute('height', '12px');
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS(SVG_NS, 'use');
        use.setAttributeNS(XLINK_NS, 'xlink:href', `${icons}#${severity === 'error' ? 'x_circle_16' : 'alert_16'}`);
        svg.appendChild(use);
        dom.appendChild(svg);

        const text = document.createElement('span');
        text.className = 'dashql-inline-diagnostic-message';
        text.textContent = message;
        dom.appendChild(text);
        if (more > 0) {
            const count = document.createElement('span');
            count.className = 'dashql-inline-diagnostic-more';
            count.textContent = `+${more}`;
            dom.appendChild(count);
        }
        // The editor ignores the events of the widget, a press places the cursor at the diagnostic
        dom.addEventListener('mousedown', event => {
            if (event.button !== 0) return;
            event.preventDefault();
            revealEditorOffset(view, from);
        });
        return dom;
    }
    ignoreEvent(): boolean {
        return true;
    }
}

const ERROR_LINE = Decoration.line({ class: 'dashql-diagnostic-line-error' });

/// The line decorations and messages of the diagnostics of an editor, without the line that is being edited
export function inlineDiagnosticDecorations(state: EditorState, editedLine: number | null): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    for (const diagnostic of lineDiagnostics(state, editorDiagnostics(state))) {
        if (diagnostic.lineFrom === editedLine) continue;
        if (diagnostic.severity === 'error') builder.add(diagnostic.lineFrom, diagnostic.lineFrom, ERROR_LINE);
        builder.add(diagnostic.lineTo, diagnostic.lineTo, Decoration.widget({ widget: new DiagnosticMessageWidget(diagnostic), side: 1 }));
    }
    return builder.finish();
}

/// The line of the cursor while the editor has the focus
function editedLine(view: EditorView): number | null {
    return view.hasFocus ? view.state.doc.lineAt(view.state.selection.main.head).from : null;
}

class InlineDiagnosticsView {
    decorations: DecorationSet;
    constructor(view: EditorView) {
        this.decorations = inlineDiagnosticDecorations(view.state, editedLine(view));
    }
    update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.focusChanged
            || editorDiagnostics(update.state) !== editorDiagnostics(update.startState)) {
            this.decorations = inlineDiagnosticDecorations(update.state, editedLine(update.view));
        }
    }
}

/// The messages of the diagnostics at the ends of their lines and the tint of the lines with errors
export const DashQLInlineDiagnosticsPlugin = ViewPlugin.fromClass(InlineDiagnosticsView, {
    decorations: plugin => plugin.decorations,
});
