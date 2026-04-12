import * as React from 'react';
import * as styles from './notebook_script_details.module.css';
import { EditorView } from '@codemirror/view';

import { motion, AnimatePresence } from 'framer-motion';
import icons from '@ankoh/dashql-svg-symbols';

import type { Icon } from '@primer/octicons-react';

import { ButtonVariant, IconButton } from '../foundations/button.js';
import { IndicatorStatus, StatusIndicator } from '../foundations/status_indicator.js';
import { KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { QueryExecutionStatus } from '../../connection/query_execution_state.js';
import { QueryResultView } from '../query_result/query_result_view.js';
import { QueryStatusPanel } from '../query_status/query_status_panel.js';
import { ConnectionState } from '../../connection/connection_state.js';
import { useQueryState } from '../../connection/query_executor.js';
import { getSelectedEntry, NotebookState } from '../../notebook/notebook_state.js';
import { useAppConfig } from '../../app_config.js';
import { ScriptEditor } from './script_editor.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { VerticalTabs, VerticalTabVariant } from '../foundations/vertical_tabs.js';

const AUTO_VSPLIT_MIN_HEIGHT = 720;

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

export const NotebookScriptDetails: React.FC<NotebookScriptDetailsProps> = (props) => {
    const config = useAppConfig();
    const [selectedTab, selectTab] = React.useState<TabKey>(TabKey.Editor);
    const [splitModeEnabled, setSplitModeEnabled] = React.useState<boolean>(false);
    const [splitTab, setSplitTab] = React.useState<TabKey | null>(null);
    const [editorView, setEditorView] = React.useState<EditorView | null>(null);
    const [hasAutoEnabledSplit, setHasAutoEnabledSplit] = React.useState<boolean>(false);
    const containerRef = React.useRef<HTMLDivElement>(null);

    const notebookEntry = getSelectedEntry(props.notebook);
    const scriptData = notebookEntry != null ? props.notebook.scripts[notebookEntry.scriptId] : null;

    const activeQueryId = scriptData?.latestQueryId ?? null;
    const activeQueryState = useQueryState(props.notebook?.connectionId ?? null, activeQueryId);

    const tabState = React.useRef<TabState>({
        enabledTabs: 1,
    });
    let enabledTabs = 1;
    enabledTabs += +(activeQueryState != null);
    enabledTabs += +(activeQueryState?.status == QueryExecutionStatus.SUCCEEDED);
    tabState.current.enabledTabs = enabledTabs;

    const toggleSplitMode = React.useCallback(() => {
        setSplitModeEnabled(prev => {
            if (!prev) {
                // Enabling split mode: set primary tab as selected and choose split tab
                selectTab(TabKey.Editor);
                const defaultSplitTab = tabState.current.enabledTabs >= 3
                    ? TabKey.QueryResultView
                    : (tabState.current.enabledTabs >= 2 ? TabKey.QueryStatusPanel : null);
                setSplitTab(defaultSplitTab);
            } else {
                // Disabling split mode
                setSplitTab(null);
            }
            return !prev;
        });
    }, []);

    const handleSelectTab = React.useCallback((tab: TabKey) => {
        if (!splitModeEnabled) {
            selectTab(tab);
        }
        // In split mode, tab selection is handled by onSelectSplitTab
    }, [splitModeEnabled]);

    const handleSelectSplitTab = React.useCallback((tab: TabKey) => {
        if (tab === TabKey.Editor) return; // Can't select Editor for split
        setSplitTab(tab);
    }, []);

    const keyHandlers = React.useMemo<KeyEventHandler[]>(
        () => [
            {
                key: 'j',
                ctrlKey: true,
                callback: () => {
                    if (splitModeEnabled) {
                        // In split mode, cycle through available split tabs
                        setSplitTab(currentSplitTab => {
                            const availableTabs = [TabKey.QueryStatusPanel, TabKey.QueryResultView].filter((_, idx) =>
                                tabState.current.enabledTabs >= idx + 2
                            );
                            if (availableTabs.length === 0) return currentSplitTab;

                            const currentIndex = currentSplitTab ? availableTabs.indexOf(currentSplitTab) : -1;
                            const nextIndex = (currentIndex + 1) % availableTabs.length;
                            return availableTabs[nextIndex];
                        });
                    } else {
                        // Normal mode: cycle through all tabs
                        selectTab(key => {
                            const tabs = [TabKey.Editor, TabKey.QueryStatusPanel, TabKey.QueryResultView];
                            return tabs[((key as number) + 1) % tabState.current.enabledTabs];
                        });
                    }
                },
            },
            {
                key: 'Escape',
                ctrlKey: false,
                // Capture is required so Escape reaches hideDetails before the editor consumes it.
                capture: true,
                callback: () => props.hideDetails(),
            },
        ],
        [props.hideDetails, tabState, selectTab, splitModeEnabled],
    );
    useKeyEvents(keyHandlers);

    const prevStatus = React.useRef<[number | null, QueryExecutionStatus | null] | null>(null);
    React.useEffect(() => {
        const status = activeQueryState?.status ?? null;
        switch (status) {
            case null:
                if (!splitModeEnabled) {
                    selectTab(TabKey.Editor);
                }
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
                    if (splitModeEnabled) {
                        selectTab(TabKey.Editor);
                        setSplitTab(TabKey.QueryStatusPanel);
                    } else {
                        selectTab(TabKey.QueryStatusPanel);
                    }
                }
                break;
            case QueryExecutionStatus.FAILED:
                if (prevStatus.current != null && prevStatus.current[1] != QueryExecutionStatus.FAILED) {
                    if (splitModeEnabled) {
                        selectTab(TabKey.Editor);
                        setSplitTab(TabKey.QueryStatusPanel);
                    } else {
                        selectTab(TabKey.QueryStatusPanel);
                    }
                }
                break;
            case QueryExecutionStatus.SUCCEEDED:
                if (prevStatus.current != null && prevStatus.current[1] != QueryExecutionStatus.SUCCEEDED) {
                    if (splitModeEnabled) {
                        selectTab(TabKey.Editor);
                        setSplitTab(TabKey.QueryResultView);
                    } else {
                        selectTab(TabKey.QueryResultView);
                    }
                }
                break;
        }
        prevStatus.current = [activeQueryId, status];
    }, [activeQueryId, activeQueryState?.status, splitModeEnabled]);

    // Auto-enable split mode the first time a second tab becomes active (if height > AUTO_VSPLIT_MIN_HEIGHT)
    React.useEffect(() => {
        if (!hasAutoEnabledSplit && !splitModeEnabled && tabState.current.enabledTabs >= 2) {
            const container = containerRef.current;
            if (container) {
                const height = container.getBoundingClientRect().height;
                if (height > AUTO_VSPLIT_MIN_HEIGHT) {
                    selectTab(TabKey.Editor); // Ensure primary tab is selected
                    setSplitModeEnabled(true);
                    const defaultSplitTab = tabState.current.enabledTabs >= 3
                        ? TabKey.QueryResultView
                        : TabKey.QueryStatusPanel;
                    setSplitTab(defaultSplitTab);
                    setHasAutoEnabledSplit(true);
                }
            }
        }
    }, [hasAutoEnabledSplit, splitModeEnabled, tabState.current.enabledTabs]);

    // Handle edge case: if split tab becomes disabled, switch to another tab or disable split mode
    React.useEffect(() => {
        if (splitModeEnabled && splitTab !== null && splitTab !== TabKey.Editor) {
            // Check if the current split tab is disabled
            const isSplitTabDisabled = (splitTab === TabKey.QueryStatusPanel && tabState.current.enabledTabs < 2) ||
                (splitTab === TabKey.QueryResultView && tabState.current.enabledTabs < 3);

            if (isSplitTabDisabled) {
                // Try to find another enabled tab
                if (tabState.current.enabledTabs >= 3 && splitTab !== TabKey.QueryResultView) {
                    setSplitTab(TabKey.QueryResultView);
                } else if (tabState.current.enabledTabs >= 2 && splitTab !== TabKey.QueryStatusPanel) {
                    setSplitTab(TabKey.QueryStatusPanel);
                } else {
                    // No other tabs available, disable split mode
                    setSplitModeEnabled(false);
                    setSplitTab(null);
                }
            }
        }
    }, [splitModeEnabled, splitTab, activeQueryState?.status]);

    React.useEffect(() => {
        if (selectedTab !== TabKey.Editor || editorView == null) {
            return;
        }
        const handle = requestAnimationFrame(() => {
            editorView.focus();
        });
        return () => cancelAnimationFrame(handle);
    }, [editorView, selectedTab]);

    if (notebookEntry == null || scriptData == null) {
        return <div className={styles.entry_body_container} />;
    }

    const ScreenNormalIcon: Icon = SymbolIcon('screen_normal_16');
    const tableDebugMode = config?.settings?.tableDebugMode ?? false;
    return (
        <div className={styles.entry_body_container}>
            <AnimatePresence mode="wait">
                <motion.div
                    ref={containerRef}
                    key={notebookEntry?.scriptId}
                    className={styles.entry_body_card}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{
                        duration: 0.1,
                        ease: [0.33, 1, 0.68, 1]
                    }}
                >
                    <div className={styles.entry_card_container}>
                        <div className={styles.entry_card_action_bar}>
                            <IconButton
                                className={styles.entry_status_indicator_button}
                                variant={ButtonVariant.Invisible}
                                aria-label="Expand"
                                aria-labelledby="expand-entry"
                            >
                                <StatusIndicator
                                    fill="black"
                                    width={"14px"}
                                    height={"14px"}
                                    status={IndicatorStatus.Succeeded}
                                />
                            </IconButton>
                            <IconButton
                                className={styles.entry_card_collapse_button}
                                variant={ButtonVariant.Invisible}
                                onClick={props.hideDetails}
                                aria-label="Collapse"
                                aria-labelledby="collapse-entry"
                            >
                                <ScreenNormalIcon size={16} />
                            </IconButton>
                        </div>
                        <VerticalTabs
                            className={styles.entry_card_tabs}
                            variant={VerticalTabVariant.Stacked}
                            selectedTab={selectedTab}
                            selectTab={handleSelectTab}
                            splitModeEnabled={splitModeEnabled}
                            splitTab={splitTab}
                            primaryTabKey={TabKey.Editor}
                            onToggleSplitMode={toggleSplitMode}
                            onSelectSplitTab={handleSelectSplitTab}
                            tabProps={{
                                [TabKey.Editor]: {
                                    tabId: TabKey.Editor,
                                    icon: `${icons}#file`,
                                    labelShort: 'Editor',
                                    ariaLabel: 'Script editor',
                                    description: 'Edit script',
                                    disabled: false
                                },
                                [TabKey.QueryStatusPanel]: {
                                    tabId: TabKey.QueryStatusPanel,
                                    icon: `${icons}#plan`,
                                    labelShort: 'Status',
                                    ariaLabel: 'Query status',
                                    description: 'Query status',
                                    disabled: tabState.current.enabledTabs < 2,
                                },
                                [TabKey.QueryResultView]: {
                                    tabId: TabKey.QueryResultView,
                                    icon: `${icons}#table_24`,
                                    labelShort: 'Data',
                                    ariaLabel: 'Query results',
                                    description: 'Query results',
                                    disabled: tabState.current.enabledTabs < 3,
                                },
                            }}
                            tabKeys={[
                                TabKey.Editor,
                                TabKey.QueryStatusPanel,
                                TabKey.QueryResultView
                            ]}
                            tabRenderers={{
                                [TabKey.Editor]: _props => (
                                    <ScriptEditor
                                        notebookId={props.notebook.notebookId}
                                        scriptKey={notebookEntry.scriptId}
                                        setView={setEditorView}
                                    />
                                ),
                                [TabKey.QueryStatusPanel]: _props => (
                                    <QueryStatusPanel query={activeQueryState} />
                                ),
                                [TabKey.QueryResultView]: _props => (
                                    <QueryResultView query={activeQueryState} debugMode={tableDebugMode} />
                                ),
                            }}
                        />
                    </div>
                </motion.div>
            </AnimatePresence>
        </div>
    );
};
