/// The protocol between the server of `dashql connect` and its clients: the page that follows a session, the hooks of a
/// harness and the runs of `dashql run` in it (docs/design/agent_session.md#protocol). Every answer of the server names
/// it and the client checks it, both sides speak exactly one: the line of the tab runs the `dashql-cli` of the build of
/// the page.
///
/// Raise it with every change of what goes over the wire: a route, a request, a field of the state.
///
/// 1: the routes of `/v1`, the state with turns and their steps, workbooks and log, the runs that the tab runs
/// 2: `chart` of a run request, the tab renders the charts of the run and sends them as the event `script_chart`
/// 3: `id` of the state, a new one for every server: the tab copies its workbooks again into a new session on the port
/// 4: no log and no paths of workbooks in the state, the copies of the tab are its workbooks
/// 5: requests name no protocol, only the answers of the server do
export const AGENT_SESSION_PROTOCOL = 5;

/// The protocol of the server, on every answer
export const AGENT_SESSION_PROTOCOL_HEADER = 'X-DashQL-Protocol';

/// The side that is older than the other: the server, `dashql-cli` that runs it, or the client
export type AgentSessionOutdated = 'server' | 'client';

/// A client and the server of a session speak different protocols
export class AgentSessionProtocolError extends Error {
    constructor(
        /// The side that has to be updated
        readonly outdated: AgentSessionOutdated,
        /// The protocol of the server, null if it names none
        readonly serverProtocol: number | null,
    ) {
        super(outdated === 'server'
            ? `the server of the session speaks protocol ${serverProtocol ?? 'none'}, this client ${AGENT_SESSION_PROTOCOL}: update dashql-cli`
            : `the server of the session speaks protocol ${serverProtocol}, this client ${AGENT_SESSION_PROTOCOL}: update the client`);
        this.name = 'AgentSessionProtocolError';
    }
}

/// A protocol in a header, null without a valid one
export function parseAgentSessionProtocol(value: string | readonly string[] | null | undefined): number | null {
    if (typeof value !== 'string' || !/^\s*\d{1,9}\s*$/.test(value)) return null;
    return Number(value);
}

/// The side that is older by the protocol of the other side, null if both speak the same. A side that names none is
/// the older one.
export function outdatedAgentSessionSide(serverProtocol: number | null): AgentSessionOutdated | null {
    if (serverProtocol === AGENT_SESSION_PROTOCOL) return null;
    return serverProtocol == null || serverProtocol < AGENT_SESSION_PROTOCOL ? 'server' : 'client';
}

/// Check the protocol of an answer of the server of a session, throws an AgentSessionProtocolError if the client and
/// the server speak different ones. Any answer of the server names it, also one with an error status.
export function checkAgentSessionAnswer(response: Response): void {
    const serverProtocol = parseAgentSessionProtocol(response.headers.get(AGENT_SESSION_PROTOCOL_HEADER));
    const outdated = outdatedAgentSessionSide(serverProtocol);
    if (outdated != null) throw new AgentSessionProtocolError(outdated, serverProtocol);
}

/// Send a request to the server of a session, the answer is checked with checkAgentSessionAnswer
export async function fetchAgentSession(input: URL | string, init: RequestInit = {}, send: typeof fetch = fetch): Promise<Response> {
    const response = await send(input, init);
    checkAgentSessionAnswer(response);
    return response;
}
