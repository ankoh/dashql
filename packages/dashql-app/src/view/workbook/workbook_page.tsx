import * as React from 'react';
import * as ActionList from '../foundations/action_list.js';
import * as styles from './workbook_page.module.css';
import * as theme from '../../github_theme.module.css';
import * as icons from '../../../static/svg/symbols.generated.svg';

import { ButtonGroup, IconButton } from '@primer/react';
import { DownloadIcon, LinkIcon, PaperAirplaneIcon, SyncIcon, ThreeBarsIcon } from '@primer/octicons-react';

import { CatalogPanel } from '../../view/catalog/catalog_panel.js';
import { ConnectorInfo } from '../../connection/connector_info.js';
import { DragSizing, DragSizingBorder } from '../foundations/drag_sizing.js';
import { KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { QueryExecutionStatus } from '../../connection/query_execution_state.js';
import { QueryResultView } from '../query_result/query_result_view.js';
import { QueryStatusPanel } from '../query_status/query_status_panel.js';
import { ScriptEditor } from './editor.js';
import { VerticalTabs, VerticalTabVariant } from '../foundations/vertical_tabs.js';
import { WorkbookCommandType, useWorkbookCommandDispatch } from '../../workbook/workbook_commands.js';
import { WorkbookEntryList } from './workbook_entry_list.js';
import { WorkbookFileSaveOverlay } from './workbook_file_save_overlay.js';
import { WorkbookListDropdown } from './session_list_dropdown.js';
import { WorkbookURLShareOverlay } from './workbook_url_share_overlay.js';
import { useCurrentWorkbookState } from '../../workbook/current_workbook.js';
import { useQueryState } from '../../connection/query_executor.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { WorkbookState } from 'workbook/workbook_state.js';

const ConnectionCommandList = (props: { conn: ConnectionState | null, workbook: WorkbookState | null }) => {
    const sessionCommand = useWorkbookCommandDispatch();
    return (
        <>
            <ActionList.ListItem
                disabled={!props.conn?.connectorInfo.features.executeQueryAction}
                onClick={() => sessionCommand(WorkbookCommandType.ExecuteEditorQuery)}
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
                onClick={() => sessionCommand(WorkbookCommandType.RefreshCatalog)}
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

const WorkbookCommandList = (props: { conn: ConnectionState | null, workbook: WorkbookState | null }) => {
    const [linkSharingIsOpen, openLinkSharing] = React.useState<boolean>(false);
    const [fileSaveIsOpen, openFileSave] = React.useState<boolean>(false);
    return (
        <>
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
                    <DownloadIcon />
                </ActionList.Leading>
                <ActionList.ItemText>
                    Save as File
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

enum TabKey {
    Catalog = 0,
    QueryStatusPanel = 1,
    QueryResultView = 2,
}

interface TabState {
    enabledTabs: number;
}

interface Props { }

export const EditorPage: React.FC<Props> = (_props: Props) => {
    const [workbook, _modifyWorkbook] = useCurrentWorkbookState();
    const [conn, _modifyConn] = useConnectionState(workbook?.connectionId ?? null);
    const [selectedTab, selectTab] = React.useState<TabKey>(TabKey.Catalog);
    const [sharingIsOpen, setSharingIsOpen] = React.useState<boolean>(false);

    // Resolve the editor query state (if any)
    const workbookEntry = workbook?.workbookEntries[workbook.selectedWorkbookEntry];
    const activeQueryId = workbookEntry?.queryId ?? null;
    const activeQueryState = useQueryState(workbook?.connectionId ?? null, activeQueryId);

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
                        const tabs = [TabKey.Catalog, TabKey.QueryStatusPanel, TabKey.QueryResultView];
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
                selectTab(TabKey.Catalog);
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

    const sessionCommand = useWorkbookCommandDispatch();
    return (
        <div className={styles.page}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.page_title}>Workbook</div>
                    <WorkbookListDropdown short={true} />
                </div>
                <div className={styles.header_action_container}>
                    <div>
                        <ButtonGroup className={theme.button_group}>
                            <IconButton
                                icon={PaperAirplaneIcon}
                                aria-labelledby="execute-query"
                                onClick={() => sessionCommand(WorkbookCommandType.ExecuteEditorQuery)}
                            />
                            <IconButton
                                icon={SyncIcon}
                                aria-labelledby="refresh-schema"
                                onClick={() => sessionCommand(WorkbookCommandType.RefreshCatalog)}
                            />
                            <IconButton
                                icon={LinkIcon}
                                aria-labelledby="visit-github-repository"
                                onClick={() => setSharingIsOpen(s => !s)}
                            />
                        </ButtonGroup>
                        <WorkbookURLShareOverlay isOpen={sharingIsOpen} setIsOpen={setSharingIsOpen} />
                    </div>
                    <IconButton icon={ThreeBarsIcon} aria-labelledby="visit-github-repository" />
                </div>
            </div>
            <div className={styles.workbook_entry_sidebar}>
                <WorkbookEntryList workbook={workbook} />
            </div>
            <div className={styles.body_container}>
                <div className={styles.editor_container}>
                    <ScriptEditor className={styles.editor_card} />
                </div>
                <DragSizing border={DragSizingBorder.Top} className={styles.output_container}>
                    <VerticalTabs
                        className={styles.output_card}
                        variant={VerticalTabVariant.Stacked}
                        selectedTab={selectedTab}
                        selectTab={selectTab}
                        tabProps={{
                            [TabKey.Catalog]: { tabId: TabKey.Catalog, icon: `${icons}#tables_connected`, labelShort: 'Catalog', disabled: false },
                            [TabKey.QueryStatusPanel]: {
                                tabId: TabKey.QueryStatusPanel,
                                icon: `${icons}#plan`,
                                labelShort: 'Status',
                                disabled: tabState.current.enabledTabs < 2,
                            },
                            [TabKey.QueryResultView]: {
                                tabId: TabKey.QueryResultView,
                                icon: `${icons}#table`,
                                labelShort: 'Data',
                                disabled: tabState.current.enabledTabs < 3,
                            },
                        }}
                        tabKeys={[TabKey.Catalog, TabKey.QueryStatusPanel, TabKey.QueryResultView]}
                        tabRenderers={{
                            [TabKey.Catalog]: _props => <CatalogPanel />,
                            [TabKey.QueryStatusPanel]: _props => (
                                <QueryStatusPanel query={activeQueryState} />
                            ),
                            [TabKey.QueryResultView]: _props => (
                                <QueryResultView query={activeQueryState} />
                            ),
                        }}
                    />
                </DragSizing>
            </div>
            <div className={styles.action_sidebar}>
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
                    />
                    <ActionList.Divider />
                </ActionList.List>
            </div>
        </div>
    );
};
