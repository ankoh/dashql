import * as React from 'react';
import type * as dashql from '@akohn/dashql';
import * as styles from './workbook_prompt.module.css';

import type { EditorView } from '@codemirror/view';
import { useAppConfig } from '../../config/app_config.js';
import { AgentGreeting } from '../../agent/agent_greeting.js';
import type { WobbleTuning } from '../../agent/wobble.js';
import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { ConnectorType } from '@akohn/dashql/platform/connections/connector_info';
import type { ModifyWorkbookScripts, ScriptData, WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { useCatalog, useOptionalRuntime, useScriptRun, useWorkbookExecution, useWorkbookScriptMap } from '@akohn/dashql-react/hooks';
import { type KeyEventHandler, useKeyEvents } from '@akohn/dashql-react/dom/key_events';
import { useSettledHeight } from '@akohn/dashql-react/components/size_observer';
import { useWorkbookReadOnly } from '../workbook_read_only.js';
import { useScriptSelection } from '../scripts/script_selection.js';
import { createScriptAction, useLiveScriptReader } from '../scripts/script_creation.js';
import type { RenameDraftReferences } from '../scripts/script_rename.js';
import { getKeywordCase } from '../scripts/script_format.js';
import { ScriptConnectionPicker, scriptConnectionView, usePickPendingConnection } from '../scripts/script_connection_picker.js';
import { useConnectionLabeler } from '../connections/connection_labels.js';
import { WorkbookConnectionAttentionContext } from '../connections/workbook_connection_attention.js';
import { useLogger } from '../../host/logger_provider.js';
import { WorkbookComposer, WorkbookComposerVariant, type WorkbookTableParameters } from './workbook_composer.js';
import type { WorkbookFeedInsets } from './workbook_feed.js';
import { agentActivity, type AgentFollowTarget } from '../../agent/agent_session.js';
import { useAgentConnect, useAgentSession } from '../../agent/agent_session_provider.js';
import { AgentConnectionsPicker } from '../../agent/agent_connections_picker.js';
import { ComposerMode } from '../../agent/agent_connect.js';
import { agentLiveStatuses, diffAgentQuestions } from '../../agent/agent_workbook_status.js';
import { WorkbookStatusBar, WorkbookStatusBarVariant, type WorkbookStatusBarPrompt } from '../status/workbook_status_bar.js';
import { useLiveWorkbookStatuses, useWorkbookOutcomeTransitions } from '../status/workbook_status_store.js';
import { useWorkbookStatusSources } from '../status/use_workbook_status_sources.js';
import { useCloudPublishStatus } from '../../cloud/cloud_publish_status.js';

/// Where the prompt of a workbook shows
export enum WorkbookPromptPlacement {
    /// Over the feed: the greeting and the hero composer of an empty workbook, else docked below the scripts
    Feed,
    /// Over the dashboard and the dataflow, as wide as their bar
    Overlay,
    /// Hidden behind an overview or another page, it keeps its draft
    Hidden,
}

/// What the prompt asks of the feed of the workbook
export interface WorkbookPromptFeed {
    /// Follow the agent to a script it edits or runs, while the feed follows the agent
    follow: (scriptKey: number, target: AgentFollowTarget) => void;
    /// Show a script that the user picked in the log of the agent
    show: (scriptKey: number) => void;
    /// The agent works on a new question, the feed follows it again
    followAgent: () => void;
    /// The prompt appended a script, the view that shows scrolls to it: the feed, the dashboard or the dataflow
    appended: (scriptKey: number) => void;
}

/// What the feed asks of the prompt
export interface WorkbookPromptHandle {
    /// The editor of the composer, null without one
    view: EditorView | null;
    /// Reference a script or an attachment in the question of the composer
    mention: (name: string) => void;
}

export interface WorkbookPromptProps {
    workbookScripts: WorkbookScripts;
    modifyWorkbookScripts: ModifyWorkbookScripts;
    /// The connection that the next script runs on
    conn: ConnectionState | null;
    /// The connections that the scripts run on, by default the connection of the next script
    scriptConnections?: ReadonlyMap<string, ConnectionState>;
    /// Where the prompt shows
    placement: WorkbookPromptPlacement;
    /// Is the composer shown below the bar of Wobble? Else it shrinks into the bar, with its draft. The greeting of an
    /// empty workbook always shows it.
    expanded: boolean;
    /// A click on the bar of Wobble shows or hides the composer
    onExpandedChange?: (expanded: boolean) => void;
    /// The feed of the workbook that follows the agent and shows the appended scripts
    feed: WorkbookPromptFeed;
    /// Receives what the feed asks of the prompt
    handleRef?: React.Ref<WorkbookPromptHandle>;
    /// Receives the function that renames the references in the draft of the composer, for renames of the views
    draftRenameRef?: React.RefObject<RenameDraftReferences | null>;
    /// The parts of the feed that the prompt lines up with: the head above the greeting, the scrollbar beside the
    /// docked composer
    feedInsets?: WorkbookFeedInsets;
    /// The height of the docked prompt, the feed keeps it free below its last script
    onHeight?: (height: number) => void;
    dependencies?: WorkbookPromptDependencies;
}

export interface WorkbookPromptDependencies {
    usePickPendingConnection: typeof usePickPendingConnection;
    useKeyEvents: typeof useKeyEvents;
    useScriptRun: typeof useScriptRun;
    useWorkbookScriptMap: typeof useWorkbookScriptMap;
    useLiveScriptReader: typeof useLiveScriptReader;
    useComposerCore: typeof useComposerCore;
    useAgentSession: typeof useAgentSession;
    useAgentConnect: typeof useAgentConnect;
    WorkbookComposer: typeof WorkbookComposer;
    WorkbookStatusBar: typeof WorkbookStatusBar;
}

const DEFAULT_DEPENDENCIES: WorkbookPromptDependencies = {
    usePickPendingConnection,
    useKeyEvents,
    useScriptRun,
    useWorkbookScriptMap,
    useLiveScriptReader,
    useComposerCore,
    useAgentSession,
    useAgentConnect,
    WorkbookComposer,
    WorkbookStatusBar,
};

const LOG_CTX = 'workbook_prompt';
const NO_INSETS: WorkbookFeedInsets = { head: 0, scrollbarInset: 0, scrollbarGutter: 0 };

/// What the composer drafts with: the core, the catalog of the connection of the next script, the table parameters of
/// the workbook and the connector of the connection. Null until the runtime has its core.
export interface ComposerCore {
    instance: dashql.DashQL;
    catalog: dashql.DashQLCatalog;
    tableParameters: WorkbookTableParameters;
    connectorType: ConnectorType | null;
}

/// The core of the composer of a workbook on the connection of its next script
export function useComposerCore(workbookId: string, connectionId: string | null): ComposerCore | null {
    const runtime = useOptionalRuntime();
    const instance = runtime?.core ?? null;
    const catalog = useCatalog(connectionId);
    return React.useMemo(() => {
        if (runtime == null || instance == null || connectionId == null) return null;
        if (catalog == null) return null;
        return {
            instance,
            catalog,
            tableParameters: { attach: session => runtime.attachTableParameters(workbookId, session) },
            connectorType: runtime.connection(connectionId)?.connectorType as ConnectorType | undefined ?? null,
        };
    }, [runtime, instance, workbookId, connectionId, catalog]);
}

/// Wobble moves more and faster on the empty workbook than by default, it is the only thing moving on the page
const LANDING_WOBBLE_TUNING: Partial<WobbleTuning> = { wobble: 0.03, wobbleSpeed: 2 };

/// The prompt of a workbook over its views: the composer that drafts the next script or asks the agent, and the bar of
/// Wobble with the status of the workbook. It greets an empty workbook, docks below the scripts of the feed and floats
/// over the dashboard and the dataflow. A click on the bar shrinks the composer into the bar and grows it out again,
/// in every view; a new script shows in all of them.
export const WorkbookPrompt: React.FC<WorkbookPromptProps> = (props) => {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const { modifyWorkbookScripts, feed } = props;
    const config = useAppConfig();
    const logger = useLogger();
    const keywordCase = getKeywordCase(config?.settings);
    const workbookId = props.workbookScripts.workbookId;
    const readOnly = useWorkbookReadOnly();
    const overFeed = props.placement === WorkbookPromptPlacement.Feed;
    const scripts = dependencies.useWorkbookScriptMap(workbookId);
    const defaultConnections = React.useMemo(
        () => new Map(props.conn == null ? [] : [[props.conn.connectionId, props.conn]]),
        [props.conn],
    );
    const connections = props.scriptConnections ?? defaultConnections;

    // The runs, the connections and the publishes of the workbook tell its status, the bar of Wobble shows it in every
    // view
    const execution = useWorkbookExecution(workbookId);
    const publishStatus = useCloudPublishStatus(workbookId);
    const labeler = useConnectionLabeler();
    useWorkbookStatusSources({
        workbookScripts: props.workbookScripts,
        scripts,
        connections,
        label: labeler,
        execution: execution.state,
        publish: publishStatus,
    });

    // The composer drafts the next script, on the connection that the script will run on
    const composerConnectionId = props.workbookScripts.nextScriptConnectionId ?? null;
    const composerCore = dependencies.useComposerCore(workbookId, composerConnectionId);
    const composerConnectionState = composerConnectionId == null ? null : connections.get(composerConnectionId) ?? null;
    const composerConnection = React.useMemo(
        () => composerConnectionState == null ? null : scriptConnectionView(composerConnectionState, labeler(composerConnectionState)),
        [composerConnectionState, labeler],
    );
    const composerConnectorType = composerConnection?.connectorInfo.connectorType ?? composerCore?.connectorType ?? ConnectorType.HYPER;
    // New scripts, and the draft of the composer, use the default connection of the workbook
    const pickPendingConnection = dependencies.usePickPendingConnection(modifyWorkbookScripts);
    const scriptNames = React.useMemo(() => props.workbookScripts.scriptOrder.map(scriptDisplayName), [props.workbookScripts.scriptOrder]);
    const ownDraftRenameRef = React.useRef<RenameDraftReferences | null>(null);
    const renameScriptRef = props.draftRenameRef ?? ownDraftRenameRef;

    // The workbook scripts change with every keystroke and the connections with every query event
    const latest = React.useRef({ workbookScripts: props.workbookScripts, connections });
    latest.current = { workbookScripts: props.workbookScripts, connections };

    // The composer appends its draft as a new script and runs it right away.
    // The composer keeps a SQL draft while its connection is not connected, a script that the agent writes
    // on a connection that is not connected is only created and the connection asks for attention.
    const selection = useScriptSelection();
    const readScript = dependencies.useLiveScriptReader();
    const runScript = dependencies.useScriptRun();
    const connectionAttention = React.useContext(WorkbookConnectionAttentionContext);
    const appendScript = React.useCallback((text: string) => {
        const prev = latest.current.workbookScripts;
        // The outcome names the created script by its key, it is selected
        const outcome = modifyWorkbookScripts(createScriptAction(prev, { text }));
        if (!outcome.ok || typeof outcome.id !== 'number') return null;
        feed.appended(outcome.id);
        selection.select(prev.workbookId, outcome.id);
        const scriptData = readScript(outcome.id);
        return scriptData != null ? { workbookId: prev.workbookId, scriptData } : null;
    }, [modifyWorkbookScripts, feed, selection, readScript]);
    const runAppendedScript = React.useCallback((appendedWorkbookId: string, scriptData: ScriptData) => {
        // The agent may write the script on another connection than the one of the composer
        if (latest.current.connections.get(scriptData.connectionId)?.connectionHealth !== ConnectionHealth.ONLINE) {
            connectionAttention?.request();
            return;
        }
        if (runScript == null) return;
        void runScript(appendedWorkbookId, scriptData.scriptKey);
    }, [connectionAttention, runScript]);
    const handleSend = React.useCallback((text: string) => {
        logger.debug('Running the composer draft', { characters: String(text.length) }, LOG_CTX);
        try {
            const appended = appendScript(text);
            if (appended != null) runAppendedScript(appended.workbookId, appended.scriptData);
        } catch (error) {
            logger.error('Appending the composer draft failed', { error: stringifyError(error) }, LOG_CTX);
        }
    }, [appendScript, runAppendedScript, logger]);

    // The agent of a session in the terminal answers questions in the scripts of the workbook, the feed follows it
    const session = dependencies.useAgentSession({
        workbookScripts: props.workbookScripts,
        followScript: feed.follow,
        showScript: feed.show,
    });
    const agentConnect = dependencies.useAgentConnect();
    // Every new question of the session follows the agent again
    const latestQuestionId = session != null && session.turns.length > 0 ? session.turns[session.turns.length - 1].questionId : null;
    React.useEffect(() => {
        if (latestQuestionId != null) feed.followAgent();
    }, [latestQuestionId, feed]);
    // The agent tells what it works on, its questions go to the log
    const agentLive = React.useMemo(() => agentLiveStatuses(session, Date.now()), [session]);
    useLiveWorkbookStatuses(workbookId, 'agent', agentLive);
    useWorkbookOutcomeTransitions(workbookId, session, (prev, next) => diffAgentQuestions(prev, next, Date.now()));

    // The feed mentions its scripts and attachments in the question of the composer
    const [composerView, setComposerView] = React.useState<EditorView | null>(null);
    const submitRef = React.useRef<(() => void) | null>(null);
    const targetScriptRef = React.useRef<((name: string) => void) | null>(null);
    React.useImperativeHandle(props.handleRef, () => ({
        view: composerView,
        mention: name => targetScriptRef.current?.(name),
    }), [composerView]);

    // An empty workbook greets the user with the composer in place of the feed, until the agent of a session works on a
    // question. The tab follows its session after a switch back to SQL, the questions of the agent dock the composer
    // in AI only. The composer stays at the same position in the tree so it keeps focus when the view docks it. The
    // composer over another view is docked.
    const agentTurns = agentConnect?.mode === ComposerMode.Sql ? 0 : session?.turns.length ?? 0;
    const landing = overFeed && props.workbookScripts.scriptOrder.length === 0 && agentTurns === 0;
    // The composer shrinks into the bar of Wobble and grows out of it on a click on the bar, the greeting shows it
    const collapsed = !landing && !props.expanded;
    const composerShown = props.placement !== WorkbookPromptPlacement.Hidden && !collapsed;
    const { onExpandedChange } = props;
    const focusOnExpand = React.useRef(false);
    const togglePrompt = React.useMemo(() => {
        if (landing || onExpandedChange == null) return undefined;
        return {
            expanded: !collapsed,
            onToggle: () => {
                // The composer that grows out of the bar takes the focus, the user writes right away
                focusOnExpand.current = collapsed;
                onExpandedChange(collapsed);
            },
        };
    }, [landing, collapsed, onExpandedChange]);
    React.useEffect(() => {
        if (collapsed || !focusOnExpand.current) return;
        focusOnExpand.current = false;
        composerView?.focus();
    }, [collapsed, composerView]);

    // Ctrl+E executes the selected script globally. While the composer has focus, it sends the draft instead of
    // running a script the user isn't looking at.
    const keyHandlers = React.useMemo<KeyEventHandler[]>(() => [{
        key: 'e',
        ctrlKey: true,
        capture: true,
        callback: (event: KeyboardEvent) => {
            if (!composerShown || composerView == null || !composerView.hasFocus) return;
            event.preventDefault();
            event.stopPropagation();
            submitRef.current?.();
        },
    }], [composerShown, composerView]);
    dependencies.useKeyEvents(keyHandlers);

    // While the user writes, Wobble watches the caret of the composer
    const composerCaret = React.useCallback(() => {
        const head = composerView?.state?.selection?.main.head;
        if (composerView == null || head == null || !composerView.hasFocus) return null;
        const coords = composerView.coordsAtPos(head);
        return coords == null ? null : { x: coords.left, y: (coords.top + coords.bottom) / 2 };
    }, [composerView]);
    // Wobble gets excited about every keystroke in the composer, a ref keeps the prompt from rendering per key
    const lastComposerInput = React.useRef<number | null>(null);
    React.useEffect(() => {
        const dom = composerView?.contentDOM;
        if (dom == null || typeof dom.addEventListener !== 'function') return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key.length === 1 || event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Enter') {
                lastComposerInput.current = performance.now();
            }
        };
        dom.addEventListener('keydown', onKeyDown);
        return () => dom.removeEventListener('keydown', onKeyDown);
    }, [composerView]);
    const composerLastInput = React.useCallback(() => lastComposerInput.current, []);
    const landingWobble = React.useMemo(() => ({
        className: styles.landing_wobble,
        'data-testid': 'feed-landing-wobble',
        label: 'DashQL agent',
        paused: !overFeed,
        tuning: LANDING_WOBBLE_TUNING,
        gaze: { pointer: true, target: composerCaret },
        lastInput: composerLastInput,
    }), [overFeed, composerCaret, composerLastInput]);
    const dockGaze = React.useMemo(() => ({ target: composerCaret }), [composerCaret]);

    // The docked prompt floats over the bottom of the feed, the last script scrolls clear of it. The morph between the
    // views changes the height in every frame, the page follows the height at its end once and doesn't lay out the
    // views in every frame.
    const [section, setSection] = React.useState<HTMLDivElement | null>(null);
    useSettledHeight(section, props.onHeight);

    // The bar of Wobble on the prompt: the status of the workbook, the agent and the log. On the landing view the
    // greeting is Wobble, the bar leaves it out. A read-only workbook has no prompt, the bar stands alone.
    const statusBar = (variant: WorkbookStatusBarVariant, prompt?: WorkbookStatusBarPrompt) => (
        <dependencies.WorkbookStatusBar
            workbookId={workbookId}
            variant={variant}
            prompt={prompt}
            session={readOnly ? null : session}
            wobble={!landing}
            gaze={dockGaze}
            lastInput={composerLastInput}
            paused={props.placement === WorkbookPromptPlacement.Hidden}
        />
    );
    const insets = props.feedInsets ?? NO_INSETS;
    const placement = overFeed ? 'feed' : props.placement === WorkbookPromptPlacement.Overlay ? 'overlay' : 'hidden';
    return (
        <div
            className={styles.prompt_layer}
            data-testid="workbook-prompt"
            data-placement={placement}
            data-landing={landing ? '' : undefined}
            style={{
                '--prompt_feed_head': `${insets.head}px`,
                '--prompt_scrollbar_inset': `${insets.scrollbarInset}px`,
                '--prompt_scrollbar_gutter': `${insets.scrollbarGutter}px`,
            } as React.CSSProperties}
        >
            {landing && (
                <div className={styles.landing_top}>
                    <div className={styles.landing_header}>
                        <AgentGreeting
                            wobble={landingWobble}
                            questionClassName={styles.landing_question}
                            questionTestId="feed-landing-question" />
                    </div>
                </div>
            )}
            {readOnly && !landing && (
                <div className={styles.prompt_section} ref={setSection}>
                    <div className={styles.prompt_body}>{statusBar(WorkbookStatusBarVariant.Standalone)}</div>
                </div>
            )}
            {!readOnly && <div className={styles.prompt_section} ref={setSection}>
                <div className={styles.prompt_body}>
                    {/* Without a composer the other views still show the bar */}
                    {props.placement === WorkbookPromptPlacement.Overlay && (composerConnectionId == null || composerCore == null) && statusBar(WorkbookStatusBarVariant.Standalone)}
                    {composerConnectionId != null && composerCore != null && <dependencies.WorkbookComposer
                        key={workbookId}
                        instance={composerCore.instance}
                        catalog={composerCore.catalog}
                        variant={landing ? WorkbookComposerVariant.Hero : WorkbookComposerVariant.Docked}
                        collapsed={collapsed}
                        keywordCase={keywordCase}
                        agentActivity={session != null ? agentActivity(session).kind : 'idle'}
                        session={session}
                        connect={agentConnect}
                        onSend={handleSend}
                        bar={statusBar(WorkbookStatusBarVariant.Prompt, togglePrompt)}
                        setView={setComposerView}
                        submitRef={submitRef}
                        scriptNames={scriptNames}
                        targetScriptRef={targetScriptRef}
                        renameScriptRef={renameScriptRef}
                        tableParameters={composerCore.tableParameters}
                        snippetConnector={composerConnectorType}
                        offlineWorkbookId={composerConnection?.connectionHealth === ConnectionHealth.ONLINE ? null : workbookId}
                        connectionPicker={(
                            <ScriptConnectionPicker
                                workbookId={workbookId}
                                scriptName="new"
                                connection={composerConnection}
                                disabled={false}
                                onPick={pickPendingConnection}
                                testId="composer-connection-picker"
                            />
                        )}
                        agentConnectionsPicker={agentConnect == null ? undefined : (
                            <AgentConnectionsPicker workbookId={workbookId} connect={agentConnect} />
                        )}
                    />}
                </div>
            </div>}
        </div>
    );
};
