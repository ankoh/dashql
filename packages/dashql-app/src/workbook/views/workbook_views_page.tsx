import * as React from 'react';
import * as styles from './workbook_views_page.module.css';

import { LinkIcon, PaperclipIcon, SymbolIcon, ThreeBarsIcon } from '@akohn/dashql-react/components/symbol_icon';
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
import { WorkbookFeed, type WorkbookFeedInsets, type WorkbookFeedRevealRequest } from '../feed/workbook_feed.js';
import { WorkbookPrompt, WorkbookPromptPlacement, type WorkbookPromptFeed, type WorkbookPromptHandle } from '../feed/workbook_prompt.js';
import type { AgentFollowTarget } from '../../agent/agent_session.js';
import { Dashboard } from '../dashboard/dashboard.js';
import { DataflowCanvas } from '../dataflow/dataflow_canvas.js';
import { WorkbookViewMode, defaultViewOfViewMode, useWorkbookViewMode, viewModeOfDefaultView } from '../workbook_view_mode.js';
import { SegmentedControl, SegmentedControlSize } from '@akohn/dashql-react/components/segmented_control';
import { PanelResizeHandle } from '@akohn/dashql-react/components/panel_resize_handle';
import { useWorkbookExecution, useWorkbookShown } from '@akohn/dashql-react/hooks';
import { AnchoredOverlay } from '@akohn/dashql-react/components/anchored_overlay';
import { AnchorAlignment, AnchorSide } from '@akohn/dashql-react/dom/anchored_position';
import { WorkbookConnectionAttentionContext } from '../connections/workbook_connection_attention.js';
import { WorkbookConnectionButtons } from './workbook_connection_buttons.js';
import { WorkbookExecutionControls, useSkippedRunAttention } from './workbook_execution_controls.js';
import { WorkbookErrors } from '../scripts/workbook_errors.js';
import { useAppFlavor } from '../../config/flavor_provider.js';
import { ConnectionOverviewPage } from '../../connections/connection_overview_page.js';
import { CloudOverviewPage } from '../../cloud/cloud_overview_page.js';
import type { RenameDraftReferences } from '../attachment_rename.js';
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
// The octicons show the sidebar on the right, flipped it sits on the left like the workbench
const CollapseSidebarIcon = SymbolIcon('sidebar_collapse_16');
const ExpandSidebarIcon = SymbolIcon('sidebar_expand_16');
// The views of the workbook view switch, octicons
const FeedViewIcon = SymbolIcon('rows_16');
const DashboardViewIcon = SymbolIcon('dashboard_16');
const DataflowViewIcon = SymbolIcon('workflow_16');
/// The views of the switch, the workbook first
const WORKBOOK_VIEWS: [WorkbookViewMode, string, typeof FeedViewIcon][] = [
    [WorkbookViewMode.Feed, 'Feed', FeedViewIcon],
    [WorkbookViewMode.Dashboard, 'Dashboard', DashboardViewIcon],
    [WorkbookViewMode.Dataflow, 'Dataflow', DataflowViewIcon],
];
/// The elements that move with the arrow keys themselves: text, editors, composite widgets, dialogs and the handle of a
/// card that the keyboard drags (dnd-kit presses the handle of the dragged item, its keyboard sensor listens on the
/// document after the page). Elsewhere the arrow keys switch the views of the workbook.
const ARROW_KEY_TARGETS = [
    'input', 'textarea', 'select', '[contenteditable]:not([contenteditable="false"])',
    '[role="grid"]', '[role="treegrid"]', '[role="listbox"]', '[role="menu"]', '[role="menubar"]', '[role="radiogroup"]',
    '[role="slider"]', '[role="tablist"]', '[role="tree"]', '[role="dialog"]',
    '[aria-roledescription][aria-pressed="true"]',
].join(', ');

function usesArrowKeys(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(ARROW_KEY_TARGETS) != null;
}
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
type DataflowProps = React.ComponentProps<typeof DataflowCanvas>;
type EditorDialogProps = React.ComponentProps<typeof ScriptEditorDialog>;
type WorkbenchProps = React.ComponentProps<typeof WorkbookWorkbenchSidebar>;

const renderFeed = (props: FeedProps) => <WorkbookFeed {...props} />;
const renderPrompt = (props: PromptProps) => <WorkbookPrompt {...props} />;
const renderDashboard = (props: DashboardProps) => <Dashboard {...props} />;
const renderDataflow = (props: DataflowProps) => <DataflowCanvas {...props} />;
const renderEditorDialog = (props: EditorDialogProps) => <ScriptEditorDialog {...props} />;
const renderWorkbench = (props: WorkbenchProps) => <WorkbookWorkbenchSidebar {...props} />;

interface Props {
    workbookScripts: WorkbookScripts;
    modifyWorkbookScripts: ModifyWorkbookScripts;
    /// The connection that the next script of the workbook runs on
    connection: ConnectionState | null;
    /// The connections that the scripts of the workbook run on
    scriptConnections: ReadonlyMap<string, ConnectionState>;
    active: boolean;
    // The heavy parts of the page are slots with the real views as defaults. A test shows stand-ins: they need
    // editors, charts, the layout of the dataflow or the storage of the app.
    /// The feed of the scripts
    feed?: (props: FeedProps) => React.ReactNode;
    /// The prompt over the views
    prompt?: (props: PromptProps) => React.ReactNode;
    /// The dashboard
    dashboard?: (props: DashboardProps) => React.ReactNode;
    /// The canvas of the dataflow
    dataflow?: (props: DataflowProps) => React.ReactNode;
    /// The editor dialog of a script of the dataflow
    editorDialog?: (props: EditorDialogProps) => React.ReactNode;
    /// The workbench next to the views and in the drawer
    workbench?: (props: WorkbenchProps) => React.ReactNode;
}

/// The page of a workbook. Memoized: the workbook page renders again with a change of any connection, the page only
/// when its props change.
export const WorkbookViewsPage = React.memo(function WorkbookViewsPage(props: Props): React.ReactElement {
    const {
        feed = renderFeed, prompt = renderPrompt, dashboard = renderDashboard, dataflow = renderDataflow,
        editorDialog = renderEditorDialog, workbench: workbenchSlot = renderWorkbench,
    } = props;
    // The composer of the prompt renames the references in its draft, also for the attachments renamed in the feed
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
    const attachInputRef = React.useRef<HTMLInputElement>(null);
    React.useEffect(() => {
        if (preview && (mode === WorkbookViewMode.Dashboard || mode === WorkbookViewMode.Dataflow)) setMode(WorkbookViewMode.Feed);
    }, [preview, mode, setMode]);
    const dashboardActive = mode === WorkbookViewMode.Dashboard;
    const dataflowActive = mode === WorkbookViewMode.Dataflow;
    const activeView = dashboardActive ? WorkbookViewMode.Dashboard : dataflowActive ? WorkbookViewMode.Dataflow : WorkbookViewMode.Feed;
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
    // The prompt floats over the views of the workbook and creates scripts in every one of them. It docks below the
    // scripts of the feed and floats over the dashboard and the dataflow. The workbook page is active in the feed only,
    // it shows in the dashboard and the dataflow too.
    const otherViewShown = (dashboardActive || dataflowActive) && !overviewActive && !cloudLoading;
    const promptPlacement = feedActive ? WorkbookPromptPlacement.Feed
        : otherViewShown ? WorkbookPromptPlacement.Overlay : WorkbookPromptPlacement.Hidden;
    // A click on the bar of Wobble shows or hides the composer. A switch of the view returns it to the default of the
    // view: shown in the feed, shrunk into the bar over the dashboard and the dataflow. An overview keeps it.
    const [promptToggle, setPromptToggle] = React.useState<{ view: WorkbookViewMode; expanded: boolean } | null>(null);
    if (promptToggle != null && promptToggle.view !== activeView) setPromptToggle(null);
    const promptExpanded = promptToggle?.view === activeView ? promptToggle.expanded : activeView === WorkbookViewMode.Feed;
    const togglePrompt = React.useCallback((expanded: boolean) => setPromptToggle({ view: activeView, expanded }), [activeView]);
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
        const next = activeViewIsDefault ? WorkbookViewMode.Feed : activeView;
        if (next === defaultView) return;
        modifyWorkbookScripts({ kind: 'setDefaultView', value: { view: defaultViewOfViewMode(next) } });
    }, [activeView, activeViewIsDefault, defaultView, modifyWorkbookScripts]);
    const defaultViewDescription = !activeViewIsDefault
        ? `Open the workbook in the ${activeViewLabel.toLowerCase()}`
        : activeView === WorkbookViewMode.Feed
            ? 'The workbook opens in the feed'
            : `The workbook opens in the ${activeViewLabel.toLowerCase()}, click to open it in the feed`;
    // The groups at the end of the bar. An ephemeral workbook has no actions and no Execute All, a preview has its own
    // actions and says next to Execute All that it is read-only.
    const connectionsShown = barConnections.length > 0;
    const actionsShown = preview || !ephemeral;
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
        if (mode !== WorkbookViewMode.Feed) setMode(WorkbookViewMode.Feed);
        setRevealRequest({ workbookId, fileName });
    }, [mode, setMode, setOverviewConnectionId]);
    // The prompt and the feed ask each other through handles: the feed mentions its scripts in the question of the
    // prompt, the prompt has the feed follow the agent and show the scripts it appends
    const promptRef = React.useRef<WorkbookPromptHandle | null>(null);
    // The script that the dashboard or the dataflow shows, until the view switches or an overview covers it
    const [viewReveal, setViewReveal] = React.useState<{ view: WorkbookViewMode; scriptKey: number } | null>(null);
    if (viewReveal != null && (viewReveal.view !== activeView || !otherViewShown)) setViewReveal(null);
    const dashboardReveal = viewReveal?.view === WorkbookViewMode.Dashboard ? viewReveal : null;
    const dataflowReveal = viewReveal?.view === WorkbookViewMode.Dataflow ? viewReveal : null;
    const feedRef = React.useRef<WorkbookPromptFeed | null>(null);
    const modeRef = React.useRef(mode);
    modeRef.current = mode;
    const promptFeed = React.useMemo<WorkbookPromptFeed>(() => ({
        follow: (scriptKey: number, target: AgentFollowTarget) => feedRef.current?.follow(scriptKey, target),
        // A script that the user picks in the log of the agent shows in the feed
        show: (scriptKey: number) => {
            setOverviewConnectionId(null);
            setDetails(null);
            if (modeRef.current !== WorkbookViewMode.Feed) setMode(WorkbookViewMode.Feed);
            feedRef.current?.show(scriptKey);
        },
        followAgent: () => feedRef.current?.followAgent(),
        // The feed scrolls to the end also while it is hidden, the dashboard and the dataflow show the new script
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
                        {dashboardActive && !overviewActive && !cloudLoading && (
                            dashboard({
                                workbookScripts: props.workbookScripts,
                                modifyWorkbookScripts: props.modifyWorkbookScripts,
                                scriptConnections,
                                revealRequest: dashboardReveal,
                            })
                        )}
                        {dataflowActive && !overviewActive && !cloudLoading && (
                            <div className={styles.dataflow_layout}>
                                <div className={styles.dataflow_canvas}>
                                    <React.Fragment key={props.workbookScripts.workbookId}>
                                        {dataflow({
                                            workbookScripts: props.workbookScripts,
                                            modifyWorkbookScripts: props.modifyWorkbookScripts,
                                            scriptConnections,
                                            onInspect: inspectScript,
                                            revealRequest: dataflowReveal,
                                            bottomInset: readOverlayInset,
                                        })}
                                    </React.Fragment>
                                </div>
                                {showDetails && (
                                    <React.Fragment key={details.scriptId}>
                                        {editorDialog({
                                            workbookScripts: props.workbookScripts,
                                            modifyWorkbookScripts: props.modifyWorkbookScripts,
                                            scriptKey: details.scriptId,
                                            scriptConnections,
                                            onNavigateToScript: inspectScript,
                                            onClose: closeDetails,
                                        })}
                                    </React.Fragment>
                                )}
                            </div>
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
                        {actionsShown && <BarSeparator className={styles.start_separator} />}
                        {actionsShown && <div className={styles.execution_controls} role="group" aria-label="Execution" data-testid="workbook-execution-group">
                            {!ephemeral && (
                                <WorkbookExecutionControls
                                    workbookId={props.workbookScripts.workbookId}
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
                                <WorkbookURLShareOverlay workbookId={props.workbookScripts.workbookId} isOpen={shareOpen} setIsOpen={setShareOpen} anchorRef={menuTriggerRef} />
                                {archiveExport && !ephemeral && !preview && (
                                    <WorkbookFileSaveOverlay
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
                                    onChange={(selectedIndex) => showView(WORKBOOK_VIEWS[selectedIndex]?.[0] ?? WorkbookViewMode.Feed)}
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
                    <WorkbookNavigationDrawer open onClose={closeNavigationDrawer} returnFocusRef={navigationDrawerTriggerRef}>
                        {workbench(true)}
                    </WorkbookNavigationDrawer>
                )}
            </div>
        </WorkbookReadOnlyContext.Provider>
    );
});
