import type { CopyFile, SessionWorkbook } from './session_folder.js';

/// The events of a harness that its hooks send to the server of `dashql connect`, docs/design/agent_session.md
export type AgentSessionEventName = 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'Stop' | 'SessionEnd';

/// An event of a session, as the hook command of dashql reads it from the harness. The server knows the harness and
/// the folder from `dashql connect`.
export interface AgentSessionEvent {
    event: AgentSessionEventName;
    /// The question of UserPromptSubmit
    prompt?: string | null;
    /// What a tool of PreToolUse or PostToolUse does, in one line
    status?: string | null;
    /// The files that a tool of PreToolUse or PostToolUse reads or writes, as the tool named them
    files?: string[];
    /// The id of the use of a tool, PostToolUse names the same as its PreToolUse
    toolUseId?: string | null;
    /// The final message of Stop
    message?: string | null;
    /// The error of a failed tool of PostToolUse
    error?: string | null;
}

/// A use of a tool in a turn: PreToolUse starts it, PostToolUse ends it
export interface AgentSessionStep {
    /// What the tool does, in one line
    label: string;
    /// The id of the use of the tool, null if the harness names none
    toolUseId: string | null;
    /// When the server got PreToolUse, in ms since the epoch
    startedAt: number;
    /// When the server got PostToolUse, null while the tool runs
    endedAt: number | null;
    /// Did the tool fail?
    failed: boolean;
}

/// A question of the session and what the agent did for it
export interface AgentSessionTurn {
    turnId: number;
    /// The question, empty when the harness did not tell it
    question: string;
    /// The latest status line while the agent works, null once it stopped
    status: string | null;
    /// The final message of the agent
    note: string | null;
    /// The files that the tools touched, in the order of their first touch
    files: string[];
    /// The uses of tools, oldest first, the latest MAX_AGENT_SESSION_STEPS
    steps: AgentSessionStep[];
}

/// The state of a session that the server keeps and the page follows
export interface AgentSessionState {
    /// The id that `dashql connect` picks, a new one for every session, so that a page tells a new session on the same
    /// port from the one it followed
    id: string;
    harness: string;
    folder: string;
    /// Did the harness end the session?
    ended: boolean;
    /// The turns, oldest first
    turns: AgentSessionTurn[];
    /// The copies of the workbooks of the tab with the stamps of their files
    workbooks: SessionWorkbook[];
    /// Counts the changes, a page tells a new state by it
    version: number;
}

/// The turns that a session keeps, the oldest go first
export const MAX_AGENT_SESSION_TURNS = 50;
/// The steps that a turn keeps, the oldest go first
export const MAX_AGENT_SESSION_STEPS = 30;

export function createAgentSessionState(harness: string, folder: string, id: string): AgentSessionState {
    return { id, harness, folder, ended: false, turns: [], workbooks: [], version: 0 };
}

/// A turn of a question
function newTurn(state: AgentSessionState, question: string): AgentSessionTurn {
    const last = state.turns[state.turns.length - 1];
    return { turnId: (last?.turnId ?? 0) + 1, question, status: 'working', note: null, files: [], steps: [] };
}

/// The steps of a turn with the open ones ended
function endSteps(steps: readonly AgentSessionStep[], now: number): AgentSessionStep[] {
    return steps.map(step => step.endedAt == null ? { ...step, endedAt: now } : step);
}

/// The index of the open step that a PostToolUse ends: the one of its id, else the oldest one of its label, -1 if none
function openStepOf(steps: readonly AgentSessionStep[], toolUseId: string | null, label: string): number {
    if (toolUseId != null) {
        const index = steps.findIndex(step => step.endedAt == null && step.toolUseId === toolUseId);
        if (index >= 0) return index;
    }
    return steps.findIndex(step => step.endedAt == null && (step.toolUseId == null || toolUseId == null) && step.label === label);
}

/// Apply an event to the state of a session, at the time of the server
export function reduceAgentSessionEvent(state: AgentSessionState, event: AgentSessionEvent, now: number = Date.now()): AgentSessionState {
    let turns = state.turns;
    const last = turns[turns.length - 1];
    const open = last != null && last.status != null ? last : null;
    switch (event.event) {
        case 'SessionStart':
            break;
        case 'UserPromptSubmit':
            turns = [...turns, newTurn(state, event.prompt ?? '')];
            break;
        case 'PreToolUse':
        case 'PostToolUse': {
            // A harness that tells no question still shows what its agent does
            const turn = open ?? newTurn(state, '');
            const files = [...turn.files];
            for (const file of event.files ?? []) if (!files.includes(file)) files.push(file);
            const label = event.status ?? 'tool';
            const toolUseId = event.toolUseId ?? null;
            const steps = [...turn.steps];
            if (event.event === 'PreToolUse') {
                steps.push({ label, toolUseId, startedAt: now, endedAt: null, failed: false });
            } else {
                // A PostToolUse without its PreToolUse, e.g. of hooks without PreToolUse, is a step that ended
                const failed = event.error != null;
                const index = openStepOf(steps, toolUseId, label);
                if (index >= 0) steps[index] = { ...steps[index], endedAt: now, failed };
                else steps.push({ label, toolUseId, startedAt: now, endedAt: now, failed });
            }
            const next = { ...turn, status: event.status ?? turn.status, files, steps: steps.slice(-MAX_AGENT_SESSION_STEPS) };
            turns = open != null ? [...turns.slice(0, -1), next] : [...turns, next];
            break;
        }
        case 'Stop':
            if (open != null) {
                turns = [...turns.slice(0, -1), { ...open, status: null, note: event.message ?? null, steps: endSteps(open.steps, now) }];
            }
            break;
        case 'SessionEnd':
            if (open != null) turns = [...turns.slice(0, -1), { ...open, status: null, steps: endSteps(open.steps, now) }];
            break;
    }
    return {
        ...state,
        ended: event.event === 'SessionEnd' ? true : event.event === 'SessionStart' ? false : state.ended,
        turns: turns.slice(-MAX_AGENT_SESSION_TURNS),
        version: state.version + 1,
    };
}

/// Set the files of the copy of a workbook with their stamps, null removes the copy
export function reduceAgentSessionCopy(state: AgentSessionState, workbookId: string, files: CopyFile[] | null): AgentSessionState {
    const others = state.workbooks.filter(workbook => workbook.workbookId !== workbookId);
    return { ...state, workbooks: files == null ? others : [...others, { workbookId, files }], version: state.version + 1 };
}
