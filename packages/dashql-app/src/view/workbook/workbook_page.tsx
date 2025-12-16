import * as React from 'react';
import * as ActionList from '../foundations/action_list.js';
import * as styles from './workbook_page.module.css';
import * as theme from '../../github_theme.module.css';
import * as icons from '../../../static/svg/symbols.generated.svg';
import * as core from '@ankoh/dashql-core';

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
import { ModifyWorkbook, useWorkbookState } from '../../workbook/workbook_state_registry.js';
import { QueryExecutionStatus } from '../../connection/query_execution_state.js';
import { QueryResultView } from '../query_result/query_result_view.js';
import { QueryStatusPanel } from '../query_status/query_status_panel.js';
import { ScriptData, WorkbookState } from '../../workbook/workbook_state.js';
import { ScriptEditor } from './workbook_editor.js';
import { SymbolIcon } from '../../view/foundations/symbol_icon.js';
import { VerticalTabs, VerticalTabVariant } from '../foundations/vertical_tabs.js';
import { WorkbookCommandType, useWorkbookCommandDispatch } from '../../workbook/workbook_commands.js';
import { WorkbookEntryThumbnails } from './workbook_entry_thumbnails.js';
import { WorkbookFileSaveOverlay } from './workbook_file_save_overlay.js';
import { WorkbookListDropdown } from './workbook_list_dropdown.js';
import { WorkbookURLShareOverlay } from './workbook_url_share_overlay.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useLogger } from '../../platform/logger_provider.js';
import { useQueryState } from '../../connection/query_executor.js';
import { useRouteContext } from '../../router.js';
import { useScrollbarHeight, useScrollbarWidth } from '../../utils/scrollbar.js';

const LOG_CTX = 'workbook_page';

const ConnectionCommandList = (props: { conn: ConnectionState | null, workbook: WorkbookState | null }) => {
    const workbookCommand = useWorkbookCommandDispatch();

    const DatabaseIcon = SymbolIcon("database_16");
    const FileSymlinkIcon = SymbolIcon("file_symlink_16");
    return (
        <>
            <ActionList.ListItem
                disabled={!props.conn?.connectorInfo.features.executeQueryAction}
                onClick={() => workbookCommand(WorkbookCommandType.EditWorkbookConnection)}
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
                onClick={() => workbookCommand(WorkbookCommandType.ExecuteEditorQuery)}
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
                onClick={() => workbookCommand(WorkbookCommandType.RefreshCatalog)}
            >
                <ActionList.Leading>
                    <SyncIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Refresh Catalog
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + R</ActionList.Trailing>
            </ActionList.ListItem>
            <ActionList.ListItem
                onClick={() => { }}
                disabled={true}
            >
                <ActionList.Leading>
                    <FileSymlinkIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Add to Catalog
                </ActionList.ItemText>
                <ActionList.Trailing></ActionList.Trailing>
            </ActionList.ListItem>
        </>
    );
};

const WorkbookCommandList = (props: { conn: ConnectionState | null, workbook: WorkbookState | null, modifyWorkbook: ModifyWorkbook | null }) => {
    const [linkSharingIsOpen, openLinkSharing] = React.useState<boolean>(false);
    const [fileSaveIsOpen, openFileSave] = React.useState<boolean>(false);
    const workbookCommand = useWorkbookCommandDispatch();

    const ArrowDownIcon = SymbolIcon("arrow_down_16");
    const ArrowUpIcon = SymbolIcon("arrow_up_16");
    const FileZipIcon = SymbolIcon("file_zip_16");
    return (
        <>
            <ActionList.ListItem
                onClick={() => workbookCommand(WorkbookCommandType.SelectPreviousWorkbookEntry)}
                disabled={(props.workbook?.selectedWorkbookEntry ?? 0) == 0}
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
                onClick={() => workbookCommand(WorkbookCommandType.SelectNextWorkbookEntry)}
                disabled={((props.workbook?.selectedWorkbookEntry ?? 0) + 1) >= (props.workbook?.workbookEntries.length ?? 0)}
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
                    <WorkbookURLShareOverlay isOpen={linkSharingIsOpen} setIsOpen={openLinkSharing} />
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + U</ActionList.Trailing>
            </ActionList.ListItem>
            <ActionList.ListItem onClick={() => openFileSave(s => !s)}>
                <ActionList.Leading>
                    <FileZipIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Save .{DASHQL_ARCHIVE_FILENAME_EXT}
                    <WorkbookFileSaveOverlay
                        isOpen={fileSaveIsOpen}
                        setIsOpen={openFileSave}
                        conn={props.conn}
                        workbook={props.workbook}
                    />
                </ActionList.ItemText>
                <ActionList.Trailing>Ctrl + S</ActionList.Trailing>
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

export function ScriptEditorWithCatalog(props: { workbook: WorkbookState, connection: ConnectionState | null, script: ScriptData }) {
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
        <div className={styles.details_editor_tabs_body}>
            <ScriptEditor
                workbookId={props.workbook.workbookId}
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
                                <CatalogViewer workbookId={props.workbook.workbookId} />
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

interface WorkbookEntryDetailsProps {
    workbook: WorkbookState;
    workbookEntryId: number;
    connection: ConnectionState | null;
    hideDetails: () => void;
}

const WorkbookEntryDetails: React.FC<WorkbookEntryDetailsProps> = (props: WorkbookEntryDetailsProps) => {
    // const ollamaClient = useOllamaClient();

    const [selectedTab, selectTab] = React.useState<TabKey>(TabKey.Editor);

    // Resolve the query state (if any)
    const workbookEntry = props.workbook.workbookEntries[props.workbook.selectedWorkbookEntry];
    const scriptData = props.workbook.scripts[workbookEntry.scriptId];
    const activeQueryId = scriptData?.latestQueryId ?? null;
    const activeQueryState = useQueryState(props.workbook?.connectionId ?? null, activeQueryId);

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

    const ScreenNormalIcon: Icon = SymbolIcon("screen_normal_16");
    return (
        <div className={styles.details_body_container}>
            <div className={styles.details_body_card}>
                <div className={styles.details_editor_container}>
                    <div className={styles.details_editor_header}>
                        <IconButton
                            className={styles.details_status_indicator_button}
                            variant={ButtonVariant.Invisible}
                            aria-label="expand"
                            aria-labelledby="expand-entry"
                        >
                            <StatusIndicator
                                className={styles.details_status_indicator}
                                fill="black"
                                width={"14px"}
                                height={"14px"}
                                status={IndicatorStatus.Succeeded}
                            />
                        </IconButton>
                        <IconButton
                            className={styles.details_editor_collapse_button}
                            variant={ButtonVariant.Invisible}
                            onClick={props.hideDetails}
                            aria-label="collapse"
                            aria-labelledby="collapse-entry"
                        >
                            <ScreenNormalIcon size={16} />
                        </IconButton>
                    </div>
                    <VerticalTabs
                        className={styles.details_editor_tabs}
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
                            [TabKey.Editor]: _props => <ScriptEditorWithCatalog workbook={props.workbook} connection={props.connection} script={scriptData} />,
                            [TabKey.QueryStatusPanel]: _props => (
                                <QueryStatusPanel query={activeQueryState} />
                            ),
                            [TabKey.QueryResultView]: _props => (
                                <QueryResultView query={activeQueryState} />
                            ),
                        }}
                    />
                </div>
            </div>
        </div>
    );
};


interface WorkbookEntryListProps {
    workbook: WorkbookState;
    showDetails: () => void;
}

const WorkbookEntryList: React.FC<WorkbookEntryListProps> = (props: WorkbookEntryListProps) => {
    const out: React.ReactElement[] = [];
    const ScreenFullIcon: Icon = SymbolIcon("screen_full_16");
    for (let wi = 0; wi < props.workbook.workbookEntries.length; ++wi) {
        // const entry = props.workbook.workbookEntries[wi];
        out.push(
            <div key={wi} className={styles.collection_entry_card}>
                <div key={wi} className={styles.collection_entry_header}>
                    <IconButton
                        className={styles.details_status_indicator_button}
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

export const WorkbookPage: React.FC<Props> = (_props: Props) => {
    const route = useRouteContext();
    const logger = useLogger();
    const [workbook, modifyWorkbook] = useWorkbookState(route.workbookId ?? null);
    const [conn, _modifyConn] = useConnectionState(workbook?.connectionId ?? null);
    const [sharingIsOpen, setSharingIsOpen] = React.useState<boolean>(false);
    const [showDetails, setShowDetails] = React.useState<boolean>(true);

    const sessionCommand = useWorkbookCommandDispatch();

    let warning: React.ReactElement | null = null;
    if (conn?.connectorInfo.connectorType == ConnectorType.DEMO) {
        warning = (
            <div className={styles.warning_card}>
                Changes are not persisted for a Demo connection.
            </div>
        );
    }

    if (route.workbookId === null) {
        logger.error('missing workbook id', {}, LOG_CTX);
        return <div />;
    } else if (workbook == null) {
        logger.error('missing workbook', { workbookId: route.workbookId?.toString() }, LOG_CTX)
        return <div />;
    }
    return (
        <div className={styles.page}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.page_title}>Workbook</div>
                    <WorkbookListDropdown />
                </div>
                <div className={styles.header_right_container}>
                    {conn && <ConnectionStatus conn={conn} />}
                </div>
                <div className={styles.header_action_container}>
                    <div>
                        <ButtonGroup className={theme.button_group}>
                            <IconButtonLegacy
                                icon={PaperAirplaneIcon}
                                aria-labelledby="execute-query"
                                onClick={() => sessionCommand(WorkbookCommandType.ExecuteEditorQuery)}
                            />
                            <IconButtonLegacy
                                icon={SyncIcon}
                                aria-labelledby="refresh-schema"
                                onClick={() => sessionCommand(WorkbookCommandType.RefreshCatalog)}
                            />
                            <IconButtonLegacy
                                icon={LinkIcon}
                                aria-labelledby="visit-github-repository"
                                onClick={() => setSharingIsOpen(s => !s)}
                            />
                        </ButtonGroup>
                        <WorkbookURLShareOverlay isOpen={sharingIsOpen} setIsOpen={setSharingIsOpen} />
                    </div>
                    <IconButtonLegacy icon={ThreeBarsIcon} aria-labelledby="visit-github-repository" />
                </div>
            </div>
            <div className={styles.workbook_entry_sidebar}>
                <WorkbookEntryThumbnails workbook={workbook} modifyWorkbook={modifyWorkbook} />
            </div>
            <div className={styles.body_container}>
                {
                    showDetails
                        ? <WorkbookEntryDetails workbook={workbook} workbookEntryId={workbook.selectedWorkbookEntry} connection={conn} hideDetails={() => setShowDetails(false)} />
                        : <WorkbookEntryList workbook={workbook} showDetails={() => setShowDetails(true)} />
                }
            </div>
            <div className={styles.body_action_sidebar}>
                {warning}
                <div className={styles.body_action_sidebar_card}>
                    <ActionList.List aria-label="Actions">
                        <ActionList.GroupHeading>Connection</ActionList.GroupHeading>
                        <ConnectionCommandList
                            conn={conn ?? null}
                            workbook={workbook}
                        />
                        <ActionList.GroupHeading>Workbook</ActionList.GroupHeading>
                        <WorkbookCommandList
                            conn={conn ?? null}
                            workbook={workbook}
                            modifyWorkbook={modifyWorkbook}
                        />
                    </ActionList.List>
                </div>
            </div>
        </div>
    );
};
