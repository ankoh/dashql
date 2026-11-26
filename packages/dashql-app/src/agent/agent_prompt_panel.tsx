import * as React from 'react';
import * as styles from './agent_prompt_panel.module.css';

import { Button, ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { IndicatorStatus, StatusIndicator } from '@akohn/dashql-react/components/status_indicator';
import { ChevronDownIcon, ChevronRightIcon, SquareFillIcon, SymbolIcon } from '@akohn/dashql-react/components/symbol_icon';
import { MarkdownText } from '@akohn/dashql-react/components/visualization/markdown_view';
import { useOptionalRuntime } from '@akohn/dashql-react/hooks';
import { formatAgentDuration, type AgentSession, type AgentTurn } from './agent_session.js';
import type { AgentSessionStep } from './agent_session_state.js';

const SparklesFillIcon = SymbolIcon('sparkles_fill_16');

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

/// A text of the agent as Markdown, compiled by the core: no raw HTML, no unsafe links, no images. Without the core the
/// text shows as it is.
const AgentMarkdown: React.FC<{ text: string; className: string; testId?: string }> = ({ text, className, testId }) => {
    const core = useOptionalRuntime()?.core ?? null;
    const document = React.useMemo(() => core?.compileMarkdown(text) ?? null, [core, text]);
    if (document == null) return <div className={className} data-plain="" data-testid={testId}>{text}</div>;
    return <MarkdownText className={className} document={document} data-testid={testId} />;
};

/// The steps of a turn: what every tool did and how long it took, and what the agent said between its tools
const AgentSteps: React.FC<{ steps: AgentSessionStep[] }> = ({ steps }) => {
    const now = useNow(steps.some(step => step.endedAt == null));
    return (
        <ol className={styles.steps} aria-label="Steps" data-testid="composer-agent-steps">
            {steps.map((step, index) => {
                if (step.kind === 'text') {
                    return (
                        <li key={index} className={styles.step} data-state="text" data-testid="composer-agent-step">
                            <AgentMarkdown text={step.label} className={styles.step_text} />
                        </li>
                    );
                }
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
/// answer in full.
const AgentTurnItem: React.FC<{ turn: AgentTurn; session: AgentSession; expanded: boolean; onToggle: () => void }> = ({ turn, session, expanded, onToggle }) => {
    const working = turn.status != null;
    const indicator = working ? IndicatorStatus.Running
        : turn.error != null ? IndicatorStatus.Failed
            : turn.interrupted ? IndicatorStatus.Skip : IndicatorStatus.Succeeded;
    const questionTextId = React.useId();
    const { steps } = turn;
    return (
        <li
            className={styles.turn}
            data-state={working ? 'working' : turn.error != null ? 'failed' : turn.interrupted ? 'interrupted' : 'done'}
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
                    title={expanded ? undefined : turn.question}
                    data-testid="composer-agent-turn-question"
                    onClick={expanded ? undefined : onToggle}
                >
                    {turn.question}
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
                {working && (
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label="Stop the agent"
                        data-testid="question-stop"
                        onClick={session.onStop}
                    >
                        <SquareFillIcon size={12} />
                    </IconButton>
                )}
            </div>
            {expanded && steps.length > 0 && (
                <div role={working ? 'status' : undefined}>
                    <AgentSteps steps={steps} />
                </div>
            )}
            {expanded && working && (steps.length === 0 || steps[steps.length - 1].endedAt != null) && (
                <div className={styles.turn_thinking} data-testid="composer-agent-thinking">Thinking…</div>
            )}
            {expanded && !working && turn.note != null && (
                <AgentMarkdown text={turn.note} className={styles.turn_note} testId="composer-agent-answer" />
            )}
            {expanded && turn.error != null && <div className={styles.turn_error} role="alert" data-testid="composer-agent-error">{turn.error}</div>}
            {expanded && turn.interrupted && turn.error == null && turn.note == null && <div className={styles.turn_stopped} role="note">Stopped without an answer</div>}
        </li>
    );
};

/// Is a turn expanded unless the user toggled it? The latest turn and the turns the agent works on are.
function isTurnExpandedByDefault(turn: AgentTurn, index: number, turns: readonly AgentTurn[]): boolean {
    return index === turns.length - 1 || turn.status != null;
}

/// The conversation with the agent above the editor of the prompt in AI: the questions on the workbook with the steps
/// of the agent, its texts between the steps, its answers, errors and the scripts it wrote. The feed holds only the
/// scripts. The questions scroll within a fixed height, each one expands and collapses. A new conversation forgets the
/// questions and the session of the harness.
export const AgentPromptPanel: React.FC<{ session: AgentSession; onHide?: () => void }> = ({ session, onHide }) => {
    // The turns that the user expanded or collapsed
    const [toggled, setToggled] = React.useState<ReadonlyMap<number, boolean>>(() => new Map());
    const toggle = React.useCallback((turnId: number, expanded: boolean) => {
        setToggled(prev => new Map(prev).set(turnId, expanded));
    }, []);
    // The turns scroll within a fixed height, a new question scrolls them to the bottom, a new step or answer of the
    // latest question while the user stays at the bottom
    const turnsRef = React.useRef<HTMLUListElement>(null);
    const atBottomRef = React.useRef(true);
    const latestTurn = session.turns.length > 0 ? session.turns[session.turns.length - 1] : null;
    const latestTurnId = latestTurn?.turnId ?? null;
    const latestSteps = latestTurn?.steps.length ?? 0;
    const latestDone = latestTurn?.status == null;
    React.useLayoutEffect(() => {
        const list = turnsRef.current;
        if (list != null) list.scrollTop = list.scrollHeight;
        atBottomRef.current = true;
    }, [latestTurnId]);
    React.useLayoutEffect(() => {
        const list = turnsRef.current;
        if (list != null && atBottomRef.current) list.scrollTop = list.scrollHeight;
    }, [latestSteps, latestDone]);
    const onTurnsScroll = React.useCallback(() => {
        const list = turnsRef.current;
        if (list != null) atBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 8;
    }, []);
    return (
        <section className={styles.panel} aria-label="Conversation with the agent" data-testid="composer-agent">
            <div className={styles.header}>
                {/* The bar of Wobble above tells the harness and what it does */}
                <SparklesFillIcon size={12} className={styles.header_icon} />
                <span className={styles.header_title}>Conversation</span>
                <span className={styles.header_detail} data-testid="composer-agent-detail">
                    {session.turns.length === 1 ? '1 question' : `${session.turns.length} questions`}
                </span>
                <Button
                    className={styles.header_action}
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    data-testid="composer-agent-reset"
                    onClick={session.onReset}
                >
                    New conversation
                </Button>
                {onHide != null && (
                    <IconButton
                        variant={ButtonVariant.Invisible}
                        size={ButtonSize.Small}
                        aria-label="Hide the conversation"
                        data-testid="composer-agent-hide"
                        onClick={onHide}
                    >
                        <ChevronDownIcon size={16} />
                    </IconButton>
                )}
            </div>
            <ul ref={turnsRef} className={styles.turns} aria-label="Questions" onScroll={onTurnsScroll}>
                {session.turns.map((turn, index, turns) => {
                    const expanded = toggled.get(turn.turnId) ?? isTurnExpandedByDefault(turn, index, turns);
                    return (
                        <AgentTurnItem
                            key={turn.turnId}
                            turn={turn}
                            session={session}
                            expanded={expanded}
                            onToggle={() => toggle(turn.turnId, !expanded)}
                        />
                    );
                })}
            </ul>
        </section>
    );
};
