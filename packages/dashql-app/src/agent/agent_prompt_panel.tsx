import * as React from 'react';
import * as styles from './agent_prompt_panel.module.css';

import { ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { IndicatorStatus, StatusIndicator } from '@akohn/dashql-react/components/status_indicator';
import { ChevronRightIcon, SymbolIcon } from '@akohn/dashql-react/components/symbol_icon';
import {
    agentActivity,
    formatAgentDuration,
    harnessLabel,
    isAgentAnswering,
    isAgentWaiting,
    isAgentWorking,
    type AgentSession,
    type AgentStep,
    type AgentTurn,
} from './agent_session.js';

const SparklesFillIcon = SymbolIcon('sparkles_fill_16');
const CrossIcon = SymbolIcon('x_16');

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

/// The time now, every second while `ticking`, for the time of the steps that run
function useNow(ticking: boolean): number {
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
        if (!ticking) return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [ticking]);
    return now;
}

/// The steps of a turn: what every tool did and how long it took. The feed shows the scripts that a step runs.
const AgentSteps: React.FC<{ steps: AgentStep[] }> = ({ steps }) => {
    const now = useNow(steps.some(step => step.endedAt == null));
    return (
        <ol className={styles.steps} aria-label="Steps" data-testid="composer-agent-steps">
            {steps.map((step, index) => {
                const running = step.endedAt == null;
                const status = running ? IndicatorStatus.Running : (step.failed ? IndicatorStatus.Failed : IndicatorStatus.Succeeded);
                return (
                    <li key={index} className={styles.step} data-state={running ? 'running' : (step.failed ? 'failed' : 'done')} data-testid="composer-agent-step">
                        <div className={styles.step_line}>
                            <span className={styles.step_indicator}>
                                <StatusIndicator status={status} width="10px" height="10px" />
                            </span>
                            <span className={styles.step_label} title={step.label}>{step.label}</span>
                            <span className={styles.step_time} data-testid="composer-agent-step-time">
                                {formatAgentDuration((step.endedAt ?? now) - step.startedAt)}
                            </span>
                        </div>
                    </li>
                );
            })}
        </ol>
    );
};

/// A question of the workbook with the answer of the agent.
/// A collapsed turn shows the question in one line. An expanded turn shows the question, the steps of the agent and the
/// final message in full.
const AgentTurnItem: React.FC<{ turn: AgentTurn; session: AgentSession; expanded: boolean; onToggle: () => void }> = ({ turn, session, expanded, onToggle }) => {
    const { questionId, question } = turn;
    const working = isAgentAnswering(question);
    const activity = agentActivity(question);
    const waiting = activity?.kind === 'waiting' ? activity.text : null;
    const indicator = waiting != null ? IndicatorStatus.Blocked
        : working ? IndicatorStatus.Running
            : question.interrupted ? IndicatorStatus.Skip : IndicatorStatus.Succeeded;
    const note = React.useMemo(() => (question.note != null ? plainAgentNote(question.note) : null), [question.note]);
    const questionTextId = React.useId();
    const { steps } = question;
    return (
        <li
            className={styles.turn}
            data-state={waiting != null ? 'waiting' : working ? 'working' : question.interrupted ? 'interrupted' : 'done'}
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
                        <StatusIndicator status={indicator} width="12px" height="12px" fill={waiting != null ? 'var(--color_attention_fg)' : undefined} />
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
                        onClick={() => session.onShowScript(script.scriptKey)}
                    >
                        {script.scriptName}
                    </button>
                ))}
                {/* The terminal stops the agent, the page only watches */}
                {!working && (
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label="Dismiss the answer"
                        data-testid="question-dismiss"
                        onClick={() => session.onDismiss(questionId)}
                    >
                        <CrossIcon size={14} />
                    </IconButton>
                )}
            </div>
            {expanded && steps.length > 0 && (
                <div role={working ? 'status' : undefined}>
                    <AgentSteps steps={steps} />
                </div>
            )}
            {expanded && waiting != null && (
                <div className={styles.turn_waiting} role="status" data-testid="composer-agent-waiting">
                    Waits for you in the terminal: {waiting}
                </div>
            )}
            {expanded && !working && note != null && <div className={styles.turn_note} role="note">{note}</div>}
            {expanded && question.interrupted && <div className={styles.turn_note} role="note">Stopped without an answer</div>}
        </li>
    );
};

/// Is a turn expanded unless the user toggled it? The latest turn and the turns the agent works on are.
function isTurnExpandedByDefault(turn: AgentTurn, index: number, turns: readonly AgentTurn[]): boolean {
    return index === turns.length - 1 || isAgentAnswering(turn.question);
}

/// The log of the agent in the bubble of Wobble: the harness, the folder it works in and the questions of the session
/// with their status lines, final messages, errors and the scripts the agent wrote.
/// The questions scroll within a fixed height, each one expands and collapses.
/// The scripts only show the edits of the agent.
export const AgentPromptPanel: React.FC<{ session: AgentSession; onClose?: () => void }> = ({ session, onClose }) => {
    const working = isAgentWorking(session);
    // The turns that the user expanded or collapsed
    const [toggled, setToggled] = React.useState<ReadonlyMap<number, boolean>>(() => new Map());
    const toggle = React.useCallback((questionId: number, expanded: boolean) => {
        setToggled(prev => new Map(prev).set(questionId, expanded));
    }, []);
    // The turns scroll within a fixed height, a new question scrolls them to the bottom, a new step of the latest
    // question while the user stays at the bottom
    const turnsRef = React.useRef<HTMLUListElement>(null);
    const atBottomRef = React.useRef(true);
    const latestTurn = session.turns.length > 0 ? session.turns[session.turns.length - 1] : null;
    const latestQuestionId = latestTurn?.questionId ?? null;
    const latestSteps = latestTurn?.question.steps.length ?? 0;
    React.useLayoutEffect(() => {
        const list = turnsRef.current;
        if (list != null) list.scrollTop = list.scrollHeight;
        atBottomRef.current = true;
    }, [latestQuestionId]);
    React.useLayoutEffect(() => {
        const list = turnsRef.current;
        if (list != null && atBottomRef.current) list.scrollTop = list.scrollHeight;
    }, [latestSteps]);
    const onTurnsScroll = React.useCallback(() => {
        const list = turnsRef.current;
        if (list != null) atBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 8;
    }, []);
    const detail = session.ended ? 'ended the session' : !session.connected ? 'lost the session'
        : isAgentWaiting(session) ? 'waits for you in the terminal' : working ? 'working' : `in ${session.folder}`;
    return (
        <div className={styles.panel} role="region" aria-label="Agent" data-testid="composer-agent">
            <div className={styles.header}>
                <SparklesFillIcon size={12} className={styles.header_icon} />
                <span className={styles.header_title}>{harnessLabel(session.harness)}</span>
                <span className={styles.header_dot} data-connected={session.connected ? '' : undefined} aria-hidden="true" />
                <span className={styles.header_detail} data-testid="composer-agent-detail">{detail}</span>
                {onClose != null && (
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label="Close the agent log"
                        data-testid="composer-agent-close"
                        onClick={onClose}
                    >
                        <CrossIcon size={14} />
                    </IconButton>
                )}
            </div>
            {session.turns.length > 0 && (
                <ul ref={turnsRef} className={styles.turns} aria-label="Questions" onScroll={onTurnsScroll}>
                    {session.turns.map((turn, index, turns) => {
                        const expanded = toggled.get(turn.questionId) ?? isTurnExpandedByDefault(turn, index, turns);
                        return (
                            <AgentTurnItem
                                key={turn.questionId}
                                turn={turn}
                                session={session}
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
