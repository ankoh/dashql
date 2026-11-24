/// The events of a turn of a harness that the desktop app runs for a question on a workbook, in the order of the turn:
/// UserPromptSubmit first, Stop last (docs/design/agent_integration.md). Edited names a script that a `dashql` command
/// of the agent changed.
export type AgentSessionEventName = 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse' | 'Edited' | 'Stop';

/// An event of a turn, as the main process reads it from the output of the harness
export interface AgentSessionEvent {
    event: AgentSessionEventName;
    /// The question of UserPromptSubmit
    prompt?: string | null;
    /// What a tool of PreToolUse or PostToolUse does, in one line
    status?: string | null;
    /// The scripts that Edited names, by their file names
    files?: string[];
    /// The id of the use of a tool, PostToolUse names the same as its PreToolUse
    toolUseId?: string | null;
    /// The final message of Stop
    message?: string | null;
    /// The error of a failed tool of PostToolUse, or of a turn that failed with Stop
    error?: string | null;
    /// Did the user stop the turn? Of Stop
    interrupted?: boolean;
}

/// A use of a tool in a turn: PreToolUse starts it, PostToolUse ends it
export interface AgentSessionStep {
    /// What the tool does, in one line
    label: string;
    /// The id of the use of the tool, null if the harness names none
    toolUseId: string | null;
    /// When the page got PreToolUse, in ms since the epoch
    startedAt: number;
    /// When the page got PostToolUse, null while the tool runs
    endedAt: number | null;
    /// Did the tool fail?
    failed: boolean;
}

/// A question on a workbook and what the agent did for it
export interface AgentSessionTurn {
    turnId: number;
    /// The question
    question: string;
    /// The latest status line while the agent works, null once it stopped
    status: string | null;
    /// Did the user stop the turn?
    interrupted: boolean;
    /// Why the turn failed, e.g. the harness exited with an error
    error: string | null;
    /// The final message of the agent
    note: string | null;
    /// The scripts that the agent changed, by their file names, in the order of their first change
    files: string[];
    /// The uses of tools, oldest first, the latest MAX_AGENT_SESSION_STEPS
    steps: AgentSessionStep[];
}

/// The conversation of the agent on a workbook as the page keeps it
export interface AgentSessionState {
    /// The harness of the latest turn, null before the first
    harness: string | null;
    /// The turns, oldest first
    turns: AgentSessionTurn[];
    /// Counts the changes, a page tells a new state by it
    version: number;
}

/// The turns that a conversation keeps, the oldest go first
export const MAX_AGENT_SESSION_TURNS = 50;
/// The steps that a turn keeps, the oldest go first
export const MAX_AGENT_SESSION_STEPS = 30;

export function createAgentSessionState(): AgentSessionState {
    return { harness: null, turns: [], version: 0 };
}

/// A turn of a question
function newTurn(state: AgentSessionState, question: string): AgentSessionTurn {
    const last = state.turns[state.turns.length - 1];
    return { turnId: (last?.turnId ?? 0) + 1, question, status: 'working', interrupted: false, error: null, note: null, files: [], steps: [] };
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

/// Apply an event of a turn of a harness to the conversation of a workbook, at the time of the page
export function reduceAgentSessionEvent(state: AgentSessionState, event: AgentSessionEvent, now: number = Date.now(), harness: string | null = state.harness): AgentSessionState {
    let turns = state.turns;
    const last = turns[turns.length - 1];
    const open = last != null && last.status != null ? last : null;
    // A turn that is still open ended without its Stop
    const closed = (turn: AgentSessionTurn): AgentSessionTurn => ({ ...turn, status: null, interrupted: true, steps: endSteps(turn.steps, now) });
    switch (event.event) {
        case 'UserPromptSubmit': {
            const before = open != null ? [...turns.slice(0, -1), closed(open)] : turns;
            turns = [...before, newTurn({ ...state, turns: before }, event.prompt ?? '')];
            break;
        }
        case 'Edited': {
            if (open == null) break;
            const files = [...open.files];
            for (const file of event.files ?? []) if (!files.includes(file)) files.push(file);
            turns = [...turns.slice(0, -1), { ...open, files }];
            break;
        }
        case 'PreToolUse':
        case 'PostToolUse': {
            if (open == null) break;
            const label = event.status ?? 'tool';
            const toolUseId = event.toolUseId ?? null;
            const steps = [...open.steps];
            if (event.event === 'PreToolUse') {
                steps.push({ label, toolUseId, startedAt: now, endedAt: null, failed: false });
            } else {
                // A PostToolUse without its PreToolUse is a step that ended
                const failed = event.error != null;
                const index = openStepOf(steps, toolUseId, label);
                if (index >= 0) steps[index] = { ...steps[index], endedAt: now, failed };
                else steps.push({ label, toolUseId, startedAt: now, endedAt: now, failed });
            }
            turns = [...turns.slice(0, -1), { ...open, status: event.status ?? open.status, steps: steps.slice(-MAX_AGENT_SESSION_STEPS) }];
            break;
        }
        case 'Stop':
            if (open != null) {
                turns = [...turns.slice(0, -1), {
                    ...open,
                    status: null,
                    interrupted: event.interrupted === true,
                    error: event.error ?? null,
                    note: event.message ?? null,
                    steps: endSteps(open.steps, now),
                }];
            }
            break;
    }
    return { harness, turns: turns.slice(-MAX_AGENT_SESSION_TURNS), version: state.version + 1 };
}
