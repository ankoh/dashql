import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import type { AgentSessionState } from '@akohn/dashql/platform/session/agent_session_state';

/// A script that the agent wrote
export interface AgentScript {
    scriptKey: number;
    /// The display name of the script
    scriptName: string;
}

/// A use of a tool by the agent
export interface AgentStep {
    /// What the tool does, in one line
    label: string;
    /// When it started, in ms since the epoch on the clock of the server, the same machine
    startedAt: number;
    /// When it ended, null while it runs
    endedAt: number | null;
    failed: boolean;
}

/// A question that the user asked the agent in the terminal
export interface AgentQuestion {
    /// The question in natural language
    question: string;
    /// The latest status line of the agent while it works, null once it finished
    status: string | null;
    /// What the agent waits for in the terminal while it works, e.g. an approval, null while it works on its own
    waiting: string | null;
    /// Did the question end on an interrupt in the terminal instead of an answer?
    interrupted: boolean;
    /// The final message of the agent
    note: string | null;
    /// The uses of tools, oldest first
    steps: AgentStep[];
}

/// A question with the scripts that the agent wrote for it
export interface AgentTurn {
    questionId: number;
    question: AgentQuestion;
    scripts: AgentScript[];
}

/// The session of a harness in the terminal, as the page follows it. The page only watches: the hooks of the harness
/// send its events to the server of `dashql connect`, the page reads them from there (docs/design/agent_session.md). The
/// questions come from the terminal, the prompt of the page is closed while the page reaches the session.
export interface AgentSession {
    /// The id of the session, a new one for every server on the port of the line
    id: string;
    /// The harness, e.g. claude or codex
    harness: string;
    /// The folder that the agent works in
    folder: string;
    /// Does the page still reach the session? Not once the session ended.
    connected: boolean;
    /// Did the harness end the session? The page waits on the port for the next one.
    ended: boolean;
    /// The questions of the session, oldest first
    turns: AgentTurn[];
    /// Dismiss the final message of a question
    onDismiss: (questionId: number) => void;
    /// Scroll to a script that the agent wrote
    onShowScript: (scriptKey: number) => void;
}

/// What the agent does: nothing, it waits for the user in the terminal on its question, a tool runs, or it thinks
/// between its tools, where the harness tells nothing
export type AgentActivity =
    | { kind: 'idle' }
    | { kind: 'waiting'; text: string }
    | { kind: 'tool'; text: string }
    | { kind: 'thinking' };

/// The question of a session for its activity, a question of the model or a turn of the state of the server
type ActivityQuestion = Pick<AgentQuestion, 'status' | 'waiting'> & { steps: readonly Pick<AgentStep, 'label' | 'endedAt'>[] };

/// What the agent of a session does for the question that it works on, idle without one and while the page doesn't
/// reach the session
export function agentActivity(session: { connected: boolean; turns: readonly { question: ActivityQuestion }[] }): AgentActivity {
    const question = session.connected ? [...session.turns].reverse().find(turn => turn.question.status != null)?.question : undefined;
    if (question == null) return { kind: 'idle' };
    if (question.waiting != null) return { kind: 'waiting', text: question.waiting };
    const running = [...question.steps].reverse().find(step => step.endedAt == null);
    return running != null ? { kind: 'tool', text: running.label } : { kind: 'thinking' };
}

/// The title of the browser tab with a mark of what the agent does, which a user in the terminal next to it sees
export function agentDocumentTitle(title: string, activity: AgentActivity): string {
    switch (activity.kind) {
        case 'idle':
            return title;
        case 'waiting':
            return `(!) ${title}`;
        default:
            return `\u25CF ${title}`;
    }
}

/// The step of a shell command that runs scripts with `dashql run`, e.g. `DASHQL_TRINO_PASSWORD=… dashql run tpch`
export const DASHQL_RUN = /(^|[\s/])dashql run\b/;

/// A duration in a few characters: `0.4 s`, `12 s`, `2 min 5 s`
export function formatAgentDuration(ms: number): string {
    const seconds = Math.max(0, ms) / 1000;
    if (seconds < 10) return `${seconds.toFixed(1)} s`;
    if (seconds < 60) return `${Math.floor(seconds)} s`;
    const minutes = Math.floor(seconds / 60);
    const rest = Math.floor(seconds % 60);
    return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/// The name of a harness as users know it
export function harnessLabel(harness: string): string {
    switch (harness) {
        case 'claude': return 'Claude Code';
        case 'codex': return 'Codex';
        default: return harness;
    }
}

/// Where the feed follows the agent to: the text of a script it edits or the results of a script it runs
export type AgentFollowTarget = 'script' | 'result';

/// The workbook that a session may work on
export interface AgentSessionArgs {
    workbookScripts: WorkbookScripts;
    /// Follow the agent to a script, every time it edits or runs one
    followScript: (scriptKey: number, target: AgentFollowTarget) => void;
    /// Show a script that the user picked in the log
    showScript: (scriptKey: number) => void;
}

/// The session of an agent as its server tells it, and whether the page reaches the server
export interface FollowedAgentSession {
    state: AgentSessionState;
    connected: boolean;
}

/// The session as the bar of a workbook shows it: the files that the agent touched are the scripts of the workbook
/// with their names, the dismissed turns are gone. The prompt stays closed while the page reaches the session.
export function agentSessionOf(
    followed: FollowedAgentSession,
    workbookScripts: WorkbookScripts,
    dismissed: ReadonlySet<number>,
    onDismiss: (questionId: number) => void,
    onShowScript: (scriptKey: number) => void,
): AgentSession {
    const { state } = followed;
    const turns: AgentTurn[] = state.turns.filter(turn => !dismissed.has(turn.turnId)).map(turn => {
        const scripts: AgentScript[] = [];
        for (const file of turn.files) {
            const fileName = file.split(/[\\/]/).pop() ?? file;
            const ref = workbookScripts.scriptRefs[fileName];
            if (ref != null && !scripts.some(script => script.scriptKey === ref.scriptId)) {
                scripts.push({ scriptKey: ref.scriptId, scriptName: scriptDisplayName(fileName) });
            }
        }
        return {
            questionId: turn.turnId,
            question: {
                question: turn.question || 'A question in the terminal',
                status: turn.status,
                waiting: turn.waiting,
                interrupted: turn.interrupted,
                note: turn.note,
                steps: turn.steps.map(step => ({ label: step.label, startedAt: step.startedAt, endedAt: step.endedAt, failed: step.failed })),
            },
            scripts,
        };
    });
    return {
        id: state.id,
        harness: state.harness,
        folder: state.folder,
        connected: followed.connected && !state.ended,
        ended: state.ended,
        turns,
        onDismiss,
        onShowScript,
    };
}
