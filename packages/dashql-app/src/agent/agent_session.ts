import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import type { AgentSessionState } from '@akohn/dashql/platform/session/agent_session_state';

import type { AgentFollowTarget } from './agent_commands.js';

export type { AgentFollowTarget };

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
    /// When it started, in ms since the epoch
    startedAt: number;
    /// When it ended, null while it runs
    endedAt: number | null;
    failed: boolean;
}

/// A question that the user asked the agent in the prompt
export interface AgentQuestion {
    /// The question in natural language
    question: string;
    /// The latest status line of the agent while it works, null once it finished
    status: string | null;
    /// Did the user stop the question?
    interrupted: boolean;
    /// Why the question failed, e.g. the harness exited with an error
    error: string | null;
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

/// The conversation of the agent on a workbook, as the bar of the workbook shows it. The desktop app runs a harness of
/// the machine for every question, the agent works on the workbook through the `dashql` commands
/// (docs/design/agent_integration.md).
export interface AgentSession {
    workbookId: string;
    /// The harness of the latest question, e.g. claude or codex, null before the first
    harness: string | null;
    /// The questions, oldest first
    turns: AgentTurn[];
    /// Dismiss the final message of a question
    onDismiss: (questionId: number) => void;
    /// Scroll to a script that the agent wrote
    onShowScript: (scriptKey: number) => void;
    /// Stop the question that runs
    onStop: () => void;
}

/// What the agent does: nothing, a tool runs, or it thinks between its tools, where the harness tells nothing
export type AgentActivity =
    | { kind: 'idle' }
    | { kind: 'tool'; text: string }
    | { kind: 'thinking' };

/// The question of a conversation for its activity
type ActivityQuestion = Pick<AgentQuestion, 'status'> & { steps: readonly Pick<AgentStep, 'label' | 'endedAt'>[] };

/// What the agent does for the question that it works on, idle without one
export function agentActivity(session: { turns: readonly { question: ActivityQuestion }[] }): AgentActivity {
    const question = [...session.turns].reverse().find(turn => turn.question.status != null)?.question;
    if (question == null) return { kind: 'idle' };
    const running = [...question.steps].reverse().find(step => step.endedAt == null);
    return running != null ? { kind: 'tool', text: running.label } : { kind: 'thinking' };
}

/// Does the agent work on a question of the conversation?
export function isAgentWorking(session: { turns: readonly { question: Pick<AgentQuestion, 'status'> }[] } | null): boolean {
    return session != null && session.turns.some(turn => turn.question.status != null);
}

/// The title of the window with a mark while the agent works
export function agentDocumentTitle(title: string, activity: AgentActivity): string {
    return activity.kind === 'idle' ? title : `● ${title}`;
}

/// The step of a shell command that runs scripts with `dashql run` or `dashql vis`
export const DASHQL_RUN = /(^|[\s/])dashql (run|vis)\b/;

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
export function harnessLabel(harness: string | null): string {
    switch (harness) {
        case 'claude': return 'Claude Code';
        case 'codex': return 'Codex';
        case 'opencode': return 'opencode';
        case null: return 'The agent';
        default: return harness;
    }
}

/// The workbook that the conversation works on
export interface AgentSessionArgs {
    workbookScripts: WorkbookScripts;
    /// Follow the agent to a script, every time it edits or runs one
    followScript: (scriptKey: number, target: AgentFollowTarget) => void;
    /// Show a script that the user picked in the log
    showScript: (scriptKey: number) => void;
}

/// The conversation as the bar of a workbook shows it: the scripts that the agent changed are the scripts of the
/// workbook with their names, the dismissed turns are gone
export function agentSessionOf(
    workbookId: string,
    state: AgentSessionState,
    workbookScripts: WorkbookScripts,
    dismissed: ReadonlySet<number>,
    handlers: Pick<AgentSession, 'onDismiss' | 'onShowScript' | 'onStop'>,
): AgentSession {
    const turns: AgentTurn[] = state.turns.filter(turn => !dismissed.has(turn.turnId)).map(turn => {
        const scripts: AgentScript[] = [];
        for (const fileName of turn.files) {
            const ref = workbookScripts.scriptRefs[fileName];
            if (ref != null && !scripts.some(script => script.scriptKey === ref.scriptId)) {
                scripts.push({ scriptKey: ref.scriptId, scriptName: scriptDisplayName(fileName) });
            }
        }
        return {
            questionId: turn.turnId,
            question: {
                question: turn.question,
                status: turn.status,
                interrupted: turn.interrupted,
                error: turn.error,
                note: turn.note,
                steps: turn.steps.map(step => ({ label: step.label, startedAt: step.startedAt, endedAt: step.endedAt, failed: step.failed })),
            },
            scripts,
        };
    });
    return { workbookId, harness: state.harness, turns, ...handlers };
}
