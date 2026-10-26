import * as React from 'react';
import * as dashql from '@ankoh/dashql-core';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectorType } from '../../connections/connector_info.js';
import { LoggerProvider } from '../../../platform/logger/logger_provider.js';
import { buildSnippetRegistry, type SnippetRegistry } from '../snippets/snippet_registry.js';
import { useSnippetsDialog, type SnippetsDialogController } from './snippets_dialog.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class { observe() { } unobserve() { } disconnect() { } });

function file(body: string): string {
    return `${dashql.renderCommentTag('description', 'Text.')}\n${body}`;
}

describe('shell snippets dialog', () => {
    let registry: SnippetRegistry;
    let container: HTMLDivElement;
    let root: Root;
    let controller: SnippetsDialogController;
    let connectorType: ConnectorType;

    const Harness = () => {
        const snippetsDialog = useSnippetsDialog(connectorType, registry);
        controller = snippetsDialog.controller;
        return <div>{snippetsDialog.dialog}</div>;
    };

    beforeAll(async () => {
        const core = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
        registry = buildSnippetRegistry(core, {
            'hyper/dates/month.sql': file('select 1;'),
            'trino/json/access.sql': file("select json_parse('{}');"),
            'hyper/datasets/tpch_0_1.sql': file('create table a as select 1;\ncreate table b as select 2;'),
        });
        expect(registry.errors).toEqual([]);
    });

    beforeEach(() => {
        connectorType = ConnectorType.HYPER;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        act(() => root.render(<LoggerProvider><Harness /></LoggerProvider>));
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        document.getElementById('__dashqlPortalRoot__')?.remove();
    });

    function open(signal?: AbortSignal): Promise<string | null> {
        let result!: Promise<string | null>;
        act(() => { result = controller.request(signal); });
        return result;
    }
    function query<T extends Element = HTMLElement>(selector: string): T | null {
        return document.querySelector<T>(selector);
    }
    function snippetIds(): string[] {
        return Array.from(document.querySelectorAll<HTMLElement>('[data-testid="snippet"]')).map(item => item.dataset.snippetId!);
    }

    it('shows the Hyper snippets and resolves with the text of the used one', async () => {
        const result = open();
        expect(query('[data-testid="snippets-overlay"]')).not.toBeNull();
        expect(snippetIds().sort()).toEqual(['datasets/tpch_0_1', 'dates/month']);
        expect(document.activeElement).toBe(query('[data-testid="snippet-list"]'));

        act(() => query<HTMLButtonElement>('[data-testid="snippet"][data-snippet-id="datasets/tpch_0_1"]')!.click());
        act(() => query<HTMLButtonElement>('[data-testid="snippet-apply"]')!.click());
        await expect(result).resolves.toBe('create table a as select 1;\ncreate table b as select 2;\n');
        expect(query('[data-testid="snippets-overlay"]')).toBeNull();
    });

    it('shows the snippets of the connector of the shell', async () => {
        connectorType = ConnectorType.TRINO;
        act(() => root.render(<LoggerProvider><Harness /></LoggerProvider>));
        const result = open();
        expect(snippetIds()).toEqual(['json/access']);

        act(() => query<HTMLButtonElement>('[data-testid="snippets-close"]')!.click());
        await expect(result).resolves.toBeNull();
    });

    it('resolves with null when closed', async () => {
        const result = open();
        act(() => query<HTMLButtonElement>('[data-testid="snippets-close"]')!.click());
        await expect(result).resolves.toBeNull();
        expect(query('[data-testid="snippets-overlay"]')).toBeNull();
    });

    it('closes when the command is aborted and rejects a second request', async () => {
        const abort = new AbortController();
        const result = open(abort.signal);
        await expect(controller.request()).rejects.toThrow('already pending');

        act(() => abort.abort());
        await expect(result).resolves.toBeNull();
        expect(query('[data-testid="snippets-overlay"]')).toBeNull();
    });
});
