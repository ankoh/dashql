import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import * as core from '@akohn/dashql';
import { EditorView } from '@codemirror/view';
import { createTestRoot } from '@akohn/dashql-react/testing/react_root';
import { LoggerProvider } from '../../host/logger_provider.js';
import { AnalyzerPage, EDITOR_SCRIPT } from './analyzer_page.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;
beforeAll(async () => { await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

describe('AnalyzerPage', () => {
    let root: ReturnType<typeof createTestRoot>;

    beforeEach(async () => {
        root = createTestRoot();
        root.container.style.width = '1200px';
        await root.render(
            <LoggerProvider>
                <AnalyzerPage />
            </LoggerProvider>,
        );
        await act(async () => {
            await vi.waitFor(() => expect(card('Editor Script')).not.toBeNull());
        });
    });
    afterEach(() => {
        root.unmount();
        vi.restoreAllMocks();
    });

    const card = (title: string) => root.container.querySelector<HTMLElement>(`section[aria-label="${title}"]`);
    const phase = (title: string, name: string) => card(title)!.querySelector<HTMLElement>(`section[aria-label="${name}"]`)!;
    const tokens = (title: string) => [...phase(title, 'Scanner').querySelectorAll('[data-token]')].map(token => token.textContent);
    const toggle = (title: string) => act(async () => card(title)!.querySelector<HTMLButtonElement>('button')!.click());
    const editor = (title: string) => EditorView.findFromDOM(card(title)!.querySelector<HTMLElement>('.cm-editor')!)!;
    /// The facts of a row of the analysis, as their text
    const facts = (row: string) => [...phase('Editor Script', 'Analyzer').querySelectorAll<HTMLElement>(`[data-fact="${row}"]`)];
    const factTexts = (row: string) => facts(row).map(fact => fact.textContent);
    /// A hover is a continuous event, its update renders after the act
    const hover = (element: HTMLElement) => act(async () => { element.dispatchEvent(new PointerEvent('pointerover', { bubbles: true })); });
    const focusedTokens = () => [...phase('Editor Script', 'Scanner').querySelectorAll('[data-focus]')].map(token => token.textContent);

    it('shows the catalog script and the tokens, the AST and the analysis of the editor script', () => {
        // The catalog script is collapsed and shows its summary
        expect(card('Catalog Script')!.querySelector('button')!.getAttribute('aria-expanded')).toBe('false');
        expect(card('Catalog Script')!.querySelector('.cm-editor')).toBeNull();
        expect(card('Catalog Script')!.textContent).toContain('8 statements');
        expect(editor('Editor Script').state.doc.toString()).toBe(EDITOR_SCRIPT);

        expect(tokens('Editor Script').slice(0, 4)).toEqual(['select', 'min', '(', 'ps_supplycost']);
        const parser = phase('Editor Script', 'Parser');
        expect(parser.textContent).toContain('SELECT');
        expect(parser.querySelectorAll('[data-node]').length).toBeGreaterThan(3);
        // The table references resolve in the catalog of the catalog script
        expect(phase('Editor Script', 'Analyzer').textContent).toContain('4 table refs (4 resolved)');
    });

    it('shows the facts of the analysis by their kind', async () => {
        // No JSON, rows of facts
        expect(phase('Editor Script', 'Analyzer').textContent).not.toContain('{');
        // The table references resolve, their facts name the resolved tables
        const tables = factTexts('Table refs');
        expect(tables.map(text => text!.match(/^[a-z]+/)![0])).toEqual(['partsupp', 'supplier', 'nation', 'region']);
        expect(tables.some(text => text!.includes('unresolved'))).toBe(false);
        // The columns resolve and name their tables
        const columns = factTexts('Column refs');
        expect(columns.some(text => text!.includes('unresolved'))).toBe(false);
        expect(columns.find(text => text!.startsWith('r_name'))).toContain('region');
        // The analyzer records the call, the column refs and the constants, no row of other expressions such as the ANDs
        expect(factTexts('Calls')).toEqual(['min(ps_supplycost)']);
        expect(facts('Expressions')).toEqual([]);
        expect(factTexts('Constants')).toContain("literal'EUROPE'");
        expect(factTexts('Scopes').length).toBeGreaterThan(0);

        // A fact under the pointer highlights its node in the AST and its tokens in the scanner
        await hover(facts('Table refs')[1]);
        await act(async () => {
            await vi.waitFor(() => expect(focusedTokens()).toEqual(['supplier']));
        });
        const node = phase('Editor Script', 'Parser').querySelector<HTMLElement>('[data-role="focus"]')!;
        expect(node).not.toBeNull();
        expect(facts('Table refs')[1].hasAttribute('data-focus')).toBe(true);
        // A node under the pointer in the AST highlights its facts
        const nodes = [...phase('Editor Script', 'Parser').querySelectorAll<HTMLElement>('[data-node]')];
        await hover(nodes[nodes.length - 1]);
        await act(async () => {
            await vi.waitFor(() => expect(facts('Table refs')[1].hasAttribute('data-focus')).toBe(false));
        });
        await hover(node);
        await act(async () => {
            await vi.waitFor(() => expect(facts('Table refs')[1].hasAttribute('data-focus')).toBe(true));
        });
    });

    it('follows the pointers of the node under the pointer', async () => {
        const parser = phase('Editor Script', 'Parser');
        const nodes = [...parser.querySelectorAll<HTMLElement>('[data-node]')];
        const edges = () => parser.querySelectorAll('svg path').length;
        const roles = () => nodes.map(node => node.getAttribute('data-role')).filter(role => role != null).sort().join(',');
        // The root of the statement comes last, it has children and no parent: an edge to its first child
        await hover(nodes[nodes.length - 1]);
        await act(async () => {
            await vi.waitFor(() => expect(roles()).toMatch(/^(child,)+focus$/));
        });
        expect(edges()).toBe(1);
        expect(parser.textContent).toContain('r_name');
        // The scanner highlights the tokens of the node, the root has all but the semicolon
        const focused = () => focusedTokens().length;
        expect(focusedTokens()).toEqual(tokens('Editor Script').slice(0, -1));
        // A node in between has a parent too, edges to its first child and its parent
        await hover(nodes.find(node => node.textContent!.endsWith('TABLEREF'))!);
        await act(async () => {
            await vi.waitFor(() => expect(roles()).toMatch(/^(child,)+focus,parent$/));
        });
        expect(edges()).toBe(2);
        expect(focused()).toBe(1);
    });

    it('analyzes the editor script again when the catalog script changes', async () => {
        await toggle('Catalog Script');
        await act(async () => {
            const view = editor('Catalog Script');
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: 'create table orders (o_orderkey integer)' },
                userEvent: 'input.paste',
            });
        });
        await act(async () => {
            await vi.waitFor(() => expect(phase('Editor Script', 'Analyzer').textContent).toContain('4 table refs (0 resolved)'));
        });
        expect(card('Catalog Script')!.textContent).toContain('1 statement');

        await act(async () => {
            const view = editor('Editor Script');
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: 'select o_orderkey from orders' },
                userEvent: 'input.paste',
            });
        });
        await act(async () => {
            await vi.waitFor(() => expect(tokens('Editor Script')).toEqual(['select', 'o_orderkey', 'from', 'orders']));
        });
        expect(phase('Editor Script', 'Analyzer').textContent).toContain('1 table refs (1 resolved)');
    });

    it('opens the catalog script with its text and only that', async () => {
        await toggle('Catalog Script');
        expect(editor('Catalog Script').state.doc.toString()).toContain('create table lineitem');
        expect(card('Catalog Script')!.querySelector('section')).toBeNull();
        await toggle('Catalog Script');
        expect(card('Catalog Script')!.querySelector('.cm-editor')).toBeNull();
        expect(card('Catalog Script')!.textContent).toContain('8 statements');
    });

    it('formats a script pretty or compact from the menu of its card', async () => {
        const formatButton = (title: string) => [...card(title)!.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Format') ?? null;
        const format = async (title: string, mode: 'pretty' | 'compact') => {
            await act(async () => formatButton(title)!.click());
            const item = document.querySelector<HTMLElement>(`[data-action="format-${mode}"]`);
            expect(item).not.toBeNull();
            await act(async () => item!.click());
        };
        // A collapsed card has no editor and no button
        expect(formatButton('Catalog Script')).toBeNull();
        // The script of the page is formatted pretty already
        await format('Editor Script', 'pretty');
        expect(editor('Editor Script').state.doc.toString()).toBe(EDITOR_SCRIPT);
        // Compact fills the width of the editor, the conditions share a line
        await format('Editor Script', 'compact');
        const compact = editor('Editor Script').state.doc.toString();
        expect(compact).not.toBe(EDITOR_SCRIPT);
        expect(compact.split('\n').length).toBeLessThan(EDITOR_SCRIPT.split('\n').length);
        await format('Editor Script', 'pretty');
        expect(editor('Editor Script').state.doc.toString()).toBe(EDITOR_SCRIPT);
        // The session follows the editor, the analysis shows the formatted script
        expect(tokens('Editor Script')).toContain('r_name');
        await toggle('Catalog Script');
        expect(formatButton('Catalog Script')).not.toBeNull();
    });

    it('keeps the analysis of a collapsed editor script', async () => {
        await toggle('Editor Script');
        expect(card('Editor Script')!.querySelector('.cm-editor')).toBeNull();
        expect(card('Editor Script')!.textContent).toContain('1 statement');
        await toggle('Editor Script');
        expect(tokens('Editor Script')).toContain('ps_supplycost');
    });
});
