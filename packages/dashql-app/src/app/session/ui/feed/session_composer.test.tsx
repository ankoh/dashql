import * as React from 'react';
import * as core from '@ankoh/dashql-core';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';

import { SessionComposer, SessionComposerVariant } from './session_composer.js';
import { ConnectorType } from '../../../connections/connector_info.js';
import { buildSnippetRegistry } from '../../snippets/snippet_registry.js';
import { ComposerInputMode } from '../../ai/input_mode.js';
import { LoggerProvider } from '../../../../platform/logger/logger_provider.js';
import * as identifierStyles from '../../ai/editor/nl_identifier_plugin.module.css';
import { DashQLCompletionStartEffect, DashQLProcessorPlugin } from '../../scripts/editor/dashql_processor.js';
import { SessionConnectionAttentionContext } from '../session_connection_attention.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });

function press(view: EditorView, key: string, modifiers: KeyboardEventInit = {}) {
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }));
}

function type(view: EditorView, text: string) {
    view.dispatch({ changes: { from: view.state.doc.length, insert: text }, selection: { anchor: view.state.doc.length + text.length } });
}

describe('Session composer', () => {
    let container: HTMLDivElement;
    let root: Root;
    let catalog: core.DashQLCatalog;
    let view: EditorView | null;
    let onSend: ReturnType<typeof vi.fn<(text: string, mode: ComposerInputMode) => void>>;
    let targetScript: React.RefObject<((name: string) => void) | null>;
    let attention: { sessionId: string; active: boolean; request: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        catalog = dql.createCatalog();
        view = null;
        onSend = vi.fn<(text: string, mode: ComposerInputMode) => void>();
        targetScript = { current: null };
        attention = { sessionId: 'session', active: false, request: vi.fn() };
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        catalog.destroy();
        dql.resetUnsafe();
        document.getElementById('__dashqlPortalRoot__')?.remove();
    });

    // The view is created by a chain of effects, wait until the composer hands it out
    async function render(variant = SessionComposerVariant.Docked, aiAvailable = false, offlineSessionId: string | null = null) {
        const snippets = buildSnippetRegistry(dql, { 'hyper/dates/month.sql': `${core.renderCommentTag('description', 'Text.')}\nselect 42;` });
        act(() => root.render(<LoggerProvider>
            <SessionConnectionAttentionContext.Provider value={attention as any}>
                <SessionComposer instance={dql} catalog={catalog} variant={variant} aiAvailable={aiAvailable}
                    snippetConnector={ConnectorType.HYPER} snippetRegistry={snippets}
                    scriptNames={['revenue', 'revenue-2']} targetScriptRef={targetScript} offlineSessionId={offlineSessionId}
                    keywordCase={core.buffers.formatting.KeywordCase.LOWER} onSend={onSend} setView={v => { view = v; }} />
            </SessionConnectionAttentionContext.Provider>
        </LoggerProvider>));
        await vi.waitFor(() => expect(view).not.toBeNull());
        return view!;
    }
    const sendButton = () => container.querySelector<HTMLButtonElement>('[data-testid="composer-send"]')!;
    const modeButton = (mode: 'sql' | 'ai') => container.querySelector<HTMLButtonElement>(`[data-testid="composer-mode"][data-mode="${mode}"]`)!;

    it('sends the draft on Enter and clears it', async () => {
        const editor = await render();
        expect(sendButton().disabled).toBe(true);
        act(() => type(editor, 'select 1'));
        expect(sendButton().disabled).toBe(false);
        act(() => press(editor, 'Enter'));
        expect(onSend).toHaveBeenCalledExactlyOnceWith('select 1', ComposerInputMode.Sql);
        expect(editor.state.doc.toString()).toBe('');
        expect(sendButton().disabled).toBe(true);
    });

    it('drops an open completion together with the sent draft', async () => {
        const editor = await render();
        act(() => type(editor, 'select 1 fr'));
        act(() => editor.dispatch({ effects: DashQLCompletionStartEffect.of(null) }));
        expect(editor.state.field(DashQLProcessorPlugin).scriptCompletion).not.toBeNull();
        act(() => press(editor, 'Enter'));
        expect(onSend).toHaveBeenCalledExactlyOnceWith('select 1 fr', ComposerInputMode.Sql);
        expect(editor.state.field(DashQLProcessorPlugin).scriptCompletion).toBeNull();
    });

    it('shows the placeholder instead of a completion hint when focused empty', async () => {
        const editor = await render();
        act(() => editor.focus());
        expect(editor.state.field(DashQLProcessorPlugin).scriptCompletion).toBeNull();
        expect(container.querySelector('.cm-placeholder')).not.toBeNull();
    });

    it('inserts a newline on Shift+Enter without sending', async () => {
        const editor = await render();
        act(() => type(editor, 'select 1'));
        act(() => press(editor, 'Enter', { shiftKey: true }));
        expect(onSend).not.toHaveBeenCalled();
        expect(editor.state.doc.toString()).toBe('select 1\n');
    });

    it('scrolls long lines without showing a scrollbar', async () => {
        const editor = await render();
        expect(editor.lineWrapping).toBe(false);
        expect(getComputedStyle(editor.scrollDOM).scrollbarWidth).toBe('none');
    });

    it('ignores blank drafts and sends through the button', async () => {
        const editor = await render();
        act(() => type(editor, '  '));
        act(() => press(editor, 'Enter'));
        expect(onSend).not.toHaveBeenCalled();
        act(() => type(editor, 'select 2'));
        act(() => sendButton().click());
        expect(onSend).toHaveBeenCalledExactlyOnceWith('  select 2', ComposerInputMode.Sql);
        expect(editor.state.doc.toString()).toBe('');
    });

    it.each([
        ['landing', SessionComposerVariant.Hero],
        ['docked', SessionComposerVariant.Docked],
    ])('keeps a SQL draft on the %s composer while its connection is not connected and pulses the connections', async (_, variant) => {
        const editor = await render(variant, false, 'session');
        // The button is clickable even without a draft, it never sends
        expect(sendButton().disabled).toBe(false);
        expect(sendButton().getAttribute('aria-label')).toBe('Connect to run');
        expect(container.querySelector('[data-execution-connection-blocked="true"]')?.contains(sendButton())).toBe(true);
        act(() => type(editor, 'select 1'));
        act(() => sendButton().click());
        act(() => press(editor, 'Enter'));
        expect(onSend).not.toHaveBeenCalled();
        expect(attention.request).toHaveBeenCalledTimes(2);
        expect(attention.request).toHaveBeenCalledWith('session');
        expect(editor.state.doc.toString()).toBe('select 1');
        // Once connected the draft is sent
        await render(variant, false, null);
        expect(sendButton().getAttribute('aria-label')).toBe('Run query');
        act(() => sendButton().click());
        expect(onSend).toHaveBeenCalledExactlyOnceWith('select 1', ComposerInputMode.Sql);
    });

    it('asks the agent while the connection of the draft is not connected', async () => {
        const editor = await render(SessionComposerVariant.Docked, true, 'session');
        act(() => type(editor, 'how many rows'));
        await vi.waitFor(() => expect(sendButton().getAttribute('aria-label')).toBe('Ask the agent'));
        expect(container.querySelector('[data-execution-connection-blocked]')).toBeNull();
        act(() => sendButton().click());
        expect(onSend).toHaveBeenCalledExactlyOnceWith('how many rows', ComposerInputMode.Ai);
        expect(attention.request).not.toHaveBeenCalled();
    });

    it.each([
        ['landing', SessionComposerVariant.Hero],
        ['docked', SessionComposerVariant.Docked],
    ])('replaces the draft with a snippet on the %s composer', async (_, variant) => {
        const editor = await render(variant);
        act(() => type(editor, 'select 1'));
        act(() => container.querySelector<HTMLButtonElement>('[data-testid="composer-snippets"]')!.click());
        act(() => document.querySelector<HTMLButtonElement>('[data-testid="snippet-apply"]')!.click());
        expect(editor.state.doc.toString()).toContain('select 42');
        expect(editor.state.doc.toString()).not.toContain('select 1');
        expect(sendButton().disabled).toBe(false);
        expect(document.querySelector('[data-testid="snippets-overlay"]')).toBeNull();
    });

    it('keeps the draft across hero and docked variants and disables AI without a provider', async () => {
        const editor = await render(SessionComposerVariant.Hero);
        expect(container.querySelector('[data-variant="hero"]')).not.toBeNull();
        act(() => type(editor, 'select 3'));
        expect(await render(SessionComposerVariant.Docked)).toBe(editor);
        expect(container.querySelector('[data-variant="docked"]')).not.toBeNull();
        expect(editor.state.doc.toString()).toBe('select 3');
        expect(modeButton('ai').disabled).toBe(true);
    });

    it('moves the draft to the catalog of a merged connection', async () => {
        const editor = await render(SessionComposerVariant.Docked, true);
        act(() => type(editor, 'select 4'));
        // A merge deletes the connection, and destroys its catalog, before the session renders the target
        const merged = catalog;
        catalog = dql.createCatalog();
        merged.destroy();
        expect(await render(SessionComposerVariant.Docked, true)).toBe(editor);
        act(() => type(editor, ' '));
        await vi.waitFor(() => expect(editor.state.field(DashQLProcessorPlugin).scriptSession?.getText()).toBe('select 4 '));
    });

    describe('with the agent available', () => {
        const selectedMode = () => container.querySelector('[data-testid="composer-mode"][aria-current="true"]')?.getAttribute('data-mode');
        const typeUser = (editor: EditorView, text: string) => editor.dispatch({
            changes: { from: editor.state.doc.length, insert: text },
            selection: { anchor: editor.state.doc.length + text.length },
            userEvent: 'input.type',
        });

        it('starts in natural language without SQL completion', async () => {
            const editor = await render(SessionComposerVariant.Docked, true);
            expect(selectedMode()).toBe('ai');
            expect(modeButton('ai').disabled).toBe(false);
            act(() => typeUser(editor, 'selec'));
            expect(editor.state.field(DashQLProcessorPlugin).scriptCompletion).toBeNull();
        });

        it('switches to SQL once the draft is convincingly SQL and back for natural language', async () => {
            const editor = await render(SessionComposerVariant.Docked, true);
            act(() => type(editor, 'select'));
            expect(selectedMode()).toBe('ai');
            act(() => type(editor, ' 1 '));
            expect(selectedMode()).toBe('sql');
            act(() => type(editor, 'the revenue of all customers '));
            expect(selectedMode()).toBe('ai');
        });

        it('hesitates to leave SQL for a short invalid tail', async () => {
            const editor = await render(SessionComposerVariant.Docked, true);
            act(() => type(editor, 'select a, b from orders where x = 1 '));
            expect(selectedMode()).toBe('sql');
            act(() => type(editor, 'oops '));
            expect(selectedMode()).toBe('sql');
        });

        it('keeps a mode the user picked until the draft is cleared', async () => {
            const editor = await render(SessionComposerVariant.Docked, true);
            act(() => modeButton('sql').click());
            act(() => type(editor, 'what is the revenue of all customers '));
            expect(selectedMode()).toBe('sql');
            act(() => editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: '' } }));
            expect(selectedMode()).toBe('ai');
        });

        it('sends a complete statement as SQL even while its last token is being typed', async () => {
            const editor = await render(SessionComposerVariant.Docked, true);
            act(() => type(editor, 'select 1'));
            expect(selectedMode()).toBe('ai');
            act(() => press(editor, 'Enter'));
            expect(onSend).toHaveBeenCalledExactlyOnceWith('select 1', ComposerInputMode.Sql);
            expect(editor.state.doc.toString()).toBe('');
        });

        it('highlights tables that session scripts load into the catalog later', async () => {
            const editor = await render(SessionComposerVariant.Docked, true);
            catalog.createSnapshot();
            const session = dql.createScriptSession(catalog);
            session.replaceText(session.getTextVersion(), 'create table orders (amount int)');
            session.analyze();
            session.loadIntoCatalog();
            act(() => type(editor, 'total amount of orders '));
            await vi.waitFor(() => expect(Array.from(editor.contentDOM.querySelectorAll(
                `.${identifierStyles.identifier_table}, .${identifierStyles.identifier_column}`)).map(e => e.textContent))
                .toEqual(['amount', 'orders']));
            session.destroy();
        });

        it('references a targeted script once and turns the draft into a question', async () => {
            const editor = await render(SessionComposerVariant.Docked, true);
            const highlightedScripts = () => Array.from(editor.contentDOM.querySelectorAll(`.${identifierStyles.identifier_script}`))
                .map(e => e.textContent);
            act(() => modeButton('sql').click());
            act(() => type(editor, 'filter'));
            act(() => targetScript.current!('revenue-2'));
            expect(editor.state.doc.toString()).toBe('filter @revenue-2 ');
            expect(editor.state.selection.main.head).toBe(editor.state.doc.length);
            expect(selectedMode()).toBe('ai');
            expect(highlightedScripts()).toEqual(['@revenue-2']);
            act(() => targetScript.current!('revenue-2'));
            act(() => targetScript.current!('revenue'));
            expect(editor.state.doc.toString()).toBe('filter @revenue-2 @revenue ');
            expect(highlightedScripts()).toEqual(['@revenue-2', '@revenue']);
        });

        it('sends a question and clears it right away', async () => {
            const editor = await render(SessionComposerVariant.Docked, true);
            act(() => type(editor, 'what is the revenue'));
            expect(selectedMode()).toBe('ai');
            expect(sendButton().disabled).toBe(false);
            act(() => press(editor, 'Enter'));
            expect(onSend).toHaveBeenCalledExactlyOnceWith('what is the revenue', ComposerInputMode.Ai);
            expect(editor.state.doc.toString()).toBe('');
            expect(selectedMode()).toBe('ai');
        });
    });
});
