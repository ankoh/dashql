import * as React from 'react';
import * as styles from './workbook_feed_page.module.css';

import { LinkIcon, PaperAirplaneIcon, SquareFillIcon, SymbolIcon, ThreeBarsIcon } from '../../ui/foundations/symbol_icon.js';

import { ConnectionHealth, type ConnectionState } from '@ankoh/dashql/platform/connections/connection_state';
import {
    isCloudPreview,
    isEphemeralWorkbook,
    scriptConnectionIds,
    workbookConnectionIds,
    type ModifyWorkbookScripts,
    type WorkbookScripts,
} from '@ankoh/dashql/platform/workbook/scripts/workbook_scripts';
import { useScriptSelection } from '../scripts/script_selection.js';
import { Button, ButtonSize, ButtonVariant, IconButton } from '../../ui/foundations/button.js';
import { WorkbookNavigationDrawer } from '../workbook_navigation_drawer.js';
import { WorkbookWorkbenchSidebar } from '../workbook_workbench_sidebar.js';
import { WorkbookURLShareOverlay } from '../persistence/workbook_url_share_overlay.js';
import { WorkbookFileSaveOverlay } from '../persistence/workbook_file_save_overlay.js';
import { ScriptEditorDialog } from '../scripts/script_editor_dialog.js';
import { WorkbookFeed, type WorkbookFeedRevealRequest } from './workbook_feed.js';
import { Dashboard } from '../dashboard/dashboard.js';
import { DataflowCanvas } from '../dataflow/dataflow_canvas.js';
import { WorkbookViewMode, useWorkbookViewMode } from '../workbook_view_mode.js';
import { SegmentedControl, SegmentedControlSize } from '../../ui/foundations/segmented_control.js';
import { useWorkbookExecution } from '../../runtime/runtime_hooks.js';
import { IndicatorStatus, StatusIndicator } from '../../ui/foundations/status_indicator.js';
import { AnchoredOverlay } from '../../ui/foundations/anchored_overlay.js';
import { AnchorAlignment, AnchorSide } from '../../ui/foundations/anchored_position.js';
import { connectionHealthKey, WorkbookConnectionAttentionContext, useWorkbookConnectionAttention } from '../workbook_connection_attention.js';
import { WorkbookConnectionButtons } from './workbook_connection_buttons.js';
import { useAppFlavor } from '../../config/flavor_provider.js';
import { ConnectionOverviewPage } from '../../connections/connection_overview_page.js';
import { CloudOverviewPage } from '../../cloud/cloud_overview_page.js';
import { WorkbookStatusBar, WorkbookStatusBarVariant } from '../status/workbook_status_bar.js';
import type { RenameDraftReferences } from '../scripts/script_rename.js';
import { CloudPreviewActions, CloudPreviewBadge, CloudWorkbookLoadingCard } from '../../cloud/cloud_preview_actions.js';
import { useCloudWorkbookLoading } from '../../cloud/cloud_workbook_loading.js';
import { WorkbookReadOnlyContext } from '../workbook_read_only.js';

const FileZipIcon = SymbolIcon('file_zip_16');
const CloseIcon = SymbolIcon('x_16');
// The views of the workbook view switch, octicons
const FeedViewIcon = SymbolIcon('rows_16');
const DashboardViewIcon = SymbolIcon('dashboard_16');
const DataflowViewIcon = SymbolIcon('workflow_16');
/// The views of the switch, the workbook first
const WORKBOOK_VIEWS: [WorkbookViewMode, string, typeof FeedViewIcon][] = [
    [WorkbookViewMode.Workbook, 'Feed', FeedViewIcon],
    [WorkbookViewMode.Dashboard, 'Dashboard', DashboardViewIcon],
    [WorkbookViewMode.Dataflow, 'Dataflow', DataflowViewIcon],
];

export interface WorkbookFeedPageDependencies {
    WorkbookFeed: typeof WorkbookFeed;
    ScriptEditorDialog: typeof ScriptEditorDialog;
    WorkbookWorkbenchSidebar: typeof WorkbookWorkbenchSidebar;
    ConnectionOverviewPage: typeof ConnectionOverviewPage;
    WorkbookStatusBar: typeof WorkbookStatusBar;
    CloudOverviewPage: typeof CloudOverviewPage;
    WorkbookNavigationDrawer: typeof WorkbookNavigationDrawer;
    ThreeBarsIcon: typeof ThreeBarsIcon;
    IconButton: typeof IconButton;
    Button: typeof Button;
    Dashboard: typeof Dashboard;
    DataflowCanvas: typeof DataflowCanvas;
    WorkbookURLShareOverlay: typeof WorkbookURLShareOverlay;
    WorkbookFileSaveOverlay: typeof WorkbookFileSaveOverlay;
    WorkbookConnectionButtons: typeof WorkbookConnectionButtons;
    useWorkbookViewMode: typeof useWorkbookViewMode;
    SegmentedControl: typeof SegmentedControl;
    useWorkbookExecution: typeof useWorkbookExecution;
    CloudPreviewActions: typeof CloudPreviewActions;
    CloudPreviewBadge: typeof CloudPreviewBadge;
    CloudWorkbookLoadingCard: typeof CloudWorkbookLoadingCard;
}

const DEFAULT_DEPENDENCIES: WorkbookFeedPageDependencies = {
    WorkbookFeed,
    ScriptEditorDialog,
    WorkbookWorkbenchSidebar,
    ConnectionOverviewPage,
    WorkbookStatusBar,
    CloudOverviewPage,
    WorkbookNavigationDrawer,
    ThreeBarsIcon,
    IconButton,
    Button,
    Dashboard,
    DataflowCanvas,
    WorkbookURLShareOverlay,
    WorkbookFileSaveOverlay,
    WorkbookConnectionButtons,
    useWorkbookViewMode,
    SegmentedControl,
    useWorkbookExecution,
    CloudPreviewActions,
    CloudPreviewBadge,
    CloudWorkbookLoadingCard,
};

interface Props {
    workbookScripts: WorkbookScripts;
    modifyWorkbookScripts: ModifyWorkbookScripts;
    /// The connection that the next script of the workbook runs on
    connection: ConnectionState | null;
    /// The connections that the scripts of the workbook run on
    scriptConnections?: ReadonlyMap<string, ConnectionState>;
    active: boolean;
    dependencies?: WorkbookFeedPageDependencies;
}

export const WorkbookFeedPage: React.FC<Props> = (props) => {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    // The composer of the feed renames the references in its draft, also for renames in the dataflow
    const draftRenameRef = React.useRef<RenameDraftReferences | null>(null);
    // The script that the editor dialog of the dataflow shows. It belongs to the workbook it was opened in and closes
    // when another workbook is selected or the script is gone.
    const [details, setDetails] = React.useState<{ workbookId: string; scriptId: number } | null>(null);
    const showDetails = details != null && details.workbookId === props.workbookScripts.workbookId
        && props.workbookScripts.scriptKeys.includes(details.scriptId);
    React.useEffect(() => setDetails(null), [props.workbookScripts.workbookId]);
    // The dialog selects its script, the commands of the workbook (Ctrl+E) run the selected script
    const selection = useScriptSelection();
    const inspectScript = React.useCallback((scriptKey: number) => {
        const fileName = props.workbookScripts.scriptOrder[props.workbookScripts.scriptKeys.indexOf(scriptKey)];
        if (fileName == null) return;
        selection.selectFile(props.workbookScripts, fileName);
        setDetails({ workbookId: props.workbookScripts.workbookId, scriptId: scriptKey });
    }, [props.workbookScripts, selection]);
    const closeDetails = React.useCallback(() => setDetails(null), []);
    const [navigationDrawerOpen, setNavigationDrawerOpen] = React.useState(false);
    // The overview of a connection or of a cloud that takes the place of the workbook
    const [overview, setOverview] = React.useState<{ kind: 'connection' | 'cloud'; connectionId: string } | null>(null);
    const overviewConnectionId = overview?.kind === 'connection' ? overview.connectionId : null;
    const cloudOverviewId = overview?.kind === 'cloud' ? overview.connectionId : null;
    /// Open the overview of a connection, null closes any overview
    const setOverviewConnectionId = React.useCallback((connectionId: string | null) => {
        setOverview(connectionId == null ? null : { kind: 'connection', connectionId });
    }, []);
    /// Open the overview of a cloud, null closes any overview
    const setCloudOverviewId = React.useCallback((connectionId: string | null) => {
        setOverview(connectionId == null ? null : { kind: 'cloud', connectionId });
    }, []);
    const closeOverview = React.useCallback(() => setOverview(null), []);
    const navigationDrawerTriggerRef = React.useRef<HTMLButtonElement>(null);
    const shareTriggerRef = React.useRef<HTMLButtonElement>(null);
    const exportTriggerRef = React.useRef<HTMLButtonElement>(null);
    const [shareOpen, setShareOpen] = React.useState(false);
    const [exportOpen, setExportOpen] = React.useState(false);
    const archiveExport = useAppFlavor().features.workbookArchiveExport;
    // A workbook run takes every connection that a script runs on. Connections that aren't connected serve the cached
    // results of their scripts, the others are skipped.
    const scriptConnections = props.scriptConnections ?? new Map(props.connection == null ? [] : [[props.connection.connectionId, props.connection]]);
    const runConnections = scriptConnectionIds(props.workbookScripts).flatMap(connectionId => scriptConnections.get(connectionId) ?? []);
    // The bar also shows the connection that the composer drafts the next script on, e.g. the one picked in an empty workbook
    const barConnections = workbookConnectionIds(props.workbookScripts).flatMap(connectionId => scriptConnections.get(connectionId) ?? []);
    const connectionAttention = useWorkbookConnectionAttention(props.workbookScripts.workbookId, connectionHealthKey(barConnections));
    // A connection that is connecting holds the run, it would join a moment later
    const scriptConnectionsIdle = runConnections.length > 0 && runConnections.every(connection =>
        connection.connectionHealth !== ConnectionHealth.CONNECTING && (connection.queriesActiveOrdered?.length ?? 0) === 0);
    const execution = dependencies.useWorkbookExecution(props.workbookScripts.workbookId);
    const run = execution.state;
    const [executionDetailsOpen, setExecutionDetailsOpen] = React.useState(false);
    React.useEffect(() => setExecutionDetailsOpen(false), [props.workbookScripts.workbookId]);
    React.useEffect(() => setOverview(null), [props.workbookScripts.workbookId]);
    const executeRef = React.useRef<HTMLButtonElement>(null);
    const progress = run ? `${run.completedScripts}/${run.totalScripts}` : '';
    const skipped = run != null && run.skippedScripts > 0 ? ` · ${run.skippedScripts} need a connection` : '';
    const statusText = !run ? '' : run.phase === 'planning' ? 'Planning...'
        : run.phase === 'stopping' ? `Stopping · ${progress} completed`
        : run.phase === 'failed' ? `${progress} completed${skipped}`
        : run.phase === 'cancelled' ? `Stopped · ${progress} completed`
        : run.phase === 'succeeded' ? (skipped ? `${progress} completed${skipped}` : `${progress} succeeded`) : `${progress} completed${skipped}`;
    // A run that skipped scripts points at the connections that they need once it settles, nothing opens by itself. A
    // run that settled before the page mounted doesn't, e.g. when the workbook is opened again.
    const settledWithSkips = (run?.phase === 'succeeded' || run?.phase === 'failed') && run.skippedScripts > 0;
    const sawRun = React.useRef(false);
    React.useEffect(() => { sawRun.current = false; }, [props.workbookScripts.workbookId]);
    React.useEffect(() => { if (execution.busy) sawRun.current = true; }, [execution.busy]);
    const requestAttention = connectionAttention.request;
    React.useEffect(() => {
        if (settledWithSkips && sawRun.current) {
            sawRun.current = false;
            requestAttention(props.workbookScripts.workbookId);
        }
    }, [settledWithSkips, requestAttention, props.workbookScripts.workbookId]);
    const skippedTitle = run != null && run.skippedFiles.length > 0 ? `Need a connection: ${run.skippedFiles.join(', ')}` : undefined;
    const { mode, setMode } = dependencies.useWorkbookViewMode();
    // The greeter shows the feed, its workbook has nothing to run, show or share until a script promotes it
    const ephemeral = isEphemeralWorkbook(props.workbookScripts);
    // A read-only look at a published workbook is imported before it is shared
    const preview = isCloudPreview(props.workbookScripts);
    React.useEffect(() => {
        if ((ephemeral || preview) && (mode === WorkbookViewMode.Dashboard || mode === WorkbookViewMode.Dataflow)) setMode(WorkbookViewMode.Workbook);
    }, [ephemeral, preview, mode, setMode]);
    const dashboardActive = mode === WorkbookViewMode.Dashboard;
    const dataflowActive = mode === WorkbookViewMode.Dataflow;
    const activeView = dashboardActive ? WorkbookViewMode.Dashboard : dataflowActive ? WorkbookViewMode.Dataflow : WorkbookViewMode.Workbook;
    const overviewActive = overview != null;
    // A version of a published workbook that is being loaded takes the place of the views
    const cloudLoading = useCloudWorkbookLoading() != null;
    const feedActive = props.active && !dashboardActive && !dataflowActive && !overviewActive && !cloudLoading;
    // A script opened from the sidebar shows in the feed
    const [revealRequest, setRevealRequest] = React.useState<WorkbookFeedRevealRequest | null>(null);
    const openScript = React.useCallback((workbookId: string, fileName: string) => {
        setOverviewConnectionId(null);
        setDetails(null);
        if (mode !== WorkbookViewMode.Workbook) setMode(WorkbookViewMode.Workbook);
        setRevealRequest({ workbookId, fileName });
    }, [mode, setMode]);
    const workbench = (closeAfterSelection: boolean) => (
        <dependencies.WorkbookWorkbenchSidebar
            workbookScripts={props.workbookScripts}
            closeAfterSelection={closeAfterSelection ? () => setNavigationDrawerOpen(false) : undefined}
            openOverviewId={overviewConnectionId}
            onOpenOverview={setOverviewConnectionId}
            openCloudId={cloudOverviewId}
            onOpenCloud={setCloudOverviewId}
            onOpenScript={openScript}
        />
    );

    return (
        <WorkbookConnectionAttentionContext.Provider value={connectionAttention}>
        <WorkbookReadOnlyContext.Provider value={preview}>
        <div className={styles.page}>
            <aside className={styles.navigation_sidebar}>
                {workbench(false)}
            </aside>
            <main className={styles.body_container} id="workbook-body">
                <div className={styles.content_container}>
                    {cloudLoading && (
                        <div className={styles.loading_layer}>
                            <dependencies.CloudWorkbookLoadingCard />
                        </div>
                    )}
                    <div className={feedActive ? styles.feed_layer : styles.feed_layer_hidden}>
                        <dependencies.WorkbookFeed
                            workbookScripts={props.workbookScripts}
                            modifyWorkbookScripts={props.modifyWorkbookScripts}
                            draftRenameRef={draftRenameRef}
                            active={feedActive}
                            revealRequest={revealRequest}
                            conn={props.connection}
                            scriptConnections={props.scriptConnections}
                        />
                    </div>
                    {overviewConnectionId != null && !cloudLoading && (
                        <dependencies.ConnectionOverviewPage
                            connectionId={overviewConnectionId}
                            onClose={closeOverview}
                        />
                    )}
                    {cloudOverviewId != null && !cloudLoading && (
                        <dependencies.CloudOverviewPage
                            key={cloudOverviewId}
                            connectionId={cloudOverviewId}
                            onClose={closeOverview}
                        />
                    )}
                    {dashboardActive && !overviewActive && !cloudLoading && (
                        <dependencies.Dashboard
                            workbookScripts={props.workbookScripts}
                            modifyWorkbookScripts={props.modifyWorkbookScripts}
                            scriptConnections={scriptConnections}
                            draftRenameRef={draftRenameRef}
                        />
                    )}
                    {/* The bar of Wobble tells the status of the workbook in the views without the prompt */}
                    {(dashboardActive || dataflowActive) && !overviewActive && !cloudLoading && (
                        <div className={styles.status_bar_dock}>
                            <dependencies.WorkbookStatusBar
                                workbookId={props.workbookScripts.workbookId}
                                variant={WorkbookStatusBarVariant.Standalone}
                                paused={!props.active}
                            />
                        </div>
                    )}
                    {dataflowActive && !overviewActive && !cloudLoading && (
                        <div className={styles.dataflow_layout}>
                            <div className={styles.dataflow_canvas}>
                                <dependencies.DataflowCanvas
                                    key={props.workbookScripts.workbookId}
                                    workbookScripts={props.workbookScripts}
                                    modifyWorkbookScripts={props.modifyWorkbookScripts}
                                    scriptConnections={scriptConnections}
                                    draftRenameRef={draftRenameRef}
                                    onInspect={inspectScript}
                                />
                            </div>
                            {showDetails && (
                                <dependencies.ScriptEditorDialog
                                    key={details.scriptId}
                                    workbookScripts={props.workbookScripts}
                                    modifyWorkbookScripts={props.modifyWorkbookScripts}
                                    scriptKey={details.scriptId}
                                    scriptConnections={scriptConnections}
                                    draftRenameRef={draftRenameRef}
                                    onNavigateToScript={inspectScript}
                                    onClose={closeDetails}
                                />
                            )}
                        </div>
                    )}
                </div>
            </main>
            {/* After the feed in the DOM, so that no-drag rows scrolled behind the bar do not cut holes into its drag region, see docs/design/electron.md */}
            <header className={styles.view_bar} data-electron-drag-region>
                <dependencies.IconButton className={styles.mobile_menu_button} ref={navigationDrawerTriggerRef} variant={ButtonVariant.Default} aria-label="Open workbook workbench" data-testid="open-workbench" onClick={() => setNavigationDrawerOpen(true)}>
                    <dependencies.ThreeBarsIcon />
                </dependencies.IconButton>
                {/* A connection overview is not part of the workbook, its controls are hidden */}
                {!overviewActive && <>
                    {/* A preview shows its scripts only, it runs nothing until it is imported */}
                    {!ephemeral && !preview && <dependencies.SegmentedControl
                        aria-label="Workbook view"
                        data-testid="workbook-view-switch"
                        size={SegmentedControlSize.Small}
                        onChange={(selectedIndex) => {
                            setOverviewConnectionId(null);
                            // The editor dialog belongs to the dataflow view
                            setDetails(null);
                            setMode(WORKBOOK_VIEWS[selectedIndex]?.[0] ?? WorkbookViewMode.Workbook);
                        }}
                    >
                        {WORKBOOK_VIEWS.map(([view, label, Icon]) => (
                            <dependencies.SegmentedControl.IconButton
                                key={view}
                                className={styles.view_switch_button}
                                aria-label={label}
                                icon={<Icon size={14} />}
                                selected={activeView === view}
                            />
                        ))}
                    </dependencies.SegmentedControl>}
                    {!ephemeral && <div className={styles.execution_controls}>
                        <dependencies.Button ref={executeRef} size={ButtonSize.Small} variant={ButtonVariant.Invisible}
                            leadingVisual={execution.busy ? SquareFillIcon : PaperAirplaneIcon}
                            aria-label={execution.busy ? 'Stop workbook execution' : 'Execute All'}
                            data-testid={execution.busy ? 'stop-execution' : 'execute-all'}
                            // A run waits for the compute database, it reads the cached results
                            disabled={execution.busy ? run?.phase === 'stopping' : !execution.ready || !scriptConnectionsIdle
                                || execution.runActive || props.workbookScripts.scriptOrder.length === 0}
                            onClick={() => execution.busy ? execution.stop() : execution.start()}>
                            <span className={styles.action_label}>{execution.busy ? run?.phase === 'stopping' ? 'Stopping' : 'Stop' : 'Execute All'}</span>
                        </dependencies.Button>
                        <div className={styles.execution_status} role="status" aria-live="polite" aria-atomic="true" data-testid="execution-status" data-phase={run?.phase}
                            title={run?.error ?? skippedTitle} aria-label={run?.error ? `${statusText}: ${run.error}` : undefined}>
                            {run && <>
                                <AnchoredOverlay
                                    open={executionDetailsOpen} onOpen={() => setExecutionDetailsOpen(true)} onClose={() => setExecutionDetailsOpen(false)}
                                    side={AnchorSide.OutsideBottom} align={AnchorAlignment.Start} anchorOffset={4}
                                    renderAnchor={anchorProps => <dependencies.Button {...anchorProps}
                                        size={ButtonSize.Small} variant={ButtonVariant.Invisible} aria-label="Show workbook execution details" data-testid="execution-details-toggle"
                                        leadingVisual={<span className={styles.execution_indicator} aria-hidden="true" data-testid="execution-indicator"><StatusIndicator width="16px" height="16px" status={execution.busy
                                            ? IndicatorStatus.Running : run.phase === 'failed' ? IndicatorStatus.Failed
                                                : run.phase === 'succeeded' ? IndicatorStatus.Succeeded : IndicatorStatus.Skip} /></span>}>
                                        <span className={styles.execution_progress}>{statusText}</span>
                                    </dependencies.Button>}>
                                    <section className={styles.execution_error_card} role="dialog" aria-label="Workbook execution details" data-testid="execution-details">
                                        <header className={styles.execution_error_header}>
                                            <h2 className={styles.execution_details_title}>{run.phase === 'failed' ? 'Execution failed' : 'Workbook execution'}</h2>
                                            <dependencies.IconButton size={ButtonSize.Small} variant={ButtonVariant.Invisible}
                                                aria-label="Close workbook execution details" data-testid="execution-details-close" onClick={() => setExecutionDetailsOpen(false)}>
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
                    </div>}
                    {/* A preview says it is read-only next to Execute All */}
                    {preview && <dependencies.CloudPreviewBadge labelClassName={styles.action_label} />}
                    <div className={styles.header_actions}>
                        {/* The connections of the workbook, the user sees which one is not connected */}
                        {/* A preview shows its connections locked, the import maps them */}
                        <dependencies.WorkbookConnectionButtons connections={barConnections} attention={connectionAttention.active} />
                        {preview && <dependencies.CloudPreviewActions workbookId={props.workbookScripts.workbookId} labelClassName={styles.action_label} />}
                        {!ephemeral && !preview && <dependencies.Button ref={shareTriggerRef} size={ButtonSize.Small} variant={ButtonVariant.Invisible} leadingVisual={LinkIcon} aria-label="Share as URL" data-testid="share-url" aria-expanded={shareOpen} onClick={() => {
                            setExportOpen(false);
                            setShareOpen(value => !value);
                        }}>
                            <span className={styles.action_label}>Share as URL</span>
                        </dependencies.Button>}
                        <dependencies.WorkbookURLShareOverlay workbookId={props.workbookScripts.workbookId} isOpen={shareOpen} setIsOpen={setShareOpen} anchorRef={shareTriggerRef} />
                        {archiveExport && !ephemeral && !preview && (
                            <>
                                <dependencies.Button ref={exportTriggerRef} size={ButtonSize.Small} variant={ButtonVariant.Invisible} leadingVisual={FileZipIcon} aria-label="Export .dashql" data-testid="export-workbook" aria-expanded={exportOpen} onClick={() => {
                                    setShareOpen(false);
                                    setExportOpen(value => !value);
                                }}>
                                    <span className={styles.action_label}>Export .dashql</span>
                                </dependencies.Button>
                                <dependencies.WorkbookFileSaveOverlay
                                    isOpen={exportOpen}
                                    setIsOpen={setExportOpen}
                                    anchorRef={exportTriggerRef}
                                    workbookScripts={props.workbookScripts}
                                    fileName={props.workbookScripts.name ?? props.workbookScripts.workbookMetadata.originalFileName ?? 'workbook'}
                                />
                            </>
                        )}
                    </div>
                </>}
            </header>
            {navigationDrawerOpen && (
                <dependencies.WorkbookNavigationDrawer open onClose={() => setNavigationDrawerOpen(false)} returnFocusRef={navigationDrawerTriggerRef}>
                    {workbench(true)}
                </dependencies.WorkbookNavigationDrawer>
            )}
        </div>
        </WorkbookReadOnlyContext.Provider>
        </WorkbookConnectionAttentionContext.Provider>
    );
};
