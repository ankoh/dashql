import * as React from 'react';
import * as styles from './workbook_status_bar.module.css';

import { Wobble, WobbleMode, type WobbleGaze, type WobbleTuning } from '../../agent/wobble.js';
import { agentActivity, harnessLabel, type AgentActivity, type AgentSession } from '../../agent/agent_session.js';
import { ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { ChevronDownIcon, ChevronUpIcon, XIcon } from '@akohn/dashql-react/components/symbol_icon';
import { IndicatorStatus, StatusDot } from '@akohn/dashql-react/components/status_indicator';
import { WorkbookStatusSource, WorkbookStatusTone } from './workbook_status.js';
import { useWorkbookLog } from './workbook_log.js';
import { getLogLevelName, type LogRecord } from '@akohn/dashql/platform/logger/log_buffer';
import { formatLogTimestamp } from '../../diagnostics/logs/log_viewer.js';
import { LogJsonModal } from '../../diagnostics/logs/log_json_modal.js';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { useWorkbookStatus } from './workbook_status_store.js';

/// Where the bar stands
export enum WorkbookStatusBarVariant {
    /// The header bar of the prompt of the feed, the frame of the prompt holds it
    Prompt = 'prompt',
    /// A bar of its own, e.g. at the bottom of the dashboard
    Standalone = 'standalone',
}

export interface WorkbookStatusBarProps {
    workbookId: string;
    variant: WorkbookStatusBarVariant;
    /// The conversation of the agent on the workbook, only the feed has it. Without, the bar shows no agent.
    session?: AgentSession | null;
    /// Show the conversation with the agent in the prompt, a click on the agent at the right end does
    onShowAgent?: () => void;
    /// Show Wobble with the log? The landing view greets with its own Wobble, the bar only tells the status then.
    wobble?: boolean;
    /// What the eyes of Wobble look at, e.g. the caret of the composer
    gaze?: WobbleGaze;
    /// The time of the last input in the composer, Wobble squints happily while the user types
    lastInput?: () => number | null;
    /// Stops the animation of Wobble, e.g. while the view is hidden
    paused?: boolean;
    /// The prompt below the bar: a click on the bar or its chevron shows or hides it. Without, the bar takes no click.
    prompt?: WorkbookStatusBarPrompt;
}

/// The prompt that the bar shows and hides
export interface WorkbookStatusBarPrompt {
    /// Is the prompt shown below the bar?
    expanded: boolean;
    /// Show or hide the prompt
    onToggle: () => void;
}

/// The parts of the bar that handle a click themselves
const BAR_CONTROLS = 'button, a, input, select, textarea, [role="button"]';

/// The agent at the right end of the bar: the harness of the latest question, a click shows the conversation
function AgentState(props: { session: AgentSession; activity: AgentActivity['kind']; onShow?: () => void }) {
    const { session } = props;
    const working = props.activity !== 'idle';
    const content = (
        <>
            <StatusDot className={styles.indicator} status={working ? IndicatorStatus.Running : IndicatorStatus.None} />
            {harnessLabel(session.harness)}
        </>
    );
    if (props.onShow == null) {
        return (
            <span className={styles.agent} title={harnessLabel(session.harness)}
                data-testid="workbook-agent-state" data-state={working ? 'working' : 'idle'}>
                {content}
            </span>
        );
    }
    return (
        <button type="button" className={styles.agent} aria-label={`Show the conversation with ${harnessLabel(session.harness)}`}
            data-testid="workbook-agent-state" data-state={working ? 'working' : 'idle'} onClick={props.onShow}>
            {content}
        </button>
    );
}

/// How long Wobble keeps its happy eyes for an answer of the agent
const ANSWER_JOY_MS = 1200;

/// The time of the latest answer of the agent on the clock of `performance.now()`, null before one. A question that
/// failed or that the user stopped is no answer.
function useAgentAnsweredAt(session: AgentSession | null): () => number | null {
    const answeredAt = React.useRef<number | null>(null);
    const working = React.useRef(new Set<number>());
    React.useEffect(() => {
        const before = working.current;
        const now = new Set<number>();
        for (const turn of session?.turns ?? []) {
            if (turn.status != null) now.add(turn.turnId);
            else if (before.has(turn.turnId) && turn.error == null && !turn.interrupted) answeredAt.current = performance.now();
        }
        working.current = now;
    }, [session]);
    return React.useCallback(() => answeredAt.current, []);
}

/// A record of the log of the workbook in one short line, as the log window shows it: the time, the level, the message
/// and the target. A click opens the record with its fields.
function LogLine(props: { record: LogRecord; selected: boolean; onSelect: () => void }) {
    const { record } = props;
    return (
        <li className={styles.log_line} data-testid="workbook-log-line" data-level={getLogLevelName(record.level)}
            data-selected={props.selected ? '' : undefined}>
            <button type="button" className={styles.log_button} onClick={props.onSelect}>
                <span className={styles.log_time}>{formatLogTimestamp(record.timestamp)}</span>
                <span className={styles.log_level}>{getLogLevelName(record.level)}</span>
                <span className={styles.log_text} title={record.message}>{record.message}</span>
                <span className={styles.log_target}>{record.target}</span>
            </button>
        </li>
    );
}

/// Wobble while the agent works: the face moves faster and the eyes dart around, it reads along
const WOBBLE_AGENT_WORKING: Partial<WobbleTuning> = { wobble: 0.04, wobbleSpeed: 2.4, glanceIntervalMs: 700 };

/// The bar of Wobble. Wobble leads it and tells the status of the workbook next to it: what runs, what needs the user,
/// else what happened last. The dot of Wobble tells that something runs, a failure is red, the status has no dot of its
/// own. The agent sits at the right end.
/// A click on Wobble opens a dark bubble above the bar with the log of the workbook: the records of the log of the app
/// that belong to the workbook, the same that the log window shows. The conversation with the agent is in the prompt,
/// the agent at the right end shows it. Wobble reads along while the agent works and is happy when it answered.
/// A dot pulses at the top right of Wobble while anything runs.
export function WorkbookStatusBar(props: WorkbookStatusBarProps): React.ReactElement {
    const session = props.session ?? null;
    // Wobble is happy while the user types and when the agent answered
    const answeredAt = useAgentAnsweredAt(session);
    const { lastInput } = props;
    const wobbleInput = React.useCallback(() => {
        const input = lastInput?.() ?? null;
        const answered = answeredAt();
        // The answer holds the eyes longer than a keystroke, Wobble takes it as input that goes on for a while
        const joy = answered == null || performance.now() - answered > ANSWER_JOY_MS ? null : performance.now();
        return input == null ? joy : joy == null ? input : Math.max(input, joy);
    }, [lastInput, answeredAt]);
    const wobble = props.wobble ?? true;
    const { status, live, busy } = useWorkbookStatus(props.workbookId);
    const activity = session != null ? agentActivity(session).kind : 'idle';
    const agentWorking = session != null
        ? activity !== 'idle'
        : live.some(s => s.source === WorkbookStatusSource.Agent && s.tone === WorkbookStatusTone.Progress);
    const [open, setOpen] = React.useState(false);
    const bubbleId = React.useId();
    const log = useWorkbookLog(props.workbookId, wobble && open);
    // The record whose fields the overlay shows, as in the log window
    const [selected, setSelected] = React.useState<number | null>(null);
    const bubbleRef = React.useRef<HTMLDivElement>(null);
    const selectedRecord = selected != null && open ? log[selected] ?? null : null;
    const close = React.useCallback(() => setOpen(false), []);
    // The log scrolls to the newest line
    const logRef = React.useRef<HTMLOListElement>(null);
    const newest = log.length;
    React.useLayoutEffect(() => {
        const list = logRef.current;
        if (list != null) list.scrollTop = list.scrollHeight;
    }, [newest, open]);
    // A click on the background of the bar shows or hides the prompt, Wobble, the log and the controls keep theirs
    const prompt = props.prompt ?? null;
    const handleBarClick = React.useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        const target = event.target;
        if (prompt == null || event.button !== 0 || !(target instanceof Element)) return;
        // The overlays of the log are portals, their events still bubble through here
        if (!event.currentTarget.contains(target) || bubbleRef.current?.contains(target)) return;
        if (target.closest(BAR_CONTROLS) != null) return;
        prompt.onToggle();
    }, [prompt]);
    return (
        <div className={styles.bar} data-variant={props.variant} data-testid="workbook-status-bar"
            data-prompt={prompt == null ? undefined : prompt.expanded ? 'expanded' : 'collapsed'}
            onClick={prompt == null ? undefined : handleBarClick}>
            {wobble && (
                <button
                    type="button"
                    className={styles.wobble_button}
                    aria-label="Workbook log"
                    aria-expanded={open}
                    aria-controls={open ? bubbleId : undefined}
                    data-testid="workbook-wobble"
                    onClick={() => setOpen(o => !o)}
                >
                    <Wobble className={styles.wobble} aria-hidden="true" mode={WobbleMode.Face} paused={props.paused}
                        tuning={agentWorking ? WOBBLE_AGENT_WORKING : undefined}
                        gaze={props.gaze} lastInput={wobbleInput} />
                    {busy && <span className={styles.busy_dot} aria-hidden="true" data-testid="workbook-wobble-dot" data-state="busy" />}
                </button>
            )}
            <span className={styles.status} role="status" aria-live="polite" data-testid="workbook-status"
                data-tone={status?.tone} data-source={status?.source}>
                <span className={styles.status_text}>
                    {status?.text ?? 'Ready'}
                    {status?.detail != null && <span className={styles.detail}> {status.detail}</span>}
                </span>
            </span>
            {session != null && (
                <div className={styles.agent_controls}>
                    <AgentState session={session} activity={activity} onShow={props.onShowAgent} />
                </div>
            )}
            {prompt != null && (
                <IconButton
                    className={styles.prompt_toggle}
                    variant={ButtonVariant.Invisible}
                    size={ButtonSize.Small}
                    aria-label={prompt.expanded ? 'Hide the prompt' : 'Show the prompt'}
                    aria-expanded={prompt.expanded}
                    tooltipDirection="n"
                    data-testid="workbook-prompt-toggle"
                    onClick={prompt.onToggle}
                >
                    {prompt.expanded ? <ChevronDownIcon size={16} /> : <ChevronUpIcon size={16} />}
                </IconButton>
            )}
            {wobble && open && (
                <div id={bubbleId} ref={bubbleRef} className={styles.bubble} data-testid="workbook-bubble">
                    <div className={styles.bubble_header}>
                        <span className={styles.bubble_title}>Log</span>
                        <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small} aria-label="Close the log"
                            data-testid="workbook-bubble-close" onClick={close}>
                            <XIcon size={14} />
                        </IconButton>
                    </div>
                    {log.length > 0 ? (
                        <ol ref={logRef} className={styles.log} aria-label="Log of the workbook">
                            {log.map((record, i) => <LogLine key={i} record={record} selected={i === selected && selectedRecord != null} onSelect={() => setSelected(i)} />)}
                        </ol>
                    ) : (
                        <div className={styles.empty} data-testid="workbook-bubble-empty">
                            Nothing logged yet. The runs of the scripts, the agent, attachments and publishes of the workbook show up here.
                        </div>
                    )}
                </div>
            )}
            <LogJsonModal
                record={selectedRecord}
                recordIndex={selected ?? -1}
                maxIndex={log.length - 1}
                anchorRef={bubbleRef}
                align={AnchorAlignment.End}
                side={AnchorSide.OutsideRight}
                onClose={() => setSelected(null)}
                onPrevious={() => setSelected(i => i != null && i > 0 ? i - 1 : i)}
                onNext={() => setSelected(i => i != null && i < log.length - 1 ? i + 1 : i)}
            />
        </div>
    );
}
