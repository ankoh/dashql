import type { WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';

import type { AgentFollowTarget } from './agent_commands.js';
import type { AgentSessionState, AgentSessionTurn } from './agent_session_state.js';

export type { AgentFollowTarget };

/// A script that the agent wrote
export interface AgentScript {
    scriptKey: number;
    /// The display name of the script
    scriptName: string;
}

/// A question with the scripts that the agent wrote for it
export type AgentTurn = AgentSessionTurn & { scripts: AgentScript[] };

/// The conversation of the agent on a workbook, as the prompt of the workbook shows it. The desktop app runs a harness
/// of the machine for every question, the agent works on the workbook through the `dashql` commands
/// (docs/design/agent_integration.md).
export interface AgentSession {
    workbookId: string;
    /// The harness of the latest question, e.g. claude or codex, null before the first
    harness: string | null;
    /// The questions, oldest first
    turns: AgentTurn[];
    /// Start a new conversation: forget the questions and the session of the harness
    onReset: () => void;
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

/// What the agent does for the question that it works on, idle without one
export function agentActivity(session: { turns: readonly Pick<AgentSessionTurn, 'status' | 'steps'>[] }): AgentActivity {
    const turn = [...session.turns].reverse().find(turn => turn.status != null);
    if (turn == null) return { kind: 'idle' };
    const running = [...turn.steps].reverse().find(step => step.endedAt == null);
    return running != null ? { kind: 'tool', text: running.label } : { kind: 'thinking' };
}

/// Does the agent work on a question of the conversation?
export function isAgentWorking(session: { turns: readonly Pick<AgentSessionTurn, 'status'>[] } | null | undefined): boolean {
    return session != null && session.turns.some(turn => turn.status != null);
}

/// A duration in a few characters: `0.4 s`, `12 s`, `2 min 5 s`
export function formatAgentDuration(ms: number): string {
    const seconds = Math.max(0, ms) / 1000;
    if (seconds < 10) return `${seconds.toFixed(1)} s`;
    if (seconds < 60) return `${Math.floor(seconds)} s`;
    const minutes = Math.floor(seconds / 60);
    const rest = Math.floor(seconds % 60);
    return rest === 0 ? `${minutes} min` : `${minutes} min ${rest} s`;
}

/// The harnesses that the desktop app runs, in the order of their switch, with their names as users know them
export const AGENT_HARNESSES: readonly { id: DashQLAgentHarness; label: string }[] = [
    { id: 'claude', label: 'Claude Code' },
    { id: 'codex', label: 'Codex' },
    { id: 'opencode', label: 'opencode' },
];

/// The name of a harness as users know it
export function harnessLabel(harness: string | null): string {
    if (harness == null) return 'The agent';
    return AGENT_HARNESSES.find(known => known.id === harness)?.label ?? harness;
}

/// The workbook that the conversation works on
export interface AgentSessionArgs {
    workbookScripts: WorkbookScripts;
    /// Follow the agent to a script, every time it edits or runs one
    followScript: (scriptKey: number, target: AgentFollowTarget) => void;
    /// Show a script that the user picked in the log
    showScript: (scriptKey: number) => void;
}

/// The conversation as the prompt of a workbook shows it: the scripts that the agent changed are the scripts of the
/// workbook with their names
export function agentSessionOf(
    workbookId: string,
    state: AgentSessionState,
    workbookScripts: WorkbookScripts,
    handlers: Pick<AgentSession, 'onReset' | 'onShowScript' | 'onStop'>,
): AgentSession {
    const turns: AgentTurn[] = state.turns.map(turn => {
        const scripts: AgentScript[] = [];
        for (const fileName of turn.files) {
            const ref = workbookScripts.scriptRefs[fileName];
            if (ref != null && !scripts.some(script => script.scriptKey === ref.scriptId)) {
                scripts.push({ scriptKey: ref.scriptId, scriptName: scriptDisplayName(fileName) });
            }
        }
        return { ...turn, scripts };
    });
    return { workbookId, harness: state.harness, turns, ...handlers };
}
