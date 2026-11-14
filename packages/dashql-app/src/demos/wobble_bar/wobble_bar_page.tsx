import * as React from 'react';

import { WorkbookStatusBar, WorkbookStatusBarVariant } from '../../workbook/status/workbook_status_bar.js';
import { WORKBOOK_STATUS_LOG_TARGET, WorkbookStatusContext, WorkbookStatusStore } from '../../workbook/status/workbook_status_store.js';
import { LogLevel, type LogRecord } from '../../platform/logger/log_buffer.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { WorkbookStatusSource, WorkbookStatusTone, type WorkbookStatus } from '../../workbook/status/workbook_status.js';
import { agentLiveStatuses } from '../../agent/agent_workbook_status.js';
import type { ComposerAgent, ComposerAgentTurn } from '../../agent/agent_prompt_panel.js';
import { AgentBridgeContext, type AgentBridge } from '../../agent/agent_bridge.js';
import { AgentQuestionStore } from '../../agent/agent_question_store.js';
import { AgentConnectionStatus } from '../../agent/agent_client.js';
import { ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { SegmentedControl, SegmentedControlSize } from '../../ui/foundations/segmented_control.js';
import { CodeIcon, PaperAirplaneIcon, SymbolIcon } from '../../ui/foundations/symbol_icon.js';
import * as composerStyles from '../../workbook/feed/workbook_composer.module.css';
import * as styles from './wobble_bar_page.module.css';

const SparklesFillIcon = SymbolIcon('sparkles_fill_16');
const SURFACES = ['light', 'dark'] as const;
const WORKBOOK_ID = 'demo';

/// An agent bridge that only tells the bar its state
function fakeBridge(state: { supported?: boolean; access?: boolean; status?: AgentConnectionStatus }): AgentBridge {
    const noop = () => { };
    return {
        status: state.status ?? AgentConnectionStatus.Connected,
        supported: state.supported ?? true,
        port: 47100,
        setPort: noop,
        harness: null,
        setHarness: noop,
        model: null,
        setModel: noop,
        effort: null,
        setEffort: noop,
        enabled: state.access ?? true,
        hasAccess: () => state.access ?? true,
        setEnabled: noop,
        request: () => Promise.reject(new Error('demo')),
        cancel: () => Promise.resolve(),
        reset: () => Promise.resolve(),
        context: () => Promise.reject(new Error('demo')),
        info: () => Promise.reject(new Error('demo')),
        hold: () => noop,
        questions: new AgentQuestionStore(),
    };
}

/// The agent of the workbook as the feed hands it to the bar
function fakeAgent(turns: ComposerAgentTurn[], connected = true): ComposerAgent {
    return {
        connected,
        port: 47100,
        context: connected ? { folder: '~/data/sales', harness: 'claude', harnessSession: turns.length > 0 ? 'session' : null, terminalCommand: null } : null,
        turns,
        onStop: () => { },
        onDismiss: () => { },
        onShowScript: () => { },
    };
}

const SCRIPTS = [{ scriptKey: 2, scriptName: '2_region_growth' }];
const WORKING: ComposerAgentTurn = {
    questionId: 1,
    question: { question: 'Which regions grew the most last quarter?', status: 'dashql agent run 2_region_growth', error: null, note: null, scripts: [2] },
    scripts: SCRIPTS,
};
const ANSWERED: ComposerAgentTurn = {
    questionId: 1,
    question: {
        question: 'Which regions grew the most last quarter?',
        status: null,
        error: null,
        note: 'EMEA grew the most, 18% over the previous quarter. The script 2_region_growth compares the quarters.',
        scripts: [2],
    },
    scripts: SCRIPTS,
};
const FAILED: ComposerAgentTurn = {
    questionId: 2,
    question: { question: 'And by product?', status: null, error: 'The harness exited with code 1', note: null, scripts: [] },
    scripts: [],
};
const LONG_STATUS: ComposerAgentTurn = {
    questionId: 1,
    question: {
        question: 'Compare the revenue of every region and product over the last eight quarters',
        status: 'dashql agent edit 4_revenue_by_region_and_product_over_the_last_eight_quarters --text …',
        error: null,
        note: null,
        scripts: [],
    },
    scripts: [],
};

/// A line of the status, `minutes` before now
function line(key: string, source: WorkbookStatusSource, tone: WorkbookStatusTone, text: string, detail: string | null = null, minutes = 0, scriptKey: number | null = null): WorkbookStatus {
    return { key, source, tone, text, detail, scriptKey, at: Date.now() - minutes * 60_000 };
}
/// A step of what ran, a record of the log like the query executor and Execute All write it
type DemoLine = WorkbookStatus & { step?: boolean };
function step(status: WorkbookStatus): DemoLine {
    return { ...status, step: true };
}

/// The targets of the records of the steps
const STEP_TARGETS: Record<WorkbookStatusSource, string> = {
    [WorkbookStatusSource.Agent]: 'agent_bridge',
    [WorkbookStatusSource.ExecuteAll]: 'workbook_execution',
    [WorkbookStatusSource.Query]: 'query_executor',
    [WorkbookStatusSource.Files]: 'workbook_feed',
    [WorkbookStatusSource.Cloud]: 'cloud_workbooks',
    [WorkbookStatusSource.Connection]: 'connection_registry',
};

/// The record of the log of a line of the demo
function demoRecord(workbookId: string, line: DemoLine): LogRecord {
    const failed = line.tone === WorkbookStatusTone.Failed;
    return {
        timestamp: line.at,
        level: failed ? LogLevel.Warn : LogLevel.Info,
        target: line.step ? STEP_TARGETS[line.source] : WORKBOOK_STATUS_LOG_TARGET,
        message: line.step ? line.detail ?? line.text : line.text,
        context: null,
        tracing: null,
        keyValues: line.step
            ? { workbookId, task: line.text }
            : { workbookId, source: line.source, detail: line.detail ?? undefined, scriptKey: line.scriptKey != null ? String(line.scriptKey) : undefined },
    };
}
const Q = WorkbookStatusSource.Query;
const T = WorkbookStatusTone;

/// The log of a workbook that the user worked in for a while
const LOG: DemoLine[] = [
    step(line('s1', WorkbookStatusSource.Connection, T.Progress, 'Connecting to Trino', null, 15)),
    line('l1', WorkbookStatusSource.Connection, T.Success, 'Connected to Trino', null, 14),
    step(line('s2', Q, T.Progress, 'Running 1_orders', 'Preparing query', 13, 1)),
    step(line('s3', Q, T.Progress, 'Running 1_orders', 'Executing query', 13, 1)),
    step(line('s4', Q, T.Progress, 'Running 1_orders', 'Received all batches', 12, 1)),
    line('l2', Q, T.Success, '1_orders ran', 'in 412 ms · 1,204 rows', 12, 1),
    step(line('s5', WorkbookStatusSource.Files, T.Progress, 'Attaching a file', null, 9)),
    line('l3', WorkbookStatusSource.Files, T.Success, 'Attached sales_2026.parquet', null, 9),
    step(line('s6', Q, T.Progress, 'Running 3_revenue', 'Executing query', 6, 3)),
    line('l4', Q, T.Failed, '3_revenue failed', 'column "amt" does not exist\nLINE 1: select region, sum(amt) from orders group by region\n                          ^\nHINT: Perhaps you meant to reference the column "orders.amount".', 6, 3),
    step(line('s7', WorkbookStatusSource.ExecuteAll, T.Progress, 'Running all scripts', '1/5 · 1_orders', 4)),
    step(line('s8', WorkbookStatusSource.ExecuteAll, T.Progress, 'Running all scripts', '3/5 · 3_revenue', 3)),
    line('l5', WorkbookStatusSource.ExecuteAll, T.Success, 'Ran all scripts', '5 scripts', 3),
];

/// A situation of the bar
interface Situation {
    id: string;
    title: string;
    description: string;
    bridge: AgentBridge;
    agent: ComposerAgent | null;
    /// What runs and what needs the user, besides the agent
    live?: WorkbookStatus[];
    /// What happened
    log?: DemoLine[];
    /// A bar of its own below the dashboard, without the prompt
    standalone?: boolean;
    /// The landing view of an empty workbook
    landing?: boolean;
    /// The width of the bar
    width?: number;
}

const AGENT_OFF = fakeBridge({ access: false, status: AgentConnectionStatus.Off });

const SITUATIONS: Situation[] = [
    {
        id: 'ready',
        title: 'Nothing happened yet',
        description: 'A workbook that was just opened, the agent is off.',
        bridge: AGENT_OFF,
        agent: null,
    },
    {
        id: 'query',
        title: 'A query runs',
        description: 'The script and its statement. The dot on Wobble pulses while anything runs.',
        bridge: AGENT_OFF,
        agent: null,
        live: [line('q', Q, T.Progress, 'Running 2_region_growth', 'statement 2/3', 0, 2)],
        log: LOG,
    },
    {
        id: 'ran',
        title: 'A query ran',
        description: 'Without anything running, Wobble tells what happened last.',
        bridge: AGENT_OFF,
        agent: null,
        log: [...LOG, line('l6', Q, T.Success, '2_region_growth ran', 'in 1.24 s', 0, 2)],
    },
    {
        id: 'failed',
        title: 'A query failed',
        description: 'A failed line in red, the log jumps to the script.',
        bridge: AGENT_OFF,
        agent: null,
        log: [...LOG, line('l6', Q, T.Failed, '2_region_growth failed', 'division by zero', 0, 2)],
    },
    {
        id: 'execute_all',
        title: 'Execute All',
        description: 'The progress of the run and the script it runs, instead of the queries of the run.',
        bridge: fakeBridge({}),
        agent: fakeAgent([]),
        live: [line('e', WorkbookStatusSource.ExecuteAll, T.Progress, 'Running all scripts', '3/5 · 3_revenue')],
        log: LOG,
    },
    {
        id: 'connection',
        title: 'A connection is not connected',
        description: 'What needs the user comes after what runs and before what happened.',
        bridge: AGENT_OFF,
        agent: null,
        live: [line('c', WorkbookStatusSource.Connection, T.Attention, 'Trino is not connected', 'the connection failed')],
        log: LOG,
    },
    {
        id: 'files',
        title: 'Files and publishing',
        description: 'Attaching files, publishing the workbook to a cloud.',
        bridge: fakeBridge({}),
        agent: fakeAgent([]),
        live: [line('f', WorkbookStatusSource.Files, T.Progress, 'Attaching 2 files')],
        log: [...LOG, line('l6', WorkbookStatusSource.Cloud, T.Success, 'Published the workbook', null, 1)],
    },
    {
        id: 'connecting',
        title: 'Waiting for the agent server',
        description: 'Agent access is on, the page looks for the agent server.',
        bridge: fakeBridge({ status: AgentConnectionStatus.Connecting }),
        agent: fakeAgent([], false),
        log: LOG,
    },
    {
        id: 'working',
        title: 'The agent works',
        description: 'The agent leads what runs. Stop at the right end, the log with its question opens by itself.',
        bridge: fakeBridge({}),
        agent: fakeAgent([WORKING]),
        live: [line('q', Q, T.Progress, 'Running 2_region_growth', null, 0, 2)],
        log: LOG,
    },
    {
        id: 'answered',
        title: 'The agent answered',
        description: 'The answer is a line of the log, the log shows the questions above the lines.',
        bridge: fakeBridge({}),
        agent: fakeAgent([ANSWERED, FAILED]),
        log: [...LOG, line('l6', WorkbookStatusSource.Agent, T.Success, 'The agent answered', 'Which regions grew the most last quarter?', 0, 2)],
    },
    {
        id: 'narrow',
        title: 'Narrow',
        description: 'A long status is cut off with an ellipsis.',
        bridge: fakeBridge({}),
        agent: fakeAgent([LONG_STATUS]),
        width: 440,
    },
    {
        id: 'unsupported',
        title: 'Not available in this browser',
        description: 'Safari cannot reach the agent server on 127.0.0.1, Enable Agent is disabled.',
        bridge: fakeBridge({ supported: false, access: false, status: AgentConnectionStatus.Off }),
        agent: null,
        log: LOG,
    },
    {
        id: 'standalone',
        title: 'Without the prompt',
        description: 'The bar of its own at the bottom of the dashboard, the dataflow and a read-only workbook.',
        bridge: fakeBridge({}),
        agent: null,
        live: [line('e', WorkbookStatusSource.ExecuteAll, T.Progress, 'Running all scripts', '2/5 · 2_region_growth')],
        log: LOG,
        standalone: true,
    },
    {
        id: 'landing',
        title: 'Landing view',
        description: 'The prompt of an empty workbook. The greeting is Wobble, the bar leaves its own Wobble out.',
        bridge: AGENT_OFF,
        agent: null,
        landing: true,
    },
];

/// The situations that wrote their log already, the log of the app keeps the records for the session
const LOGGED = new Set<string>();

/// The status of a situation in a store of its own. Its log goes to the log of the app under a workbook of its own,
/// the log window shows it as well.
function useSituationStore(situation: Situation): WorkbookStatusStore {
    const logger = useLogger();
    return React.useMemo(() => {
        const store = new WorkbookStatusStore();
        const workbookId = situationWorkbookId(situation);
        store.setLive(workbookId, 'demo', situation.live ?? []);
        store.setLive(workbookId, 'agent', agentLiveStatuses(situation.bridge, workbookId, situation.agent, Date.now()));
        const log = situation.log ?? [];
        if (!LOGGED.has(workbookId)) {
            LOGGED.add(workbookId);
            for (const line of log) logger.push(demoRecord(workbookId, line));
        }
        const outcomes = log.filter(line => !line.step);
        if (outcomes.length > 0) store.setOutcome(workbookId, outcomes[outcomes.length - 1]);
        return store;
    }, [situation, logger]);
}

/// Every situation has a workbook of its own, with a log of its own
function situationWorkbookId(situation: Situation): string {
    return `${WORKBOOK_ID}_${situation.id}`;
}

/// The prompt of the feed with the real bar of the agent, built from the classes of the composer
function DemoPrompt(props: { situation: Situation }) {
    const { situation } = props;
    const ai = situation.agent?.connected ?? false;
    const store = useSituationStore(situation);
    if (situation.standalone) {
        return (
            <WorkbookStatusContext.Provider value={store}>
                <AgentBridgeContext.Provider value={situation.bridge}>
                    <WorkbookStatusBar workbookId={situationWorkbookId(situation)} variant={WorkbookStatusBarVariant.Standalone} bridge={situation.bridge} gaze={{ pointer: true }} />
                </AgentBridgeContext.Provider>
            </WorkbookStatusContext.Provider>
        );
    }
    return (
        <WorkbookStatusContext.Provider value={store}>
        <AgentBridgeContext.Provider value={situation.bridge}>
            <div className={composerStyles.composer} data-variant={situation.landing ? 'hero' : 'docked'}
                data-agent={situation.agent?.turns.some(turn => turn.question.status != null) ? 'working' : undefined}>
                <div className={composerStyles.composer_bar}>
                    <WorkbookStatusBar workbookId={situationWorkbookId(situation)} variant={WorkbookStatusBarVariant.Prompt} bridge={situation.bridge}
                        agent={situation.agent} wobble={!situation.landing} gaze={{ pointer: true }} />
                </div>
                <div className={composerStyles.composer_prompt}>
                    <div className={`${composerStyles.composer_editor} ${styles.editor}`}>
                        <span className={styles.editor_placeholder}>{ai ? 'Ask a question about your data, Shift+Enter for a new line' : 'Write a query, press Enter to run it and Shift+Enter for a new line'}</span>
                    </div>
                    <div className={composerStyles.composer_action_bar}>
                        <SegmentedControl aria-label="Input mode" size={SegmentedControlSize.Small} onChange={() => { }}>
                            <SegmentedControl.Button leadingVisual={CodeIcon} selected={!ai}>SQL</SegmentedControl.Button>
                            <SegmentedControl.Button leadingVisual={SparklesFillIcon} selected={ai} disabled={!ai}>AI</SegmentedControl.Button>
                        </SegmentedControl>
                        <div className={composerStyles.composer_trailing_actions}>
                            <span className={styles.connection}><span className={styles.connection_dot} />Hyper</span>
                            <IconButton size={ButtonSize.Small} variant={ButtonVariant.Default} aria-label="Send" tooltipDirection="n">
                                <PaperAirplaneIcon />
                            </IconButton>
                        </div>
                    </div>
                </div>
            </div>
        </AgentBridgeContext.Provider>
        </WorkbookStatusContext.Provider>
    );
}

/// The bar of Wobble on the prompt of the feed and of its own, in the situations it shows
function WobbleBarPage(): React.ReactElement {
    const [surface, setSurface] = React.useState<(typeof SURFACES)[number]>('light');
    return (
        <div className={styles.root} data-surface={surface}>
            <div className={styles.header}>
                <h1 className={styles.title}>Wobble Bar</h1>
                <p className={styles.subtitle}>Wobble tells the status of the workbook on the prompt of the feed and below the other views. A click on Wobble opens the log.</p>
                <div className={styles.controls}>
                    <SegmentedControl aria-label="Color scheme" size={SegmentedControlSize.Small} onChange={index => setSurface(SURFACES[index])}>
                        {SURFACES.map(value => (
                            <SegmentedControl.Button key={value} selected={value === surface}>{value === 'light' ? 'Light' : 'Dark'}</SegmentedControl.Button>
                        ))}
                    </SegmentedControl>
                </div>
            </div>
            <div className={styles.situations}>
                {SITUATIONS.map(situation => (
                    <section key={situation.id} className={styles.situation} aria-labelledby={`situation-${situation.id}`} data-testid={`situation-${situation.id}`}>
                        <h2 id={`situation-${situation.id}`} className={styles.situation_title}>{situation.title}</h2>
                        <p className={styles.situation_description}>{situation.description}</p>
                        {/* The log stands above the prompt, the stage keeps room for it */}
                        <div className={styles.stage} data-log={(situation.agent?.turns.length ?? 0) > 0 ? '' : undefined} data-standalone={situation.standalone ? '' : undefined}>
                            <div className={styles.prompt_slot} style={situation.width != null ? { width: situation.width } : undefined}>
                                <DemoPrompt situation={situation} />
                            </div>
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}

export default WobbleBarPage;
