import * as React from 'react';
import * as styles from './workbook_views_page.module.css';

import { SymbolIcon, ThreeBarsIcon } from '@akohn/dashql-react/components/symbol_icon';

import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import {
    isCloudPreview,
    scriptConnectionIds,
    type ModifyWorkbookScripts,
    type WorkbookScripts,
} from '@akohn/dashql/platform/workbook/workbook_scripts';
import { ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { WorkbookNavigationDrawer } from '../navigation/workbook_navigation_drawer.js';
import { WorkbookWorkbenchSidebar } from '../navigation/workbook_workbench_sidebar.js';
import { useWorkbenchHidden } from '../navigation/workbench_hidden.js';
import { WorkbookFeed, type WorkbookFeedInsets, type WorkbookFeedRevealRequest } from '../feed/workbook_feed.js';
import { WorkbookPrompt, WorkbookPromptPlacement, type WorkbookPromptFeed, type WorkbookPromptHandle } from '../feed/workbook_prompt.js';
import type { AgentFollowTarget } from '../../agent/agent_session.js';
import { Dashboard } from '../dashboard/dashboard.js';
import { DataflowView } from '../dataflow/dataflow_view.js';
import { WorkbookConsole } from '../console/workbook_console.js';
import { WorkbookViewMode, defaultViewOfViewMode, useWorkbookViewMode, viewModeOfDefaultView } from '../workbook_view_mode.js';
import { PanelResizeHandle } from '@akohn/dashql-react/components/panel_resize_handle';
import { useWorkbookExecution, useWorkbookShown } from '@akohn/dashql-react/hooks';
import { WorkbookConnectionAttentionContext } from '../connections/workbook_connection_attention.js';
import { WorkbookConnectionButtons } from './workbook_connection_buttons.js';
import { WorkbookExecutionControls, useSkippedRunAttention, type WorkbookExecutionTarget } from './workbook_execution_controls.js';
import { useSelectedScriptKey } from '../scripts/script_selection.js';
import { WorkbookActions, type WorkbookAttach } from './workbook_actions.js';
import { WorkbookViewSwitch } from './workbook_view_switch.js';
import { WorkbookTabBar, type WorkbookTabBarRun } from './workbook_tab_bar.js';
import { DETACHED_NAV_BAR_ACTIONS, NavBarActions } from '../../app/navbar.js';
import { NavRailPages } from '../../app/nav_rail.js';
import { WorkbookErrors } from '../scripts/workbook_errors.js';
import { ConnectionOverviewPage } from '../../connections/connection_overview_page.js';
import { CloudOverviewPage } from '../../cloud/cloud_overview_page.js';
import type { RenameDraftReferences } from '../attachment_rename.js';
import { CloudPreviewBadge, CloudWorkbookLoadingCard } from '../../cloud/cloud_preview_actions.js';
import { useCloudWorkbookLoading } from '../../cloud/cloud_workbook_loading.js';
import { WorkbookReadOnlyContext } from '../workbook_read_only.js';
import { useAppConfig } from '../../config/app_config.js';
import { useFileDropHandler } from '../../app/file_drop_handler.js';
import { ATTACHMENT_EXTENSION } from '@akohn/dashql/platform/storage/storage_backend';
import { useRenderSchedule } from '@akohn/dashql-react/components/deferred';
import { classNames } from '@akohn/dashql-react/dom/classnames';
import { suspendWhileWidthChanges, transitionsEnd } from '@akohn/dashql-react/dom/calm_frames';
import { COMPACT_WIDTH_QUERY, useMediaQuery } from '@akohn/dashql-react/dom/media_query';

// The octicons show the sidebar on the right, flipped it sits on the left like the workbench
const CollapseSidebarIcon = SymbolIcon('sidebar_collapse_16');
const ExpandSidebarIcon = SymbolIcon('sidebar_expand_16');
/// The width of the workbench sidebar in pixels, the handle next to it resizes it
const SIDEBAR_DEFAULT_WIDTH = 276;
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 560;
/// The space above the prompt over the dashboard, the last card ends there
const OVERLAY_GAP = 16;

/// The line between two groups of the bar
const BarSeparator = ({ className }: { className?: string }) => (
    <div className={classNames(styles.bar_separator, className)} role="separator" aria-orientation="vertical" data-testid="workbook-bar-separator" />
);

type FeedProps = React.ComponentProps<typeof WorkbookFeed>;
type PromptProps = React.ComponentProps<typeof WorkbookPrompt>;
type DashboardProps = React.ComponentProps<typeof Dashboard>;
type DataflowProps = React.ComponentProps<typeof DataflowView>;
type ConsoleProps = React.ComponentProps<typeof WorkbookConsole>;
type WorkbenchProps = React.ComponentProps<typeof WorkbookWorkbenchSidebar>;

const renderFeed = (props: FeedProps) => <WorkbookFeed {...props} />;
const renderPrompt = (props: PromptProps) => <WorkbookPrompt {...props} />;
const renderDashboard = (props: DashboardProps) => <Dashboard {...props} />;
const renderDataflow = (props: DataflowProps) => <DataflowView {...props} />;
const renderConsole = (props: ConsoleProps) => <WorkbookConsole {...props} />;
const renderWorkbench = (props: WorkbenchProps) => <WorkbookWorkbenchSidebar {...props} />;

interface Props {
    workbookScripts: WorkbookScripts;
    modifyWorkbookScripts: ModifyWorkbookScripts;
    /// The connection that the next script of the workbook runs on
    connection: ConnectionState | null;
    /// The connections that the scripts of the workbook run on
    scriptConnections: ReadonlyMap<string, ConnectionState>;
    // The heavy parts of the page are slots with the real views as defaults. A test shows stand-ins: they need
    // editors, charts, the layout of the dataflow or the storage of the app.
    /// The feed of the scripts
    feed?: (props: FeedProps) => React.ReactNode;
    /// The prompt over the views
    prompt?: (props: PromptProps) => React.ReactNode;
    /// The dashboard
    dashboard?: (props: DashboardProps) => React.ReactNode;
    /// The dataflow, its canvas and the editor dialog of a script
    dataflow?: (props: DataflowProps) => React.ReactNode;
    /// The console, the scripts as tabs with an editor over the results
    console?: (props: ConsoleProps) => React.ReactNode;
    /// The workbench next to the views and in the drawer
    workbench?: (props: WorkbenchProps) => React.ReactNode;
}

/// The page of a workbook. Memoized: the workbook page renders again with a change of any connection, the page only
/// when its props change.
export const WorkbookViewsPage = React.memo(function WorkbookViewsPage(props: Props): React.ReactElement {
    const {
        feed = renderFeed, prompt = renderPrompt, dashboard = renderDashboard, dataflow = renderDataflow,
        console: consoleSlot = renderConsole, workbench: workbenchSlot = renderWorkbench,
    } = props;
    // The composer of the prompt renames the references in its draft, also for the attachments renamed in the feed
    const draftRenameRef = React.useRef<RenameDraftReferences | null>(null);
    const [navigationDrawerOpen, setNavigationDrawerOpen] = React.useState(false);
    const closeNavigationDrawer = React.useCallback(() => setNavigationDrawerOpen(false), []);
    const [sidebarWidth, setSidebarWidth] = React.useState(SIDEBAR_DEFAULT_WIDTH);
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
    // The toggle of the bar hides the workbench. It stays mounted while hidden and keeps its folders, sections and
    // scroll positions. A workbook just imported, e.g. from a dropped file, hides it.
    const [sidebarHidden, setSidebarHidden] = useWorkbenchHidden(props.workbookScripts.workbookId);
    const navigationDrawerTriggerRef = React.useRef<HTMLButtonElement>(null);
    // A workbook run takes every connection that a script runs on. Connections that aren't connected serve the cached
    // results of their scripts, the others are skipped.
    const scriptConnections = props.scriptConnections;
    const runConnections = scriptConnectionIds(props.workbookScripts).flatMap(connectionId => scriptConnections.get(connectionId) ?? []);
    // The bar also shows the connection that the composer drafts the next script on, e.g. the one picked in an empty workbook
    const barConnections = props.workbookScripts.connectionIds.flatMap(connectionId => scriptConnections.get(connectionId) ?? []);
    // The commands of the workbook hold the attention of its connections
    const connectionAttention = React.useContext(WorkbookConnectionAttentionContext);
    // A connection that is connecting holds the run, it would join a moment later
    const scriptConnectionsIdle = runConnections.length > 0 && runConnections.every(connection =>
        connection.connectionHealth !== ConnectionHealth.CONNECTING && (connection.queriesActiveOrdered?.length ?? 0) === 0);
    const execution = useWorkbookExecution(props.workbookScripts.workbookId);
    // The console runs its script with what it needs, the other views run the whole workbook
    const selectedScriptKey = useSelectedScriptKey(props.workbookScripts.workbookId);
    // The workbook shows the stored results of its scripts once it is shown (docs/design/workbook_results.md)
    useWorkbookShown(props.workbookScripts.workbookId);
    useSkippedRunAttention(props.workbookScripts.workbookId, execution);
    React.useEffect(() => setOverview(null), [props.workbookScripts.workbookId]);
    const { mode, setMode } = useWorkbookViewMode();
    // The greeter has nothing to run or share until a script promotes its workbook, it switches the views like any other
    const ephemeral = props.workbookScripts.ephemeral;
    // A read-only look at a published workbook is imported before it is shared
    const preview = isCloudPreview(props.workbookScripts);
    // The feed attaches the Parquet files dropped on the app or picked in the menu, its section shows them once there
    const attachmentsVisible = useAppConfig()?.settings?.experimental_file_attachments === true;
    const attachEnabled = attachmentsVisible && !preview && (props.connection?.readsAttachments ?? false);
    const attachRef = React.useRef<((files: File[]) => void) | null>(null);
    const attachFromMenu = React.useMemo<WorkbookAttach | null>(() => !attachmentsVisible ? null : {
        enabled: attachEnabled,
        attach: files => attachRef.current?.(files),
    }, [attachmentsVisible, attachEnabled]);
    // The page shows while the shell is closed, the view that it shows is the view mode then
    const pageShown = mode !== WorkbookViewMode.Shell;
    const activeView = pageShown ? mode : WorkbookViewMode.Feed;
    // A preview shows its scripts in the feed only
    React.useEffect(() => {
        if (preview && pageShown && activeView !== WorkbookViewMode.Feed) setMode(WorkbookViewMode.Feed);
    }, [preview, pageShown, activeView, setMode]);
    // A switch of the view holds the heavy renders until the transitions it starts end, e.g. the morph of the prompt
    // (workbook_composer.module.css, workbook_prompt.module.css), the next view shows skeletons until then. A slow
    // frame delays the end of a transition, the hold follows it. The layout effect runs before the effects of the new
    // view schedule the renders.
    const renderSchedule = useRenderSchedule();
    const contentRef = React.useRef<HTMLDivElement>(null);
    const shownView = React.useRef(activeView);
    React.useLayoutEffect(() => {
        if (shownView.current === activeView) return;
        shownView.current = activeView;
        renderSchedule.hold(transitionsEnd(contentRef.current));
    }, [activeView, renderSchedule]);
    // A change of the width of the window shows the skeletons as a drag of the sidebar does, the cards lay out once
    // after it
    React.useEffect(() => suspendWhileWidthChanges(renderSchedule), [renderSchedule]);
    const overviewActive = overview != null;
    // A version of a published workbook that is being loaded takes the place of the views
    const cloudLoading = useCloudWorkbookLoading() != null;
    // The active view shows unless an overview or a loading version takes its place
    const viewShown = pageShown && !overviewActive && !cloudLoading;
    const consoleScriptIndex = activeView === WorkbookViewMode.Console && selectedScriptKey != null
        ? props.workbookScripts.scriptKeys.indexOf(selectedScriptKey) : -1;
    const consoleScriptFile = props.workbookScripts.scriptOrder[consoleScriptIndex];
    const executionTarget = React.useMemo<WorkbookExecutionTarget | null>(
        () => consoleScriptFile == null ? null : { index: consoleScriptIndex, fileName: consoleScriptFile },
        [consoleScriptIndex, consoleScriptFile],
    );
    const feedActive = viewShown && activeView === WorkbookViewMode.Feed;
    // The prompt floats over the views of the workbook and creates scripts in every one of them. It docks below the
    // scripts of the feed and floats over the other views.
    const promptPlacement = !viewShown ? WorkbookPromptPlacement.Hidden
        : feedActive ? WorkbookPromptPlacement.Feed : WorkbookPromptPlacement.Overlay;
    // A click on the bar of Wobble shows or hides the composer. A switch of the view returns it to the default of the
    // view: shown in the feed, shrunk into the bar over the other views and on a compact window, where it would cover
    // the cards (docs/design/narrow_layouts.md). An overview keeps it.
    const compact = useMediaQuery(COMPACT_WIDTH_QUERY);
    const [promptToggle, setPromptToggle] = React.useState<{ view: WorkbookViewMode; expanded: boolean } | null>(null);
    if (promptToggle != null && promptToggle.view !== activeView) setPromptToggle(null);
    const promptExpanded = promptToggle?.view === activeView ? promptToggle.expanded : activeView === WorkbookViewMode.Feed && !compact;
    const togglePrompt = React.useCallback((expanded: boolean) => setPromptToggle({ view: activeView, expanded }), [activeView]);
    useFileDropHandler(pageShown ? files => {
        const attach = attachRef.current;
        if (attach == null || !files.some(file => file.name.toLowerCase().endsWith(ATTACHMENT_EXTENSION))) return false;
        attach(files);
        return true;
    } : null);
    const showView = React.useCallback((view: WorkbookViewMode) => {
        setOverviewConnectionId(null);
        setMode(view);
    }, [setMode, setOverviewConnectionId]);
    // A preview shows its scripts only, it runs nothing until it is imported
    const viewSwitchShown = !preview && !overviewActive;
    // The face of Wobble in the tab bar of a compact window tells the run of the workbook
    const tabBarRun: WorkbookTabBarRun = execution.busy ? 'running'
        : execution.state?.phase === 'failed' ? 'failed' : execution.state?.phase === 'succeeded' ? 'succeeded' : 'idle';
    // The view that the workbook opens in, also for the people it is shared with. The greeter has nothing to share.
    const defaultView = viewModeOfDefaultView(props.workbookScripts.defaultView);
    const modifyWorkbookScripts = props.modifyWorkbookScripts;
    const setDefaultView = React.useCallback((view: WorkbookViewMode) => {
        modifyWorkbookScripts({ kind: 'setDefaultView', value: { view: defaultViewOfViewMode(view) } });
    }, [modifyWorkbookScripts]);
    // The groups at the end of the bar. An ephemeral workbook has no actions and no Execute All, a preview has its own
    // actions and says next to Execute All that it is read-only.
    const connectionsShown = barConnections.length > 0;
    const actionsShown = preview || !ephemeral;
    // A script opened from the sidebar shows in the feed
    const [revealRequest, setRevealRequest] = React.useState<WorkbookFeedRevealRequest | null>(null);
    const openScript = React.useCallback((workbookId: string, fileName: string) => {
        setOverviewConnectionId(null);
        if (mode !== WorkbookViewMode.Feed) setMode(WorkbookViewMode.Feed);
        setRevealRequest({ workbookId, fileName });
    }, [mode, setMode, setOverviewConnectionId]);
    // The prompt and the feed ask each other through handles: the feed mentions its scripts in the question of the
    // prompt, the prompt has the feed follow the agent and show the scripts it appends
    const promptRef = React.useRef<WorkbookPromptHandle | null>(null);
    // The script that another view than the feed shows, until the view switches or an overview covers it
    const [viewReveal, setViewReveal] = React.useState<{ view: WorkbookViewMode; scriptKey: number } | null>(null);
    if (viewReveal != null && (viewReveal.view !== activeView || !viewShown)) setViewReveal(null);
    const dashboardReveal = viewReveal?.view === WorkbookViewMode.Dashboard ? viewReveal : null;
    const dataflowReveal = viewReveal?.view === WorkbookViewMode.Dataflow ? viewReveal : null;
    const consoleReveal = viewReveal?.view === WorkbookViewMode.Console ? viewReveal : null;
    const feedRef = React.useRef<WorkbookPromptFeed | null>(null);
    const modeRef = React.useRef(mode);
    modeRef.current = mode;
    const promptFeed = React.useMemo<WorkbookPromptFeed>(() => ({
        follow: (scriptKey: number, target: AgentFollowTarget) => feedRef.current?.follow(scriptKey, target),
        // A script that the user picks in the log of the agent shows in the feed
        show: (scriptKey: number) => {
            setOverviewConnectionId(null);
            if (modeRef.current !== WorkbookViewMode.Feed) setMode(WorkbookViewMode.Feed);
            feedRef.current?.show(scriptKey);
        },
        followAgent: () => feedRef.current?.followAgent(),
        // The feed scrolls to the end also while it is hidden, the other views show the new script
        appended: (scriptKey: number) => {
            feedRef.current?.appended(scriptKey);
            if (modeRef.current !== WorkbookViewMode.Feed) setViewReveal({ view: modeRef.current, scriptKey });
        },
    }), [setMode, setOverviewConnectionId]);
    // A failed script of the run of the workbook shows in the feed
    const scriptRefs = props.workbookScripts.scriptRefs;
    const showScriptOfFile = React.useCallback((fileName: string) => {
        const scriptKey = scriptRefs[fileName]?.scriptId;
        if (scriptKey != null) promptFeed.show(scriptKey);
    }, [promptFeed, scriptRefs]);
    // The feed keeps the space of the docked prompt below its last script, also while the prompt is shrunk over
    // another view and the rows of the hidden feed stay where they are
    const [feedInsets, setFeedInsets] = React.useState<WorkbookFeedInsets | undefined>(undefined);
    const [promptHeight, setPromptHeight] = React.useState(0);
    const feedBottomInset = React.useRef(promptHeight);
    if (promptPlacement === WorkbookPromptPlacement.Feed) feedBottomInset.current = promptHeight;
    // Over the dashboard and the dataflow the prompt covers their bottom, the last card scrolls clear of it and a
    // revealed box stays above it. The stylesheet has the space of the bar until the prompt is measured.
    const overlayInset = promptPlacement === WorkbookPromptPlacement.Overlay ? promptHeight : 0;
    const overlayInsetRef = React.useRef(overlayInset);
    overlayInsetRef.current = overlayInset;
    const readOverlayInset = React.useCallback(() => overlayInsetRef.current, []);
    const workbench = (closeAfterSelection: boolean) => workbenchSlot({
        workbookScripts: props.workbookScripts,
        closeAfterSelection: closeAfterSelection ? closeNavigationDrawer : undefined,
        openOverviewId: overviewConnectionId,
        onOpenOverview: setOverviewConnectionId,
        openCloudId: cloudOverviewId,
        onOpenCloud: setCloudOverviewId,
        onOpenScript: openScript,
    });

    return (
        <WorkbookReadOnlyContext.Provider value={preview}>
            <div
                className={classNames(styles.page, sidebarHidden && styles.page_sidebar_hidden)}
                style={{ '--workbook_navigation_sidebar_width': `${sidebarWidth}px` } as React.CSSProperties}
            >
                <aside className={styles.navigation_sidebar}>
                    {workbench(false)}
                </aside>
                <PanelResizeHandle
                    className={styles.navigation_sidebar_separator}
                    size={sidebarWidth}
                    minSize={SIDEBAR_MIN_WIDTH}
                    maxSize={SIDEBAR_MAX_WIDTH}
                    onResize={setSidebarWidth}
                    // The charts and tables of the cards show their skeletons while the sidebar is dragged
                    onDragStart={renderSchedule.suspend}
                    label="Resize workbench and workbook"
                />
                <main className={styles.body_container} id="workbook-body">
                    <div
                        ref={contentRef}
                        className={styles.content_container}
                        style={overlayInset > 0 ? { '--status_bar_dock_space': `${overlayInset + OVERLAY_GAP}px` } as React.CSSProperties : undefined}
                    >
                        {cloudLoading && (
                            <div className={styles.loading_layer}>
                                <CloudWorkbookLoadingCard />
                            </div>
                        )}
                        <div className={feedActive ? styles.feed_layer : styles.feed_layer_hidden}>
                            {feed({
                                workbookScripts: props.workbookScripts,
                                modifyWorkbookScripts: props.modifyWorkbookScripts,
                                draftRenameRef,
                                active: feedActive,
                                revealRequest,
                                attachRef,
                                bottomInset: feedBottomInset.current,
                                promptRef,
                                handleRef: feedRef,
                                onInsets: setFeedInsets,
                                conn: props.connection,
                                scriptConnections,
                            })}
                        </div>
                        {overviewConnectionId != null && !cloudLoading && (
                            <ConnectionOverviewPage
                                connectionId={overviewConnectionId}
                                onClose={closeOverview}
                            />
                        )}
                        {cloudOverviewId != null && !cloudLoading && (
                            <CloudOverviewPage
                                key={cloudOverviewId}
                                connectionId={cloudOverviewId}
                                onClose={closeOverview}
                            />
                        )}
                        {viewShown && activeView === WorkbookViewMode.Console && (
                            consoleSlot({
                                workbookScripts: props.workbookScripts,
                                modifyWorkbookScripts: props.modifyWorkbookScripts,
                                scriptConnections,
                                connection: props.connection,
                                draftRenameRef,
                                revealRequest: consoleReveal,
                            })
                        )}
                        {viewShown && activeView === WorkbookViewMode.Dashboard && (
                            dashboard({
                                workbookScripts: props.workbookScripts,
                                modifyWorkbookScripts: props.modifyWorkbookScripts,
                                scriptConnections,
                                revealRequest: dashboardReveal,
                            })
                        )}
                        {viewShown && activeView === WorkbookViewMode.Dataflow && (
                            dataflow({
                                workbookScripts: props.workbookScripts,
                                modifyWorkbookScripts: props.modifyWorkbookScripts,
                                scriptConnections,
                                revealRequest: dataflowReveal,
                                bottomInset: readOverlayInset,
                            })
                        )}
                        {/* Over the views, the composer keeps its draft and its focus when the view switches */}
                        {prompt({
                            workbookScripts: props.workbookScripts,
                            modifyWorkbookScripts: props.modifyWorkbookScripts,
                            conn: props.connection,
                            scriptConnections,
                            placement: promptPlacement,
                            expanded: promptExpanded,
                            onExpandedChange: togglePrompt,
                            feed: promptFeed,
                            handleRef: promptRef,
                            draftRenameRef,
                            feedInsets,
                            onHeight: setPromptHeight,
                        })}
                    </div>
                </main>
                {/* After the feed in the DOM, so that no-drag rows scrolled behind the bar do not cut holes into its drag region, see docs/design/electron.md */}
                {/* The dark chrome at the top of a compact window, in place of the stripe and the rail: the drawer, the
                    pages of the rail and the overlays of the stripe */}
                {compact && (
                    <div className={styles.compact_chrome} data-workbook-chrome>
                        <IconButton className={styles.chrome_menu_button} ref={navigationDrawerTriggerRef} variant={ButtonVariant.Default} aria-label="Open workbook workbench" data-testid="open-workbench" onClick={() => setNavigationDrawerOpen(true)}>
                            <ThreeBarsIcon />
                        </IconButton>
                        <nav className={styles.rail_pages} aria-label="Areas">
                            <NavRailPages wide={false} />
                        </nav>
                        <NavBarActions workbookId={props.workbookScripts.workbookId} className={`${DETACHED_NAV_BAR_ACTIONS} ${styles.system_actions}`} />
                    </div>
                )}
                <header className={styles.view_bar} data-electron-drag-region data-workbook-bar>
                    {/* The groups at the start of the bar: the workbench, then the execution of the workbook */}
                    <div className={styles.bar_group} role="group" aria-label="Workbench" data-testid="workbook-workbench-group">
                        {!compact && (
                            <IconButton className={styles.mobile_menu_button} ref={navigationDrawerTriggerRef} variant={ButtonVariant.Default} aria-label="Open workbook workbench" data-testid="open-workbench" onClick={() => setNavigationDrawerOpen(true)}>
                                <ThreeBarsIcon />
                            </IconButton>
                        )}
                        <IconButton
                            className={styles.sidebar_toggle}
                            size={ButtonSize.Small}
                            variant={ButtonVariant.Invisible}
                            aria-label={sidebarHidden ? 'Show workbench' : 'Hide workbench'}
                            aria-expanded={!sidebarHidden}
                            data-testid="workbench-toggle"
                            onClick={() => setSidebarHidden(!sidebarHidden)}
                        >
                            {sidebarHidden ? <ExpandSidebarIcon size={16} /> : <CollapseSidebarIcon size={16} />}
                        </IconButton>
                    </div>
                    {/* A connection overview is not part of the workbook, its controls are hidden */}
                    {!overviewActive && <>
                        {actionsShown && <BarSeparator className={styles.start_separator} />}
                        {actionsShown && <div className={styles.execution_controls} role="group" aria-label="Execution" data-testid="workbook-execution-group">
                            {!ephemeral && (
                                <WorkbookExecutionControls
                                    workbookId={props.workbookScripts.workbookId}
                                    target={executionTarget}
                                    execution={execution}
                                    startable={scriptConnectionsIdle && props.workbookScripts.scriptOrder.length > 0}
                                    showScript={showScriptOfFile}
                                />
                            )}
                            {/* A preview says it is read-only next to Execute All */}
                            {preview && <CloudPreviewBadge labelClassName={styles.action_label} />}
                            {/* The errors of the scripts, a script with errors doesn't run as intended */}
                            {!ephemeral && (
                                <WorkbookErrors
                                    workbookId={props.workbookScripts.workbookId}
                                    scriptKeys={props.workbookScripts.scriptKeys}
                                    showScript={promptFeed.show}
                                />
                            )}
                        </div>}
                        {/* The groups at the end of the bar: the connections of the workbook, its actions, then its views. A
                            separator stands between two groups that show. */}
                        <div className={styles.bar_end}>
                            {connectionsShown && (
                                <div className={classNames(styles.bar_group, styles.connections_group)} role="group" aria-label="Connections" data-testid="workbook-connections-group">
                                    {/* The connections of the workbook, the user sees which one is not connected */}
                                    {/* A preview shows its connections locked, the import maps them */}
                                    <WorkbookConnectionButtons connections={barConnections} attention={connectionAttention?.active === true} />
                                </div>
                            )}
                            {connectionsShown && (actionsShown || viewSwitchShown) && <BarSeparator />}
                            {actionsShown && (
                                <WorkbookActions workbookScripts={props.workbookScripts} ephemeral={ephemeral} preview={preview} attach={attachFromMenu} />
                            )}
                            {actionsShown && viewSwitchShown && <BarSeparator />}
                            {viewSwitchShown && (
                                <div className={classNames(styles.bar_group, styles.view_switch)} role="group" aria-label="Views" data-testid="workbook-views-group">
                                    <WorkbookViewSwitch
                                        activeView={activeView}
                                        onShowView={showView}
                                        defaultView={defaultView}
                                        onSetDefaultView={ephemeral ? undefined : setDefaultView}
                                        arrowKeys={pageShown}
                                    />
                                </div>
                            )}
                        </div>
                    </>}
                </header>
                {/* The views at the bottom of a compact window with Wobble in their middle, the bar at the top has no switch there */}
                {viewSwitchShown && pageShown && (
                    <div className={styles.tab_bar}>
                        <WorkbookTabBar
                            activeView={activeView}
                            onShowView={showView}
                            promptExpanded={promptExpanded}
                            onTogglePrompt={viewShown ? togglePrompt : undefined}
                            run={tabBarRun}
                        />
                    </div>
                )}
                {navigationDrawerOpen && (
                    <WorkbookNavigationDrawer open onClose={closeNavigationDrawer} returnFocusRef={navigationDrawerTriggerRef}>
                        {workbench(true)}
                    </WorkbookNavigationDrawer>
                )}
            </div>
        </WorkbookReadOnlyContext.Provider>
    );
});
