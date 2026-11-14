import * as React from 'react';
import * as styles from './agent_prompt_panel.module.css';

import { ButtonSize, ButtonVariant, IconButton } from '../ui/foundations/button.js';
import { IndicatorStatus, StatusIndicator } from '../ui/foundations/status_indicator.js';
import { ChevronRightIcon, SymbolIcon } from '../ui/foundations/symbol_icon.js';
import { harnessLabel, isAgentAnswering, isAgentWorking, type AgentSession, type AgentTurn } from './agent_session.js';

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

/// A question of the workbook with the answer of the agent.
/// A collapsed turn shows the question in one line, an expanded turn shows the question, the status line, the final
/// message and the error in full.
const AgentTurnItem: React.FC<{ turn: AgentTurn; session: AgentSession; expanded: boolean; onToggle: () => void }> = ({ turn, session, expanded, onToggle }) => {
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
                        aria-label={failed ? 'Dismiss the error' : 'Dismiss the answer'}
                        data-testid="question-dismiss"
                        onClick={() => session.onDismiss(questionId)}
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
    // The turns scroll within a fixed height, a new question scrolls them to the bottom
    const turnsRef = React.useRef<HTMLUListElement>(null);
    const latestQuestionId = session.turns.length > 0 ? session.turns[session.turns.length - 1].questionId : null;
    React.useLayoutEffect(() => {
        const list = turnsRef.current;
        if (list != null) list.scrollTop = list.scrollHeight;
    }, [latestQuestionId]);
    const detail = !session.connected ? 'lost the session' : working ? 'working' : `in ${session.folder}`;
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
                <ul ref={turnsRef} className={styles.turns} aria-label="Questions">
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
