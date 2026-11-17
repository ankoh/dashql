/// The protocol between `dashql session serve` and its clients: the page that follows a session, the hooks of a
/// harness and the runs of `dashql run` in it (docs/wip/agent_session.md#protocol). A client names its protocol on
/// every request, the server names its own and the oldest one of a client that it answers on every answer.
///
/// Raise AGENT_SESSION_PROTOCOL with every change of what goes over the wire: a route, a request, a field of the
/// state, also one that is only added. Raise AGENT_SESSION_MIN_PROTOCOL to the new protocol as well when this side no
/// longer works with a peer of an older one: a route or a field that it needs, a meaning that changed. Both sides read
/// the same two numbers, the server as the oldest client it answers, a client as the oldest server it talks to.
///
/// 1: the routes of `/v1`, the state with turns and their steps, workbooks and log, the runs that the tab runs
export const AGENT_SESSION_PROTOCOL = 1;
/// The oldest protocol of a peer that this side still works with
export const AGENT_SESSION_MIN_PROTOCOL = 1;

/// The protocol of the sender, on every request and every answer
export const AGENT_SESSION_PROTOCOL_HEADER = 'X-DashQL-Protocol';
/// The oldest protocol of a client that the server answers, on every answer
export const AGENT_SESSION_MIN_PROTOCOL_HEADER = 'X-DashQL-Min-Protocol';

/// The side that is too old for the other: the server, `dashql-cli` that runs it, or the client
export type AgentSessionOutdated = 'server' | 'client';

/// A client and the server of a session don't speak with each other
export class AgentSessionProtocolError extends Error {
    constructor(
        /// The side that has to be updated
        readonly outdated: AgentSessionOutdated,
        /// The protocol of the server, null if it names none
        readonly serverProtocol: number | null,
    ) {
        super(outdated === 'server'
            ? `the server of the session speaks protocol ${serverProtocol ?? 'none'}, this client needs ${AGENT_SESSION_MIN_PROTOCOL} or newer: update dashql-cli`
            : `the server of the session speaks protocol ${serverProtocol ?? 'none'} and needs a newer client than protocol ${AGENT_SESSION_PROTOCOL}`);
        this.name = 'AgentSessionProtocolError';
    }
}

/// A protocol in a header, null without a valid one
export function parseAgentSessionProtocol(value: string | readonly string[] | null | undefined): number | null {
    if (typeof value !== 'string' || !/^\s*\d{1,9}\s*$/.test(value)) return null;
    return Number(value);
}

/// Does the server answer a client of a protocol? A client that names none is too old.
export function serverAcceptsAgentSessionClient(clientProtocol: number | null): boolean {
    return clientProtocol != null && clientProtocol >= AGENT_SESSION_MIN_PROTOCOL;
}

/// The side that is too old by the protocols that an answer of a server names, null if client and server speak with
/// each other. A server that names none is older than the protocol.
export function outdatedAgentSessionSide(serverProtocol: number | null, serverMinProtocol: number | null): AgentSessionOutdated | null {
    if (serverProtocol == null || serverMinProtocol == null || serverProtocol < AGENT_SESSION_MIN_PROTOCOL) return 'server';
    if (AGENT_SESSION_PROTOCOL < serverMinProtocol) return 'client';
    return null;
}

/// Check the protocols of an answer of the server of a session, throws an AgentSessionProtocolError if the client and
/// the server don't speak with each other. Any answer of the server names them, also one with an error status.
export function checkAgentSessionAnswer(response: Response): void {
    const serverProtocol = parseAgentSessionProtocol(response.headers.get(AGENT_SESSION_PROTOCOL_HEADER));
    const outdated = outdatedAgentSessionSide(serverProtocol, parseAgentSessionProtocol(response.headers.get(AGENT_SESSION_MIN_PROTOCOL_HEADER)));
    if (outdated != null) throw new AgentSessionProtocolError(outdated, serverProtocol);
}

/// Send a request to the server of a session: it names the protocol of the client, the answer is checked with
/// checkAgentSessionAnswer
export async function fetchAgentSession(input: URL | string, init: RequestInit = {}, send: typeof fetch = fetch): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set(AGENT_SESSION_PROTOCOL_HEADER, String(AGENT_SESSION_PROTOCOL));
    const response = await send(input, { ...init, headers });
    checkAgentSessionAnswer(response);
    return response;
}
