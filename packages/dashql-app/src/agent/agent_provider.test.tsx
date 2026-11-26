import * as React from 'react';
import { act } from '@akohn/dashql-react/testing/react_act';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import * as dashql from '@akohn/dashql';
import { newDefaultHyperWasmConnection } from '@akohn/dashql/platform/connections/connection_params';
import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import type { Runtime } from '@akohn/dashql/runtime/runtime';
import { testRuntime } from '@akohn/dashql/runtime/testing/test_runtime';
import { RuntimeContextProvider } from '@akohn/dashql-react/hooks';
import { LoggerProvider } from '../host/logger_provider.js';
import { AgentProvider, useAgentControls, useAgentSession, type AgentControls } from './agent_provider.js';
import type { AgentSession } from './agent_session.js';
import { createAgentSessionState, reduceAgentSessionEvent } from './agent_session_state.js';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

/// The bridge of the desktop app: the test sends the events and the calls of the main process
class FakeBridge implements DashQLAgentBridge {
    kept: unknown = null;
    events = new Set<(event: { workbookId: string; event: DashQLAgentEvent }) => void>();
    calls = new Set<(call: DashQLAgentCall) => void>();
    replies: DashQLAgentReply[] = [];
    info = vi.fn(async () => ({ harnesses: [{ id: 'claude' as const, available: true }] }));
    ask = vi.fn(async () => { });
    stop = vi.fn(async () => { });
    forget: Mock<DashQLAgentBridge['forget']> = vi.fn(async () => { });
    readConversation: Mock<DashQLAgentBridge['readConversation']> = vi.fn(async () => this.kept);
    writeConversation: Mock<DashQLAgentBridge['writeConversation']> = vi.fn(async () => { });
    writeFile = vi.fn(async () => '');
    onEvent(listener: (event: { workbookId: string; event: DashQLAgentEvent }) => void) {
        this.events.add(listener);
        return () => { this.events.delete(listener); };
    }
    onCall(listener: (call: DashQLAgentCall) => void) {
        this.calls.add(listener);
        return () => { this.calls.delete(listener); };
    }
    onCallCancel() {
        return () => { };
    }
    reply(reply: DashQLAgentReply) {
        this.replies.push(reply);
    }
    emit(workbookId: string, event: DashQLAgentEvent) {
        for (const listener of this.events) listener({ workbookId, event });
    }
    call(call: DashQLAgentCall) {
        for (const listener of this.calls) listener(call);
    }
}

describe('the agents of the desktop app', () => {
    let dql: dashql.DashQL;
    let runtime: Runtime;
    let workbookId: string;
    let container: HTMLDivElement;
    let root: Root;
    let bridge: FakeBridge;
    let session: AgentSession | null;
    let controls: AgentControls | null;

    beforeAll(async () => {
        dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
    });
    beforeEach(() => {
        runtime = testRuntime(dql);
        runtime.createConnection(newDefaultHyperWasmConnection(), 'embedded');
        workbookId = runtime.createWorkbook('embedded', 'Sales', false).workbookId;
        runtime.flush();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        bridge = new FakeBridge();
        session = null;
        controls = null;
    });
    afterEach(async () => {
        act(() => root.unmount());
        container.remove();
        await runtime.destroy();
    });

    /// The prompt of the workbook, it takes the conversation of the agent
    const Prompt: React.FC = () => {
        const workbookScripts = React.useMemo(() => ({ workbookId, scriptRefs: {} }) as unknown as WorkbookScripts, []);
        session = useAgentSession({ workbookScripts, followScript: () => { }, showScript: () => { } });
        controls = useAgentControls();
        return null;
    };
    async function render() {
        act(() => root.render(
            <LoggerProvider>
                <RuntimeContextProvider value={runtime}>
                    <AgentProvider bridge={bridge}><Prompt /></AgentProvider>
                </RuntimeContextProvider>
            </LoggerProvider>,
        ));
        await vi.waitFor(() => expect(bridge.readConversation).toHaveBeenCalledWith(workbookId));
    }
    const ask = (question: string) => act(() => controls!.ask({ workbookId, question, dialect: 'Hyper', scriptNames: [] }));

    it('shows the conversation that it kept and keeps the next question', async () => {
        let kept = createAgentSessionState();
        kept = reduceAgentSessionEvent(kept, { event: 'UserPromptSubmit', prompt: 'how many orders' }, 1000, 'codex');
        kept = reduceAgentSessionEvent(kept, { event: 'Stop', message: 'There are 42 orders' }, 1100);
        bridge.kept = JSON.parse(JSON.stringify(kept));
        await render();
        await vi.waitFor(() => expect(session?.turns).toHaveLength(1));
        expect(session).toMatchObject({ harness: 'codex', turns: [{ turnId: 1, question: 'how many orders', note: 'There are 42 orders' }] });
        // Reading it is no change to keep
        expect(bridge.writeConversation).not.toHaveBeenCalled();

        ask('and per day?');
        act(() => {
            bridge.emit(workbookId, { event: 'Say', text: 'I group them by day.' });
            bridge.emit(workbookId, { event: 'Stop', message: 'Done' });
        });
        expect(session?.turns.map(turn => turn.turnId)).toEqual([1, 2]);
        await vi.waitFor(() => expect(bridge.writeConversation).toHaveBeenCalledOnce());
        const [keptId, file] = bridge.writeConversation.mock.calls[0];
        expect(keptId).toBe(workbookId);
        expect((file as { turns: unknown[] }).turns).toHaveLength(2);
    });

    it('starts a new conversation and forgets the kept one with the sessions of the harnesses', async () => {
        await render();
        ask('q');
        act(() => bridge.emit(workbookId, { event: 'Stop', message: 'a' }));
        expect(session?.turns).toHaveLength(1);
        act(() => session!.onReset());
        expect(session).toBeNull();
        expect(bridge.forget).toHaveBeenCalledExactlyOnceWith(workbookId);
        // The conversation that was forgotten is not kept again
        await new Promise(resolve => setTimeout(resolve, 400));
        expect(bridge.writeConversation).not.toHaveBeenCalled();
    });

    it('tells the dashql commands of the agent as steps of the turn', async () => {
        await render();
        ask('q');
        act(() => bridge.call({ callId: 1, workbookId, command: 'scripts', args: {}, input: null }));
        await vi.waitFor(() => expect(bridge.replies.some(reply => reply.callId === 1 && reply.exit === 0)).toBe(true));
        act(() => bridge.call({ callId: 2, workbookId, command: 'read', args: { script: 'missing' }, input: null }));
        await vi.waitFor(() => expect(bridge.replies.some(reply => reply.callId === 2 && reply.exit != null)).toBe(true));
        const steps = session!.turns[0].steps;
        expect(steps.map(step => [step.label, step.endedAt != null, step.failed])).toEqual([
            ['List the scripts', true, false],
            ['Read missing', true, true],
        ]);
    });

    it('opens the turn when it asks and asks once while the turn runs', async () => {
        await render();
        let refuse: (error: Error) => void = () => { };
        bridge.ask.mockImplementationOnce(() => new Promise<void>((_, reject) => { refuse = reject; }));
        ask('q1');
        expect(session?.turns.map(turn => [turn.question, turn.status])).toEqual([['q1', 'working']]);
        // A second Ask before the harness started is no question
        ask('q2');
        expect(bridge.ask).toHaveBeenCalledOnce();
        // A refused question fails its own turn
        await act(async () => refuse(new Error('Codex is not installed')));
        expect(session?.turns.map(turn => [turn.question, turn.status, turn.error])).toEqual([['q1', null, 'Codex is not installed']]);
    });
});
