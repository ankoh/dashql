import {
    AGENT_SESSION_MIN_PROTOCOL,
    AGENT_SESSION_PROTOCOL,
    AgentSessionProtocolError,
    fetchAgentSession,
    outdatedAgentSessionSide,
    parseAgentSessionProtocol,
    serverAcceptsAgentSessionClient,
} from './agent_session_protocol.js';

/// An answer of a server that names the protocols
function answer(protocol: number | null, minProtocol: number | null, status = 200): Response {
    const headers = new Headers();
    if (protocol != null) headers.set('X-DashQL-Protocol', String(protocol));
    if (minProtocol != null) headers.set('X-DashQL-Min-Protocol', String(minProtocol));
    return new Response(null, { status, headers });
}

describe('the protocol of an agent session', () => {
    it('reads a protocol from a header', () => {
        expect(parseAgentSessionProtocol('3')).toBe(3);
        expect(parseAgentSessionProtocol(' 3 ')).toBe(3);
        expect(parseAgentSessionProtocol(null)).toBeNull();
        expect(parseAgentSessionProtocol(undefined)).toBeNull();
        expect(parseAgentSessionProtocol('')).toBeNull();
        expect(parseAgentSessionProtocol('1.2')).toBeNull();
        expect(parseAgentSessionProtocol('-1')).toBeNull();
        expect(parseAgentSessionProtocol(['1', '2'])).toBeNull();
    });

    it('answers a client of the oldest protocol of the server or newer', () => {
        expect(serverAcceptsAgentSessionClient(AGENT_SESSION_PROTOCOL)).toBe(true);
        expect(serverAcceptsAgentSessionClient(AGENT_SESSION_MIN_PROTOCOL)).toBe(true);
        expect(serverAcceptsAgentSessionClient(AGENT_SESSION_PROTOCOL + 1)).toBe(true);
        expect(serverAcceptsAgentSessionClient(AGENT_SESSION_MIN_PROTOCOL - 1)).toBe(false);
        expect(serverAcceptsAgentSessionClient(null)).toBe(false);
    });

    it('tells the side that is too old', () => {
        expect(outdatedAgentSessionSide(AGENT_SESSION_PROTOCOL, AGENT_SESSION_MIN_PROTOCOL)).toBeNull();
        // A newer server that still answers this client
        expect(outdatedAgentSessionSide(AGENT_SESSION_PROTOCOL + 1, AGENT_SESSION_PROTOCOL)).toBeNull();
        // A newer server that no longer does
        expect(outdatedAgentSessionSide(AGENT_SESSION_PROTOCOL + 1, AGENT_SESSION_PROTOCOL + 1)).toBe('client');
        // A server older than the oldest one that this client talks to, or one that names no protocol
        expect(outdatedAgentSessionSide(AGENT_SESSION_MIN_PROTOCOL - 1, 0)).toBe('server');
        expect(outdatedAgentSessionSide(null, null)).toBe('server');
        expect(outdatedAgentSessionSide(AGENT_SESSION_PROTOCOL, null)).toBe('server');
    });

    it('sends the protocol of the client and checks the answer', async () => {
        const sent: Headers[] = [];
        const sendAnswer = (response: Response) => async (_input: URL | Request | string, init?: RequestInit) => {
            sent.push(new Headers(init?.headers));
            return response;
        };
        const ok = await fetchAgentSession('http://127.0.0.1:1/v1/state', { headers: { Authorization: 'Bearer t' } }, sendAnswer(answer(AGENT_SESSION_PROTOCOL, AGENT_SESSION_MIN_PROTOCOL)) as typeof fetch);
        expect(ok.status).toBe(200);
        expect(sent[0].get('X-DashQL-Protocol')).toBe(String(AGENT_SESSION_PROTOCOL));
        expect(sent[0].get('Authorization')).toBe('Bearer t');
        // An error of a server of the protocol is an answer like any other
        expect((await fetchAgentSession('http://127.0.0.1:1/v1/state', {}, sendAnswer(answer(AGENT_SESSION_PROTOCOL, AGENT_SESSION_MIN_PROTOCOL, 401)) as typeof fetch)).status).toBe(401);

        const outdated = async (response: Response) => {
            try {
                await fetchAgentSession('http://127.0.0.1:1/v1/state', {}, sendAnswer(response) as typeof fetch);
            } catch (error) {
                return error instanceof AgentSessionProtocolError ? error.outdated : error;
            }
            return null;
        };
        expect(await outdated(answer(null, null))).toBe('server');
        expect(await outdated(answer(AGENT_SESSION_PROTOCOL + 1, AGENT_SESSION_PROTOCOL + 1, 426))).toBe('client');
    });
});
