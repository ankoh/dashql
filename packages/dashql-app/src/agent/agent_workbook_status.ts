import { harnessLabel, isAgentWorking, type AgentSession } from './agent_session.js';
import { WorkbookStatusSource, WorkbookStatusTone, type WorkbookStatus } from '../workbook/status/workbook_status.js';

/// The live statuses of the agent: what it works on, a session that the page lost
export function agentLiveStatuses(session: AgentSession | null, now: number): WorkbookStatus[] {
    if (session == null) return [];
    if (!session.connected) {
        return [{
            key: 'agent:session',
            source: WorkbookStatusSource.Agent,
            tone: WorkbookStatusTone.Attention,
            text: `Lost the session of ${harnessLabel(session.harness)}`,
            at: now,
        }];
    }
    if (!isAgentWorking(session)) return [];
    const turn = [...session.turns].reverse().find(turn => turn.question.status != null)!;
    return [{
        key: `agent:${turn.questionId}`,
        source: WorkbookStatusSource.Agent,
        tone: WorkbookStatusTone.Progress,
        text: `${harnessLabel(session.harness)} works on your question`,
        detail: turn.question.status,
        at: now,
    }];
}

/// The lines of the log when questions of the agent finish
export function diffAgentQuestions(prev: AgentSession | null, next: AgentSession | null, now: number): WorkbookStatus[] {
    if (prev == null || next == null) return [];
    const lines: WorkbookStatus[] = [];
    for (const turn of next.turns) {
        const before = prev.turns.find(t => t.questionId === turn.questionId);
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
        lines.push(turn.question.error != null ? {
            key: `agent:${turn.questionId}:failed:${now}`,
            source: WorkbookStatusSource.Agent,
            tone: WorkbookStatusTone.Failed,
            text: `The agent failed: ${turn.question.question}`,
            detail: turn.question.error,
            at: now,
        } : {
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
