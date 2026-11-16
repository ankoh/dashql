import http from 'node:http';

import { followAgentSession, parseAgentSessionTarget } from '../session/agent_session_client.js';
import { createAgentSessionState, type AgentSessionState } from '../session/agent_session_state.js';

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
            response.writeHead(200, { 'Content-Type': 'text/event-stream' });
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
});
