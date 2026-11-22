import * as React from 'react';
import * as styles from './workbook_feed_page.module.css';

import { LinkIcon, PaperAirplaneIcon, PaperclipIcon, SquareFillIcon, SymbolIcon, ThreeBarsIcon } from '@akohn/dashql-react/components/symbol_icon';
import * as ActionList from '@akohn/dashql-react/components/action_list';
import * as actionMenuStyles from '../../app/action_menu.module.css';

import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import {
    isCloudPreview,
    scriptConnectionIds,
    type ModifyWorkbookScripts,
    type WorkbookScripts,
} from '@akohn/dashql/platform/workbook/workbook_scripts';
import { useScriptSelection } from '../scripts/script_selection.js';
import { Button, ButtonSize, ButtonVariant, IconButton } from '@akohn/dashql-react/components/button';
import { WorkbookNavigationDrawer } from '../navigation/workbook_navigation_drawer.js';
import { WorkbookWorkbenchSidebar } from '../navigation/workbook_workbench_sidebar.js';
import { useWorkbenchHidden } from '../navigation/workbench_hidden.js';
import { WorkbookURLShareOverlay } from '../persistence/workbook_url_share_overlay.js';
import { WorkbookFileSaveOverlay } from '../persistence/workbook_file_save_overlay.js';
import { ScriptEditorDialog } from '../scripts/script_editor_dialog.js';
import { WorkbookFeed, type WorkbookFeedInsets, type WorkbookFeedRevealRequest } from './workbook_feed.js';
import { WorkbookPrompt, WorkbookPromptPlacement, type WorkbookPromptFeed, type WorkbookPromptHandle } from './workbook_prompt.js';
import type { AgentFollowTarget } from '../../agent/agent_session.js';
import { Dashboard } from '../dashboard/dashboard.js';
import { DataflowCanvas } from '../dataflow/dataflow_canvas.js';
import { WorkbookViewMode, defaultViewOfViewMode, useWorkbookViewMode, viewModeOfDefaultView } from '../workbook_view_mode.js';
import { SegmentedControl, SegmentedControlSize } from '@akohn/dashql-react/components/segmented_control';
import { PanelResizeHandle } from '@akohn/dashql-react/components/panel_resize_handle';
import { useWorkbookExecution, useWorkbookShown } from '@akohn/dashql-react/hooks';
import { IndicatorStatus, StatusIndicator } from '@akohn/dashql-react/components/status_indicator';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { WorkbookConnectionAttentionContext } from '../connections/workbook_connection_attention.js';
import { WorkbookConnectionButtons } from './workbook_connection_buttons.js';
import { useAppFlavor } from '../../config/flavor_provider.js';
import { ConnectionOverviewPage } from '../../connections/connection_overview_page.js';
import { CloudOverviewPage } from '../../cloud/cloud_overview_page.js';
import type { RenameDraftReferences } from '../scripts/script_rename.js';
import { CloudPreviewActions, CloudPreviewBadge, CloudWorkbookLoadingCard } from '../../cloud/cloud_preview_actions.js';
import { useCloudWorkbookLoading } from '../../cloud/cloud_workbook_loading.js';
import { WorkbookReadOnlyContext } from '../workbook_read_only.js';
import { useAppConfig } from '../../config/app_config.js';
import { useFileDropHandler } from '../../app/file_drop_handler.js';
import { ATTACHMENT_EXTENSION } from '@akohn/dashql/platform/storage/storage_backend';
import { useRenderSchedule } from '@akohn/dashql-react/components/deferred';
import { classNames } from '@akohn/dashql-react/dom/classnames';
import { transitionsEnd } from '@akohn/dashql-react/dom/calm_frames';

const FileZipIcon = SymbolIcon('file_zip_16');
const MoreIcon = SymbolIcon('kebab_horizontal');
const PreviousViewIcon = SymbolIcon('chevron_left_12');
const NextViewIcon = SymbolIcon('chevron_right_12');
// The bookmark of the view that the workbook opens in, octicons
const DefaultViewIcon = SymbolIcon('bookmark_16');
const DefaultViewSetIcon = SymbolIcon('bookmark_filled_16');
const CloseIcon = SymbolIcon('x_16');
// The octicons show the sidebar on the right, flipped it sits on the left like the workbench
const CollapseSidebarIcon = SymbolIcon('sidebar_collapse_16');
const ExpandSidebarIcon = SymbolIcon('sidebar_expand_16');
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
/// The elements that move with the arrow keys themselves: text, editors, composite widgets and dialogs. Elsewhere the
/// arrow keys switch the views of the workbook.
const ARROW_KEY_TARGETS = [
    'input', 'textarea', 'select', '[contenteditable]:not([contenteditable="false"])',
    '[role="grid"]', '[role="treegrid"]', '[role="listbox"]', '[role="menu"]', '[role="menubar"]', '[role="radiogroup"]',
    '[role="slider"]', '[role="tablist"]', '[role="tree"]', '[role="dialog"]',
].join(', ');

function usesArrowKeys(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(ARROW_KEY_TARGETS) != null;
}
/// The width of the workbench sidebar in pixels, the handle next to it resizes it
const SIDEBAR_DEFAULT_WIDTH = 276;
const SIDEBAR_MIN_WIDTH = 200;
const SIDEBAR_MAX_WIDTH = 560;

/// The line between two groups of the bar
const BarSeparator = ({ className }: { className?: string }) => (
    <div className={classNames(styles.bar_separator, className)} role="separator" aria-orientation="vertical" data-testid="workbook-bar-separator" />
);

export interface WorkbookFeedPageDependencies {
    WorkbookFeed: typeof WorkbookFeed;
    WorkbookPrompt: typeof WorkbookPrompt;
    ScriptEditorDialog: typeof ScriptEditorDialog;
    WorkbookWorkbenchSidebar: typeof WorkbookWorkbenchSidebar;
    useWorkbenchHidden: typeof useWorkbenchHidden;
    ConnectionOverviewPage: typeof ConnectionOverviewPage;
    CloudOverviewPage: typeof CloudOverviewPage;
    WorkbookNavigationDrawer: typeof WorkbookNavigationDrawer;
    Dashboard: typeof Dashboard;
    DataflowCanvas: typeof DataflowCanvas;
    WorkbookURLShareOverlay: typeof WorkbookURLShareOverlay;
    WorkbookFileSaveOverlay: typeof WorkbookFileSaveOverlay;
    WorkbookConnectionButtons: typeof WorkbookConnectionButtons;
    useWorkbookViewMode: typeof useWorkbookViewMode;
    useWorkbookExecution: typeof useWorkbookExecution;
    useWorkbookShown: typeof useWorkbookShown;
    CloudWorkbookLoadingCard: typeof CloudWorkbookLoadingCard;
}

const DEFAULT_DEPENDENCIES: WorkbookFeedPageDependencies = {
    WorkbookFeed,
    WorkbookPrompt,
    ScriptEditorDialog,
    WorkbookWorkbenchSidebar,
    useWorkbenchHidden,
    ConnectionOverviewPage,
    CloudOverviewPage,
    WorkbookNavigationDrawer,
    Dashboard,
    DataflowCanvas,
    WorkbookURLShareOverlay,
    WorkbookFileSaveOverlay,
    WorkbookConnectionButtons,
    useWorkbookViewMode,
    useWorkbookExecution,
    useWorkbookShown,
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
    // The composer of the prompt renames the references in its draft, also for renames in the feed and the dataflow
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
    // scroll positions. A workbook just imported, e.g. from a dropped file, hides it in its dashboard or dataflow.
    const opensInView = viewModeOfDefaultView(props.workbookScripts.defaultView) !== WorkbookViewMode.Workbook;
    const [sidebarHidden, setSidebarHidden] = dependencies.useWorkbenchHidden(props.workbookScripts.workbookId, opensInView);
    const navigationDrawerTriggerRef = React.useRef<HTMLButtonElement>(null);
    // The menu of the workbook actions; Share as URL opens at the menu button, Export .dashql at the button that
    // opened it
    const menuTriggerRef = React.useRef<HTMLButtonElement>(null);
    const exportTriggerRef = React.useRef<HTMLButtonElement>(null);
    const [menuOpen, setMenuOpen] = React.useState(false);
    const [shareOpen, setShareOpen] = React.useState(false);
    const [exportOpen, setExportOpen] = React.useState<'button' | 'menu' | null>(null);
    const setExportOverlayOpen = React.useCallback((open: boolean) => setExportOpen(current => open ? current ?? 'button' : null), []);
    const flavor = useAppFlavor();
    const archiveExport = flavor.features.workbookArchiveExport;
    // The DashQL flavor also shows Export .dashql next to the menu
    const exportButton = archiveExport && flavor.id === 'dashql';
    // A workbook run takes every connection that a script runs on. Connections that aren't connected serve the cached
    // results of their scripts, the others are skipped.
    const scriptConnections = props.scriptConnections ?? new Map(props.connection == null ? [] : [[props.connection.connectionId, props.connection]]);
    const runConnections = scriptConnectionIds(props.workbookScripts).flatMap(connectionId => scriptConnections.get(connectionId) ?? []);
    // The bar also shows the connection that the composer drafts the next script on, e.g. the one picked in an empty workbook
    const barConnections = props.workbookScripts.connectionIds.flatMap(connectionId => scriptConnections.get(connectionId) ?? []);
    // The commands of the workbook hold the attention of its connections
    const connectionAttention = React.useContext(WorkbookConnectionAttentionContext);
    // A connection that is connecting holds the run, it would join a moment later
    const scriptConnectionsIdle = runConnections.length > 0 && runConnections.every(connection =>
        connection.connectionHealth !== ConnectionHealth.CONNECTING && (connection.queriesActiveOrdered?.length ?? 0) === 0);
    const execution = dependencies.useWorkbookExecution(props.workbookScripts.workbookId);
    // The workbook shows the stored results of its scripts once it is shown (docs/design/workbook_results.md)
    dependencies.useWorkbookShown(props.workbookScripts.workbookId);
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
    const requestAttention = connectionAttention?.request;
    React.useEffect(() => {
        if (settledWithSkips && sawRun.current) {
            sawRun.current = false;
            requestAttention?.();
        }
    }, [settledWithSkips, requestAttention]);
    const skippedTitle = run != null && run.skippedFiles.length > 0 ? `Need a connection: ${run.skippedFiles.join(', ')}` : undefined;
    const { mode, setMode } = dependencies.useWorkbookViewMode();
    // The greeter has nothing to run or share until a script promotes its workbook, it switches the views like any other
    const ephemeral = props.workbookScripts.ephemeral;
    // A read-only look at a published workbook is imported before it is shared
    const preview = isCloudPreview(props.workbookScripts);
    // The feed attaches the Parquet files dropped on the app or picked in the menu, its section shows them once there
    const attachmentsVisible = useAppConfig()?.settings?.experimental_file_attachments === true;
    const attachEnabled = attachmentsVisible && !preview && (props.connection?.readsAttachments ?? false);
    const attachRef = React.useRef<((files: File[]) => void) | null>(null);
    const attachInputRef = React.useRef<HTMLInputElement>(null);
    React.useEffect(() => {
        if (preview && (mode === WorkbookViewMode.Dashboard || mode === WorkbookViewMode.Dataflow)) setMode(WorkbookViewMode.Workbook);
    }, [preview, mode, setMode]);
    const dashboardActive = mode === WorkbookViewMode.Dashboard;
    const dataflowActive = mode === WorkbookViewMode.Dataflow;
    const activeView = dashboardActive ? WorkbookViewMode.Dashboard : dataflowActive ? WorkbookViewMode.Dataflow : WorkbookViewMode.Workbook;
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
    const overviewActive = overview != null;
    // A version of a published workbook that is being loaded takes the place of the views
    const cloudLoading = useCloudWorkbookLoading() != null;
    const feedActive = props.active && !dashboardActive && !dataflowActive && !overviewActive && !cloudLoading;
    // The prompt floats over the views of the workbook. It docks below the scripts of the feed, shrinks into the bar of
    // Wobble when the dashboard or the dataflow show and grows into the prompt when the feed shows again. The workbook
    // page is active in the feed only, it shows in the dashboard and the dataflow too.
    const composerCollapsed = (dashboardActive || dataflowActive) && !overviewActive && !cloudLoading;
    const promptPlacement = feedActive ? WorkbookPromptPlacement.Feed
        : composerCollapsed ? WorkbookPromptPlacement.Collapsed : WorkbookPromptPlacement.Hidden;
    const pageShown = props.active || dashboardActive || dataflowActive;
    useFileDropHandler(pageShown ? files => {
        const attach = attachRef.current;
        if (attach == null || !files.some(file => file.name.toLowerCase().endsWith(ATTACHMENT_EXTENSION))) return false;
        attach(files);
        return true;
    } : null);
    // The views in the order of the switch, the arrow keys and the arrows beside the switch step through them
    const viewIndex = WORKBOOK_VIEWS.findIndex(([view]) => view === activeView);
    const showView = React.useCallback((view: WorkbookViewMode) => {
        setOverviewConnectionId(null);
        // The editor dialog belongs to the dataflow view
        setDetails(null);
        setMode(view);
    }, [setMode, setOverviewConnectionId]);
    const stepView = React.useCallback((step: number) => {
        const next = WORKBOOK_VIEWS[viewIndex + step];
        if (next != null) showView(next[0]);
    }, [viewIndex, showView]);
    // A preview shows its scripts only, it runs nothing until it is imported
    const viewSwitchShown = !preview && !overviewActive;
    // The bookmark beside the switch marks the view that the workbook opens in, also for the people it is shared
    // with. Marking the bookmarked view again returns the workbook to the feed. The greeter has nothing to share.
    const defaultView = viewModeOfDefaultView(props.workbookScripts.defaultView);
    const activeViewIsDefault = activeView === defaultView;
    const activeViewLabel = WORKBOOK_VIEWS[viewIndex]?.[1] ?? 'Feed';
    const modifyWorkbookScripts = props.modifyWorkbookScripts;
    const toggleDefaultView = React.useCallback(() => {
        const next = activeViewIsDefault ? WorkbookViewMode.Workbook : activeView;
        if (next === defaultView) return;
        modifyWorkbookScripts({ kind: 'setDefaultView', value: { view: defaultViewOfViewMode(next) } });
    }, [activeView, activeViewIsDefault, defaultView, modifyWorkbookScripts]);
    const defaultViewDescription = !activeViewIsDefault
        ? `Open the workbook in the ${activeViewLabel.toLowerCase()}`
        : activeView === WorkbookViewMode.Workbook
            ? 'The workbook opens in the feed'
            : `The workbook opens in the ${activeViewLabel.toLowerCase()}, click to open it in the feed`;
    // The groups at the end of the bar. An ephemeral workbook has no actions, a preview has its own.
    const connectionsShown = barConnections.length > 0;
    const actionsShown = preview || !ephemeral;
    // Execute All and its status, a preview says next to them that it is read-only
    const executionShown = preview || !ephemeral;
    React.useEffect(() => {
        if (!pageShown || !viewSwitchShown) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
            if (step === 0 || usesArrowKeys(event.target)) return;
            event.preventDefault();
            stepView(step);
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [pageShown, viewSwitchShown, stepView]);
    // A script opened from the sidebar shows in the feed
    const [revealRequest, setRevealRequest] = React.useState<WorkbookFeedRevealRequest | null>(null);
    const openScript = React.useCallback((workbookId: string, fileName: string) => {
        setOverviewConnectionId(null);
        setDetails(null);
        if (mode !== WorkbookViewMode.Workbook) setMode(WorkbookViewMode.Workbook);
        setRevealRequest({ workbookId, fileName });
    }, [mode, setMode, setOverviewConnectionId]);
    // The prompt and the feed ask each other through handles: the feed mentions its scripts in the question of the
    // prompt, the prompt has the feed follow the agent and show the scripts it appends
    const promptRef = React.useRef<WorkbookPromptHandle | null>(null);
    const feedRef = React.useRef<WorkbookPromptFeed | null>(null);
    const modeRef = React.useRef(mode);
    modeRef.current = mode;
    const promptFeed = React.useMemo<WorkbookPromptFeed>(() => ({
        follow: (scriptKey: number, target: AgentFollowTarget) => feedRef.current?.follow(scriptKey, target),
        // A script that the user picks in the log of the agent shows in the feed
        show: (scriptKey: number) => {
            setOverviewConnectionId(null);
            setDetails(null);
            if (modeRef.current !== WorkbookViewMode.Workbook) setMode(WorkbookViewMode.Workbook);
            feedRef.current?.show(scriptKey);
        },
        followAgent: () => feedRef.current?.followAgent(),
        appended: () => feedRef.current?.appended(),
    }), [setMode, setOverviewConnectionId]);
    // The feed keeps the space of the docked prompt below its last script, also while the prompt is shrunk over
    // another view and the rows of the hidden feed stay where they are
    const [feedInsets, setFeedInsets] = React.useState<WorkbookFeedInsets | undefined>(undefined);
    const [promptHeight, setPromptHeight] = React.useState(0);
    const feedBottomInset = React.useRef(promptHeight);
    if (promptPlacement === WorkbookPromptPlacement.Feed) feedBottomInset.current = promptHeight;
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
                    <div ref={contentRef} className={styles.content_container}>
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
                                attachRef={attachRef}
                                bottomInset={feedBottomInset.current}
                                promptRef={promptRef}
                                handleRef={feedRef}
                                onInsets={setFeedInsets}
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
                        {/* Over the views, the composer keeps its draft and its focus when the view switches */}
                        <dependencies.WorkbookPrompt
                            workbookScripts={props.workbookScripts}
                            modifyWorkbookScripts={props.modifyWorkbookScripts}
                            conn={props.connection}
                            scriptConnections={props.scriptConnections}
                            placement={promptPlacement}
                            feed={promptFeed}
                            handleRef={promptRef}
                            draftRenameRef={draftRenameRef}
                            feedInsets={feedInsets}
                            onHeight={setPromptHeight}
                        />
                    </div>
                </main>
                {/* After the feed in the DOM, so that no-drag rows scrolled behind the bar do not cut holes into its drag region, see docs/design/electron.md */}
                <header className={styles.view_bar} data-electron-drag-region>
                    {/* The groups at the start of the bar: the workbench, then the execution of the workbook */}
                    <div className={styles.bar_group} role="group" aria-label="Workbench" data-testid="workbook-workbench-group">
                        <IconButton className={styles.mobile_menu_button} ref={navigationDrawerTriggerRef} variant={ButtonVariant.Default} aria-label="Open workbook workbench" data-testid="open-workbench" onClick={() => setNavigationDrawerOpen(true)}>
                            <ThreeBarsIcon />
                        </IconButton>
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
                        {executionShown && <BarSeparator className={styles.start_separator} />}
                        {executionShown && <div className={styles.execution_controls} role="group" aria-label="Execution" data-testid="workbook-execution-group">
                            {!ephemeral && <>
                                <Button ref={executeRef} size={ButtonSize.Small} variant={ButtonVariant.Invisible}
                                    leadingVisual={execution.busy ? SquareFillIcon : PaperAirplaneIcon}
                                    aria-label={execution.busy ? 'Stop workbook execution' : 'Execute All'}
                                    data-testid={execution.busy ? 'stop-execution' : 'execute-all'}
                                    // A run waits for the compute database, it reads the cached results
                                    disabled={execution.busy ? run?.phase === 'stopping' : !execution.ready || !scriptConnectionsIdle
                                        || execution.runActive || props.workbookScripts.scriptOrder.length === 0}
                                    onClick={() => execution.busy ? execution.stop() : execution.start()}>
                                    <span className={styles.action_label}>{execution.busy ? run?.phase === 'stopping' ? 'Stopping' : 'Stop' : 'Execute All'}</span>
                                </Button>
                                <div className={styles.execution_status} role="status" aria-live="polite" aria-atomic="true" data-testid="execution-status" data-phase={run?.phase}
                                    title={run?.error ?? skippedTitle} aria-label={run?.error ? `${statusText}: ${run.error}` : undefined}>
                                    {run && <>
                                        <AnchoredOverlay
                                            open={executionDetailsOpen} onOpen={() => setExecutionDetailsOpen(true)} onClose={() => setExecutionDetailsOpen(false)}
                                            side={AnchorSide.OutsideBottom} align={AnchorAlignment.Start} anchorOffset={4}
                                            renderAnchor={anchorProps => <Button {...anchorProps}
                                                size={ButtonSize.Small} variant={ButtonVariant.Invisible} aria-label="Show workbook execution details" data-testid="execution-details-toggle"
                                                leadingVisual={<span className={styles.execution_indicator} aria-hidden="true" data-testid="execution-indicator"><StatusIndicator width="16px" height="16px" status={execution.busy
                                                    ? IndicatorStatus.Running : run.phase === 'failed' ? IndicatorStatus.Failed
                                                        : run.phase === 'succeeded' ? IndicatorStatus.Succeeded : IndicatorStatus.Skip} /></span>}>
                                                <span className={styles.execution_progress}>{statusText}</span>
                                            </Button>}>
                                            <section className={styles.execution_error_card} role="dialog" aria-label="Workbook execution details" data-testid="execution-details">
                                                <header className={styles.execution_error_header}>
                                                    <h2 className={styles.execution_details_title}>{run.phase === 'failed' ? 'Execution failed' : 'Workbook execution'}</h2>
                                                    <IconButton size={ButtonSize.Small} variant={ButtonVariant.Invisible}
                                                        aria-label="Close workbook execution details" data-testid="execution-details-close" onClick={() => setExecutionDetailsOpen(false)}>
                                                        <CloseIcon size={16} />
                                                    </IconButton>
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
                            </>}
                            {/* A preview says it is read-only next to Execute All */}
                            {preview && <CloudPreviewBadge labelClassName={styles.action_label} />}
                        </div>}
                        {/* The groups at the end of the bar: the connections of the workbook, its actions, then its views. A
                            separator stands between two groups that show. */}
                        <div className={styles.bar_end}>
                            {connectionsShown && (
                                <div className={classNames(styles.bar_group, styles.connections_group)} role="group" aria-label="Connections" data-testid="workbook-connections-group">
                                    {/* The connections of the workbook, the user sees which one is not connected */}
                                    {/* A preview shows its connections locked, the import maps them */}
                                    <dependencies.WorkbookConnectionButtons connections={barConnections} attention={connectionAttention?.active === true} />
                                </div>
                            )}
                            {connectionsShown && (actionsShown || viewSwitchShown) && <BarSeparator />}
                            {actionsShown && <div className={classNames(styles.bar_group, styles.actions_group)} role="group" aria-label="Actions" data-testid="workbook-actions-group">
                                {preview && <CloudPreviewActions workbookId={props.workbookScripts.workbookId} labelClassName={styles.action_label} />}
                                {exportButton && !ephemeral && !preview && (
                                    <Button ref={exportTriggerRef} size={ButtonSize.Small} variant={ButtonVariant.Invisible} leadingVisual={FileZipIcon} aria-label="Export .dashql" data-testid="export-workbook" aria-expanded={exportOpen === 'button'} onClick={() => {
                                        setShareOpen(false);
                                        setExportOpen(value => value === 'button' ? null : 'button');
                                    }}>
                                        <span className={styles.action_label}>Export .dashql</span>
                                    </Button>
                                )}
                                {!ephemeral && !preview && (
                                    <AnchoredOverlay
                                        open={menuOpen}
                                        onOpen={() => setMenuOpen(true)}
                                        onClose={() => setMenuOpen(false)}
                                        side={AnchorSide.OutsideBottom}
                                        align={AnchorAlignment.End}
                                        anchorOffset={4}
                                        anchorRef={menuTriggerRef}
                                        returnFocusRef={menuTriggerRef}
                                        renderAnchor={anchorProps => (
                                            <IconButton {...anchorProps} ref={menuTriggerRef} size={ButtonSize.Small} variant={ButtonVariant.Invisible}
                                                aria-label="More workbook actions" data-testid="workbook-actions">
                                                <MoreIcon size={16} />
                                            </IconButton>
                                        )}
                                    >
                                        <div className={actionMenuStyles.menu} role="dialog" aria-label="Workbook actions">
                                            <ActionList.List aria-label="Workbook actions">
                                                <ActionList.ListItem data-testid="workbook-action" data-action="share-url" onClick={() => {
                                                    setMenuOpen(false);
                                                    setExportOpen(null);
                                                    setShareOpen(true);
                                                }}>
                                                    <ActionList.Leading><LinkIcon size={16} /></ActionList.Leading>
                                                    <ActionList.ItemText>Share as URL</ActionList.ItemText>
                                                </ActionList.ListItem>
                                                {/* The list takes elements only, the fragments wrap the optional items */}
                                                <>{archiveExport && (
                                                    <ActionList.ListItem data-testid="workbook-action" data-action="export" onClick={() => {
                                                        setMenuOpen(false);
                                                        setShareOpen(false);
                                                        setExportOpen('menu');
                                                    }}>
                                                        <ActionList.Leading><FileZipIcon size={16} /></ActionList.Leading>
                                                        <ActionList.ItemText>Export .dashql</ActionList.ItemText>
                                                    </ActionList.ListItem>
                                                )}</>
                                                <>{attachmentsVisible && (
                                                    <ActionList.ListItem data-testid="workbook-action" data-action="attach" disabled={!attachEnabled} onClick={() => {
                                                        setMenuOpen(false);
                                                        attachInputRef.current?.click();
                                                    }}>
                                                        <ActionList.Leading><PaperclipIcon size={16} /></ActionList.Leading>
                                                        <ActionList.ItemText>Attach File</ActionList.ItemText>
                                                    </ActionList.ListItem>
                                                )}</>
                                            </ActionList.List>
                                        </div>
                                    </AnchoredOverlay>
                                )}
                                <dependencies.WorkbookURLShareOverlay workbookId={props.workbookScripts.workbookId} isOpen={shareOpen} setIsOpen={setShareOpen} anchorRef={menuTriggerRef} />
                                {archiveExport && !ephemeral && !preview && (
                                    <dependencies.WorkbookFileSaveOverlay
                                        isOpen={exportOpen != null}
                                        setIsOpen={setExportOverlayOpen}
                                        anchorRef={exportOpen === 'button' ? exportTriggerRef : menuTriggerRef}
                                        workbookScripts={props.workbookScripts}
                                        fileName={props.workbookScripts.name ?? props.workbookScripts.workbookMetadata.originalFileName ?? 'workbook'}
                                    />
                                )}
                                {attachmentsVisible && (
                                    <input ref={attachInputRef} className={styles.attach_input} type="file" multiple accept={ATTACHMENT_EXTENSION}
                                        aria-label="Attach files to the workbook" disabled={!attachEnabled} onChange={event => {
                                            const files = event.target.files == null ? [] : Array.from(event.target.files);
                                            event.target.value = '';
                                            if (files.length > 0) attachRef.current?.(files);
                                        }} />
                                )}
                            </div>}
                            {actionsShown && viewSwitchShown && <BarSeparator />}
                            {/* The arrows beside the switch tell that the arrow keys step through the views */}
                            {viewSwitchShown && <div className={classNames(styles.bar_group, styles.view_switch)} role="group" aria-label="Views" data-testid="workbook-views-group">
                                {!ephemeral && (
                                    <IconButton size={ButtonSize.Small} variant={ButtonVariant.Invisible}
                                        className={classNames(styles.view_default, activeViewIsDefault && styles.view_default_set)}
                                        aria-label="Default view" aria-pressed={activeViewIsDefault} description={defaultViewDescription}
                                        data-testid="workbook-view-default" onClick={toggleDefaultView}>
                                        {activeViewIsDefault ? <DefaultViewSetIcon size={14} /> : <DefaultViewIcon size={14} />}
                                    </IconButton>
                                )}
                                <IconButton size={ButtonSize.Small} variant={ButtonVariant.Invisible} className={styles.view_step}
                                    aria-label="Previous view" description="Previous view (←)" data-testid="workbook-view-previous"
                                    disabled={viewIndex <= 0} onClick={() => stepView(-1)}>
                                    <PreviousViewIcon size={12} />
                                </IconButton>
                                <SegmentedControl
                                    aria-label="Workbook view"
                                    data-testid="workbook-view-switch"
                                    size={SegmentedControlSize.Small}
                                    onChange={(selectedIndex) => showView(WORKBOOK_VIEWS[selectedIndex]?.[0] ?? WorkbookViewMode.Workbook)}
                                >
                                    {WORKBOOK_VIEWS.map(([view, label, Icon]) => (
                                        <SegmentedControl.IconButton
                                            key={view}
                                            className={styles.view_switch_button}
                                            aria-label={label}
                                            icon={<Icon size={14} />}
                                            selected={activeView === view}
                                        />
                                    ))}
                                </SegmentedControl>
                                <IconButton size={ButtonSize.Small} variant={ButtonVariant.Invisible} className={styles.view_step}
                                    aria-label="Next view" description="Next view (→)" data-testid="workbook-view-next"
                                    disabled={viewIndex >= WORKBOOK_VIEWS.length - 1} onClick={() => stepView(1)}>
                                    <NextViewIcon size={12} />
                                </IconButton>
                            </div>}
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
    );
};
