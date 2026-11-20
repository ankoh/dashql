import {
    AGENT_SESSION_PROTOCOL,
    AgentSessionProtocolError,
    fetchAgentSession,
    outdatedAgentSessionSide,
    parseAgentSessionProtocol,
} from './agent_session_protocol.js';

/// An answer of a server that names its protocol
function answer(protocol: number | null, status = 200): Response {
    const headers = new Headers();
    if (protocol != null) headers.set('X-DashQL-Protocol', String(protocol));
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

    it('tells the older side when the protocols differ', () => {
        expect(outdatedAgentSessionSide(AGENT_SESSION_PROTOCOL)).toBeNull();
        expect(outdatedAgentSessionSide(AGENT_SESSION_PROTOCOL + 1)).toBe('client');
        expect(outdatedAgentSessionSide(AGENT_SESSION_PROTOCOL - 1)).toBe('server');
        expect(outdatedAgentSessionSide(null)).toBe('server');
    });

    it('sends the protocol of the client and checks the answer', async () => {
        const sent: Headers[] = [];
        const sendAnswer = (response: Response) => async (_input: URL | Request | string, init?: RequestInit) => {
            sent.push(new Headers(init?.headers));
            return response;
        };
        const ok = await fetchAgentSession('http://127.0.0.1:1/v1/state', { headers: { Authorization: 'Bearer t' } }, sendAnswer(answer(AGENT_SESSION_PROTOCOL)) as typeof fetch);
        expect(ok.status).toBe(200);
        expect(sent[0].get('X-DashQL-Protocol')).toBe(String(AGENT_SESSION_PROTOCOL));
        expect(sent[0].get('Authorization')).toBe('Bearer t');
        // An error of a server of the protocol is an answer like any other
        expect((await fetchAgentSession('http://127.0.0.1:1/v1/state', {}, sendAnswer(answer(AGENT_SESSION_PROTOCOL, 401)) as typeof fetch)).status).toBe(401);

        const outdated = async (response: Response) => {
            try {
                await fetchAgentSession('http://127.0.0.1:1/v1/state', {}, sendAnswer(response) as typeof fetch);
            } catch (error) {
                return error instanceof AgentSessionProtocolError ? error.outdated : error;
            }
            return null;
        };
        expect(await outdated(answer(null))).toBe('server');
        expect(await outdated(answer(AGENT_SESSION_PROTOCOL + 1, 426))).toBe('client');
    });
});
