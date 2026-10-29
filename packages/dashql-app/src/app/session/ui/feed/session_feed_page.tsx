import * as React from 'react';
import * as styles from './session_feed_page.module.css';

import { LinkIcon, PaperAirplaneIcon, PlugIcon, SquareFillIcon, SymbolIcon, ThreeBarsIcon } from '../../../../ui/foundations/symbol_icon.js';

import { ConnectionHealth, type ConnectionState } from '../../../connections/connection_state.js';
import {
    scriptConnectionIds,
    SELECT_SCRIPT,
    type SessionScripts,
} from '../../scripts/session_scripts.js';
import type { ModifySessionScripts } from '../../scripts/session_scripts_registry.js';
import { Button, ButtonSize, ButtonVariant, IconButton } from '../../../../ui/foundations/button.js';
import { SessionNavigationDrawer } from '../session_navigation_drawer.js';
import { SessionWorkbenchSidebar } from '../session_workbench_sidebar.js';
import { SessionURLShareOverlay } from '../session_url_share_overlay.js';
import { SessionFileSaveOverlay } from '../session_file_save_overlay.js';
import { ScriptDetails, TabKey as DetailsTabKey } from '../script_details.js';
import { SessionFeed } from './session_feed.js';
import { Dashboard } from '../../dashboard/dashboard.js';
import { SessionViewMode, useSessionViewMode } from '../session_view_mode.js';
import { SegmentedControl, SegmentedControlSize } from '../../../../ui/foundations/segmented_control.js';
import { useAppConfig } from '../../../config/app_config.js';
import { useSessionExecution } from '../../scripts/session_execution_provider.js';
import { IndicatorStatus, StatusIndicator } from '../../../../ui/foundations/status_indicator.js';
import { AnchoredOverlay } from '../../../../ui/foundations/anchored_overlay.js';
import { AnchorAlignment, AnchorSide } from '../../../../ui/foundations/anchored_position.js';
import { connectionHealthKey, connectionsToConnect, ExecuteConnectionGuard, SessionConnectionAttentionContext, useSessionConnectionAttention } from '../session_connection_attention.js';
import { SessionConnectionButtons } from './session_connection_buttons.js';
import { ConnectionSettingsOverlay } from '../../../connections/ui/connection_settings_overlay.js';
import { useAppFlavor } from '../../../flavor/flavor_provider.js';
import { ConnectionOverviewPage } from '../../../connections/ui/connection_overview_page.js';
import { AgentSessionMenu } from '../../../agent/agent_session_menu.js';

const FileZipIcon = SymbolIcon('file_zip_16');
const CloseIcon = SymbolIcon('x_16');

export interface SessionFeedPageDependencies {
    SessionFeed: typeof SessionFeed;
    ScriptDetails: typeof ScriptDetails;
    SessionWorkbenchSidebar: typeof SessionWorkbenchSidebar;
    ConnectionOverviewPage: typeof ConnectionOverviewPage;
    SessionNavigationDrawer: typeof SessionNavigationDrawer;
    ThreeBarsIcon: typeof ThreeBarsIcon;
    IconButton: typeof IconButton;
    Button: typeof Button;
    Dashboard: typeof Dashboard;
    SessionURLShareOverlay: typeof SessionURLShareOverlay;
    SessionFileSaveOverlay: typeof SessionFileSaveOverlay;
    SessionConnectionButtons: typeof SessionConnectionButtons;
    ConnectionSettingsOverlay: typeof ConnectionSettingsOverlay;
    useSessionViewMode: typeof useSessionViewMode;
    useAppConfig: typeof useAppConfig;
    SegmentedControl: typeof SegmentedControl;
    useSessionExecution: typeof useSessionExecution;
}

const DEFAULT_DEPENDENCIES: SessionFeedPageDependencies = {
    SessionFeed,
    ScriptDetails,
    SessionWorkbenchSidebar,
    ConnectionOverviewPage,
    SessionNavigationDrawer,
    ThreeBarsIcon,
    IconButton,
    Button,
    Dashboard,
    SessionURLShareOverlay,
    SessionFileSaveOverlay,
    SessionConnectionButtons,
    ConnectionSettingsOverlay,
    useSessionViewMode,
    useAppConfig,
    SegmentedControl,
    useSessionExecution,
};

interface Props {
    sessionScripts: SessionScripts;
    modifySessionScripts: ModifySessionScripts;
    /// The connection that the next script of the session runs on
    connection: ConnectionState | null;
    /// The connections that the scripts of the session run on
    scriptConnections?: ReadonlyMap<string, ConnectionState>;
    active: boolean;
    dependencies?: SessionFeedPageDependencies;
}

export const SessionFeedPage: React.FC<Props> = (props) => {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    // The details belong to the session they were opened in, another session shows its feed
    const [details, setDetails] = React.useState<{ sessionId: string; scriptId?: number; initialTab?: DetailsTabKey } | null>(null);
    const showDetails = details != null && details.sessionId === props.sessionScripts.sessionId;
    const [feedShadowContainer, setFeedShadowContainer] = React.useState<HTMLDivElement | null>(null);
    const [navigationDrawerOpen, setNavigationDrawerOpen] = React.useState(false);
    const [overviewConnectionId, setOverviewConnectionId] = React.useState<string | null>(null);
    const closeOverview = React.useCallback(() => setOverviewConnectionId(null), []);
    const navigationDrawerTriggerRef = React.useRef<HTMLButtonElement>(null);
    const shareTriggerRef = React.useRef<HTMLButtonElement>(null);
    const exportTriggerRef = React.useRef<HTMLButtonElement>(null);
    const [shareOpen, setShareOpen] = React.useState(false);
    const [exportOpen, setExportOpen] = React.useState(false);
    const archiveExport = useAppFlavor().features.sessionArchiveExport;
    // A session run takes every connection that a script runs on, they have to be connected first
    const scriptConnections = props.scriptConnections ?? new Map(props.connection == null ? [] : [[props.connection.connectionId, props.connection]]);
    const runConnections = scriptConnectionIds(props.sessionScripts).flatMap(connectionId => scriptConnections.get(connectionId) ?? []);
    const toConnect = connectionsToConnect(runConnections);
    const disconnected = toConnect.length > 0;
    const connectionAttention = useSessionConnectionAttention(props.sessionScripts.sessionId, connectionHealthKey(runConnections));
    const scriptConnectionsIdle = runConnections.length > 0 && runConnections.every(connection =>
        connection.connectionHealth === ConnectionHealth.ONLINE && (connection.queriesActive?.size ?? 0) === 0);
    // "Connect to run" opens the settings of the first connection that is not connected
    const [connectConnectionId, setConnectConnectionId] = React.useState<string | null>(null);
    React.useEffect(() => setConnectConnectionId(null), [props.sessionScripts.sessionId]);
    const execution = dependencies.useSessionExecution(props.sessionScripts.sessionId);
    const run = execution.state;
    const [executionDetailsOpen, setExecutionDetailsOpen] = React.useState(false);
    React.useEffect(() => setExecutionDetailsOpen(false), [props.sessionScripts.sessionId]);
    React.useEffect(() => setOverviewConnectionId(null), [props.sessionScripts.sessionId]);
    const executeRef = React.useRef<HTMLButtonElement>(null);
    const progress = run ? `${run.completedScripts}/${run.totalScripts}` : '';
    const statusText = !run ? '' : run.phase === 'planning' ? 'Planning...'
        : run.phase === 'stopping' ? `Stopping · ${progress} completed`
        : run.phase === 'failed' ? `${progress} completed`
        : run.phase === 'cancelled' ? `Stopped · ${progress} completed`
        : run.phase === 'succeeded' ? `${progress} succeeded` : `${progress} completed`;
    const { mode, setMode } = dependencies.useSessionViewMode();
    const dashboardsEnabled = dependencies.useAppConfig()?.settings?.experimental_dashboards === true;
    const dashboardActive = dashboardsEnabled && mode === SessionViewMode.Dashboard;
    const overviewActive = overviewConnectionId != null;
    const feedActive = props.active && !dashboardActive && !showDetails && !overviewActive;
    // Stable since it is passed into the callbacks of every feed row
    const latestSessionScripts = React.useRef(props.sessionScripts);
    latestSessionScripts.current = props.sessionScripts;
    const openDetails = React.useCallback((fileName?: string, initialTab?: DetailsTabKey) => {
        const sessionScripts = latestSessionScripts.current;
        const targetFileName = fileName ?? sessionScripts.scriptFocus.fileName;
        setDetails({ sessionId: sessionScripts.sessionId, scriptId: sessionScripts.scriptRefs[targetFileName]?.scriptId, initialTab });
        setOverviewConnectionId(null);
    }, []);
    const workbench = (closeAfterSelection: boolean) => (
        <dependencies.SessionWorkbenchSidebar
            sessionScripts={props.sessionScripts}
            closeAfterSelection={closeAfterSelection ? () => setNavigationDrawerOpen(false) : undefined}
            openOverviewId={overviewConnectionId}
            onOpenOverview={setOverviewConnectionId}
        />
    );

    return (
        <SessionConnectionAttentionContext.Provider value={connectionAttention}>
        <div className={styles.page}>
            <header className={styles.view_bar} data-electron-drag-region>
                <dependencies.IconButton className={styles.mobile_menu_button} ref={navigationDrawerTriggerRef} variant={ButtonVariant.Default} aria-label="Open session workbench" data-testid="open-workbench" onClick={() => setNavigationDrawerOpen(true)}>
                    <dependencies.ThreeBarsIcon />
                </dependencies.IconButton>
                {/* A connection overview is not part of the session, its controls are hidden */}
                {!overviewActive && <>
                    {dashboardsEnabled && <dependencies.SegmentedControl
                        aria-label="Session view"
                        data-testid="session-view-switch"
                        size={SegmentedControlSize.Small}
                        onChange={(selectedIndex) => {
                            setOverviewConnectionId(null);
                            setMode(selectedIndex === 0
                                ? SessionViewMode.Session
                                : SessionViewMode.Dashboard);
                        }}
                    >
                        <dependencies.SegmentedControl.Button selected={!dashboardActive}>Session</dependencies.SegmentedControl.Button>
                        <dependencies.SegmentedControl.Button selected={dashboardActive}>Dashboard</dependencies.SegmentedControl.Button>
                    </dependencies.SegmentedControl>}
                    <div className={styles.execution_controls}>
                        <ExecuteConnectionGuard sessionId={props.sessionScripts.sessionId} blocked={disconnected && !execution.busy}>
                        <dependencies.Button ref={executeRef} size={ButtonSize.Small} variant={ButtonVariant.Invisible}
                            leadingVisual={execution.busy ? SquareFillIcon : disconnected ? PlugIcon : PaperAirplaneIcon}
                            aria-label={execution.busy ? 'Stop session execution' : disconnected ? 'Connect to run' : 'Execute All'}
                            data-testid={execution.busy ? 'stop-execution' : 'execute-all'}
                            data-connect={!execution.busy && disconnected ? '' : undefined}
                            disabled={execution.busy ? run?.phase === 'stopping' : !disconnected && (!scriptConnectionsIdle
                                || props.sessionScripts.scriptOrder.length === 0)}
                            onClick={() => execution.busy ? execution.stop()
                                : disconnected ? setConnectConnectionId(toConnect[0].connectionId)
                                : execution.start(props.modifySessionScripts)}>
                            <span className={styles.action_label}>{execution.busy ? run?.phase === 'stopping' ? 'Stopping' : 'Stop' : disconnected ? 'Connect to run' : 'Execute All'}</span>
                        </dependencies.Button>
                        </ExecuteConnectionGuard>
                        {/* Mounted only while open, the overlay subscribes to the connection */}
                        {connectConnectionId != null && (
                            <dependencies.ConnectionSettingsOverlay
                                connectionId={connectConnectionId}
                                isOpen
                                onClose={() => setConnectConnectionId(null)}
                                anchorRef={executeRef}
                                side={AnchorSide.OutsideBottom}
                            />
                        )}
                        <div className={styles.execution_status} role="status" aria-live="polite" aria-atomic="true" data-testid="execution-status" data-phase={run?.phase}
                            title={run?.error ?? undefined} aria-label={run?.error ? `${statusText}: ${run.error}` : undefined}>
                            {run && <>
                                <AnchoredOverlay
                                    open={executionDetailsOpen} onOpen={() => setExecutionDetailsOpen(true)} onClose={() => setExecutionDetailsOpen(false)}
                                    side={AnchorSide.OutsideBottom} align={AnchorAlignment.Start} anchorOffset={4}
                                    renderAnchor={anchorProps => <dependencies.Button {...anchorProps}
                                        size={ButtonSize.Small} variant={ButtonVariant.Invisible} aria-label="Show session execution details" data-testid="execution-details-toggle"
                                        leadingVisual={<span className={styles.execution_indicator} aria-hidden="true" data-testid="execution-indicator"><StatusIndicator width="16px" height="16px" status={execution.busy
                                            ? IndicatorStatus.Running : run.phase === 'failed' ? IndicatorStatus.Failed
                                                : run.phase === 'succeeded' ? IndicatorStatus.Succeeded : IndicatorStatus.Skip} /></span>}>
                                        <span className={styles.execution_progress}>{statusText}</span>
                                    </dependencies.Button>}>
                                    <section className={styles.execution_error_card} role="dialog" aria-label="Session execution details" data-testid="execution-details">
                                        <header className={styles.execution_error_header}>
                                            <h2 className={styles.execution_details_title}>{run.phase === 'failed' ? 'Execution failed' : 'Session execution'}</h2>
                                            <dependencies.IconButton size={ButtonSize.Small} variant={ButtonVariant.Invisible}
                                                aria-label="Close session execution details" data-testid="execution-details-close" onClick={() => setExecutionDetailsOpen(false)}>
                                                <CloseIcon size={16} />
                                            </dependencies.IconButton>
                                        </header>
                                        <div className={styles.execution_details_body}>
                                            <div>{statusText}</div>
                                            {run.activeFileName && <div>{run.activeFileName} · statement {run.activeStatementIndex}/{run.activeStatementCount}</div>}
                                            <div>{run.completedStatements}/{run.totalStatements} statements completed</div>
                                            {run.error && <div className={styles.execution_error_message}>{run.error}</div>}
                                        </div>
                                    </section>
                                </AnchoredOverlay>
                            </>}
                        </div>
                    </div>
                    <div className={styles.header_actions}>
                        <AgentSessionMenu sessionId={props.sessionScripts.sessionId} labelClassName={styles.action_label} />
                        <dependencies.Button ref={shareTriggerRef} size={ButtonSize.Small} variant={ButtonVariant.Invisible} leadingVisual={LinkIcon} aria-label="Share as URL" data-testid="share-url" aria-expanded={shareOpen} onClick={() => {
                            setExportOpen(false);
                            setShareOpen(value => !value);
                        }}>
                            <span className={styles.action_label}>Share as URL</span>
                        </dependencies.Button>
                        <dependencies.SessionURLShareOverlay sessionId={props.sessionScripts.sessionId} isOpen={shareOpen} setIsOpen={setShareOpen} anchorRef={shareTriggerRef} />
                        {archiveExport && (
                            <>
                                <dependencies.Button ref={exportTriggerRef} size={ButtonSize.Small} variant={ButtonVariant.Invisible} leadingVisual={FileZipIcon} aria-label="Export .dashql" data-testid="export-session" aria-expanded={exportOpen} onClick={() => {
                                    setShareOpen(false);
                                    setExportOpen(value => !value);
                                }}>
                                    <span className={styles.action_label}>Export .dashql</span>
                                </dependencies.Button>
                                <dependencies.SessionFileSaveOverlay
                                    isOpen={exportOpen}
                                    setIsOpen={setExportOpen}
                                    anchorRef={exportTriggerRef}
                                    sessionScripts={props.sessionScripts}
                                    fileName={props.sessionScripts.name ?? props.sessionScripts.sessionMetadata.originalFileName ?? 'session'}
                                />
                            </>
                        )}
                        {/* The connections of the scripts at the right end of the bar, the user sees which one is not connected */}
                        <dependencies.SessionConnectionButtons connections={runConnections} attention={connectionAttention.active} />
                    </div>
                </>}
            </header>
            <aside className={styles.navigation_sidebar}>
                {workbench(false)}
            </aside>
            <main className={styles.body_container} id="session-body">
                <div className={styles.content_container}>
                    <div className={feedActive ? styles.feed_layer : styles.feed_layer_hidden}>
                        <dependencies.SessionFeed
                            sessionScripts={props.sessionScripts}
                            modifySessionScripts={props.modifySessionScripts}
                            active={feedActive}
                            scrollShadowContainer={feedShadowContainer}
                            showDetails={openDetails}
                            conn={props.connection}
                            scriptConnections={props.scriptConnections}
                        />
                    </div>
                    {!dashboardActive && !overviewActive && showDetails
                                ? <dependencies.ScriptDetails
                                    sessionScripts={props.sessionScripts}
                                    modifySessionScripts={props.modifySessionScripts}
                                    connection={props.connection}
                                    scriptConnections={props.scriptConnections}
                                    hideDetails={() => setDetails(null)}
                                    scriptId={details.scriptId}
                                    initialTab={details.initialTab}
                                    navigateToScript={(scriptKey) => {
                                        const target = props.sessionScripts.scripts[scriptKey];
                                        if (!target?.fileName) return;
                                        props.modifySessionScripts({
                                            type: SELECT_SCRIPT,
                                            value: target.fileName,
                                        });
                                        setDetails({ sessionId: props.sessionScripts.sessionId, scriptId: scriptKey });
                                    }}
                                />
                                : null}
                    {overviewConnectionId != null && (
                        <dependencies.ConnectionOverviewPage
                            connectionId={overviewConnectionId}
                            onClose={closeOverview}
                        />
                    )}
                    {dashboardActive && !overviewActive && (
                        <dependencies.Dashboard
                            sessionScripts={props.sessionScripts}
                            modifySessionScripts={props.modifySessionScripts}
                        />
                    )}
                    <div
                        ref={setFeedShadowContainer}
                        className={dashboardActive || overviewActive ? styles.feed_shadow_layer_hidden : styles.feed_shadow_layer}
                        aria-hidden="true"
                    />
                </div>
            </main>
            {navigationDrawerOpen && (
                <dependencies.SessionNavigationDrawer open onClose={() => setNavigationDrawerOpen(false)} returnFocusRef={navigationDrawerTriggerRef}>
                    {workbench(true)}
                </dependencies.SessionNavigationDrawer>
            )}
        </div>
        </SessionConnectionAttentionContext.Provider>
    );
};
