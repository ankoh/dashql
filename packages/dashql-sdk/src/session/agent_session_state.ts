/// The events of a harness that its hooks send to `dashql session serve`, docs/wip/agent_session.md
export type AgentSessionEventName = 'SessionStart' | 'UserPromptSubmit' | 'PostToolUse' | 'Stop' | 'SessionEnd';

/// An event of a session, as the hook command of dashql reads it from the harness
export interface AgentSessionEvent {
    event: AgentSessionEventName;
    /// The harness, e.g. claude or codex
    harness: string;
    /// The folder that the agent works in
    folder: string;
    /// The question of UserPromptSubmit
    prompt?: string | null;
    /// What a tool of PostToolUse did, in one line
    status?: string | null;
    /// The files that a tool of PostToolUse read or wrote, as the tool named them
    files?: string[];
    /// The final message of Stop
    message?: string | null;
    /// The error of a failed turn
    error?: string | null;
}

/// A question of the session and what the agent did for it
export interface AgentSessionTurn {
    turnId: number;
    /// The question, empty when the harness did not tell it
    question: string;
    /// The latest status line while the agent works, null once it stopped
    status: string | null;
    error: string | null;
    /// The final message of the agent
    note: string | null;
    /// The files that the tools touched, in the order of their first touch
    files: string[];
}

/// The state of a session that the server keeps and the page follows
export interface AgentSessionState {
    harness: string;
    folder: string;
    /// Did the harness end the session?
    ended: boolean;
    /// The turns, oldest first
    turns: AgentSessionTurn[];
    /// Counts the events, a page tells a new state by it
    version: number;
}

/// The turns that a session keeps, the oldest go first
export const MAX_AGENT_SESSION_TURNS = 50;

export function createAgentSessionState(harness: string, folder: string): AgentSessionState {
    return { harness, folder, ended: false, turns: [], version: 0 };
}

/// A turn of a question
function newTurn(state: AgentSessionState, question: string): AgentSessionTurn {
    const last = state.turns[state.turns.length - 1];
    return { turnId: (last?.turnId ?? 0) + 1, question, status: 'working', error: null, note: null, files: [] };
}

/// Apply an event to the state of a session
export function reduceAgentSessionEvent(state: AgentSessionState, event: AgentSessionEvent): AgentSessionState {
    let turns = state.turns;
    const last = turns[turns.length - 1];
    const open = last != null && last.status != null ? last : null;
    switch (event.event) {
        case 'SessionStart':
            break;
        case 'UserPromptSubmit':
            turns = [...turns, newTurn(state, event.prompt ?? '')];
            break;
        case 'PostToolUse': {
            // A harness that tells no question still shows what its agent does
            const turn = open ?? newTurn(state, '');
            const files = [...turn.files];
            for (const file of event.files ?? []) if (!files.includes(file)) files.push(file);
            const next = { ...turn, status: event.status ?? turn.status, files };
            turns = open != null ? [...turns.slice(0, -1), next] : [...turns, next];
            break;
        }
        case 'Stop':
            if (open != null) {
                turns = [...turns.slice(0, -1), { ...open, status: null, note: event.message ?? null, error: event.error ?? null }];
            }
            break;
        case 'SessionEnd':
            if (open != null) turns = [...turns.slice(0, -1), { ...open, status: null }];
            break;
    }
    return {
        harness: event.harness || state.harness,
        folder: event.folder || state.folder,
        ended: event.event === 'SessionEnd' ? true : event.event === 'SessionStart' ? false : state.ended,
        turns: turns.slice(-MAX_AGENT_SESSION_TURNS),
        version: state.version + 1,
    };
}
