import * as React from 'react';
import * as styles from './workbook_status_bar.module.css';

import { Wobble, WobbleMode, type WobbleGaze } from '../../agent/wobble.js';
import { AgentPromptPanel, harnessLabel, isAgentWorking, type ComposerAgent } from '../../agent/agent_prompt_panel.js';
import { AgentAccessState, AgentWorkbookMenu, agentAccessState } from '../../agent/agent_workbook_menu.js';
import type { AgentBridge } from '../../agent/agent_bridge.js';
import { isAgentAnswering } from '../../agent/use_agent_questions.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { SquareFillIcon, XIcon } from '../../ui/foundations/symbol_icon.js';
import { IndicatorStatus, StatusDot } from '../../ui/foundations/status_indicator.js';
import { WorkbookStatusSource, WorkbookStatusTone } from './workbook_status.js';
import { useWorkbookLog } from './workbook_log.js';
import { getLogLevelName, type LogRecord } from '../../platform/logger/log_buffer.js';
import { formatLogTimestamp } from '../../ui/logs/log_viewer.js';
import { LogJsonModal } from '../../ui/logs/log_json_modal.js';
import { AnchorAlignment, AnchorSide } from '../../ui/foundations/anchored_position.js';
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
    /// The agent bridge, null without: the bar shows no agent then
    bridge: AgentBridge | null;
    /// The agent of the workbook with its questions, only the feed has it. Without, the log shows no questions and
    /// the bar no stop button.
    agent?: ComposerAgent | null;
    /// Show Wobble with the log? The landing view greets with its own Wobble, the bar only tells the status then.
    wobble?: boolean;
    /// What the eyes of Wobble look at, e.g. the caret of the composer
    gaze?: WobbleGaze;
    /// The time of the last input in the composer, Wobble squints happily while the user types
    lastInput?: () => number | null;
    /// Stops the animation of Wobble, e.g. while the view is hidden
    paused?: boolean;
}

/// The agent at the right end of the bar: Enable Agent without agent access, else its state, stop and its menu
function AgentControls(props: { workbookId: string; bridge: AgentBridge; agent: ComposerAgent | null; working: boolean }) {
    const { agent, bridge } = props;
    const state = agentAccessState(bridge, props.workbookId);
    if (state === AgentAccessState.Unsupported || state === AgentAccessState.Off) {
        return <AgentWorkbookMenu workbookId={props.workbookId} />;
    }
    let title: string;
    if (state === AgentAccessState.Connecting) {
        title = `Waiting for the agent server on port ${bridge.port}`;
    } else if (agent?.context != null) {
        title = `${harnessLabel(agent.context.harness)} in ${agent.context.folder}`;
    } else {
        title = 'Connected to the agent server';
    }
    const dot = props.working ? 'working' : state === AgentAccessState.Connecting ? 'connecting' : 'connected';
    const stop = agent == null ? null : () => {
        for (const turn of agent.turns) {
            if (isAgentAnswering(turn.question)) agent.onStop(turn.questionId);
        }
    };
    return (
        <>
            <span className={styles.agent} title={title} data-testid="workbook-agent-state" data-state={dot}>
                <StatusDot className={styles.indicator} status={dot === 'working' ? IndicatorStatus.Running
                    : dot === 'connected' ? IndicatorStatus.Succeeded : IndicatorStatus.None} />
                Agent
            </span>
            {props.working && stop != null && (
                <IconButton variant={ButtonVariant.Invisible} size={ButtonSize.Small} aria-label="Stop the agent"
                    tooltipDirection="n" data-testid="workbook-agent-stop" onClick={stop}>
                    <SquareFillIcon size={12} />
                </IconButton>
            )}
            <AgentWorkbookMenu workbookId={props.workbookId} />
        </>
    );
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

/// The bar of Wobble. Wobble leads it and tells the status of the workbook next to it: what runs, what needs the user,
/// else what happened last. The dot of Wobble tells that something runs, a failure is red, the status has no dot of its
/// own. The agent sits at the right end.
/// A click on Wobble opens a dark bubble above the bar with the questions of the agent and the log of the workbook: the
/// records of the log of the app that belong to the workbook, the same that the log window shows.
/// It opens by itself when the agent starts to work and stays open until the user closes it. A dot pulses at the top
/// right of Wobble while anything runs.
export function WorkbookStatusBar(props: WorkbookStatusBarProps): React.ReactElement {
    const agent = props.agent ?? null;
    const wobble = props.wobble ?? true;
    const { status, live, busy } = useWorkbookStatus(props.workbookId);
    const agentWorking = agent != null
        ? isAgentWorking(agent)
        : live.some(s => s.source === WorkbookStatusSource.Agent && s.tone === WorkbookStatusTone.Progress);
    const [open, setOpen] = React.useState(agentWorking);
    // The bubble opens when the agent starts to work, while rendering like a state that follows a prop
    const [wasWorking, setWasWorking] = React.useState(agentWorking);
    if (agentWorking !== wasWorking) {
        setWasWorking(agentWorking);
        if (agentWorking) setOpen(true);
    }
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
    const agentTurns = agent != null && agent.turns.length > 0;
    return (
        <div className={styles.bar} data-variant={props.variant} data-testid="workbook-status-bar">
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
                    <Wobble className={styles.wobble} aria-hidden="true" mode={WobbleMode.Face} paused={props.paused} gaze={props.gaze} lastInput={props.lastInput} />
                    {busy && <span className={styles.busy_dot} aria-hidden="true" data-testid="workbook-wobble-dot" />}
                </button>
            )}
            <span className={styles.status} role="status" aria-live="polite" data-testid="workbook-status"
                data-tone={status?.tone} data-source={status?.source}>
                <span className={styles.status_text}>
                    {status?.text ?? 'Ready'}
                    {status?.detail != null && <span className={styles.detail}> {status.detail}</span>}
                </span>
            </span>
            {props.bridge != null && (
                <div className={styles.agent_controls}>
                    <AgentControls workbookId={props.workbookId} bridge={props.bridge} agent={agent} working={agentWorking} />
                </div>
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
                    {agentTurns && <AgentPromptPanel agent={agent} />}
                    {log.length > 0 ? (
                        <ol ref={logRef} className={styles.log} aria-label="Log of the workbook">
                            {log.map((record, i) => <LogLine key={i} record={record} selected={i === selected && selectedRecord != null} onSelect={() => setSelected(i)} />)}
                        </ol>
                    ) : !agentTurns && (
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
