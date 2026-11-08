import * as dashql from '@ankoh/dashql-core';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { completionAtEnd, ORDERS_COMPLETION_TEXT, ordersCompletion } from '../../tests/mocks/editor_completion.js';
import { DashQLCompletionListPlugin } from './dashql_completion_list.js';
import { DashQLCompletionAbortEffect, DashQLProcessorPlugin, DashQLUpdateEffect } from './dashql_processor.js';
import * as styles from './dashql_completion_list.module.css';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

const LONG_TYPE = 'a_very_long_schema_name_that_a_row_cuts_off';

/// Client functions with what a list shows about them
const SPEC = {
    format: 1,
    namespace: 'svc',
    title: 'The Service',
    schemas: { [LONG_TYPE]: { attributes: [{ name: 'id', type: 'integer' }] } },
    functions: [
        {
            name: 'item_get',
            method: 'GET',
            family: 'Items',
            path: '/items/{id}',
            description: 'Reads `one` **item**, see [the docs](https://example.com/docs). <b>No</b> markup.',
            example: "CALL svc.item_get (id => 'a');",
            result_description: 'One row for `the` item.',
            columns: [{ name: 'size', type: 'BIGINT' }],
            options: [
                { name: 'id', in: 'path', type: 'string', required: true, description: 'The id.' },
                { name: 'owner', schema: LONG_TYPE },
                { name: 'plain', type: 'string' },
            ],
        },
        { name: 'item_list', method: 'GET' },
    ],
};

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
        setup: ((session: dashql.DashQLScriptSession) => void) | null = null,
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
    function clientFunctionEditor(text: string, candidate: string): EditorView {
        const catalog = dql.createCatalog();
        catalog.registerClientFunctions(JSON.stringify(SPEC));
        return editorAt(text, catalog, candidate);
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

    it('hides the list when the completion ends', async () => {
        const editor = completingEditor();
        await vi.waitFor(() => expect(list().classList.contains(styles.hidden)).toBe(false));
        editor.dispatch({ effects: DashQLCompletionAbortEffect.of(null) });
        await vi.waitFor(() => expect(list().classList.contains(styles.hidden)).toBe(true));
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

    it('shows the description of the selected candidate in a pane', async () => {
        clientFunctionEditor('call svc.', 'item_get');
        await waitForSelected();
        expect(paneVisible()).toBe(true);
        // The signature comes first
        expect(pane().firstElementChild?.firstElementChild?.textContent).toBe('(id string, owner?, plain? string)');
        expect(pane().textContent).toContain('Reads one item');
    });

    it('shows the parameters, the result and the facts of a function in the pane', async () => {
        clientFunctionEditor('call svc.', 'item_get');
        await waitForSelected();
        await vi.waitFor(() => expect(paneVisible()).toBe(true));
        expect(titles()).toEqual(['Parameters', 'Result', 'Example', 'Details']);
        const [parameters, result] = [...pane().querySelectorAll<HTMLElement>(`.${styles.details_fields}`)];
        const cells = (table: HTMLElement, cell: string) => [...table.querySelectorAll(`.${cell}`)].map(e => e.textContent);
        expect(cells(parameters, styles.details_field_name)).toEqual(['id', 'owner', 'plain']);
        expect(cells(parameters, styles.details_field_detail)).toEqual(['string · required', '', 'string']);
        expect(cells(parameters, styles.details_field_description)).toEqual(['The id.', '', '']);
        expect(cells(result, styles.details_field_name)).toEqual(['size']);
        expect(cells(result, styles.details_field_detail)).toEqual(['BIGINT']);
        expect(pane().textContent).toContain('One row for the item.');
        expect(pane().querySelector(`.${styles.details_example}`)?.textContent).toBe("CALL svc.item_get (id => 'a');");
        const facts = pane().querySelector<HTMLElement>(`.${styles.details_facts}`)!;
        expect(cells(facts, styles.details_field_name)).toEqual(['Family', 'Endpoint']);
        expect(cells(facts, styles.details_field_detail)).toEqual(['Items', 'GET /items/{id}']);
    });

    it('shows the attributes of the schema of an option in the pane', async () => {
        clientFunctionEditor('call svc.item_get (ow', 'owner');
        await waitForSelected();
        await vi.waitFor(() => expect(paneVisible()).toBe(true));
        expect(titles()).toEqual(['Attributes']);
    });

    it('shows the type of an option in the pane, and only its name in the row', async () => {
        clientFunctionEditor('call svc.item_get (pla', 'plain');
        await waitForSelected();
        expect(paneVisible()).toBe(true);
        expect(paneDetail()).toBe('string');
        expect(selected().textContent).not.toContain('string');
    });

    it('hides the pane if nothing is known about a candidate', async () => {
        editorAt('sel', dql.createCatalog(), 'select');
        await waitForSelected();
        expect(paneVisible()).toBe(false);
    });

    it('renders a description as text with inline Markdown', async () => {
        clientFunctionEditor('call svc.', 'item_get');
        await waitForSelected();
        expect(pane().querySelector('code')?.textContent).toBe('one');
        expect(pane().querySelector('strong')?.textContent).toBe('item');
        expect(pane().querySelector('a')).toBeNull();
        expect(pane().querySelector('b')).toBeNull();
        expect(pane().textContent).toContain('see the docs.');
        expect(pane().textContent).toContain('<b>No</b> markup.');
    });

    it('keeps the focus in the editor when the pane is clicked', async () => {
        clientFunctionEditor('call svc.', 'item_get');
        await waitForSelected();
        const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        pane().dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it('stays in the window', async () => {
        clientFunctionEditor('call svc.', 'item_get');
        await waitForSelected();
        await vi.waitFor(() => expect(paneVisible()).toBe(true));
        expect(list().getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);
        expect(list().getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
    });

    it('shows the badges of client function candidates', async () => {
        clientFunctionEditor('call sv', 'svc');
        await waitForSelected();
        expect(badgeOf('svc')).toBe('NS');
        expect(paneDetail()).toBe('The Service');
    });

    it('shows the badge of a client function', async () => {
        clientFunctionEditor('call svc.', 'item_get');
        await waitForSelected();
        expect(badgeOf('item_get')).toBe('FN');
    });

    it('shows the badge of an option', async () => {
        clientFunctionEditor('call svc.item_get (', 'id');
        await waitForSelected();
        expect(badgeOf('id')).toBe('OPT');
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

    it('removes the list with the editor', () => {
        completingEditor().destroy();
        expect(document.querySelector('[data-dashql-completion-list]')).toBeNull();
    });
});
