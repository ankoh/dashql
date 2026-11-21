import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { followAgentSession, parseAgentSessionTarget, readWorkbookFolderFiles } from '../session/agent_session_client.js';
import { openNodeRoot } from './node_directory_handle.js';
import { createAgentSessionState, type AgentSessionState } from '../session/agent_session_state.js';
import { AGENT_SESSION_PROTOCOL, AgentSessionProtocolError } from '../session/agent_session_protocol.js';

/// The protocol that a server of the session names on its answers
const PROTOCOL_HEADERS = { 'X-DashQL-Protocol': String(AGENT_SESSION_PROTOCOL) };

describe('the client of an agent session', () => {
    it('takes only servers on this machine with a token', () => {
        expect(parseAgentSessionTarget('http://127.0.0.1:4100/', 't')).toEqual({ endpoint: 'http://127.0.0.1:4100', token: 't' });
        expect(parseAgentSessionTarget('http://localhost:4100', 't')).toEqual({ endpoint: 'http://localhost:4100', token: 't' });
        expect(parseAgentSessionTarget('https://example.com', 't')).toBeNull();
        expect(parseAgentSessionTarget('http://127.0.0.1:4100', '')).toBeNull();
        expect(parseAgentSessionTarget(42, 't')).toBeNull();
    });

    it('reads the states of the stream until the server ends it', async () => {
        const states = [createAgentSessionState('claude', '/a'), { ...createAgentSessionState('claude', '/a'), version: 1 }];
        let token: string | null = null;
        const server = http.createServer((request, response) => {
            token = new URL(request.url ?? '/', 'http://x').searchParams.get('token');
            response.writeHead(200, { 'Content-Type': 'text/event-stream', ...PROTOCOL_HEADERS });
            // A state may arrive in pieces, comments are skipped
            const second = `data: ${JSON.stringify(states[1])}\n\n`;
            response.write(`: alive\n\ndata: ${JSON.stringify(states[0])}\n\n${second.slice(0, 10)}`);
            setTimeout(() => response.end(second.slice(10)), 20);
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const received: AgentSessionState[] = [];
            const target = { endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}`, token: 'secret' };
            await followAgentSession(target, state => received.push(state), new AbortController().signal);
            expect(received).toEqual(states);
            expect(token).toBe('secret');
        } finally {
            server.close();
        }
    });

    it('reads no state of a server that names no protocol', async () => {
        const server = http.createServer((_request, response) => {
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
            response.end(`data: ${JSON.stringify(createAgentSessionState('claude', '/a'))}\n\n`);
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        try {
            const received: AgentSessionState[] = [];
            const target = { endpoint: `http://127.0.0.1:${(server.address() as { port: number }).port}`, token: 'secret' };
            const followed = followAgentSession(target, state => received.push(state), new AbortController().signal);
            await expect(followed).rejects.toBeInstanceOf(AgentSessionProtocolError);
            await expect(followed).rejects.toMatchObject({ outdated: 'server' });
            expect(received).toEqual([]);
        } finally {
            server.close();
        }
    });

    it('reads the files of a workbook folder that a page copies into the session', async () => {
        const folder = mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-copy-'));
        const root = await openNodeRoot(folder);
        // The mirror of the attachments of a native workbook has no workbook file, the page copies nothing
        mkdirSync(path.join(folder, 'attachments'));
        writeFileSync(path.join(folder, 'attachments', 't.parquet'), 'PAR1');
        expect(await readWorkbookFolderFiles(root)).toBeNull();

        writeFileSync(path.join(folder, 'dashql-workbook.json'), '{}');
        mkdirSync(path.join(folder, 'scripts'));
        writeFileSync(path.join(folder, 'scripts', 'b.sql'), 'select 2');
        writeFileSync(path.join(folder, 'scripts', 'a.sql'), 'select 1');
        const files = await readWorkbookFolderFiles(root);
        expect(files?.map(file => file.path)).toEqual(['dashql-workbook.json', 'scripts/a.sql', 'scripts/b.sql', 'attachments/t.parquet']);
        expect(await (files![1].content as Blob).text()).toBe('select 1');
    });
});
