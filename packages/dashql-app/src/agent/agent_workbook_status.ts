import { AgentConnectionStatus } from './agent_client.js';
import type { AgentBridge } from './agent_bridge.js';
import { harnessLabel, isAgentWorking, type ComposerAgent } from './agent_prompt_panel.js';
import { AgentAccessState, agentAccessState } from './agent_workbook_menu.js';
import { WorkbookStatusSource, WorkbookStatusTone, type WorkbookStatus } from '../workbook/status/workbook_status.js';

/// The live statuses of the agent: what it works on, a server it waits for
export function agentLiveStatuses(bridge: AgentBridge | null, workbookId: string, agent: ComposerAgent | null, now: number): WorkbookStatus[] {
    if (bridge == null || agent == null) return [];
    const state = agentAccessState(bridge, workbookId);
    if (state === AgentAccessState.Connecting) {
        const incompatible = bridge.status === AgentConnectionStatus.Incompatible;
        return [{
            key: 'agent:server',
            source: WorkbookStatusSource.Agent,
            tone: WorkbookStatusTone.Attention,
            text: incompatible ? 'The agent server runs another version' : 'Waiting for the agent server',
            detail: incompatible ? 'update DashQL or reload the page' : 'start dashql agent serve',
            at: now,
        }];
    }
    if (!isAgentWorking(agent)) return [];
    const turn = [...agent.turns].reverse().find(turn => turn.question.status != null)!;
    return [{
        key: `agent:${turn.questionId}`,
        source: WorkbookStatusSource.Agent,
        tone: WorkbookStatusTone.Progress,
        text: agent.context != null ? `${harnessLabel(agent.context.harness)} works on your question` : 'The agent works on your question',
        detail: turn.question.status,
        at: now,
    }];
}

/// The lines of the log when questions of the agent finish
export function diffAgentQuestions(prev: ComposerAgent | null, next: ComposerAgent | null, now: number): WorkbookStatus[] {
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

/// The lines of the log when the agent access of the workbook or the connection to the agent server changes
export function diffAgentAccess(prev: AgentAccessState | null, next: AgentAccessState | null, now: number): WorkbookStatus[] {
    if (prev == null || next == null || prev === next) return [];
    const line = (tone: WorkbookStatusTone, text: string): WorkbookStatus[] => [{
        key: `agent:access:${next}:${now}`, source: WorkbookStatusSource.Agent, tone, text, at: now,
    }];
    switch (next) {
        case AgentAccessState.Connected:
            return line(WorkbookStatusTone.Success, 'Connected to the agent server');
        case AgentAccessState.Connecting:
            return prev === AgentAccessState.Connected
                ? line(WorkbookStatusTone.Attention, 'Lost the connection to the agent server')
                : line(WorkbookStatusTone.Success, 'Enabled the agent');
        case AgentAccessState.Off:
            return line(WorkbookStatusTone.Attention, 'Disabled the agent');
        default:
            return [];
    }
}
