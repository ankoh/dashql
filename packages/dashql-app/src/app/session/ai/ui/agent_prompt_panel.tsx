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
import { isAgentAnswering, type AgentQuestion } from '../use_agent_questions.js';

const LOG_CTX = 'agent_prompt_panel';

const SparklesFillIcon = SymbolIcon('sparkles_fill_16');
const CrossIcon = SymbolIcon('x_16');

/// A script that the agent wrote
export interface ComposerAgentScript {
    scriptKey: number;
    /// The display name of the script
    scriptName: string;
}

/// A question of the session that the agent answers or answered
export interface ComposerAgentTurn {
    questionId: number;
    /// The question with the status, the final message or the error of the agent
    question: AgentQuestion;
    /// The scripts of the session that the agent wrote
    scripts: ComposerAgentScript[];
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
    turns: ComposerAgentTurn[];
    /// Stop the agent working on a question
    onStop: (questionId: number) => void;
    /// Dismiss the final message or the error of a question
    onDismiss: (questionId: number) => void;
    /// Scroll to a script that the agent wrote
    onShowScript: (scriptKey: number) => void;
}

/// Is the agent working on a question of the session?
export function isAgentWorking(agent: ComposerAgent): boolean {
    return agent.turns.some(turn => isAgentAnswering(turn.question));
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

/// Follow the harness context of a session while the agent server is connected.
/// Fetched again when the refresh key changes, e.g. once a turn finished and the harness session is known.
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

/// The final message of the agent as plain text, without the markers of the markdown that harnesses like to write
export function plainAgentNote(note: string): string {
    return note
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/__(.+?)__/g, '$1')
        .replace(/`([^`\n]+)`/g, '$1')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/// The final message of the agent, clamped to two lines until it is expanded.
/// The user watched the scripts change and run, a recap of them is rarely worth more than a glance.
const AgentTurnNote: React.FC<{ note: string }> = ({ note }) => {
    const text = React.useMemo(() => plainAgentNote(note), [note]);
    const ref = React.useRef<HTMLDivElement>(null);
    const [expanded, setExpanded] = React.useState(false);
    const [overflows, setOverflows] = React.useState(false);
    React.useLayoutEffect(() => {
        const element = ref.current;
        if (element == null || expanded) return;
        const measure = () => setOverflows(element.scrollHeight > element.clientHeight + 1);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [text, expanded]);
    return (
        <div className={styles.turn_note_container}>
            <div ref={ref} className={styles.turn_note} role="note" data-expanded={expanded ? '' : undefined}>{text}</div>
            {(overflows || expanded) && (
                <button
                    type="button"
                    className={styles.turn_note_toggle}
                    aria-expanded={expanded}
                    data-testid="composer-agent-note-toggle"
                    onClick={() => setExpanded(e => !e)}
                >
                    {expanded ? 'Show less' : 'Show more'}
                </button>
            )}
        </div>
    );
};

const AgentTurnItem: React.FC<{ turn: ComposerAgentTurn; agent: ComposerAgent }> = ({ turn, agent }) => {
    const { questionId, question } = turn;
    const working = isAgentAnswering(question);
    const failed = !working && question.error != null;
    const indicator = working ? IndicatorStatus.Running : (failed ? IndicatorStatus.Failed : IndicatorStatus.Succeeded);
    return (
        <li className={styles.turn} data-state={working ? 'working' : (failed ? 'failed' : 'done')} data-testid="composer-agent-turn">
            <div className={styles.turn_header}>
                <span className={styles.turn_indicator}>
                    <StatusIndicator status={indicator} width="12px" height="12px" />
                </span>
                <span className={styles.turn_question} title={question.question}>{question.question}</span>
                {turn.scripts.map(script => (
                    <button
                        key={script.scriptKey}
                        type="button"
                        className={styles.turn_script}
                        aria-label={`Show the script ${script.scriptName}`}
                        data-testid="composer-agent-script"
                        onClick={() => agent.onShowScript(script.scriptKey)}
                    >
                        {script.scriptName}
                    </button>
                ))}
                {working ? (
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label="Stop the agent"
                        data-testid="question-stop"
                        onClick={() => agent.onStop(questionId)}
                    >
                        <SquareFillIcon size={12} />
                    </IconButton>
                ) : (
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label={failed ? 'Dismiss the error' : 'Dismiss the answer'}
                        data-testid="question-dismiss"
                        onClick={() => agent.onDismiss(questionId)}
                    >
                        <CrossIcon size={14} />
                    </IconButton>
                )}
            </div>
            {working && <div className={styles.turn_status} role="status">{question.status}</div>}
            {failed && <div className={styles.turn_error} role="alert">{question.error}</div>}
            {!working && !failed && question.note != null && <AgentTurnNote note={question.note} />}
        </li>
    );
};

/// The agent on top of the composer: the harness, the connection to the agent server and the questions of the
/// session with their status lines, final messages, errors and the scripts the agent wrote.
/// The scripts only show the edits of the agent.
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
            {agent.turns.length > 0 && (
                <ul className={styles.turns} aria-label="Questions">
                    {agent.turns.map(turn => <AgentTurnItem key={turn.questionId} turn={turn} agent={agent} />)}
                </ul>
            )}
        </div>
    );
};
