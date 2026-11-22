import * as dashql from '@akohn/dashql';

import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DashQLProcessorPlugin, DashQLUpdateEffect, type DashQLParameterClick } from './dashql_processor.js';
import { DashQLParameterClickPlugin } from './dashql_parameter_clicks.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL | null = null;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => {
    dql!.resetUnsafe();
});

const TEXT = 'select * from :orders where amount > :min';

/// An editor of an analyzed script whose session takes the events of the editor, with a spy for the clicks
function mountEditor(onParameterClick: (click: DashQLParameterClick, view: EditorView) => void) {
    const catalog = dql!.createCatalog();
    const scriptSession = dql!.createScriptSession(catalog);
    scriptSession.replaceText(0n, TEXT);
    const editorUpdate = scriptSession.analyze();
    expect(editorUpdate.analysisAvailable).toBe(true);
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
        parent,
        state: EditorState.create({ doc: TEXT, selection: EditorSelection.cursor(0), extensions: [DashQLProcessorPlugin, DashQLParameterClickPlugin] }),
    });
    view.dispatch({
        effects: DashQLUpdateEffect.of({
            scriptKey: scriptSession.getCatalogEntryId(),
            scriptSession,
            editorUpdate,
            scriptBuffers: null,
            scriptCompletion: null,
            scriptPendingDiff: null,
            textVersion: scriptSession.getTextVersion(),
            onParameterClick,
            onUpdate: () => {},
        }),
    });
    return { view, dispose: () => { view.destroy(); parent.remove(); } };
}

/// A click like the one of the user: the press places the cursor, the release follows at the same point
function click(view: EditorView, offset: number, at: { x: number; y: number }, modifiers: MouseEventInit = {}) {
    const init = { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: at.x, clientY: at.y, ...modifiers };
    view.contentDOM.dispatchEvent(new MouseEvent('mousedown', init));
    view.dispatch({ selection: EditorSelection.cursor(offset), userEvent: 'select.pointer' });
    view.contentDOM.dispatchEvent(new MouseEvent('mouseup', init));
}

/// The middle of a span of the document on the screen
function middleOf(view: EditorView, from: number, to: number) {
    const start = view.coordsAtPos(from, 1)!;
    const end = view.coordsAtPos(to, -1)!;
    return { x: (start.left + end.right) / 2, y: (start.top + start.bottom) / 2 };
}

describe('Clicks on parameters', () => {
    it('reports a click on a scalar and on a table parameter with its span', () => {
        const onClick = vi.fn<(click: DashQLParameterClick, view: EditorView) => void>();
        const { view, dispose } = mountEditor(onClick);
        try {
            const min = TEXT.indexOf(':min');
            click(view, min + 2, middleOf(view, min, min + 4));
            expect(onClick).toHaveBeenCalledExactlyOnceWith({ name: 'min', table: false, from: min, to: min + 4 }, view);

            onClick.mockClear();
            const orders = TEXT.indexOf(':orders');
            click(view, orders + 3, middleOf(view, orders, orders + 7));
            expect(onClick).toHaveBeenCalledExactlyOnceWith({ name: 'orders', table: true, from: orders, to: orders + 7 }, view);
        } finally {
            dispose();
        }
    });

    it('ignores a click beside a parameter, on other tokens, with a modifier, a double click and a drag', () => {
        const onClick = vi.fn<(click: DashQLParameterClick, view: EditorView) => void>();
        const { view, dispose } = mountEditor(onClick);
        try {
            // Right of the parameter at the end of the line the cursor lands at its end, the click hits no parameter
            const end = view.coordsAtPos(TEXT.length, -1)!;
            click(view, TEXT.length, { x: end.right + 40, y: (end.top + end.bottom) / 2 });
            // Another token
            const amount = TEXT.indexOf('amount');
            click(view, amount + 2, middleOf(view, amount, amount + 6));
            // A click with Shift extends the selection, a double click selects a word
            const min = TEXT.indexOf(':min');
            const at = middleOf(view, min, min + 4);
            click(view, min + 2, at, { shiftKey: true });
            click(view, min + 2, at, { detail: 2 });
            // A press that the pointer drags away from selects text
            view.contentDOM.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: at.x, clientY: at.y }));
            view.dispatch({ selection: EditorSelection.cursor(min + 2) });
            view.contentDOM.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0, detail: 1, clientX: at.x + 30, clientY: at.y }));
            expect(onClick).not.toHaveBeenCalled();
        } finally {
            dispose();
        }
    });
});
