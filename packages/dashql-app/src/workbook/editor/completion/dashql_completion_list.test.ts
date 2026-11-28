import * as dashql from '@akohn/dashql';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { completionAtEnd, ORDERS_COMPLETION_TEXT, ordersCompletion } from '../../../tests/mocks/editor_completion.js';
import { DashQLCompletionListPlugin } from './dashql_completion_list.js';
import { DashQLCompletionHintPlugin } from './dashql_completion_hint.js';
import { DashQLCompletionAbortEffect, DashQLProcessorPlugin, DashQLUpdateEffect } from '../dashql_processor.js';
import * as styles from './completion_list.module.css';

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
    const pane = () => list().querySelector<HTMLElement>(`.${styles.details_container}`)!;
    const paneVisible = () => !pane().classList.contains(styles.hidden);
    const titles = () => [...pane().querySelectorAll(`.${styles.details_title}`)].map(e => e.textContent);
    const rowOf = (name: string) => [...list().querySelectorAll<HTMLElement>(`.${styles.candidate_container}`)]
        .find(row => row.querySelector(`.${styles.candidate_name}`)?.textContent === name)!;
    const badgeOf = (name: string) => rowOf(name).querySelector(`.${styles.candidate_icon}`)?.textContent;
    const paneDetail = () => pane().querySelector(`.${styles.details_detail}`)?.textContent;

    /// An editor that shows the completion at the end of a text
    function editorAt(
        text: string,
        catalog: dashql.DashQLCatalog,
        candidate: string,
        setup: ((workbook: dashql.DashQLScriptSession) => void) | null = null,
    ): EditorView {
        parent = document.createElement('div');
        document.body.appendChild(parent);
        view = new EditorView({
            parent,
            state: EditorState.create({
                doc: text,
                selection: EditorSelection.cursor(text.length),
                extensions: [DashQLProcessorPlugin, DashQLCompletionListPlugin],
            }),
        });
        view.dispatch({ effects: DashQLUpdateEffect.of(completionAtEnd(dql, text, catalog, candidate, setup)) });
        return view;
    }
    /// An editor that completes a table of the catalog, the pane shows its columns
    function tableEditor(): EditorView {
        const catalog = dql.createCatalog();
        const schema = dql.createScript(catalog);
        schema.insertTextAt(0, 'create table db0.public.orders(id int);');
        schema.analyze();
        catalog.loadScript(schema, 0);
        return editorAt(ORDERS_COMPLETION_TEXT, catalog, 'orders');
    }
    const waitForSelected = () => vi.waitFor(() => expect(list().querySelector(`.${styles.selected}`)).not.toBeNull());

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

    it('accepts a candidate that is clicked or tapped', async () => {
        const editor = completingEditor();
        await waitForSelected();
        const rows = [...list().querySelectorAll<HTMLElement>(`.${styles.candidate_container}`)];
        expect(rows.length).toBeGreaterThan(1);
        const name = rows[1].querySelector(`.${styles.candidate_name}`)!.textContent!;
        rows[1].querySelector(`.${styles.candidate_name}`)!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await vi.waitFor(() => expect(editor.state.doc.toString()).toContain(name));
        expect(editor.state.doc.toString()).not.toBe(ORDERS_COMPLETION_TEXT);
        expect(editor.state.selection.main.head).toBeGreaterThan(ORDERS_COMPLETION_TEXT.length);
    });

    it('steps through the catalog objects of an entry without accepting it', async () => {
        const editor = completingEditor();
        await waitForSelected();
        const arrow = selected().querySelector('[aria-label="Next catalog object"]')!;
        arrow.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        arrow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await vi.waitFor(() => expect(selected().querySelector(`.${styles.info_selected_count}`)?.textContent).toBe('2'));
        expect(editor.state.doc.toString()).toBe(ORDERS_COMPLETION_TEXT);
    });

    it('hides the list when the completion ends', async () => {
        const editor = completingEditor();
        await vi.waitFor(() => expect(list().classList.contains(styles.hidden)).toBe(false));
        editor.dispatch({ effects: DashQLCompletionAbortEffect.of(null) });
        await vi.waitFor(() => expect(list().classList.contains(styles.hidden)).toBe(true));
    });

    it('stays hidden when the completion ends before the list showed', async () => {
        const editor = completingEditor();
        editor.dispatch({ effects: DashQLCompletionAbortEffect.of(null) });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        expect(list().classList.contains(styles.hidden)).toBe(true);
    });

    it('shows the detail of the selected catalog object in the pane', async () => {
        const catalog = dql.createCatalog();
        const schema = dql.createScript(catalog);
        schema.insertTextAt(0, `
            create table db0.public.orders(id int);
            create table db1.public.orders(id int, total int);
        `);
        schema.analyze();
        catalog.loadScript(schema, 0);
        editorAt(ORDERS_COMPLETION_TEXT, catalog, 'orders');
        await waitForSelected();
        expect(paneVisible()).toBe(true);
        expect(paneDetail()).toBe('1 column');

        selected().querySelector('[aria-label="Next catalog object"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        await vi.waitFor(() => expect(paneDetail()).toBe('2 columns'));
        // The columns of the table, as they are written
        expect(titles()).toEqual(['Columns']);
        const cell = (name: string) => [...pane().querySelectorAll(`.${name}`)].map(e => e.textContent);
        expect(cell(styles.details_field_name)).toEqual(['id', 'total']);
        expect(cell(styles.details_field_detail)).toEqual(['integer', 'integer']);
    });

    it('hides the pane if nothing is known about a candidate', async () => {
        editorAt('sel', dql.createCatalog(), 'select');
        await waitForSelected();
        expect(paneVisible()).toBe(false);
    });

    it('keeps the focus in the editor when the pane is clicked', async () => {
        tableEditor();
        await waitForSelected();
        const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        pane().dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it('stays in the window', async () => {
        tableEditor();
        await waitForSelected();
        await vi.waitFor(() => expect(paneVisible()).toBe(true));
        expect(list().getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
        expect(list().getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
    });

    it('shows the badge of a CTE, a table without catalog objects', async () => {
        editorAt('with foo as (select 1 as total) select * from fo', dql.createCatalog(), 'foo');
        await waitForSelected();
        expect(badgeOf('foo')).toBe('TBL');
    });

    it('shows the badge of an output column, a column without catalog objects', async () => {
        editorAt('select 1 as total order by tot', dql.createCatalog(), 'total');
        await waitForSelected();
        expect(badgeOf('total')).toBe('COL');
    });

    it('keeps the badge of a selected table parameter', async () => {
        const registry = dql.createTableParameters();
        editorAt('select * from :sal', dql.createCatalog(), 'sales', session => {
            const sales = { name: 'sales', file: 'sales.parquet', stamp: '1', columns: ['region'] };
            registry.publish([{ name: 'editor', session }], [sales]);
        });
        await waitForSelected();
        expect(selected().querySelector(`.${styles.candidate_icon}`)?.textContent).toBe(':');
        expect(paneDetail()).toBe('1 column');
    });

    it('keeps its place when the hints insert text before the target', async () => {
        parent = document.createElement('div');
        document.body.appendChild(parent);
        view = new EditorView({
            parent,
            state: EditorState.create({
                doc: ORDERS_COMPLETION_TEXT,
                selection: EditorSelection.cursor(ORDERS_COMPLETION_TEXT.length),
                extensions: [DashQLProcessorPlugin, DashQLCompletionHintPlugin, DashQLCompletionListPlugin],
            }),
        });
        // The hint qualifies the table of another database, `db0.public.` goes in front of `ord`
        view.dispatch({ effects: DashQLUpdateEffect.of(ordersCompletion(dql)) });
        await waitForSelected();
        const editor = view;
        const targetOffset = ORDERS_COMPLETION_TEXT.length - 'ord'.length;
        await vi.waitFor(() => expect(editor.contentDOM.textContent).toContain('db0.public.'));
        const left = parseFloat(list().style.left);

        // Without the hints, the list starts at the target
        editor.dispatch({ effects: DashQLCompletionAbortEffect.of(null) });
        await vi.waitFor(() => expect(editor.contentDOM.textContent).not.toContain('db0.public.'));
        // Within a pixel: the list adds up the widths of characters, which WebKit measures in other fractions of a pixel
        expect(Math.abs(left - editor.coordsForChar(targetOffset)!.left)).toBeLessThan(1);
    });

    it('names a syntax error before the cursor above the candidates', async () => {
        const catalog = dql.createCatalog();
        const schema = dql.createScript(catalog);
        schema.insertTextAt(0, 'create table foo (a int, bar int);');
        schema.analyze();
        catalog.loadScript(schema, 0);
        editorAt('select a,\n  , a from foo where ba', catalog, 'bar');
        await waitForSelected();
        const banner = list().querySelector<HTMLElement>(`.${styles.syntax_error}`)!;
        expect(banner.classList.contains(styles.hidden)).toBe(false);
        expect(banner.querySelector(`.${styles.syntax_error_message}`)?.textContent).toBe('Line 2: syntax error, unexpected ","');
        expect(banner.querySelector(`.${styles.syntax_error_hint}`)?.textContent).toBe('remove the "," before ","');
    });

    it('shows no syntax error without one before the cursor', async () => {
        completingEditor();
        await waitForSelected();
        expect(list().querySelector(`.${styles.syntax_error}`)?.classList.contains(styles.hidden)).toBe(true);
    });

    it('removes the list with the editor', () => {
        completingEditor().destroy();
        expect(document.querySelector('[data-dashql-completion-list]')).toBeNull();
    });
});
