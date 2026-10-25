import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { LoggerProvider } from '../../../../platform/logger/logger_provider.js';
import { ConnectorType } from '../../../connections/connector_info.js';
import { buildSnippetRegistry, getBundledSnippets, type SnippetRegistry } from '../../snippets/snippet_registry.js';
import { SnippetsOverlay } from './snippets_overlay.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class { observe() { } unobserve() { } disconnect() { } });

/// A path that does not fit into the snippet list
const LONG_PATH = 'hyper/window-functions/running-total-of-the-revenue-per-customer-and-month-since-the-first-order.sql';

/// The id of the snippet with the long path
const LONG_ID = LONG_PATH.slice(LONG_PATH.indexOf('/') + 1, -'.sql'.length);

function file(body: string): string {
    return `${dashql.renderCommentTag('description', 'Text.')}\n${body}`;
}

describe('SnippetsOverlay', () => {
    let registry: SnippetRegistry;
    let bundled: SnippetRegistry;
    let container: HTMLDivElement;
    let root: Root;
    const onApply = vi.fn();

    beforeAll(async () => {
        const core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        registry = buildSnippetRegistry(core, {
            'hyper/dates/month.sql': file('select 1;'),
            'trino/dates/month.sql': file('select 1;'),
            'hyper/json/access.sql': file("select '{}'::json;"),
            'trino/json/access.sql': file("select json_parse('{}');"),
            'trino/strings/split.sql': file("select split('a,b', ',');"),
            'hyper/datasets/tpch_0_1.sql': file("create table if not exists lineitem as select * from external('tpch-0.1/lineitem.parquet');"),
            'hyper/aggregation/count.sql': file('select count(*) from lineitem;'),
            [LONG_PATH]: file('select 1;'),
        });
        expect(registry.errors).toEqual([]);
        bundled = getBundledSnippets(core);
    });

    beforeEach(() => {
        onApply.mockReset();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        document.getElementById('__dashqlPortalRoot__')?.remove();
    });

    function render(connectorType: ConnectorType, disabled = false, snippets = registry): void {
        act(() => root.render(
            <LoggerProvider>
                <SnippetsOverlay scriptName="script" connectorType={connectorType} disabled={disabled} onApply={onApply} registry={snippets} />
            </LoggerProvider>,
        ));
    }
    function open(): void {
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="script-snippets"]')!.click());
    }
    function query<T extends Element = HTMLElement>(selector: string): T | null {
        return document.querySelector<T>(selector);
    }
    function snippetIds(): string[] {
        return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="snippet"]')).map(item => item.dataset.snippetId!);
    }
    function selectSnippet(id: string): void {
        act(() => query<HTMLButtonElement>(`[data-testid="snippet"][data-snippet-id="${id}"]`)!.click());
    }
    function applySelected(): void {
        act(() => query<HTMLButtonElement>('[data-testid="snippet-apply"]')!.click());
    }

    it('shows only the snippets of the connector and applies the text for it', () => {
        render(ConnectorType.TRINO);
        open();
        expect(snippetIds().sort()).toEqual(['dates/month', 'json/access', 'strings/split']);

        selectSnippet('json/access');
        expect(query('[data-testid="snippet-preview"]')!.dataset.snippetId).toEqual('json/access');
        applySelected();
        expect(onApply).toHaveBeenCalledOnce();
        expect(onApply.mock.calls[0][0]).toContain('json_parse');
        expect(onApply.mock.calls[0][0]).not.toContain('@dashql:');
        expect(query('[data-testid="snippets-overlay"]')).toBeNull();
    });

    it('lists the snippets of all categories in one list', () => {
        render(ConnectorType.HYPER);
        open();
        expect(snippetIds().sort()).toEqual(['aggregation/count', 'datasets/tpch_0_1', 'dates/month', 'json/access', LONG_ID]);
        // The datasets come first, the other snippets query them
        expect(query<HTMLElement>('[data-testid="snippet-folder"]')!.dataset.folder).toEqual('datasets');
    });

    it('previews the text of a snippet with line numbers', () => {
        render(ConnectorType.HYPER);
        open();
        const preview = query('[data-testid="snippet-text"]')!;
        expect(preview.querySelector('.cm-content')).not.toBeNull();
        expect(preview.querySelector('.cm-lineNumbers')).not.toBeNull();
    });

    it('shows the snippet files of the connector in the folders of their categories', () => {
        render(ConnectorType.TRINO);
        open();
        const folders = () => Array.from(document.querySelectorAll<HTMLElement>('[data-testid="snippet-folder"]')).map(item => item.dataset.folder);
        expect(folders()).toEqual(['dates', 'json', 'strings']);
        const name = query('[data-testid="snippet"][data-snippet-id="json/access"] [title]')!;
        expect(name.textContent).toEqual('access.sql');
        expect(name.title).toEqual('trino/json/access.sql');

        const json = () => query<HTMLButtonElement>('[data-testid="snippet-folder"][data-folder="json"]')!;
        act(() => json().click());
        expect(json().getAttribute('aria-expanded')).toEqual('false');
        expect(snippetIds().sort()).toEqual(['dates/month', 'strings/split']);
        act(() => json().click());
        expect(snippetIds().sort()).toEqual(['dates/month', 'json/access', 'strings/split']);
    });

    it('keeps a long name on one line at the start of the entry', () => {
        render(ConnectorType.SALESFORCE_DATA_CLOUD);
        open();
        const item = query(`[data-testid="snippet"][data-snippet-id="${LONG_ID}"]`)!;
        const path = item.querySelector<HTMLElement>(`[title="${LONG_PATH}"]`)!;
        expect(path.textContent).toEqual(LONG_PATH.slice(LONG_PATH.lastIndexOf('/') + 1));
        // One line that is cut, not wrapped
        expect(path.getBoundingClientRect().height).toBeLessThan(2 * parseFloat(getComputedStyle(path).fontSize));
        expect(path.scrollWidth).toBeGreaterThan(path.clientWidth);
        expect(path.getBoundingClientRect().right).toBeLessThanOrEqual(item.getBoundingClientRect().right);
        // The name starts right after the file icon
        const icon = item.querySelector('svg')!;
        expect(path.getBoundingClientRect().left - icon.getBoundingClientRect().right).toBeLessThan(16);
    });

    it('shows the full names of all bundled snippets', () => {
        for (const connector of [ConnectorType.HYPER, ConnectorType.TRINO, ConnectorType.SALESFORCE_DATA_CLOUD]) {
            render(connector, false, bundled);
            open();
            const paths = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="snippet"] [title]'));
            expect(paths.length, ConnectorType[connector]).toBeGreaterThan(0);
            for (const path of paths) {
                expect(path.scrollWidth, path.title).toBeLessThanOrEqual(path.clientWidth);
            }
            act(() => query<HTMLButtonElement>('[data-testid="snippets-close"]')!.click());
        }
    });

    it('shows the description of a snippet and applies its text without comment tags', () => {
        render(ConnectorType.HYPER);
        open();
        selectSnippet('aggregation/count');
        expect(query('[data-testid="snippet-description"]')!.textContent).toEqual('Text.');
        applySelected();
        expect(onApply.mock.calls[0][0]).toEqual('select count(*) from lineitem;\n');
    });

    it('applies the selection with the keyboard', () => {
        render(ConnectorType.HYPER);
        open();
        const list = query<HTMLElement>('[data-testid="snippet-list"]')!;
        const selected = () => query('[data-testid="snippet-preview"]')!.dataset.snippetId;
        const first = selected();
        act(() => { list.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); });
        expect(selected()).not.toEqual(first);
        act(() => { list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
        expect(onApply).toHaveBeenCalledOnce();
    });

    it('stays closed while disabled', () => {
        render(ConnectorType.HYPER, true);
        expect(container.querySelector<HTMLButtonElement>('[data-testid="script-snippets"]')!.disabled).toBe(true);
    });
});
