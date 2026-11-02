import * as dashql from '@ankoh/dashql-core';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ORDERS_COMPLETION_TEXT, ordersCompletion } from '../../tests/mocks/editor_completion.js';
import { DashQLCompletionListPlugin } from './dashql_completion_list.js';
import { DashQLCompletionAbortEffect, DashQLProcessorPlugin, DashQLUpdateEffect } from './dashql_processor.js';
import * as styles from './dashql_completion_list.module.css';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

describe('DashQLCompletionListPlugin', () => {
    let view: EditorView | null = null;
    let parent: HTMLElement | null = null;
    afterEach(() => {
        view?.destroy();
        parent?.remove();
        view = null;
        dql.resetUnsafe();
    });

    /// An editor that shows the completion of the orders tables
    function completingEditor(): EditorView {
        parent = document.createElement('div');
        document.body.appendChild(parent);
        view = new EditorView({
            parent,
            state: EditorState.create({
                doc: ORDERS_COMPLETION_TEXT,
                selection: EditorSelection.cursor(ORDERS_COMPLETION_TEXT.length),
                extensions: [DashQLProcessorPlugin, DashQLCompletionListPlugin],
            }),
        });
        view.dispatch({ effects: DashQLUpdateEffect.of(ordersCompletion(dql)) });
        return view;
    }
    const list = () => document.querySelector<HTMLElement>('[data-dashql-completion-list]')!;
    const selected = () => list().querySelector<HTMLElement>(`.${styles.selected}`)!;

    it('lists the candidates and the catalog object of the selected candidate', async () => {
        completingEditor();
        await vi.waitFor(() => expect(list().querySelector(`.${styles.selected}`)).not.toBeNull());
        expect(list().classList.contains(styles.hidden)).toBe(false);
        expect(selected().textContent).toContain('orders');
        expect(selected().querySelector(`.${styles.info_selected_count}`)?.textContent).toBe('1');
        expect(list().style.top).not.toBe('');
    });

    it('switches the catalog object with the arrows', async () => {
        completingEditor();
        await vi.waitFor(() => expect(list().querySelector(`.${styles.selected}`)).not.toBeNull());
        const count = () => selected().querySelector(`.${styles.info_selected_count}`)?.textContent;
        selected().querySelector('[aria-label="Next catalog object"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await vi.waitFor(() => expect(count()).toBe('2'));
        selected().querySelector('[aria-label="Previous catalog object"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await vi.waitFor(() => expect(count()).toBe('1'));
    });

    it('hides the list when the completion ends', async () => {
        const editor = completingEditor();
        await vi.waitFor(() => expect(list().classList.contains(styles.hidden)).toBe(false));
        editor.dispatch({ effects: DashQLCompletionAbortEffect.of(null) });
        await vi.waitFor(() => expect(list().classList.contains(styles.hidden)).toBe(true));
    });

    it('removes the list with the editor', () => {
        completingEditor().destroy();
        expect(document.querySelector('[data-dashql-completion-list]')).toBeNull();
    });
});
