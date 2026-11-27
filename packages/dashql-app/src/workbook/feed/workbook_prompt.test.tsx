import * as React from 'react';
import { act, waitForRender } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { fakeScript } from '@akohn/dashql-react/testing/fake_models';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import type { ModifyWorkbookScripts, ScriptDataMap, WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import type { EditorView } from '@codemirror/view';
import { WorkbookConnectionAttentionContext } from '../connections/workbook_connection_attention.js';
import { LoggerProvider } from '../../host/logger_provider.js';
import { WorkbookComposerVariant, type WorkbookComposerProps } from './workbook_composer.js';
import { WorkbookPrompt, WorkbookPromptPlacement, type WorkbookPromptDependencies, type WorkbookPromptFeed, type WorkbookPromptHandle } from './workbook_prompt.js';
import type { AgentSession, AgentSessionArgs, AgentTurn } from '../../agent/agent_session.js';
import { ComposerMode, type AgentControls } from '../../agent/agent_provider.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });

type Attention = NonNullable<React.ContextType<typeof WorkbookConnectionAttentionContext>>;

describe('Workbook prompt', () => {
    const promptState = {
        keyHandlers: [] as Parameters<WorkbookPromptDependencies['useKeyEvents']>[0],
        composerProps: null as WorkbookComposerProps | null,
        /// The props of the bar of Wobble, null while the prompt shows none
        barProps: null as React.ComponentProps<WorkbookPromptDependencies['WorkbookStatusBar']> | null,
        /// The bar that rendered the props last
        barOwner: null as object | null,
        runScript: vi.fn(),
        /// The workbook that the runtime holds after an action
        next: null as (WorkbookScripts & { scripts: ScriptDataMap }) | null,
        /// The conversation of the agent that the prompt gets, and what the prompt gave it
        session: null as AgentSession | null,
        agent: null as AgentControls | null,
        sessionArgs: null as AgentSessionArgs | null,
        submit: vi.fn(),
        view: null as ReturnType<typeof fakeView> | null,
    };
    const promptDependencies: WorkbookPromptDependencies = {
        usePickPendingConnection: () => vi.fn(),
        useKeyEvents: handlers => { promptState.keyHandlers = handlers; },
        useScriptRun: () => promptState.runScript,
        useLiveScriptReader: () => (key: number) => promptState.next?.scripts[key] ?? null,
        useComposerCore: () => ({ instance: {}, catalog: {}, tableParameters: { attach: () => false }, connectorType: ConnectorType.HYPER }) as unknown as ReturnType<WorkbookPromptDependencies['useComposerCore']>,
        useAgentSession: (args: AgentSessionArgs) => { promptState.sessionArgs = args; return promptState.session; },
        useAgentControls: () => promptState.agent,
        WorkbookComposer: (props: WorkbookComposerProps) => {
            promptState.composerProps = props;
            if (props.submitRef) props.submitRef.current = promptState.submit;
            const { setView } = props;
            // The composer reads the text, the focus and the dispatch of the view
            React.useEffect(() => setView?.(promptState.view as unknown as EditorView | null), [setView]);
            return <div data-testid="composer">{props.bar}</div>;
        },
        WorkbookStatusBar: (props) => {
            // A new composer mounts its bar before the old one unmounts, only the latest bar clears the props
            const owner = React.useRef({});
            promptState.barProps = props;
            promptState.barOwner = owner.current;
            React.useEffect(() => () => {
                if (promptState.barOwner === owner.current) promptState.barProps = null;
            }, []);
            return <div data-testid="workbook-status-bar" />;
        },
    };
    const onlineConn = {
        connectionId: 'database', connectionHealth: ConnectionHealth.ONLINE,
        connectorType: ConnectorType.HYPER, label: { name: 'Hyper', connector: 'Hyper', detail: 'Wasm', text: 'Hyper Wasm' },
        details: { setupParams: null, channel: null, connector: { kind: 'hyper' } },
    } as unknown as ConnectionState;

    /// A workbook of scripts on the connection `database`, with its scripts by key
    function workbook(fileNames: string[] = []): WorkbookScripts & { scripts: ScriptDataMap } {
        const scripts: ScriptDataMap = {};
        const scriptRefs: WorkbookScripts['scriptRefs'] = {};
        fileNames.forEach((fileName, i) => {
            scripts[i + 1] = fakeScript(i + 1, fileName);
            scriptRefs[fileName] = { scriptId: i + 1, fileName };
        });
        return {
            workbookId: 'workbook', name: null, workbookMetadata: {}, pendingConnectionId: 'database', nextScriptConnectionId: 'database',
            scriptKeys: fileNames.map((_, i) => i + 1), scriptConnections: fileNames.map(() => 'database'), connectionIds: ['database'],
            scripts, scriptRefs, scriptOrder: [...fileNames],
        } as unknown as WorkbookScripts & { scripts: ScriptDataMap };
    }
    const APPLIED = { ok: true, changed: true, error: null, id: null };

    /// The editor of the composer with its text and focus
    function fakeView(text: string, hasFocus = true) {
        return {
            hasFocus,
            state: { doc: { toString: () => text, length: text.length } },
            dispatch: vi.fn(),
            focus: vi.fn(),
        };
    }

    /// The conversation of Claude Code with its questions
    function agentSession(turns: AgentTurn[] = []): AgentSession {
        return { workbookId: 'workbook', harness: 'claude', turns, onReset: vi.fn(), onShowScript: vi.fn(), onStop: vi.fn() };
    }
    /// A question that the agent works on
    const question = (turnId: number, status: string | null = 'Edit scripts/1_alpha.sql'): AgentTurn => ({
        turnId, question: 'how many rows', status, interrupted: false, error: null, note: null, files: [], steps: [], scripts: [],
    });

    let container: HTMLDivElement;
    let root: Root;
    let attention: Attention & { request: Mock<Attention['request']> };
    let feed: { [K in keyof WorkbookPromptFeed]: Mock<WorkbookPromptFeed[K]> };
    let handle: React.RefObject<WorkbookPromptHandle | null>;
    beforeEach(() => {
        promptState.keyHandlers = [];
        promptState.composerProps = null;
        promptState.barProps = null;
        promptState.runScript.mockReset();
        promptState.submit.mockReset();
        promptState.session = null;
        promptState.agent = null;
        promptState.sessionArgs = null;
        promptState.next = null;
        promptState.view = fakeView('');
        attention = { active: false, request: vi.fn<Attention['request']>() };
        feed = { follow: vi.fn(), show: vi.fn(), followAgent: vi.fn(), appended: vi.fn() };
        handle = React.createRef<WorkbookPromptHandle>();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => { act(() => root.unmount()); container.remove(); });

    function render(workbookScripts: WorkbookScripts & { scripts: ScriptDataMap }, modifyWorkbookScripts: ModifyWorkbookScripts = vi.fn(),
        conn: ConnectionState | null = onlineConn, placement = WorkbookPromptPlacement.Feed,
        expanded = placement === WorkbookPromptPlacement.Feed, onExpandedChange?: (expanded: boolean) => void) {
        act(() => root.render(<LoggerProvider>
            <WorkbookConnectionAttentionContext.Provider value={attention}>
                <WorkbookPrompt workbookScripts={workbookScripts} modifyWorkbookScripts={modifyWorkbookScripts} conn={conn}
                    scriptConnections={new Map(conn == null ? [] : [[conn.connectionId, conn]])} placement={placement} expanded={expanded} onExpandedChange={onExpandedChange} feed={feed} handleRef={handle}
                    dependencies={promptDependencies} />
            </WorkbookConnectionAttentionContext.Provider>
        </LoggerProvider>));
    }
    const greeting = () => container.querySelector('[data-testid="feed-landing-question"]');
    const layer = () => container.querySelector<HTMLElement>('[data-testid="workbook-prompt"]')!;

    it('greets an empty workbook with the hero composer', () => {
        render(workbook());
        expect(greeting()).not.toBeNull();
        expect(promptState.composerProps?.variant).toBe(WorkbookComposerVariant.Hero);
    });

    it('docks the composer below the scripts of a workbook', () => {
        render(workbook(['1_alpha.sql']));
        expect(greeting()).toBeNull();
        expect(promptState.composerProps?.variant).toBe(WorkbookComposerVariant.Docked);
    });

    it('shrinks the composer to the bar of Wobble over another view of the workbook', () => {
        render(workbook(), vi.fn(), onlineConn, WorkbookPromptPlacement.Overlay);
        // The empty workbook docks its composer under the other view, Wobble stays awake in the bar
        expect(layer().dataset.placement).toBe('overlay');
        expect(greeting()).toBeNull();
        expect(promptState.composerProps).toMatchObject({ variant: WorkbookComposerVariant.Docked, collapsed: true });
        expect(promptState.barProps).toMatchObject({ wobble: true, paused: false });

        render(workbook());
        expect(layer().dataset.placement).toBe('feed');
        expect(promptState.composerProps).toMatchObject({ variant: WorkbookComposerVariant.Hero, collapsed: false });

        // Behind an overview the prompt keeps its draft, Wobble rests
        render(workbook(['1_alpha.sql']), vi.fn(), onlineConn, WorkbookPromptPlacement.Hidden);
        expect(layer().dataset.placement).toBe('hidden');
        expect(promptState.barProps).toMatchObject({ paused: true });
    });

    it('shows and hides the composer on a click on the bar of Wobble, in every view', async () => {
        const onExpandedChange = vi.fn();
        // Over another view the composer grows out of the bar and takes the focus
        promptState.view = fakeView('', false);
        render(workbook(['1_alpha.sql']), vi.fn(), onlineConn, WorkbookPromptPlacement.Overlay, false, onExpandedChange);
        expect(promptState.composerProps?.collapsed).toBe(true);
        expect(promptState.barProps?.prompt?.expanded).toBe(false);
        act(() => promptState.barProps!.prompt!.onToggle());
        expect(onExpandedChange).toHaveBeenCalledExactlyOnceWith(true);
        render(workbook(['1_alpha.sql']), vi.fn(), onlineConn, WorkbookPromptPlacement.Overlay, true, onExpandedChange);
        expect(promptState.composerProps).toMatchObject({ variant: WorkbookComposerVariant.Docked, collapsed: false });
        expect(promptState.view.focus).toHaveBeenCalledOnce();

        // The composer over another view sends its draft on Ctrl+E like over the feed
        promptState.view.hasFocus = true;
        const handler = promptState.keyHandlers.find(h => h.key === 'e' && h.ctrlKey && h.capture)!;
        await act(async () => handler.callback({ preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as KeyboardEvent));
        expect(promptState.submit).toHaveBeenCalledOnce();

        // Over the feed it shrinks into the bar, it keeps no focus to give
        render(workbook(['1_alpha.sql']), vi.fn(), onlineConn, WorkbookPromptPlacement.Feed, true, onExpandedChange);
        expect(promptState.barProps?.prompt?.expanded).toBe(true);
        act(() => promptState.barProps!.prompt!.onToggle());
        expect(onExpandedChange).toHaveBeenLastCalledWith(false);
        render(workbook(['1_alpha.sql']), vi.fn(), onlineConn, WorkbookPromptPlacement.Feed, false, onExpandedChange);
        expect(promptState.composerProps?.collapsed).toBe(true);
        expect(promptState.view.focus).toHaveBeenCalledOnce();
        // A shrunk composer sends nothing on Ctrl+E, the key runs the selected script
        const shrunkHandler = promptState.keyHandlers.find(h => h.key === 'e' && h.ctrlKey && h.capture)!;
        await act(async () => shrunkHandler.callback({ preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as KeyboardEvent));
        expect(promptState.submit).toHaveBeenCalledOnce();

        // The greeting of an empty workbook always shows the composer, its bar takes no click
        render(workbook(), vi.fn(), onlineConn, WorkbookPromptPlacement.Feed, false, onExpandedChange);
        expect(promptState.composerProps).toMatchObject({ variant: WorkbookComposerVariant.Hero, collapsed: false });
        expect(promptState.barProps?.prompt).toBeUndefined();
    });

    it('appends a sent draft as a script, runs it and has the feed show it', async () => {
        const next = workbook(['1_alpha.sql']);
        promptState.next = next;
        const modify = vi.fn(() => ({ ...APPLIED, id: 1 }));
        render(workbook(), modify);
        await act(async () => promptState.composerProps!.onSend('select 1'));
        expect(modify).toHaveBeenCalledExactlyOnceWith({ kind: 'createScript', value: expect.objectContaining({ text: 'select 1' }) });
        expect(feed.appended).toHaveBeenCalledExactlyOnceWith(1);
        await vi.waitFor(() => expect(promptState.runScript).toHaveBeenCalledOnce());
        expect(promptState.runScript).toHaveBeenCalledExactlyOnceWith(next.workbookId, next.scripts[1].scriptKey);
        expect(attention.request).not.toHaveBeenCalled();
    });

    it('keeps the composer draft while the connection of the next script is not connected', () => {
        render(workbook());
        expect(promptState.composerProps?.offlineWorkbookId).toBeNull();
        render(workbook(), vi.fn(), { ...onlineConn, connectionHealth: ConnectionHealth.NOT_STARTED });
        expect(promptState.composerProps?.offlineWorkbookId).toBe('workbook');
    });

    it('only creates the script without a healthy connection', async () => {
        promptState.next = workbook(['1_alpha.sql']);
        const modify = vi.fn(() => ({ ...APPLIED, id: 1 }));
        render(workbook(), modify, null);
        await act(async () => promptState.composerProps!.onSend('select 1'));
        expect(modify).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(attention.request).toHaveBeenCalledExactlyOnceWith());
        expect(promptState.runScript).not.toHaveBeenCalled();
    });

    it('sends the draft on Ctrl+E only while the composer has focus', async () => {
        promptState.view = fakeView('select 2', false);
        render(workbook(['1_alpha.sql']));
        const handler = promptState.keyHandlers.find(h => h.key === 'e' && h.ctrlKey && h.capture)!;
        const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
        handler.callback(event as unknown as KeyboardEvent);
        expect(event.stopPropagation).not.toHaveBeenCalled();
        expect(promptState.submit).not.toHaveBeenCalled();

        promptState.view!.hasFocus = true;
        await act(async () => handler.callback(event as unknown as KeyboardEvent));
        expect(event.stopPropagation).toHaveBeenCalledOnce();
        expect(promptState.submit).toHaveBeenCalledOnce();
    });

    it('gives the feed the editor of the composer and the mentions of its scripts', () => {
        render(workbook(['1_alpha.sql']));
        expect(handle.current?.view).toBe(promptState.view);
        const target = vi.fn();
        promptState.composerProps!.targetScriptRef!.current = target;
        handle.current!.mention('alpha');
        expect(target).toHaveBeenCalledExactlyOnceWith('alpha');
    });

    it('passes the conversation of the agent to the bar and closes the greeting', async () => {
        render(workbook());
        expect(promptState.barProps).toMatchObject({ workbookId: 'workbook', variant: 'prompt', session: null });
        expect(promptState.composerProps?.session).toBeNull();

        // An empty workbook greets until the agent works on a question, then the composer docks
        promptState.session = agentSession();
        render(workbook());
        expect(greeting()).not.toBeNull();
        expect(promptState.composerProps?.session).toBe(promptState.session);
        promptState.session = agentSession([question(1)]);
        render(workbook());
        expect(greeting()).toBeNull();
        expect(promptState.composerProps?.variant).toBe(WorkbookComposerVariant.Docked);
        expect(promptState.composerProps?.agentActivity).toBe('thinking');
        expect(promptState.barProps?.session).toBe(promptState.session);
    });

    it('has the feed follow the agent for every new question and show the scripts the user picks', () => {
        promptState.session = agentSession([question(1)]);
        render(workbook(['1_alpha.sql']));
        expect(feed.followAgent).toHaveBeenCalledOnce();
        render(workbook(['1_alpha.sql']));
        expect(feed.followAgent).toHaveBeenCalledOnce();
        promptState.session = agentSession([question(1, null), question(2)]);
        render(workbook(['1_alpha.sql']));
        expect(feed.followAgent).toHaveBeenCalledTimes(2);

        // The session follows and shows the scripts in the feed
        expect(promptState.sessionArgs).toMatchObject({ followScript: feed.follow, showScript: feed.show });
    });

    it('greets an empty workbook again once the prompt switches back to SQL', () => {
        promptState.session = agentSession([question(1, null)]);
        promptState.agent = { mode: ComposerMode.Ai } as AgentControls;
        render(workbook());
        expect(greeting()).toBeNull();
        expect(promptState.composerProps?.variant).toBe(WorkbookComposerVariant.Docked);

        // The bar still shows the questions
        promptState.agent = { mode: ComposerMode.Sql } as AgentControls;
        render(workbook());
        expect(greeting()).not.toBeNull();
        expect(promptState.composerProps?.variant).toBe(WorkbookComposerVariant.Hero);
        expect(promptState.barProps?.session).toBe(promptState.session);
    });

    it('shows the conversation above the editor until the user hides it, a new question shows it again', async () => {
        const setMode = vi.fn();
        promptState.agent = { mode: ComposerMode.Ai, setMode } as unknown as AgentControls;
        const onExpandedChange = vi.fn();
        promptState.session = agentSession([question(1, null)]);
        render(workbook(['1_alpha.sql']), vi.fn(), onlineConn, WorkbookPromptPlacement.Feed, true, onExpandedChange);
        const conversation = () => promptState.composerProps?.conversation as React.ReactElement<{ session: AgentSession; onHide: () => void }> | undefined;
        expect(conversation()?.props.session).toBe(promptState.session);
        act(() => conversation()!.props.onHide());
        expect(conversation()).toBeUndefined();
        // The agent at the right end of the bar shows it again, in AI
        act(() => promptState.barProps!.onShowAgent!());
        expect(setMode).toHaveBeenCalledWith(ComposerMode.Ai);
        expect(conversation()).toBeDefined();
        expect(onExpandedChange).not.toHaveBeenCalled();
        act(() => conversation()!.props.onHide());
        promptState.session = agentSession([question(1, null), question(2)]);
        expect(conversation()).toBeUndefined();
        render(workbook(['1_alpha.sql']), vi.fn(), onlineConn, WorkbookPromptPlacement.Feed, true, onExpandedChange);
        // The effect of the new question shows it, its update renders after the scope of act
        await waitForRender(() => expect(conversation()?.props.session).toBe(promptState.session));
    });

    it('grows the prompt out of the bar to show the conversation', () => {
        promptState.agent = { mode: ComposerMode.Sql, setMode: vi.fn() } as unknown as AgentControls;
        promptState.session = agentSession([question(1, null)]);
        const onExpandedChange = vi.fn();
        render(workbook(['1_alpha.sql']), vi.fn(), onlineConn, WorkbookPromptPlacement.Feed, false, onExpandedChange);
        act(() => promptState.barProps!.onShowAgent!());
        expect(onExpandedChange).toHaveBeenCalledExactlyOnceWith(true);
    });

        it('asks the agent with the dialect of the next script and the names of the scripts', () => {
        const ask = vi.fn();
        promptState.agent = { mode: ComposerMode.Ai, ask } as unknown as AgentControls;
        render(workbook(['1_alpha.sql']));
        promptState.composerProps!.onAsk!('how many rows has :1_alpha');
        expect(ask).toHaveBeenCalledExactlyOnceWith({
            workbookId: 'workbook',
            question: 'how many rows has :1_alpha',
            dialect: expect.stringContaining('Hyper'),
            scriptNames: ['1_alpha'],
        });
    });
});
