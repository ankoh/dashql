import { agentActivity, harnessLabel, type AgentSession } from './agent_session.js';
import { WorkbookStatusSource, WorkbookStatusTone, type WorkbookStatus } from '../workbook/status/workbook_status.js';

/// The live status of the agent: what it works on
export function agentLiveStatuses(session: AgentSession | null, now: number): WorkbookStatus[] {
    if (session == null) return [];
    const activity = agentActivity(session);
    if (activity.kind === 'idle') return [];
    return [{
        key: 'agent:activity',
        source: WorkbookStatusSource.Agent,
        tone: WorkbookStatusTone.Progress,
        text: `${harnessLabel(session.harness)} works on your question`,
        detail: activity.kind === 'tool' ? activity.text : 'thinking',
        at: now,
    }];
}

/// The lines of the log when questions of the agent start and finish
export function diffAgentQuestions(prev: AgentSession | null, next: AgentSession | null, now: number): WorkbookStatus[] {
    if (prev == null || next == null) return [];
    const lines: WorkbookStatus[] = [];
    const prevTurns = prev.workbookId === next.workbookId ? prev.turns : [];
    for (const turn of next.turns) {
        const before = prevTurns.find(t => t.turnId === turn.turnId);
        if (before == null) {
            lines.push({
                key: `agent:${turn.turnId}:asked:${now}`,
                source: WorkbookStatusSource.Agent,
                tone: WorkbookStatusTone.Progress,
                text: `Asked the agent: ${turn.question}`,
                at: now,
            });
            continue;
        }
        if (before.status == null || turn.status != null) continue;
        if (turn.error != null) {
            lines.push({
                key: `agent:${turn.turnId}:failed:${now}`,
                source: WorkbookStatusSource.Agent,
                tone: WorkbookStatusTone.Failed,
                text: `The agent failed: ${turn.question}`,
                detail: turn.error,
                at: now,
            });
            continue;
        }
        if (turn.interrupted) {
            lines.push({
                key: `agent:${turn.turnId}:interrupted:${now}`,
                source: WorkbookStatusSource.Agent,
                tone: WorkbookStatusTone.Attention,
                text: `The agent stopped: ${turn.question}`,
                at: now,
            });
            continue;
        }
        lines.push({
            key: `agent:${turn.turnId}:answered:${now}`,
            source: WorkbookStatusSource.Agent,
            tone: WorkbookStatusTone.Success,
            text: `The agent answered: ${turn.question}`,
            detail: turn.note,
            scriptKey: turn.scripts.length > 0 ? turn.scripts[turn.scripts.length - 1].scriptKey : null,
            at: now,
        });
    }
    return lines;
}
