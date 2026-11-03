import * as React from 'react';
import * as styles from './agent_prompt_panel.module.css';

import { ButtonSize, ButtonVariant, IconButton } from '../ui/foundations/button.js';
import { IndicatorStatus, StatusIndicator } from '../ui/foundations/status_indicator.js';
import { ChevronRightIcon, SquareFillIcon, SymbolIcon } from '../ui/foundations/symbol_icon.js';
import { AgentConnectionStatus } from './agent_client.js';
import type { AgentSessionContext } from './agent_protocol.js';
import { stringifyError } from '../platform/logger/logger.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import type { AgentBridge } from './agent_bridge.js';
import { isAgentAnswering, type AgentQuestion } from './use_agent_questions.js';

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

/// A question of the session with the answer of the agent.
/// A collapsed turn shows the question in one line, an expanded turn shows the question, the status line, the final
/// message and the error in full.
const AgentTurnItem: React.FC<{ turn: ComposerAgentTurn; agent: ComposerAgent; expanded: boolean; onToggle: () => void }> = ({ turn, agent, expanded, onToggle }) => {
    const { questionId, question } = turn;
    const working = isAgentAnswering(question);
    const failed = !working && question.error != null;
    const indicator = working ? IndicatorStatus.Running : (failed ? IndicatorStatus.Failed : IndicatorStatus.Succeeded);
    const note = React.useMemo(() => (question.note != null ? plainAgentNote(question.note) : null), [question.note]);
    const questionTextId = React.useId();
    return (
        <li
            className={styles.turn}
            data-state={working ? 'working' : (failed ? 'failed' : 'done')}
            data-expanded={expanded ? '' : undefined}
            data-testid="composer-agent-turn"
        >
            <div className={styles.turn_header}>
                <button
                    type="button"
                    className={styles.turn_toggle}
                    aria-expanded={expanded}
                    aria-labelledby={questionTextId}
                    data-testid="composer-agent-turn-toggle"
                    onClick={onToggle}
                >
                    <ChevronRightIcon size={12} className={styles.turn_chevron} />
                    <span className={styles.turn_indicator}>
                        <StatusIndicator status={indicator} width="12px" height="12px" />
                    </span>
                </button>
                {/* The question is text that users can select and copy, not a part of the button.
                    A click expands a collapsed turn, the chevron collapses an expanded one. */}
                <span
                    id={questionTextId}
                    className={styles.turn_question}
                    title={expanded ? undefined : question.question}
                    data-testid="composer-agent-turn-question"
                    onClick={expanded ? undefined : onToggle}
                >
                    {question.question}
                </span>
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
            {expanded && working && question.status != null && <div className={styles.turn_status} role="status">{question.status}</div>}
            {expanded && failed && <div className={styles.turn_error} role="alert">{question.error}</div>}
            {expanded && !working && !failed && note != null && <div className={styles.turn_note} role="note">{note}</div>}
        </li>
    );
};

/// Is a turn expanded unless the user toggled it? The latest turn and the turns the agent works on are.
function isTurnExpandedByDefault(turn: ComposerAgentTurn, index: number, turns: readonly ComposerAgentTurn[]): boolean {
    return index === turns.length - 1 || isAgentAnswering(turn.question);
}

/// The agent on top of the composer: the harness, the connection to the agent server and the questions of the
/// session with their status lines, final messages, errors and the scripts the agent wrote.
/// The questions scroll within a fixed height, each one expands and collapses.
/// The scripts only show the edits of the agent.
export const AgentPromptPanel: React.FC<{ agent: ComposerAgent }> = ({ agent }) => {
    const working = isAgentWorking(agent);
    // The turns that the user expanded or collapsed
    const [toggled, setToggled] = React.useState<ReadonlyMap<number, boolean>>(() => new Map());
    const toggle = React.useCallback((questionId: number, expanded: boolean) => {
        setToggled(prev => new Map(prev).set(questionId, expanded));
    }, []);
    // The turns scroll within a fixed height, a new question scrolls them to the bottom
    const turnsRef = React.useRef<HTMLUListElement>(null);
    const latestQuestionId = agent.turns.length > 0 ? agent.turns[agent.turns.length - 1].questionId : null;
    React.useLayoutEffect(() => {
        const list = turnsRef.current;
        if (list != null) list.scrollTop = list.scrollHeight;
    }, [latestQuestionId]);
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
                <ul ref={turnsRef} className={styles.turns} aria-label="Questions">
                    {agent.turns.map((turn, index, turns) => {
                        const expanded = toggled.get(turn.questionId) ?? isTurnExpandedByDefault(turn, index, turns);
                        return (
                            <AgentTurnItem
                                key={turn.questionId}
                                turn={turn}
                                agent={agent}
                                expanded={expanded}
                                onToggle={() => toggle(turn.questionId, !expanded)}
                            />
                        );
                    })}
                </ul>
            )}
        </div>
    );
};
