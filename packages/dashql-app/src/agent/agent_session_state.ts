/// An event of a turn of a harness that the desktop app runs for a question on a workbook, in the order of the turn
/// (docs/design/agent_integration.md): the page opens the turn with UserPromptSubmit when it asks, the main process
/// tells the events of the harness, Stop last. Edited names the scripts that a `dashql` command of the agent changed,
/// by their file names.
export type AgentSessionEvent =
    | DashQLAgentEvent
    | { event: 'UserPromptSubmit'; prompt: string }
    | { event: 'Edited'; files: string[] };

/// A step of a turn: a use of a tool, which PreToolUse starts and PostToolUse ends, or a text of the agent, which ends
/// as it starts
export interface AgentSessionStep {
    kind: 'tool' | 'text';
    /// What the tool does, in one line, or the text of the agent
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
    /// The uses of tools and the texts of the agent, oldest first, the latest MAX_AGENT_SESSION_STEPS
    steps: AgentSessionStep[];
}

/// The conversation of the agent on a workbook as the page keeps it, plain JSON in the folder of the workbook
export interface AgentSessionState {
    /// The harness of the latest turn, null before the first
    harness: string | null;
    /// The turns, oldest first
    turns: AgentSessionTurn[];
}

/// The turns that a conversation keeps, the oldest go first
export const MAX_AGENT_SESSION_TURNS = 50;
/// The steps that a turn keeps, the oldest go first
export const MAX_AGENT_SESSION_STEPS = 60;
/// The longest text of the agent that a step keeps
export const MAX_AGENT_SESSION_TEXT = 4000;

export function createAgentSessionState(): AgentSessionState {
    return { harness: null, turns: [] };
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

/// Is a step the text, or the start of a text that a step cut?
function isTextOf(text: string, label: string): boolean {
    const trimmed = text.trim();
    return trimmed === label || (label.endsWith('…') && trimmed.startsWith(label.slice(0, -1)));
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
            turns = [...before, newTurn({ ...state, turns: before }, event.prompt)];
            break;
        }
        case 'Edited': {
            if (open == null) break;
            const files = [...open.files];
            for (const file of event.files) if (!files.includes(file)) files.push(file);
            turns = [...turns.slice(0, -1), { ...open, files }];
            break;
        }
        case 'PreToolUse':
        case 'PostToolUse': {
            if (open == null) break;
            const label = event.status;
            const toolUseId = event.toolUseId;
            const steps = [...open.steps];
            if (event.event === 'PreToolUse') {
                steps.push({ kind: 'tool', label, toolUseId, startedAt: now, endedAt: null, failed: false });
            } else {
                // A PostToolUse without its PreToolUse is a step that ended
                const failed = event.error != null;
                const index = openStepOf(steps, toolUseId, label);
                if (index >= 0) steps[index] = { ...steps[index], endedAt: now, failed };
                else steps.push({ kind: 'tool', label, toolUseId, startedAt: now, endedAt: now, failed });
            }
            turns = [...turns.slice(0, -1), { ...open, status: event.status, steps: steps.slice(-MAX_AGENT_SESSION_STEPS) }];
            break;
        }
        case 'Say': {
            const text = event.text.trim();
            if (open == null || text.length === 0) break;
            const label = text.length > MAX_AGENT_SESSION_TEXT ? `${text.slice(0, MAX_AGENT_SESSION_TEXT - 1)}…` : text;
            const steps = [...open.steps, { kind: 'text' as const, label, toolUseId: null, startedAt: now, endedAt: now, failed: false }];
            turns = [...turns.slice(0, -1), { ...open, steps: steps.slice(-MAX_AGENT_SESSION_STEPS) }];
            break;
        }
        case 'Stop':
            if (open != null) {
                const note = event.message != null && event.message.trim().length > 0 ? event.message : null;
                // The final message is the last text of the agent, the turn shows it once
                let steps = endSteps(open.steps, now);
                const last = steps[steps.length - 1];
                if (note != null && last?.kind === 'text' && isTextOf(note, last.label)) steps = steps.slice(0, -1);
                turns = [...turns.slice(0, -1), {
                    ...open,
                    status: null,
                    interrupted: event.interrupted === true,
                    error: event.error ?? null,
                    note,
                    steps,
                }];
            }
            break;
    }
    return { harness, turns: turns.slice(-MAX_AGENT_SESSION_TURNS) };
}

function isString(value: unknown): value is string {
    return typeof value === 'string';
}

function isTime(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function parseStep(value: unknown): AgentSessionStep | null {
    if (value == null || typeof value !== 'object') return null;
    const step = value as Record<string, unknown>;
    if (!isString(step.label) || !isTime(step.startedAt)) return null;
    return {
        kind: step.kind === 'text' ? 'text' : 'tool',
        label: step.label,
        toolUseId: isString(step.toolUseId) ? step.toolUseId : null,
        startedAt: step.startedAt,
        // A step that ran when the app went away ended then
        endedAt: isTime(step.endedAt) ? step.endedAt : step.startedAt,
        failed: step.failed === true,
    };
}

function parseTurn(value: unknown): AgentSessionTurn | null {
    if (value == null || typeof value !== 'object') return null;
    const turn = value as Record<string, unknown>;
    if (!isTime(turn.turnId) || !isString(turn.question)) return null;
    // A turn that ran when the app went away was stopped
    const open = turn.status != null;
    return {
        turnId: turn.turnId,
        question: turn.question,
        status: null,
        interrupted: open || turn.interrupted === true,
        error: isString(turn.error) ? turn.error : null,
        note: isString(turn.note) ? turn.note : null,
        files: Array.isArray(turn.files) ? turn.files.filter(isString) : [],
        steps: Array.isArray(turn.steps) ? turn.steps.map(parseStep).filter((step): step is AgentSessionStep => step != null).slice(-MAX_AGENT_SESSION_STEPS) : [],
    };
}

/// Read a conversation that the app kept, null if it is none. Turns that still ran end as stopped, broken turns and
/// steps are left out.
export function parseAgentSessionFile(value: unknown): AgentSessionState | null {
    if (value == null || typeof value !== 'object') return null;
    const file = value as Record<string, unknown>;
    if (!Array.isArray(file.turns)) return null;
    const turns = file.turns.map(parseTurn).filter((turn): turn is AgentSessionTurn => turn != null).slice(-MAX_AGENT_SESSION_TURNS);
    return { harness: isString(file.harness) ? file.harness : null, turns };
}
