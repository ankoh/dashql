import * as React from 'react';
import * as core from '@ankoh/dashql';
import { act } from '@dashql/browser-test-act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';

import { WorkbookComposer, WorkbookComposerVariant } from './workbook_composer.js';
import { ConnectorType } from '@ankoh/dashql/platform/connections/connector_info';
import { buildSnippetRegistry } from '../snippets/snippet_registry.js';
import { LoggerProvider } from '../../platform/logger/logger_provider.js';
import * as styles from './workbook_composer.module.css';
import { DashQLCompletionStartEffect, DashQLProcessorPlugin } from '../editor/dashql_processor.js';
import { WorkbookConnectionAttentionContext } from '../workbook_connection_attention.js';
import { ComposerMode, type ConnectHarness } from '../../agent/agent_connect.js';
import type { AgentConnect } from '../../agent/agent_session_provider.js';

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

function mouseDown(target: Element, button = 0): MouseEvent {
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button });
    act(() => { target.dispatchEvent(event); });
    return event;
}

describe('Workbook composer', () => {
    let container: HTMLDivElement;
    let root: Root;
    let catalog: core.DashQLCatalog;
    let view: EditorView | null;
    let onSend: ReturnType<typeof vi.fn<(text: string) => void>>;
    let targetScript: React.RefObject<((name: string) => void) | null>;
    let attention: { workbookId: string; active: boolean; request: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        catalog = dql.createCatalog();
        view = null;
        onSend = vi.fn<(text: string) => void>();
        targetScript = { current: null };
        attention = { workbookId: 'workbook', active: false, request: vi.fn() };
    });
    afterEach(() => {
        act(() => root.unmount());
        container.remove();
        catalog.destroy();
        dql.resetUnsafe();
        document.getElementById('__dashqlPortalRoot__')?.remove();
    });

    // The view is created by a chain of effects, wait until the composer hands it out
    async function render(variant = WorkbookComposerVariant.Docked, offlineWorkbookId: string | null = null, agentWorking = false, bar: React.ReactNode = undefined) {
        const snippets = buildSnippetRegistry(dql, { 'hyper/dates/month.sql': `/**\n * Text.\n */\nselect 42;` });
        act(() => root.render(<LoggerProvider>
            <WorkbookConnectionAttentionContext.Provider value={attention as any}>
                <WorkbookComposer instance={dql} catalog={catalog} variant={variant}
                    snippetConnector={ConnectorType.HYPER} snippetRegistry={snippets}
                    scriptNames={['revenue', 'revenue-2']} targetScriptRef={targetScript} offlineWorkbookId={offlineWorkbookId} agentWorking={agentWorking} bar={bar}
                    keywordCase={core.buffers.formatting.KeywordCase.LOWER} onSend={onSend} setView={v => { view = v; }} />
            </WorkbookConnectionAttentionContext.Provider>
        </LoggerProvider>));
        await vi.waitFor(() => expect(view).not.toBeNull());
        return view!;
    }
    const sendButton = () => container.querySelector<HTMLButtonElement>('[data-testid="composer-send"]')!;

    it('sends the draft on Enter and clears it', async () => {
        const editor = await render();
        expect(sendButton().disabled).toBe(true);
        act(() => type(editor, 'select 1'));
        expect(sendButton().disabled).toBe(false);
        act(() => press(editor, 'Enter'));
        expect(onSend).toHaveBeenCalledExactlyOnceWith('select 1');
        expect(editor.state.doc.toString()).toBe('');
        expect(sendButton().disabled).toBe(true);
    });

    it('drops an open completion together with the sent draft', async () => {
        const editor = await render();
        act(() => type(editor, 'select 1 fr'));
        act(() => editor.dispatch({ effects: DashQLCompletionStartEffect.of(null) }));
        expect(editor.state.field(DashQLProcessorPlugin).scriptCompletion).not.toBeNull();
        act(() => press(editor, 'Enter'));
        expect(onSend).toHaveBeenCalledExactlyOnceWith('select 1 fr');
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

    it('wraps long lines and scrolls without showing a scrollbar', async () => {
        const editor = await render();
        expect(editor.lineWrapping).toBe(true);
        expect(getComputedStyle(editor.scrollDOM).scrollbarWidth).toBe('none');
    });

    it('keeps the cursor at the start of a line inside of the scroller, which would clip it otherwise', async () => {
        const editor = await render();
        await vi.waitFor(() => expect(container.querySelector('.cm-cursor')).not.toBeNull());
        // The cursor is only displayed in a focused window, its layout is read from its position and its margin
        const left = editor.coordsAtPos(0)!.left + parseFloat(getComputedStyle(container.querySelector('.cm-cursor')!).marginLeft);
        expect(left).toBeLessThan(editor.coordsAtPos(0)!.left);
        expect(left).toBeGreaterThanOrEqual(editor.scrollDOM.getBoundingClientRect().left);
    });

    it('focuses the editor on a click on the background of the prompt and keeps its cursor', async () => {
        const editor = await render();
        act(() => type(editor, 'select 1'));
        act(() => editor.dispatch({ selection: { anchor: 3 } }));
        for (const background of [`.${styles.composer_editor}`, `.${styles.composer_action_bar}`, `.${styles.composer_trailing_actions}`]) {
            editor.contentDOM.blur();
            expect(document.activeElement).not.toBe(editor.contentDOM);
            const event = mouseDown(container.querySelector(background)!);
            expect(event.defaultPrevented).toBe(true);
            expect(document.activeElement).toBe(editor.contentDOM);
            expect(editor.state.selection.main.head).toBe(3);
        }
    });

    it('leaves clicks on the controls, secondary clicks and the overlays of the controls alone', async () => {
        const editor = await render();
        // The composer takes clicks once it holds the view, the snippets are enabled then
        const snippets = container.querySelector<HTMLButtonElement>('[data-testid="composer-snippets"]')!;
        await vi.waitFor(() => expect(snippets.disabled).toBe(false));
        const notFocused = (event: MouseEvent) => {
            expect(event.defaultPrevented).toBe(false);
            expect(document.activeElement).not.toBe(editor.contentDOM);
        };
        notFocused(mouseDown(container.querySelector(`.${styles.composer_action_bar}`)!, 2));
        act(() => snippets.click());
        const overlay = document.querySelector('[data-testid="snippets-overlay"]')!;
        expect(container.contains(overlay)).toBe(false);
        notFocused(mouseDown(overlay));
    });

    it('ignores blank drafts and sends through the button', async () => {
        const editor = await render();
        act(() => type(editor, '  '));
        act(() => press(editor, 'Enter'));
        expect(onSend).not.toHaveBeenCalled();
        act(() => type(editor, 'select 2'));
        act(() => sendButton().click());
        expect(onSend).toHaveBeenCalledExactlyOnceWith('  select 2');
        expect(editor.state.doc.toString()).toBe('');
    });

    it.each([
        ['landing', WorkbookComposerVariant.Hero],
        ['docked', WorkbookComposerVariant.Docked],
    ])('keeps a SQL draft on the %s composer while its connection is not connected and pulses the connections', async (_, variant) => {
        const editor = await render(variant, 'workbook');
        // The button is clickable even without a draft, it never sends
        expect(sendButton().disabled).toBe(false);
        expect(sendButton().getAttribute('aria-label')).toBe('Connect to run');
        expect(container.querySelector('[data-execution-connection-blocked="true"]')?.contains(sendButton())).toBe(true);
        act(() => type(editor, 'select 1'));
        act(() => sendButton().click());
        act(() => press(editor, 'Enter'));
        expect(onSend).not.toHaveBeenCalled();
        expect(attention.request).toHaveBeenCalledTimes(2);
        expect(attention.request).toHaveBeenCalledWith('workbook');
        expect(editor.state.doc.toString()).toBe('select 1');
        // Once connected the draft is sent
        await render(variant, null);
        expect(sendButton().getAttribute('aria-label')).toBe('Run query');
        act(() => sendButton().click());
        expect(onSend).toHaveBeenCalledExactlyOnceWith('select 1');
    });

    it.each([
        ['landing', WorkbookComposerVariant.Hero],
        ['docked', WorkbookComposerVariant.Docked],
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

    it('keeps the draft across hero and docked variants', async () => {
        const editor = await render(WorkbookComposerVariant.Hero);
        expect(container.querySelector('[data-variant="hero"]')).not.toBeNull();
        act(() => type(editor, 'select 3'));
        expect(await render(WorkbookComposerVariant.Docked)).toBe(editor);
        expect(container.querySelector('[data-variant="docked"]')).not.toBeNull();
        expect(editor.state.doc.toString()).toBe('select 3');
    });

    it('shows the bar above the prompt only with content and turns the frame while the agent works', async () => {
        await render(WorkbookComposerVariant.Docked);
        const bar = () => container.querySelector<HTMLElement>('[data-testid="composer-bar"]')!;
        expect(bar().childElementCount).toBe(0);
        expect(getComputedStyle(bar()).display).toBe('none');
        expect(container.querySelector('[data-agent]')).toBeNull();
        await render(WorkbookComposerVariant.Docked, null, true, <span data-testid="agent-bar">Agent</span>);
        expect(bar().querySelector('[data-testid="agent-bar"]')).not.toBeNull();
        expect(getComputedStyle(bar()).display).not.toBe('none');
        expect(container.querySelector('[data-agent="working"]')).not.toBeNull();
    });

    it('keeps the editor when the bar appears', async () => {
        const editor = await render(WorkbookComposerVariant.Docked);
        act(() => type(editor, 'select 5'));
        expect(await render(WorkbookComposerVariant.Docked, null, false, <span data-testid="agent-bar">Agent</span>)).toBe(editor);
        expect(container.querySelector('[data-testid="composer-bar"] [data-testid="agent-bar"]')).not.toBeNull();
        expect(editor.state.doc.toString()).toBe('select 5');
    });

    describe('inputs of the draft', () => {
        const card = (name: string) => container.querySelector<HTMLInputElement>(`[data-testid="composer-bar"] [data-workbook-input="${name}"] input`)!;
        const inputNames = () => Array.from(container.querySelectorAll('[data-testid="composer-bar"] [data-testid="composer-inputs"] [data-workbook-input]'))
            .map(element => element.getAttribute('data-workbook-input'));
        function typeValue(name: string, value: string) {
            const control = card(name);
            const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            act(() => {
                setValue.call(control, value);
                control.dispatchEvent(new Event('input', { bubbles: true }));
            });
        }
        function fillInput(name: string, value: string) {
            typeValue(name, value);
            act(() => { card(name).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
        }

        it('shows the scalar parameters of a draft on the bar of the prompt', async () => {
            const editor = await render(WorkbookComposerVariant.Hero);
            expect(inputNames()).toEqual([]);
            act(() => type(editor, 'select :min, :region from :revenue'));
            expect(inputNames()).toEqual(['min', 'region']);
            // The cards go with the parameters
            act(() => editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: 'select 1' } }));
            expect(container.querySelector('[data-testid="composer-inputs"]')).toBeNull();
        });

        it('shows the cards on the docked prompt too', async () => {
            const editor = await render(WorkbookComposerVariant.Docked);
            act(() => type(editor, 'select :min'));
            expect(inputNames()).toEqual(['min']);
        });

        it('writes a value into the draft as a tag, keeps the cursor and sends the tag along', async () => {
            const editor = await render(WorkbookComposerVariant.Hero);
            act(() => type(editor, 'select :min'));
            act(() => editor.dispatch({ selection: { anchor: 'select'.length } }));
            fillInput('min', '10');
            const text = '/** @param :min = 10 */\nselect :min';
            expect(editor.state.doc.toString()).toBe(text);
            expect(text.slice(editor.state.selection.main.head)).toBe(' :min');
            expect(onSend).not.toHaveBeenCalled();
            // The card reads the value from the tag
            expect(card('min').value).toBe('10');
            // A second value replaces the first one
            fillInput('min', '20');
            expect(editor.state.doc.toString()).toBe('/** @param :min = 20 */\nselect :min');
            act(() => sendButton().click());
            expect(onSend).toHaveBeenCalledExactlyOnceWith('/** @param :min = 20 */\nselect :min');
            expect(inputNames()).toEqual([]);
        });

        it('sends a typed value along and keeps the send button under the pointer until the click', async () => {
            const editor = await render(WorkbookComposerVariant.Hero);
            act(() => type(editor, 'select :min'));
            act(() => card('min').focus());
            typeValue('min', '10');
            // Writing the value on the press would grow the draft and move the button away before the release
            expect(mouseDown(sendButton()).defaultPrevented).toBe(true);
            expect(editor.state.doc.toString()).toBe('select :min');
            act(() => sendButton().click());
            expect(onSend).toHaveBeenCalledExactlyOnceWith('/** @param :min = 10 */\nselect :min');
        });

        it('shows the values of a snippet with tags', async () => {
            const editor = await render(WorkbookComposerVariant.Hero);
            act(() => type(editor, `/** @param :region = 'EU' */\nselect :region`));
            expect(card('region').value).toBe('EU');
        });

        it('writes the tag of a value into the draft', async () => {
            const editor = await render(WorkbookComposerVariant.Hero);
            act(() => type(editor, 'select :min from orders '));
            fillInput('min', '10');
            expect(editor.state.doc.toString()).toBe('/** @param :min = 10 */\nselect :min from orders ');
            expect(inputNames()).toEqual(['min']);
        });
    });

    it('moves the draft to the catalog of a merged connection', async () => {
        const editor = await render(WorkbookComposerVariant.Docked);
        act(() => type(editor, 'select 4'));
        // A merge deletes the connection, and destroys its catalog, before the workbook renders the target
        const merged = catalog;
        catalog = dql.createCatalog();
        merged.destroy();
        expect(await render(WorkbookComposerVariant.Docked)).toBe(editor);
        act(() => type(editor, ' '));
        await vi.waitFor(() => expect(editor.state.field(DashQLProcessorPlugin).scriptSession?.getText()).toBe('select 4 '));
    });

    it('references a targeted script as a table parameter', async () => {
        const editor = await render(WorkbookComposerVariant.Docked);
        act(() => type(editor, 'select * from '));
        act(() => targetScript.current!('revenue-2'));
        expect(editor.state.doc.toString()).toBe('select * from :"revenue-2" ');
    });

    describe('AI', () => {
        const TARGET = { endpoint: 'http://127.0.0.1:51234', token: 'k3x9' };
        const RENEWED = { endpoint: 'http://127.0.0.1:60001', token: 'z7q2' };
        type Session = React.ComponentProps<typeof WorkbookComposer>['session'];

        /// The composer with the connect state of a provider
        const Connected: React.FC<{ initial: ComposerMode; session?: Session; pickers?: boolean }> = ({ initial, session, pickers }) => {
            const [mode, setMode] = React.useState(initial);
            const [harness, setHarness] = React.useState<ConnectHarness>('claude');
            const [target, setTarget] = React.useState(TARGET);
            const connect: AgentConnect = {
                mode, setMode, harness, setHarness, target, renewTarget: () => setTarget(RENEWED),
                excludedConnections: new Set(), toggleConnection: () => { },
            };
            return (
                <WorkbookComposer instance={dql} catalog={catalog} variant={WorkbookComposerVariant.Docked} session={session} connect={connect}
                    connectionPicker={pickers ? <span data-testid="sql-picker" /> : undefined}
                    agentConnectionsPicker={pickers ? <span data-testid="agent-picker" /> : undefined}
                    snippetConnector={ConnectorType.HYPER} snippetRegistry={buildSnippetRegistry(dql, {})}
                    keywordCase={core.buffers.formatting.KeywordCase.LOWER} onSend={onSend} setView={v => { view = v; }} />
            );
        };
        async function renderConnected(initial: ComposerMode, session?: Session, pickers = false) {
            act(() => root.render(<LoggerProvider><Connected initial={initial} session={session} pickers={pickers} /></LoggerProvider>));
            await vi.waitFor(() => expect(view).not.toBeNull());
            return view!;
        }
        const mode = (name: string) => container.querySelector<HTMLButtonElement>(`[data-testid="composer-mode"][data-mode="${name}"]`)!;
        const command = () => container.querySelector<HTMLInputElement>('[data-testid="composer-connect-command"]')?.value ?? null;
        const snippets = () => container.querySelector<HTMLButtonElement>('[data-testid="composer-snippets"]')!;

        it('greys the prompt, disables Run and the snippets and shows the line that launches a harness', async () => {
            const editor = await renderConnected(ComposerMode.Sql);
            act(() => type(editor, 'select 1'));
            expect(command()).toBeNull();
            act(() => mode('ai').click());
            expect(container.querySelector(`.${styles.composer}`)!.getAttribute('data-mode')).toBe('ai');
            expect(editor.state.readOnly).toBe(true);
            expect(editor.contentDOM.getAttribute('contenteditable')).toBe('false');
            // The line takes the place of the editor
            expect(editor.dom.checkVisibility()).toBe(false);
            expect(sendButton().disabled).toBe(true);
            expect(snippets().disabled).toBe(true);
            expect(command()).toBe('npx -y @ankoh/dashql-cli connect --launch claude --port 51234 --secret k3x9');
            // The command is only copied, a new port and copy stay usable
            expect(container.querySelector<HTMLInputElement>('[data-testid="composer-connect-command"]')!.disabled).toBe(true);
            expect(container.querySelector<HTMLButtonElement>('[data-testid="composer-connect-renew"]')!.disabled).toBe(false);
            expect(container.querySelector<HTMLButtonElement>('[data-testid="composer-connect-copy"]')!.disabled).toBe(false);
            expect(container.querySelector('[data-testid="composer-connect-status"]')!.textContent).toBe('Run the command in the folder of your project, the session shows here');
            // Enter sends nothing, the draft stays for SQL
            act(() => press(editor, 'Enter'));
            expect(onSend).not.toHaveBeenCalled();
            act(() => mode('sql').click());
            expect(editor.state.readOnly).toBe(false);
            expect(editor.state.doc.toString()).toBe('select 1');
            expect(editor.dom.checkVisibility()).toBe(true);
            expect(sendButton().disabled).toBe(false);
            expect(command()).toBeNull();
            // The switch of the harness goes with AI
            expect(container.querySelector('[data-testid="composer-connect-harness"]')).toBeNull();
        });

        it('switches the line between the harnesses, copies it and renews the port', async () => {
            const writeText = vi.fn(() => Promise.resolve());
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
            await renderConnected(ComposerMode.Ai);
            act(() => container.querySelector<HTMLButtonElement>('[data-testid="composer-connect-harness"][data-harness="codex"]')!.click());
            expect(command()).toBe('npx -y @ankoh/dashql-cli connect --launch codex --port 51234 --secret k3x9');
            await act(async () => container.querySelector<HTMLButtonElement>('[data-testid="composer-connect-copy"]')!.click());
            expect(writeText).toHaveBeenCalledWith('npx -y @ankoh/dashql-cli connect --launch codex --port 51234 --secret k3x9');
            act(() => container.querySelector<HTMLButtonElement>('[data-testid="composer-connect-renew"]')!.click());
            expect(command()).toBe('npx -y @ankoh/dashql-cli connect --launch codex --port 60001 --secret z7q2');
        });

        it('tells the harness of a connected session and keeps the SQL prompt open with it', async () => {
            const session = { harness: 'codex', folder: '/w', connected: true, turns: [], logins: [], onDismiss: vi.fn(), onShowScript: vi.fn() };
            const editor = await renderConnected(ComposerMode.Ai, session);
            expect(container.querySelector('[data-testid="composer-connect-status"]')!.textContent).toBe('Codex works on this workbook in the terminal');
            act(() => mode('sql').click());
            expect(editor.state.readOnly).toBe(false);
            act(() => type(editor, 'select 2'));
            act(() => press(editor, 'Enter'));
            expect(onSend).toHaveBeenCalledWith('select 2');
        });

        it('opens the login that a run of the agent waits for with a click', async () => {
            const url = 'https://idp.example/authorize?client_id=dashql&state=s1';
            const logins = [{ connectionId: 'c1', name: 'Trino prod', url }];
            const session = { harness: 'claude', folder: '/w', connected: true, turns: [], logins, onDismiss: vi.fn(), onShowScript: vi.fn() };
            const open = vi.spyOn(window, 'open').mockReturnValue(null);
            try {
                await renderConnected(ComposerMode.Ai, session);
                const login = container.querySelector('[data-testid="composer-connect-login"]')!;
                expect(login.textContent).toContain('The agent waits for a login to Trino prod');
                act(() => login.querySelector<HTMLButtonElement>('[data-testid="composer-connect-login-open"]')!.click());
                expect(open).toHaveBeenCalledWith(url, '_blank', 'popup');
            } finally {
                open.mockRestore();
            }
        });

        it('shows the connections of the agent in place of the connection picker in AI', async () => {
            await renderConnected(ComposerMode.Ai, undefined, true);
            expect(container.querySelector('[data-testid="agent-picker"]')).not.toBeNull();
            expect(container.querySelector('[data-testid="sql-picker"]')).toBeNull();
            act(() => mode('sql').click());
            expect(container.querySelector('[data-testid="agent-picker"]')).toBeNull();
            expect(container.querySelector('[data-testid="sql-picker"]')).not.toBeNull();
        });

        it('has no switch without the connect state', async () => {
            await render();
            expect(container.querySelector('[data-testid="composer-mode"]')).toBeNull();
        });
    });
});
