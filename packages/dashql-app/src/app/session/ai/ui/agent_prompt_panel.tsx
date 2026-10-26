import * as React from 'react';
import * as styles from './agent_prompt_panel.module.css';

import { ButtonSize, ButtonVariant, IconButton } from '../../../../ui/foundations/button.js';
import { IndicatorStatus, StatusIndicator } from '../../../../ui/foundations/status_indicator.js';
import { SquareFillIcon, SymbolIcon } from '../../../../ui/foundations/symbol_icon.js';
import { AgentConnectionStatus } from '../../../../platform/agent/agent_client.js';
import type { AgentSessionContext } from '../../../../platform/agent/agent_protocol.js';
import { stringifyError } from '../../../../platform/logger/logger.js';
import { useLogger } from '../../../../platform/logger/logger_provider.js';
import type { AgentBridge } from '../../../agent/agent_bridge.js';
import type { ScriptGeneration } from '../use_sql_generations.js';
import { isGenerating } from './script_generation.js';

const LOG_CTX = 'agent_prompt_panel';

const SparklesFillIcon = SymbolIcon('sparkles_fill_16');
const CrossIcon = SymbolIcon('x_16');

/// A question of the session that the agent answers or answered
export interface ComposerAgentRun {
    /// The script that holds the question
    scriptKey: number;
    /// The display name of the script
    scriptName: string;
    /// The status, the final message or the error of the agent
    generation: ScriptGeneration;
}

/// The agent of a session with agent access, as the composer shows it
export interface ComposerAgent {
    /// Is the agent server connected?
    connected: boolean;
    /// The port the page looks for the agent server on
    port: number;
    /// The harness context of the session, null while unknown
    context: AgentSessionContext | null;
    /// The questions of the session, oldest first
    runs: ComposerAgentRun[];
    /// Stop the agent working on a script
    onStop: (scriptKey: number) => void;
    /// Dismiss the final message or the error of a script
    onDismiss: (scriptKey: number) => void;
    /// Scroll to the script of a question
    onShowScript: (scriptKey: number) => void;
}

/// Is the agent working on a question of the session?
export function isAgentWorking(agent: ComposerAgent): boolean {
    return agent.runs.some(run => isGenerating(run.generation));
}

/// The name of a harness as users know it
export function harnessLabel(harness: string): string {
    switch (harness) {
        case 'claude': return 'Claude Code';
        case 'codex': return 'Codex';
        default: return harness;
    }
}

/// Follow the harness context of a session while the agent server is connected.
/// Fetched again when the refresh key changes, e.g. once a run finished and the harness session is known.
export function useAgentSessionContext(bridge: AgentBridge | null, sessionId: string, refreshKey: number): AgentSessionContext | null {
    const logger = useLogger();
    const [context, setContext] = React.useState<AgentSessionContext | null>(null);
    const connected = bridge != null && bridge.hasAccess(sessionId) && bridge.status === AgentConnectionStatus.Connected;
    const fetchContext = bridge?.context;
    React.useEffect(() => {
        if (!connected || fetchContext == null) {
            setContext(null);
            return;
        }
        let current = true;
        fetchContext(sessionId).then(
            next => { if (current) setContext(next); },
            e => logger.warn('Reading the agent context failed', { error: stringifyError(e) }, LOG_CTX),
        );
        return () => { current = false; };
    }, [connected, fetchContext, sessionId, refreshKey, logger]);
    return context;
}

const AgentRunItem: React.FC<{ run: ComposerAgentRun; agent: ComposerAgent }> = ({ run, agent }) => {
    const { scriptKey, scriptName, generation } = run;
    const working = isGenerating(generation);
    const failed = !working && generation.error != null;
    const indicator = working ? IndicatorStatus.Running : (failed ? IndicatorStatus.Failed : IndicatorStatus.Succeeded);
    return (
        <li className={styles.run} data-state={working ? 'working' : (failed ? 'failed' : 'done')} data-testid="composer-agent-run">
            <div className={styles.run_header}>
                <span className={styles.run_indicator}>
                    <StatusIndicator status={indicator} width="12px" height="12px" />
                </span>
                <span className={styles.run_question} title={generation.question}>{generation.question}</span>
                <button
                    type="button"
                    className={styles.run_script}
                    aria-label={`Show the script ${scriptName}`}
                    data-testid="composer-agent-script"
                    onClick={() => agent.onShowScript(scriptKey)}
                >
                    {scriptName}
                </button>
                {working ? (
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label={`Stop the agent working on ${scriptName}`}
                        data-testid="generation-stop"
                        onClick={() => agent.onStop(scriptKey)}
                    >
                        <SquareFillIcon size={12} />
                    </IconButton>
                ) : (
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label={failed ? 'Dismiss the error' : 'Dismiss the answer'}
                        data-testid="generation-dismiss"
                        onClick={() => agent.onDismiss(scriptKey)}
                    >
                        <CrossIcon size={14} />
                    </IconButton>
                )}
            </div>
            {working
                ? <div className={styles.run_status} role="status">{generation.status}</div>
                : <div className={failed ? styles.run_error : styles.run_note} role={failed ? 'alert' : 'note'}>{generation.error ?? generation.note}</div>}
        </li>
    );
};

/// The agent on top of the composer: the harness, the connection to the agent server and the questions of the
/// session with their status lines, final messages and errors. The scripts only show the edits of the agent.
export const AgentPromptPanel: React.FC<{ agent: ComposerAgent }> = ({ agent }) => {
    const working = isAgentWorking(agent);
    let detail: string;
    if (!agent.connected) {
        detail = `looking for the agent server on port ${agent.port}`;
    } else if (working) {
        detail = 'working';
    } else {
        detail = agent.context?.harnessSession != null ? 'continues the conversation' : 'starts a new conversation';
    }
    return (
        <div className={styles.panel} role="region" aria-label="Agent" data-testid="composer-agent">
            <div className={styles.header}>
                <SparklesFillIcon size={12} className={styles.header_icon} />
                <span className={styles.header_title}>{agent.context != null ? harnessLabel(agent.context.harness) : 'Agent'}</span>
                <span className={styles.header_dot} data-connected={agent.connected ? '' : undefined} aria-hidden="true" />
                <span className={styles.header_detail} data-testid="composer-agent-detail">{detail}</span>
            </div>
            {agent.runs.length > 0 && (
                <ul className={styles.runs} aria-label="Questions">
                    {agent.runs.map(run => <AgentRunItem key={run.scriptKey} run={run} agent={agent} />)}
                </ul>
            )}
        </div>
    );
};
