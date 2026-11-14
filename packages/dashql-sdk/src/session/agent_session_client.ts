import type { AgentSessionState } from './agent_session_state.js';

/// Where a page finds the server of a session: `dashql session serve` on this machine
export interface AgentSessionTarget {
    /// The base URL of the server, http on a loopback address
    endpoint: string;
    /// The token of the server
    token: string;
}

/// Hosts of this machine
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/// The target of a link to a session, null unless it names a server on this machine and a token
export function parseAgentSessionTarget(endpoint: unknown, token: unknown): AgentSessionTarget | null {
    if (typeof endpoint !== 'string' || typeof token !== 'string' || token.length === 0) return null;
    let url: URL;
    try {
        url = new URL(endpoint);
    } catch {
        return null;
    }
    if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) return null;
    return { endpoint: url.origin, token };
}

/// The URL of the stream of the states of a session
export function agentSessionStreamUrl(target: AgentSessionTarget): string {
    const url = new URL('/v1/stream', target.endpoint);
    url.searchParams.set('token', target.token);
    return url.toString();
}

/// Follow a session: the server sends its state with every event as server-sent events. Resolves when the server
/// ends the stream, rejects when it cannot be reached or the signal aborts.
export async function followAgentSession(
    target: AgentSessionTarget,
    onState: (state: AgentSessionState) => void,
    signal: AbortSignal,
): Promise<void> {
    const response = await fetch(agentSessionStreamUrl(target), { signal, headers: { Accept: 'text/event-stream' } });
    if (!response.ok || response.body == null) throw new Error(`the session answered with ${response.status}`);
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffered = '';
    while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        buffered += value;
        // An event ends with an empty line, its data lines carry the state
        let end: number;
        while ((end = buffered.indexOf('\n\n')) >= 0) {
            const block = buffered.slice(0, end);
            buffered = buffered.slice(end + 2);
            const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (data.length > 0) onState(JSON.parse(data) as AgentSessionState);
        }
    }
}
