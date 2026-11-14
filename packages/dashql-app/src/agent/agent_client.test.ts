import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentClient, AgentCommandError, AgentConnectionStatus, type AgentSocket } from './agent_client.js';
import { AGENT_FEATURES, AGENT_PROTOCOL_VERSION, type AgentCommandParams, type AgentCommandResult } from './agent_protocol.js';
import { TestLogger } from '@ankoh/dashql-sdk/testing/test_logger';
import { LogLevel, type LogRecord } from '@ankoh/dashql-sdk/platform/logger/log_buffer';

/// Run the pending promise callbacks, the commands answer asynchronously
async function flush() {
    for (let i = 0; i < 10; ++i) await Promise.resolve();
}

class FakeSocket implements AgentSocket {
    readyState = 0;
    sent: any[] = [];
    closed = false;
    onopen: ((event: unknown) => void) | null = null;
    onclose: ((event: unknown) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    constructor(readonly url: string) { }
    send(data: string) { this.sent.push(JSON.parse(data)); }
    close() { this.closed = true; this.readyState = 3; }
    open() { this.readyState = 1; this.onopen?.({}); }
    drop(code = 1006, reason = '') { this.readyState = 3; this.onclose?.({ code, reason }); }
    receive(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

describe('AgentClient', () => {
    let sockets: FakeSocket[];
    let statuses: AgentConnectionStatus[];
    let notifications: [string, unknown][];
    let disconnects: string[];
    let handleCommand: ReturnType<typeof vi.fn<(params: AgentCommandParams) => Promise<AgentCommandResult>>>;
    let client: AgentClient;
    let logger: TestLogger;

    /// The log records with a message
    const records = (message: string): LogRecord[] => {
        const found: LogRecord[] = [];
        for (let i = 0; i < logger.buffer.length; ++i) {
            const record = logger.buffer.at(i);
            if (record?.message === message) found.push(record);
        }
        return found;
    };

    beforeEach(() => {
        vi.useFakeTimers();
        sockets = [];
        statuses = [];
        notifications = [];
        disconnects = [];
        handleCommand = vi.fn<(params: AgentCommandParams) => Promise<AgentCommandResult>>(async () => ({ text: 'ok' }));
        logger = new TestLogger();
        client = new AgentClient({
            url: 'ws://127.0.0.1:47100/v1/ws',
            clientKind: 'web',
            logger,
            handleCommand,
            onNotification: ({ method, params }) => notifications.push([method, params]),
            onStatus: status => statuses.push(status),
            onDisconnect: reason => disconnects.push(reason),
            createSocket: url => {
                const socket = new FakeSocket(url);
                sockets.push(socket);
                return socket;
            },
            initialBackoffMs: 100,
            maxBackoffMs: 400,
        });
    });
    afterEach(() => {
        client.dispose();
        vi.useRealTimers();
    });

    it('connects only while a workbook has agent access', async () => {
        client.setWorkbook(null);
        expect(sockets).toHaveLength(0);
        client.setWorkbook({ id: 's1', name: 'Revenue' });
        expect(sockets).toHaveLength(1);
        expect(sockets[0].url).toBe('ws://127.0.0.1:47100/v1/ws');
        sockets[0].open();
        expect(sockets[0].sent).toEqual([{
            id: 1,
            method: 'client/workbooks',
            params: { protocol: AGENT_PROTOCOL_VERSION, client: 'web', workbooks: [{ id: 's1', name: 'Revenue' }], focused: 's1', features: AGENT_FEATURES },
        }]);
        // Connected once the server took the workbooks
        expect(client.status).toBe(AgentConnectionStatus.Connecting);
        sockets[0].receive({ id: 1, result: {} });
        await flush();
        expect(client.status).toBe(AgentConnectionStatus.Connected);

        // Another workbook replaces the first one
        client.setWorkbook({ id: 's2', name: 'Costs' });
        expect(sockets[0].sent[1].params).toMatchObject({ workbooks: [{ id: 's2', name: 'Costs' }], focused: 's2' });

        client.setWorkbook(null);
        expect(sockets[0].closed).toBe(true);
        expect(client.status).toBe(AgentConnectionStatus.Off);
        expect(statuses).toEqual([AgentConnectionStatus.Connecting, AgentConnectionStatus.Connected, AgentConnectionStatus.Off]);
        expect(disconnects).toEqual(['Agent access was turned off']);
    });

    it('stays connected without workbooks while held', () => {
        client.setHeld(true);
        expect(sockets).toHaveLength(1);
        sockets[0].open();
        expect(sockets[0].sent[0].params.workbooks).toEqual([]);
        client.setWorkbook({ id: 's1', name: '' });
        client.setWorkbook(null);
        expect(sockets[0].sent[sockets[0].sent.length - 1].params).toMatchObject({ workbooks: [], focused: null });
        expect(sockets[0].closed).toBe(false);
        client.setHeld(false);
        expect(sockets[0].closed).toBe(true);
    });

    it('reconnects with backoff and announces the workbooks again', async () => {
        client.setWorkbook({ id: 's1', name: '' });
        sockets[0].drop();
        expect(client.status).toBe(AgentConnectionStatus.Connecting);
        vi.advanceTimersByTime(99);
        expect(sockets).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(sockets).toHaveLength(2);
        sockets[1].drop();
        vi.advanceTimersByTime(199);
        expect(sockets).toHaveLength(2);
        vi.advanceTimersByTime(1);
        expect(sockets).toHaveLength(3);
        sockets[2].open();
        expect(sockets[2].sent[0].method).toBe('client/workbooks');
        // A connection that the server did not take keeps the backoff
        sockets[2].drop();
        vi.advanceTimersByTime(399);
        expect(sockets).toHaveLength(3);
        vi.advanceTimersByTime(1);
        expect(sockets).toHaveLength(4);
        // A successful connection resets the backoff
        sockets[3].open();
        sockets[3].receive({ id: sockets[3].sent[0].id, result: {} });
        await flush();
        sockets[3].drop();
        expect(disconnects[disconnects.length - 1]).toBe('The agent server disconnected');
        vi.advanceTimersByTime(100);
        expect(sockets).toHaveLength(5);
    });

    it('retries slowly when the server turns the client away', async () => {
        client.setWorkbook({ id: 's1', name: '' });
        sockets[0].open();
        sockets[0].drop(1008, 'protocol version 1 is not supported, expected 2');
        expect(client.status).toBe(AgentConnectionStatus.Incompatible);
        expect(disconnects).toEqual(['The agent server turned DashQL away: protocol version 1 is not supported, expected 2']);
        vi.advanceTimersByTime(399);
        expect(sockets).toHaveLength(1);
        vi.advanceTimersByTime(1);
        expect(sockets).toHaveLength(2);
        // Still incompatible while it connects and until the server takes the workbooks
        expect(client.status).toBe(AgentConnectionStatus.Incompatible);
        sockets[1].open();
        expect(client.status).toBe(AgentConnectionStatus.Incompatible);
        sockets[1].receive({ id: sockets[1].sent[0].id, result: {} });
        await flush();
        expect(client.status).toBe(AgentConnectionStatus.Connected);
    });

    it('answers commands with results and errors', async () => {
        client.setWorkbook({ id: 's1', name: '' });
        sockets[0].open();
        sockets[0].receive({ id: 's1', method: 'command', params: { workbook: 's1', command: 'read', args: { script: 'q' } } });
        await flush();
        expect(sockets[0].sent).toHaveLength(2);
        expect(handleCommand).toHaveBeenCalledExactlyOnceWith({ workbook: 's1', command: 'read', args: { script: 'q' } });
        expect(sockets[0].sent[1]).toEqual({ id: 's1', result: { text: 'ok' } });

        handleCommand.mockRejectedValueOnce(new AgentCommandError('usage', 'missing script'));
        sockets[0].receive({ id: 's2', method: 'command', params: { workbook: 's1', command: 'read', args: {} } });
        await flush();
        expect(sockets[0].sent).toHaveLength(3);
        expect(sockets[0].sent[2]).toEqual({ id: 's2', error: { code: 'usage', message: 'missing script' } });

        handleCommand.mockRejectedValueOnce(new Error('boom'));
        sockets[0].receive({ id: 's3', method: 'command', params: { workbook: 's1', command: 'run', args: {} } });
        await flush();
        expect(sockets[0].sent).toHaveLength(4);
        expect(sockets[0].sent[3]).toEqual({ id: 's3', error: { code: 'failed', message: 'boom' } });
    });

    it('logs commands with their short arguments, the texts at debug level', async () => {
        logger.buffer.setMinLogLevel(LogLevel.Debug);
        client.setWorkbook({ id: 's1', name: '' });
        sockets[0].open();
        handleCommand.mockResolvedValueOnce({ text: 'Updated q: sha256 abc, 0 errors\nq:1:1: warning: w' });
        const text = 'select 1\nfrom t';
        sockets[0].receive({ id: 's1', method: 'command', params: { workbook: 's1', command: 'edit', args: { script: 'q', text } } });
        await flush();
        expect(records('Running a command of the agent').map(r => r.keyValues)).toEqual([
            { id: 's1', command: 'edit', workbookId: 's1', script: 'q', text: '15 characters, 2 lines' },
        ]);
        expect(records('The text of the command').map(r => r.keyValues)).toEqual([{ id: 's1', command: 'edit', text }]);
        expect(records('Finished the command of the agent').map(r => r.keyValues)).toMatchObject([
            { id: 's1', command: 'edit', result: 'Updated q: sha256 abc, 0 errors' },
        ]);
        expect(records('The result of the command')).toHaveLength(1);
        expect(records('Received from the agent server').every(r => r.level === LogLevel.Debug)).toBe(true);

        handleCommand.mockRejectedValueOnce(new AgentCommandError('usage', 'missing script'));
        sockets[0].receive({ id: 's2', method: 'command', params: { workbook: 's1', command: 'read', args: {} } });
        await flush();
        expect(records('The command of the agent failed').map(r => r.keyValues)).toMatchObject([
            { id: 's2', command: 'read', code: 'usage', error: 'missing script' },
        ]);
    });

    it('resolves requests and passes notifications on', async () => {
        client.setWorkbook({ id: 's1', name: '' });
        sockets[0].open();
        const request = client.request('agent/request', { workbook: 's1', prompt: 'hi' });
        const sent = sockets[0].sent[1];
        expect(sent).toEqual({ id: 2, method: 'agent/request', params: { workbook: 's1', prompt: 'hi' } });
        sockets[0].receive({ id: 2, result: { turnId: 't1', harness: 'codex' } });
        await expect(request).resolves.toEqual({ turnId: 't1', harness: 'codex' });

        sockets[0].receive({ method: 'agent/done', params: { workbook: 's1', turnId: 't1', message: 'done' } });
        expect(notifications).toEqual([['agent/done', { workbook: 's1', turnId: 't1', message: 'done' }]]);

        const failing = client.request('agent/request', { workbook: 'x', prompt: 'hi' });
        sockets[0].receive({ id: 3, error: { code: 'usage', message: 'the workbook has no agent access' } });
        await expect(failing).rejects.toThrow('the workbook has no agent access');

        const pending = client.request('agent/cancel', { workbook: 's1' });
        sockets[0].drop();
        await expect(pending).rejects.toThrow('The agent server disconnected');
    });

    it('rejects requests while disconnected', async () => {
        await expect(client.request('agent/cancel', { workbook: 's1' })).rejects.toThrow('The agent server is not connected');
    });
});
