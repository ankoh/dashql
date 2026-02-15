import * as React from 'react';
import * as styles from './notebook_page.module.css';

import icons from '../../../static/svg/symbols.generated.svg';

import type { Icon } from '@primer/octicons-react';

import { ButtonVariant, IconButton } from '../foundations/button.js';
import { IndicatorStatus, StatusIndicator } from '../foundations/status_indicator.js';
import { KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { QueryExecutionStatus } from '../../connection/query_execution_state.js';
import { QueryResultView } from '../query_result/query_result_view.js';
import { QueryStatusPanel } from '../query_status/query_status_panel.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { useQueryState } from '../../connection/query_executor.js';
import { getSelectedEntry, getSelectedPageEntries, NotebookState } from '../../notebook/notebook_state.js';
import { ScriptEditorWithCatalog } from './notebook_script_editor_card.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { VerticalTabs, VerticalTabVariant } from '../foundations/vertical_tabs.js';

export enum TabKey {
    Editor = 0,
    QueryStatusPanel = 1,
    QueryResultView = 2,
}

interface TabState {
    enabledTabs: number;
}

export interface NotebookScriptDetailsProps {
    notebook: NotebookState;
    connection: ConnectionState | null;
    hideDetails: () => void;
}

export const NotebookScriptCard: React.FC<NotebookScriptDetailsProps> = (props) => {
    const [selectedTab, selectTab] = React.useState<TabKey>(TabKey.Editor);

    const notebookEntry = getSelectedEntry(props.notebook);
    const scriptData = notebookEntry != null ? props.notebook.scripts[notebookEntry.scriptId] : null;
    if (notebookEntry == null || scriptData == null) {
        return <div className={styles.entry_body_container} />;
    }
    const activeQueryId = scriptData.latestQueryId ?? null;
    const activeQueryState = useQueryState(props.notebook?.connectionId ?? null, activeQueryId);

    const tabState = React.useRef<TabState>({
        enabledTabs: 1,
    });
    let enabledTabs = 1;
    enabledTabs += +(activeQueryState != null);
    enabledTabs += +(activeQueryState?.status == QueryExecutionStatus.SUCCEEDED);
    tabState.current.enabledTabs = enabledTabs;

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

    const ScreenNormalIcon: Icon = SymbolIcon('screen_normal_16');
    const ProcessorIcon: Icon = SymbolIcon('processor');
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
