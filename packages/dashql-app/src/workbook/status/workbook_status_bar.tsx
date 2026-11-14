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
import { WORKBOOK_STATUS_SOURCE_LABELS, WorkbookStatusSource, WorkbookStatusTone, type WorkbookStatus } from './workbook_status.js';
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
    /// Shows a script of a line of the log
    onShowScript?: (scriptKey: number) => void;
    /// What the eyes of Wobble look at, e.g. the caret of the composer
    gaze?: WobbleGaze;
    /// The time of the last input in the composer, Wobble squints happily while the user types
    lastInput?: () => number | null;
    /// Stops the animation of Wobble, e.g. while the view is hidden
    paused?: boolean;
}

/// The status of the indicators of the scripts and of Execute All, the bar shows it as a dot in their colors. A step that
/// a running thing left in the log is over, its dot is faint.
function statusIndicator(status: WorkbookStatus): IndicatorStatus {
    if (status.progress) return IndicatorStatus.None;
    switch (status.tone) {
        case WorkbookStatusTone.Progress: return IndicatorStatus.Running;
        case WorkbookStatusTone.Success: return IndicatorStatus.Succeeded;
        case WorkbookStatusTone.Failed: return IndicatorStatus.Failed;
        case WorkbookStatusTone.Attention: return IndicatorStatus.Blocked;
    }
}

/// The time of a line of the log
function formatLogTime(at: number): string {
    return new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
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

/// A line of the log of the workbook: the time, the source, the text and the whole detail
function LogLine(props: { line: WorkbookStatus; onShowScript?: (scriptKey: number) => void }) {
    const { line } = props;
    const content = (
        <>
            <time className={styles.log_time} dateTime={new Date(line.at).toISOString()}>{formatLogTime(line.at)}</time>
            <StatusDot className={styles.indicator} status={statusIndicator(line)} />
            <span className={styles.log_source}>{WORKBOOK_STATUS_SOURCE_LABELS[line.source]}</span>
            <span className={styles.log_text}>{line.text}</span>
            {line.detail != null && <span className={styles.log_detail}>{line.detail}</span>}
        </>
    );
    const scriptKey = line.scriptKey;
    return (
        <li className={styles.log_line} data-testid="workbook-log-line" data-tone={line.tone} data-step={line.progress ? '' : undefined}>
            {scriptKey != null && props.onShowScript != null
                ? <button type="button" className={styles.log_button} onClick={() => props.onShowScript!(scriptKey)}>{content}</button>
                : <div className={styles.log_row}>{content}</div>}
        </li>
    );
}

/// The bar of Wobble. Wobble leads it and tells the status of the workbook next to it: what runs, what needs the user,
/// else what happened last. The agent sits at the right end.
/// A click on Wobble opens a dark bubble above the bar with the questions of the agent and the log of the workbook,
/// every status with its detail: what started, every step, how it ended.
/// It opens by itself when the agent starts to work and stays open until the user closes it. A dot pulses at the top
/// right of Wobble while anything runs.
export function WorkbookStatusBar(props: WorkbookStatusBarProps): React.ReactElement {
    const agent = props.agent ?? null;
    const wobble = props.wobble ?? true;
    const { status, log, live, busy } = useWorkbookStatus(props.workbookId);
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
    const close = React.useCallback(() => setOpen(false), []);
    // The log scrolls to the newest line
    const logRef = React.useRef<HTMLOListElement>(null);
    const newest = log.length > 0 ? log[log.length - 1].key : null;
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
                {status != null && <StatusDot className={styles.indicator} status={statusIndicator(status)} />}
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
                <div id={bubbleId} className={styles.bubble} data-testid="workbook-bubble">
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
                            {log.map(line => <LogLine key={line.key} line={line} onShowScript={props.onShowScript} />)}
                        </ol>
                    ) : !agentTurns && (
                        <div className={styles.empty} data-testid="workbook-bubble-empty">
                            Nothing happened yet. Runs, connections, files and the questions of the agent show up here.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
