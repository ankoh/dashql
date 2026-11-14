import type { WorkbookScripts } from '@ankoh/dashql-sdk/workbook/scripts/workbook_scripts';

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

/// The session of a harness in the terminal that works on a workbook, as the page follows it. The page only watches:
/// the hooks of the harness send its events to `dashql session serve`, the page reads them from there
/// (docs/wip/agent_integration_tests.md). The questions come from the terminal, the prompt of the page is closed.
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

/// The session that works on a workbook, null without one. No session reaches the page before `dashql session serve`
/// exists.
export function useAgentSession(_args: AgentSessionArgs): AgentSession | null {
    return null;
}
