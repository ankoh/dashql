import { EditorView, keymap } from '@codemirror/view';
import { EditorSelection, Prec, Transaction } from '@codemirror/state';

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const QUOTES = new Set(['"', "'", '`']);
const CLOSERS = new Set([')', ']', '}']);
const BEFORE_CLOSE = /^[\s)\]};,]|$/;

export function handleInput(view: EditorView, from: number, to: number, insert: string): boolean {
    if (insert.length !== 1) return false;

    // Overtype: user types a closer and the char at cursor matches
    if (CLOSERS.has(insert) || QUOTES.has(insert)) {
        const doc = view.state.doc;
        const atCursor = from < doc.length ? doc.sliceString(from, from + 1) : '';
        if (atCursor === insert && from === to) {
            view.dispatch({
                selection: EditorSelection.cursor(from + 1),
                annotations: Transaction.userEvent.of('input.type'),
            });
            return true;
        }
        if (CLOSERS.has(insert)) return false;
    }

    // Auto-close quotes
    if (QUOTES.has(insert)) {
        const doc = view.state.doc;
        const before = from > 0 ? doc.sliceString(from - 1, from) : '';
        const after = from < doc.length ? doc.sliceString(to, to + 1) : '';
        // Don't auto-close if preceded by a word char (e.g. contractions like it's)
        if (/\w/.test(before)) return false;
        if (!BEFORE_CLOSE.test(after)) return false;

        view.dispatch({
            changes: { from, to, insert: insert + insert },
            selection: EditorSelection.cursor(from + 1),
            annotations: Transaction.userEvent.of('input.type'),
        });
        return true;
    }

    // Auto-close brackets
    const closer = PAIRS[insert];
    if (!closer) return false;

    const doc = view.state.doc;
    const after = from < doc.length ? doc.sliceString(to, to + 1) : '';
    if (!BEFORE_CLOSE.test(after)) return false;

    view.dispatch({
        changes: { from, to, insert: insert + closer },
        selection: EditorSelection.cursor(from + 1),
        annotations: Transaction.userEvent.of('input.type'),
    });
    return true;
}

export function onBackspace(view: EditorView): boolean {
    const state = view.state;
    const sel = state.selection.main;
    if (!sel.empty || sel.from === 0) return false;

    const doc = state.doc;
    const before = doc.sliceString(sel.from - 1, sel.from);
    const after = sel.from < doc.length ? doc.sliceString(sel.from, sel.from + 1) : '';

    if (PAIRS[before] === after || (QUOTES.has(before) && before === after)) {
        view.dispatch({
            changes: { from: sel.from - 1, to: sel.from + 1 },
            selection: EditorSelection.cursor(sel.from - 1),
            annotations: Transaction.userEvent.of('delete.backward'),
        });
        return true;
    }
    return false;
}

export const DashQLAutoclosePlugin = [
    EditorView.inputHandler.of(handleInput),
    Prec.high(keymap.of([{ key: 'Backspace', run: onBackspace }])),
];
