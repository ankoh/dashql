import { agentActivity, harnessLabel, type AgentSession } from './agent_session.js';
import { WorkbookStatusSource, WorkbookStatusTone, type WorkbookStatus } from '../workbook/status/workbook_status.js';

/// The live statuses of the agent: what it works on, that it waits for the user in the terminal, a session that the
/// page lost. A session that ended has none, the
/// composer shows the line for the next one.
export function agentLiveStatuses(session: AgentSession | null, now: number): WorkbookStatus[] {
    if (session == null || session.ended) return [];
    if (!session.connected) {
        return [{
            key: 'agent:session',
            source: WorkbookStatusSource.Agent,
            tone: WorkbookStatusTone.Attention,
            text: `Lost the session of ${harnessLabel(session.harness)}`,
            at: now,
        }];
    }
    const activity = agentActivity(session);
    if (activity.kind === 'idle') return [];
    if (activity.kind === 'waiting') {
        return [{
            key: 'agent:activity',
            source: WorkbookStatusSource.Agent,
            tone: WorkbookStatusTone.Attention,
            text: `${harnessLabel(session.harness)} waits for you in the terminal`,
            detail: activity.text,
            at: now,
        }];
    }
    return [{
        key: 'agent:activity',
        source: WorkbookStatusSource.Agent,
        tone: WorkbookStatusTone.Progress,
        text: `${harnessLabel(session.harness)} works on your question`,
        detail: activity.kind === 'tool' ? activity.text : 'thinking',
        at: now,
    }];
}

/// The lines of the log when questions of the agent finish. The turns of a new session on the port are all new.
export function diffAgentQuestions(prev: AgentSession | null, next: AgentSession | null, now: number): WorkbookStatus[] {
    if (prev == null || next == null) return [];
    const lines: WorkbookStatus[] = [];
    const prevTurns = prev.id === next.id ? prev.turns : [];
    for (const turn of next.turns) {
        const before = prevTurns.find(t => t.questionId === turn.questionId);
        if (before == null) {
            lines.push({
                key: `agent:${turn.questionId}:asked:${now}`,
                source: WorkbookStatusSource.Agent,
                tone: WorkbookStatusTone.Progress,
                text: `Asked the agent: ${turn.question.question}`,
                at: now,
            });
            continue;
        }
        if (before.question.status == null || turn.question.status != null) continue;
        if (turn.question.interrupted) {
            lines.push({
                key: `agent:${turn.questionId}:interrupted:${now}`,
                source: WorkbookStatusSource.Agent,
                tone: WorkbookStatusTone.Attention,
                text: `The agent stopped without an answer: ${turn.question.question}`,
                at: now,
            });
            continue;
        }
        lines.push({
            key: `agent:${turn.questionId}:answered:${now}`,
            source: WorkbookStatusSource.Agent,
            tone: WorkbookStatusTone.Success,
            text: `The agent answered: ${turn.question.question}`,
            detail: turn.question.note,
            scriptKey: turn.scripts.length > 0 ? turn.scripts[turn.scripts.length - 1].scriptKey : null,
            at: now,
        });
    }
    return lines;
}
