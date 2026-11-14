import type { WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { scriptDisplayName } from '@ankoh/dashql-runtime/workbook/scripts/script_types';
import type { AgentSessionState } from '@ankoh/dashql-runtime/session/agent_session_state';

/// A script that the agent wrote
export interface AgentScript {
    scriptKey: number;
    /// The display name of the script
    scriptName: string;
}

/// A question that the user asked the agent in the terminal
export interface AgentQuestion {
    /// The question in natural language
    question: string;
    /// The latest status line of the agent while it works, null once it finished
    status: string | null;
    /// The error of a failed turn
    error: string | null;
    /// The final message of the agent
    note: string | null;
}

/// A question with the scripts that the agent wrote for it
export interface AgentTurn {
    questionId: number;
    question: AgentQuestion;
    scripts: AgentScript[];
}

/// The session of a harness in the terminal, as the page follows it. The page only watches: the hooks of the harness
/// send its events to `dashql session serve`, the page reads them from there (docs/wip/agent_session.md). The
/// questions come from the terminal, the prompt of the page is closed while the page reaches the session.
export interface AgentSession {
    /// The harness, e.g. claude or codex
    harness: string;
    /// The folder that the agent works in
    folder: string;
    /// Does the page still reach the session?
    connected: boolean;
    /// The questions of the session, oldest first
    turns: AgentTurn[];
    /// Dismiss the final message or the error of a question
    onDismiss: (questionId: number) => void;
    /// Scroll to a script that the agent wrote
    onShowScript: (scriptKey: number) => void;
}

/// Is the agent working on a question?
export function isAgentAnswering(question: AgentQuestion): boolean {
    return question.status != null;
}

/// Is the agent of a session working on a question?
export function isAgentWorking(session: AgentSession): boolean {
    return session.turns.some(turn => isAgentAnswering(turn.question));
}

/// The name of a harness as users know it
export function harnessLabel(harness: string): string {
    switch (harness) {
        case 'claude': return 'Claude Code';
        case 'codex': return 'Codex';
        case 'opencode': return 'opencode';
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
            question: { question: turn.question || 'A question in the terminal', status: turn.status, error: turn.error, note: turn.note },
            scripts,
        };
    });
    return {
        harness: state.harness,
        folder: state.folder,
        connected: followed.connected && !state.ended,
        turns,
        onDismiss,
        onShowScript,
    };
}
