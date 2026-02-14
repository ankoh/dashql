import * as React from 'react';
import * as ActionList from '../foundations/action_list.js';
import * as styles from './notebook_page.module.css';
import * as theme from '../../github_theme.module.css';
import * as core from '@ankoh/dashql-core';

import icons from '../../../static/svg/symbols.generated.svg';

import { EditorView } from '@codemirror/view';
import { ButtonGroup, IconButton as IconButtonLegacy } from '@primer/react';
import { Icon, LinkIcon, PaperAirplaneIcon, SyncIcon, ThreeBarsIcon } from '@primer/octicons-react';

import { Button, ButtonSize, ButtonVariant, IconButton } from '../../view/foundations/button.js';
import { CatalogStatisticsOverlay } from '../../view/catalog/catalog_statistics_overlay.js';
import { CatalogViewer } from '../../view/catalog/catalog_viewer.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { ConnectionStatus } from '../../view/connection/connection_status.js';
import { ConnectorType } from '../../connection/connector_info.js';
import { DASHQL_ARCHIVE_FILENAME_EXT } from '../../globals.js';
import { IndicatorStatus, StatusIndicator } from '../../view/foundations/status_indicator.js';
import { KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { ModifyNotebook, useNotebookRegistry, useNotebookState } from '../../notebook/notebook_state_registry.js';
import { QueryExecutionStatus } from '../../connection/query_execution_state.js';
import { QueryResultView } from '../query_result/query_result_view.js';
import { QueryStatusPanel } from '../query_status/query_status_panel.js';
import { CREATE_PAGE, getSelectedEntry, getSelectedPageEntries, ScriptData, NotebookState, SELECT_PAGE } from '../../notebook/notebook_state.js';
import { ScriptEditor } from './notebook_editor.js';
import { SymbolIcon } from '../../view/foundations/symbol_icon.js';
import { VerticalTabs, VerticalTabVariant } from '../foundations/vertical_tabs.js';
import { NotebookCommandType, useNotebookCommandDispatch } from '../../notebook/notebook_commands.js';
import { NotebookScriptThumbnails } from './notebook_script_thumbnails.js';
import { NotebookFileSaveOverlay } from './notebook_file_save_overlay.js';
import { NotebookListDropdown } from './notebook_list_dropdown.js';
import { NotebookURLShareOverlay } from './notebook_url_share_overlay.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useLogger } from '../../platform/logger_provider.js';
import { useQueryState } from '../../connection/query_executor.js';
import { useRouteContext, useRouterNavigate, NOTEBOOK_PATH } from '../../router.js';
import { useScrollbarHeight, useScrollbarWidth } from '../../utils/scrollbar.js';

const LOG_CTX = 'notebook_page';

const ConnectionCommandList = (props: { conn: ConnectionState | null, notebook: NotebookState | null }) => {
    const notebookCommand = useNotebookCommandDispatch();

    const DatabaseIcon = SymbolIcon("database_16");
    const FileSymlinkIcon = SymbolIcon("file_symlink_16");
    return (
        <>
            <ActionList.ListItem
                disabled={!props.conn?.connectorInfo.features.executeQueryAction}
                onClick={() => notebookCommand(NotebookCommandType.EditNotebookConnection)}
            >
                <ActionList.Leading>
                    <DatabaseIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Edit Connection
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + L</ActionList.Trailing>
            </ActionList.ListItem>
            <ActionList.ListItem
                disabled={!props.conn?.connectorInfo.features.executeQueryAction}
                onClick={() => notebookCommand(NotebookCommandType.ExecuteEditorQuery)}
            >
                <ActionList.Leading>
                    <PaperAirplaneIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Execute Query
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + E</ActionList.Trailing>
            </ActionList.ListItem>
            <ActionList.ListItem
                disabled={!props.conn?.connectorInfo.features.refreshSchemaAction}
                onClick={() => notebookCommand(NotebookCommandType.RefreshCatalog)}
            >
                <ActionList.Leading>
                    <SyncIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Refresh Catalog
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + R</ActionList.Trailing>
            </ActionList.ListItem>
        </>
    );
};

const NotebookCommandList = (props: { conn: ConnectionState | null, notebook: NotebookState | null, modifyNotebook: ModifyNotebook | null }) => {
    const [linkSharingIsOpen, openLinkSharing] = React.useState<boolean>(false);
    const [fileSaveIsOpen, openFileSave] = React.useState<boolean>(false);
    const notebookCommand = useNotebookCommandDispatch();

    const ArrowDownIcon = SymbolIcon("arrow_down_16");
    const ArrowUpIcon = SymbolIcon("arrow_up_16");
    const FileZipIcon = SymbolIcon("file_zip_16");
    const TrashIcon = SymbolIcon("trash_16");
    return (
        <>
            <ActionList.ListItem
                onClick={() => notebookCommand(NotebookCommandType.SelectPreviousNotebookScript)}
                disabled={(props.notebook?.selectedEntryInPage ?? 0) === 0}
            >
                <ActionList.Leading>
                    <ArrowUpIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Previous Script
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + K</ActionList.Trailing>
            </ActionList.ListItem>
            <ActionList.ListItem
                onClick={() => notebookCommand(NotebookCommandType.SelectNextNotebookScript)}
                disabled={props.notebook == null || ((props.notebook.selectedEntryInPage + 1) >= getSelectedPageEntries(props.notebook).length)}
            >
                <ActionList.Leading>
                    <ArrowDownIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Next Script
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + J</ActionList.Trailing>
            </ActionList.ListItem>
            <ActionList.ListItem onClick={() => openLinkSharing(s => !s)}>
                <ActionList.Leading>
                    <LinkIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Share as URL
                    <NotebookURLShareOverlay isOpen={linkSharingIsOpen} setIsOpen={openLinkSharing} />
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + U</ActionList.Trailing>
            </ActionList.ListItem>
            <ActionList.ListItem onClick={() => openFileSave(s => !s)}>
                <ActionList.Leading>
                    <FileZipIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Save .{DASHQL_ARCHIVE_FILENAME_EXT}
                    <NotebookFileSaveOverlay
                        isOpen={fileSaveIsOpen}
                        setIsOpen={openFileSave}
                        conn={props.conn}
                        notebook={props.notebook}
                    />
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + S</ActionList.Trailing>
            </ActionList.ListItem>
            <ActionList.ListItem
                className={styles.body_action_danger}
                onClick={() => notebookCommand(NotebookCommandType.DeleteNotebook)}
            >
                <ActionList.Leading>
                    <TrashIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Delete Notebook
                </ActionList.ItemText>
            </ActionList.ListItem>
        </>
    );
};

enum PinState {
    Hide,
    ShowIfSpace,
    PinnedByUser,
    UnpinnedByUser
}

export function ScriptEditorWithCatalog(props: { notebook: NotebookState, connection: ConnectionState | null, script: ScriptData }) {
    const CatalogIcon = SymbolIcon("workflow_16");
    const PinSlashIcon = SymbolIcon("pin_slash_16");
    const InfoCircleIcon = SymbolIcon("info_circle_16");

    const [pinState, setPinState] = React.useState<PinState>(PinState.Hide);
    const [view, setView] = React.useState<EditorView | null>(null);
    const [showCatalogStats, setShowCatalogStats] = React.useState<boolean>(false);
    const catalogOverlayRef = React.useRef<HTMLDivElement>(null);
    const scrollbarWidth = useScrollbarWidth();
    const scrollbarHeight = useScrollbarHeight();

    // Determine the catalog overlay positioning.
    const [overlayMarginRight, overlayMarginBottom] = React.useMemo(() => {
        let marginRight = 0;
        let marginBottom = 0;
        if (props.script.cursor && view) {
            // Determine the right margin
            const hasVerticalScrollbar = view.scrollDOM.scrollHeight > view.scrollDOM.clientHeight;
            const hasHorizontalScrollbar = view.scrollDOM.scrollWidth > view.scrollDOM.clientWidth;
            marginRight = hasVerticalScrollbar ? scrollbarWidth : 0;
            marginBottom = hasHorizontalScrollbar ? scrollbarHeight : 0;
        }
        return [marginRight, marginBottom];
    }, [props.script.cursor, view, catalogOverlayRef.current]);

    React.useEffect(() => {
        if (props.script.cursor == null || props.script.cursor.read().contextType() == core.buffers.cursor.ScriptCursorContext.NONE) {
            if (pinState != PinState.PinnedByUser) {
                setPinState(PinState.Hide);
            }
        } else {
            if (pinState != PinState.PinnedByUser) {
                setPinState(PinState.ShowIfSpace);
            }
        }
    }, [props.script.cursor]);

    // Determine the overlay positioning classname
    const showMinimap = pinState == PinState.PinnedByUser;
    return (
        <div className={styles.entry_card_tabs_body}>
            <ScriptEditor
                notebookId={props.notebook.notebookId}
                setView={setView}
            />
            <Button
                className={styles.catalog_overlay_bean}
                leadingVisual={CatalogIcon}
                onClick={() => setPinState(PinState.PinnedByUser)}
                size={ButtonSize.Medium}
                style={{ display: showMinimap ? 'none' : 'block' }}
            >
                Catalog
            </Button>
            {
                showMinimap && (
                    <div
                        className={styles.catalog_overlay_container}
                        ref={catalogOverlayRef}
                        style={{
                            right: overlayMarginRight,
                            bottom: overlayMarginBottom
                        }}
                    >
                        <div className={styles.catalog_overlay_content}>
                            <div className={styles.catalog_overlay_header}>
                                <div className={styles.catalog_overlay_header_icon}>
                                    <CatalogIcon size={14} />
                                </div>
                                <div className={styles.catalog_overlay_header_text}>
                                    Catalog
                                </div>
                                <div className={styles.catalog_overlay_header_info}>
                                    {props.connection && (
                                        <CatalogStatisticsOverlay
                                            anchorClassName={styles.catalog_overlay_header_info_anchor}
                                            connection={props.connection}
                                            isOpen={showCatalogStats}
                                            setIsOpen={setShowCatalogStats}
                                        />
                                    )}
                                    <IconButton
                                        className={styles.catalog_overlay_header_info_button}
                                        variant={ButtonVariant.Invisible}
                                        aria-label="info-overlay"
                                        onClick={() => setShowCatalogStats(true)}
                                    >
                                        <InfoCircleIcon size={14} />
                                    </IconButton>
                                </div>
                                <IconButton
                                    className={styles.catalog_overlay_header_button_unpin}
                                    variant={ButtonVariant.Invisible}
                                    aria-label="unpin-overlay"
                                    onClick={() => setPinState(PinState.UnpinnedByUser)}
                                >
                                    <PinSlashIcon size={14} />
                                </IconButton>
                            </div>
                            <div className={styles.catalog_viewer}>
                                <CatalogViewer notebookId={props.notebook.notebookId} />
                            </div>
                        </div>
                    </div>
                )
            }
        </div>
    );
}

export function getStatusIndicatorText(status: IndicatorStatus) {
    switch (status) {
        case IndicatorStatus.Failed:
            break;
        case IndicatorStatus.Skip:
            break;
        case IndicatorStatus.Succeeded:
            break;
    }
}

enum TabKey {
    Editor = 0,
    QueryStatusPanel = 1,
    QueryResultView = 2,
}

interface TabState {
    enabledTabs: number;
}

interface NotebookScriptDetailsProps {
    notebook: NotebookState;
    connection: ConnectionState | null;
    hideDetails: () => void;
}

const NotebookScriptCard: React.FC<NotebookScriptDetailsProps> = (props: NotebookScriptDetailsProps) => {
    const [selectedTab, selectTab] = React.useState<TabKey>(TabKey.Editor);

    const notebookEntry = getSelectedEntry(props.notebook);
    const scriptData = notebookEntry != null ? props.notebook.scripts[notebookEntry.scriptId] : null;
    if (notebookEntry == null || scriptData == null) {
        return <div className={styles.entry_body_container} />;
    }
    const activeQueryId = scriptData.latestQueryId ?? null;
    const activeQueryState = useQueryState(props.notebook?.connectionId ?? null, activeQueryId);

    // Determine selected tabs
    const tabState = React.useRef<TabState>({
        enabledTabs: 1,
    });
    let enabledTabs = 1;
    enabledTabs += +(activeQueryState != null);
    enabledTabs += +(activeQueryState?.status == QueryExecutionStatus.SUCCEEDED);
    tabState.current.enabledTabs = enabledTabs;

    // Register keyboard events
    const keyHandlers = React.useMemo<KeyEventHandler[]>(
        () => [
            {
                key: 'j',
                ctrlKey: true,
                callback: () => {
                    selectTab(key => {
                        const tabs = [TabKey.Editor, TabKey.QueryStatusPanel, TabKey.QueryResultView];
                        return tabs[((key as number) + 1) % tabState.current.enabledTabs];
                    });
                },
            },
        ],
        [tabState, selectTab],
    );
    useKeyEvents(keyHandlers);

    // Automatically switch tabs when the execution status changes meaningfully
    const prevStatus = React.useRef<[number | null, QueryExecutionStatus | null] | null>(null);
    React.useEffect(() => {
        const status = activeQueryState?.status ?? null;
        switch (status) {
            case null:
                selectTab(TabKey.Editor);
                break;
            case QueryExecutionStatus.REQUESTED:
            case QueryExecutionStatus.PREPARING:
            case QueryExecutionStatus.SENDING:
            case QueryExecutionStatus.QUEUED:
            case QueryExecutionStatus.RUNNING:
            case QueryExecutionStatus.RECEIVED_FIRST_BATCH:
            case QueryExecutionStatus.RECEIVED_ALL_BATCHES:
            case QueryExecutionStatus.PROCESSING_RESULTS:
                if (prevStatus.current == null || prevStatus.current[0] != activeQueryId || prevStatus.current[1] != status) {
                    selectTab(TabKey.QueryStatusPanel);
                }
                break;
            case QueryExecutionStatus.FAILED:
                selectTab(TabKey.QueryStatusPanel);
                break;
            case QueryExecutionStatus.SUCCEEDED:
                selectTab(TabKey.QueryResultView);
                break;
        }
        prevStatus.current = [activeQueryId, status];
    }, [activeQueryId, activeQueryState?.status]);

    const [debugMode, setDebugMode] = React.useState<boolean>(false);

    const ScreenNormalIcon: Icon = SymbolIcon("screen_normal_16");
    const ProcessorIcon: Icon = SymbolIcon("processor");
    return (
        <div className={styles.entry_body_container}>
            <div className={styles.entry_body_card}>
                <div className={styles.entry_card_container}>
                    <div className={styles.entry_card_header}>
                        <IconButton
                            className={styles.entry_status_indicator_button}
                            variant={ButtonVariant.Invisible}
                            aria-label="expand"
                            aria-labelledby="expand-entry"
                        >
                            <StatusIndicator
                                className={styles.entry_status_indicator}
                                fill="black"
                                width={"14px"}
                                height={"14px"}
                                status={IndicatorStatus.Succeeded}
                            />
                        </IconButton>
                        <IconButton
                            className={styles.entry_card_debug_button}
                            variant={ButtonVariant.Invisible}
                            onClick={() => setDebugMode(m => !m)}
                            aria-label="debug mode"
                            aria-labelledby="debug-mode"
                        >
                            <ProcessorIcon size={16} />
                        </IconButton>
                        <IconButton
                            className={styles.entry_card_collapse_button}
                            variant={ButtonVariant.Invisible}
                            onClick={props.hideDetails}
                            aria-label="collapse"
                            aria-labelledby="collapse-entry"
                        >
                            <ScreenNormalIcon size={16} />
                        </IconButton>
                    </div>
                    <VerticalTabs
                        className={styles.entry_card_tabs}
                        variant={VerticalTabVariant.Stacked}
                        selectedTab={selectedTab}
                        selectTab={selectTab}
                        tabProps={{
                            [TabKey.Editor]: { tabId: TabKey.Editor, icon: `${icons}#file`, labelShort: 'Editor', disabled: false },
                            [TabKey.QueryStatusPanel]: {
                                tabId: TabKey.QueryStatusPanel,
                                icon: `${icons}#plan`,
                                labelShort: 'Status',
                                disabled: tabState.current.enabledTabs < 2,
                            },
                            [TabKey.QueryResultView]: {
                                tabId: TabKey.QueryResultView,
                                icon: `${icons}#table_24`,
                                labelShort: 'Data',
                                disabled: tabState.current.enabledTabs < 3,
                            },
                        }}
                        tabKeys={[
                            TabKey.Editor,
                            TabKey.QueryStatusPanel,
                            TabKey.QueryResultView
                        ]}
                        tabRenderers={{
                            [TabKey.Editor]: _props => <ScriptEditorWithCatalog notebook={props.notebook} connection={props.connection} script={scriptData} />,
                            [TabKey.QueryStatusPanel]: _props => (
                                <QueryStatusPanel query={activeQueryState} />
                            ),
                            [TabKey.QueryResultView]: _props => (
                                <QueryResultView query={activeQueryState} debugMode={debugMode} />
                            ),
                        }}
                    />
                </div>
            </div>
        </div>
    );
};


interface NotebookScriptListProps {
    notebook: NotebookState;
    showDetails: () => void;
}

const NotebookScriptList: React.FC<NotebookScriptListProps> = (props: NotebookScriptListProps) => {
    const out: React.ReactElement[] = [];
    const ScreenFullIcon: Icon = SymbolIcon("screen_full_16");
    const entries = getSelectedPageEntries(props.notebook);
    for (let wi = 0; wi < entries.length; ++wi) {
        // const entry = props.notebook.notebookEntries[wi];
        out.push(
            <div key={wi} className={styles.collection_entry_card}>
                <div key={wi} className={styles.collection_entry_header}>
                    <IconButton
                        className={styles.entry_status_indicator_button}
                        variant={ButtonVariant.Invisible}
                        aria-label="expand"
                        aria-labelledby="expand-entry"
                    >
                        <StatusIndicator
                            className={styles.collection_entry_status_indicator_button}
                            fill="black"
                            width={"14px"}
                            height={"14px"}
                            status={IndicatorStatus.Succeeded}
                        />
                    </IconButton>
                    <IconButton
                        className={styles.collection_entry_expand_button}
                        variant={ButtonVariant.Invisible}
                        onClick={props.showDetails}
                        aria-label="expand"
                        aria-labelledby="expand-entry"
                    >
                        <ScreenFullIcon size={16} />
                    </IconButton>
                </div>
                <div className={styles.collection_body} />
            </div>
        );
    }
    return (
        <div className={styles.collection_body_container}>
            <div className={styles.collection_entry_list}>
                {out}
            </div>
        </div>
    );
};


interface Props { }

export const NotebookPage: React.FC<Props> = (_props: Props) => {
    const route = useRouteContext();
    const navigate = useRouterNavigate();
    const logger = useLogger();
    const notebookRegistry = useNotebookRegistry()[0];
    const [notebook, modifyNotebook] = useNotebookState(route.notebookId ?? null);
    const [conn, _modifyConn] = useConnectionState(notebook?.connectionId ?? null);
    const [sharingIsOpen, setSharingIsOpen] = React.useState<boolean>(false);
    const [showDetails, setShowDetails] = React.useState<boolean>(true);

    const sessionCommand = useNotebookCommandDispatch();

    let warning: React.ReactElement | null = null;
    if (conn?.connectorInfo.connectorType == ConnectorType.DEMO) {
        warning = (
            <div className={styles.demo_info_card}>
                Changes are not persisted for Demo connections.
            </div>
        );
    }

    // Effect to route to connection notebook if notebook id is null
    React.useEffect(() => {
        if (route.notebookId === null) {
            // Do we have a connection id?
            // Then find a notebook for that connection.
            if (route.connectionId !== null) {
                const connectionNotebooks = notebookRegistry.notebooksByConnection.get(route.connectionId);
                if ((connectionNotebooks?.length ?? 0) > 0) {
                    navigate({
                        type: NOTEBOOK_PATH,
                        value: {
                            ...route,
                            notebookId: connectionNotebooks![0],
                            connectionId: route.connectionId,
                        },
                    });
                }
            } else {
                logger.warn('missing notebook id', {}, LOG_CTX);
            }
        }
    }, [route.notebookId, route.connectionId]);

    if (route.notebookId === null || notebook == null) {
        return <div />;
    }
    return (
        <div className={styles.page}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.page_title}>Notebook</div>
                    <NotebookListDropdown />
                </div>
                <div className={styles.header_right_container}>
                    {conn && <ConnectionStatus conn={conn} notebookId={route.notebookId} />}
                </div>
                <div className={styles.header_action_container}>
                    <div>
                        <ButtonGroup className={theme.button_group}>
                            <IconButtonLegacy
                                icon={PaperAirplaneIcon}
                                aria-labelledby="execute-query"
                                onClick={() => sessionCommand(NotebookCommandType.ExecuteEditorQuery)}
                            />
                            <IconButtonLegacy
                                icon={SyncIcon}
                                aria-labelledby="refresh-schema"
                                onClick={() => sessionCommand(NotebookCommandType.RefreshCatalog)}
                            />
                            <IconButtonLegacy
                                icon={LinkIcon}
                                aria-labelledby="visit-github-repository"
                                onClick={() => setSharingIsOpen(s => !s)}
                            />
                        </ButtonGroup>
                        <NotebookURLShareOverlay isOpen={sharingIsOpen} setIsOpen={setSharingIsOpen} />
                    </div>
                    <IconButtonLegacy icon={ThreeBarsIcon} aria-labelledby="visit-github-repository" />
                </div>
            </div>
            <div className={styles.page_tabs_container}>
                <div className={styles.page_tabs} role="tablist" aria-label="Notebook pages">
                    {notebook.notebookPages.map((page, index) => {
                        const isSelected = index === notebook.selectedPageIndex;
                        const label = page.scripts.length > 0 && page.scripts[0].title
                            ? page.scripts[0].title
                            : `Page ${index + 1}`;
                        return (
                            <button
                                key={index}
                                type="button"
                                role="tab"
                                aria-selected={isSelected}
                                aria-controls="notebook-body"
                                id={`notebook-page-tab-${index}`}
                                className={isSelected ? styles.page_tab_selected : styles.page_tab}
                                onClick={() => {
                                    if (isSelected) {
                                        setShowDetails(false);
                                    } else {
                                        modifyNotebook({ type: SELECT_PAGE, value: index });
                                        setShowDetails(false);
                                    }
                                }}
                            >
                                {label}
                            </button>
                        );
                    })}
                    <button
                        type="button"
                        className={styles.page_tab_add}
                        aria-label="Add page"
                        onClick={() => {
                            modifyNotebook({ type: CREATE_PAGE, value: null });
                            setShowDetails(false);
                        }}
                    >
                        +
                    </button>
                </div>
            </div>
            <div className={styles.notebook_entry_sidebar}>
                <NotebookScriptThumbnails notebook={notebook} modifyNotebook={modifyNotebook} />
            </div>
            <div className={styles.body_container} id="notebook-body" role="tabpanel" aria-labelledby={notebook.notebookPages.length > 0 ? `notebook-page-tab-${notebook.selectedPageIndex}` : undefined}>
                {
                    showDetails
                        ? <NotebookScriptCard notebook={notebook} connection={conn} hideDetails={() => setShowDetails(false)} />
                        : <NotebookScriptList notebook={notebook} showDetails={() => setShowDetails(true)} />
                }
            </div>
            <div className={styles.body_action_sidebar}>
                {warning}
                <div className={styles.body_action_sidebar_card}>
                    <ActionList.List aria-label="Actions">
                        <ActionList.GroupHeading>Connection</ActionList.GroupHeading>
                        <ConnectionCommandList
                            conn={conn ?? null}
                            notebook={notebook}
                        />
                        <ActionList.GroupHeading>Notebook</ActionList.GroupHeading>
                        <NotebookCommandList
                            conn={conn ?? null}
                            notebook={notebook}
                            modifyNotebook={modifyNotebook}
                        />
                    </ActionList.List>
                </div>
            </div>
        </div>
    );
};
