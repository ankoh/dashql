import * as React from 'react';

import { EditorView } from '@codemirror/view';

import { DashQLCompletionAbortEffect, DashQLProcessorPlugin } from './dashql_processor.js';

/// The writable DashQL editor of a DOM element, null for read-only editors and other elements
function dashqlEditorOf(target: EventTarget | null): EditorView | null {
    if (!(target instanceof Element)) return null;
    const dom = target.closest('.cm-editor');
    if (!(dom instanceof HTMLElement)) return null;
    const view = EditorView.findFromDOM(dom);
    if (view == null || view.state.readOnly || view.state.field(DashQLProcessorPlugin, false) == null) return null;
    return view;
}

/// The last writable DashQL editor of the document that had the focus, a script editor or the prompt of the composer.
/// The editor keeps its selection when it loses the focus, a mention can be inserted at its cursor afterwards.
export function useLastFocusedEditor(): () => EditorView | null {
    const last = React.useRef<EditorView | null>(null);
    React.useEffect(() => {
        const onFocusIn = (event: FocusEvent) => {
            const view = dashqlEditorOf(event.target);
            if (view != null) last.current = view;
        };
        document.addEventListener('focusin', onFocusIn);
        return () => document.removeEventListener('focusin', onFocusIn);
    }, []);
    return React.useCallback(() => {
        const view = last.current;
        // A destroyed view leaves the document
        if (view == null || !view.dom.isConnected) {
            last.current = null;
            return null;
        }
        return view;
    }, []);
}

/// Insert a mention at the cursor of an editor, separated by spaces from the text around it, and focus the editor
export function insertMentionAtCursor(view: EditorView, mention: string): void {
    const text = view.state.doc;
    const cursor = view.state.selection.main;
    const charBefore = cursor.from > 0 ? text.sliceString(cursor.from - 1, cursor.from) : '';
    const charAfter = cursor.to < text.length ? text.sliceString(cursor.to, cursor.to + 1) : '';
    const before = charBefore !== '' && !/\s|\(/.test(charBefore) ? ' ' : '';
    const after = charAfter !== '' && /\s|\)|;|,/.test(charAfter) ? '' : ' ';
    const insert = `${before}${mention}${after}`;
    view.dispatch({
        changes: { from: cursor.from, to: cursor.to, insert },
        selection: { anchor: cursor.from + insert.length },
        effects: DashQLCompletionAbortEffect.of(null),
        userEvent: 'input',
        scrollIntoView: true,
    });
    view.focus();
}
