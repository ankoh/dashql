import * as React from 'react';
import * as styles from './console_layout.module.css';

import { IconButton, ButtonSize, ButtonVariant } from '@akohn/dashql-react/components/button';
import { PlusIcon } from '@akohn/dashql-react/components/symbol_icon';
import { SegmentedControl, SegmentedControlSize } from '@akohn/dashql-react/components/segmented_control';
import { VerticalSplit } from '@akohn/dashql-react/components/vertical_split';
import { classNames } from '@akohn/dashql-react/dom/classnames';
import { COMPACT_WIDTH_QUERY, useMediaQuery } from '@akohn/dashql-react/dom/media_query';

/// A tab of the console, a script of the workbook
export interface ConsoleTab {
    scriptKey: number;
    /// The name of the script
    label: string;
}

export interface ConsoleLayoutProps {
    /// The tabs in the order of the scripts of the workbook
    tabs: readonly ConsoleTab[];
    /// The script whose tab shows, null without scripts
    activeTab: number | null;
    /// Show the tab of a script
    onSelectTab: (scriptKey: number) => void;
    /// Add a script after the others. Without it, e.g. in a read-only workbook, the strip has no button.
    onAddTab?: () => void;
    // The parts of the active tab are slots, they read the runtime
    /// The header of the script above its editor: its name, its connection and its menu
    header: () => React.ReactNode;
    /// The editor of the script, it fills the pane above the results
    editor: () => React.ReactNode;
    /// The results of the latest query of the script below the editor
    results: () => React.ReactNode;
    /// The sections of the sidebar right of the editor and the results
    sidebar: () => React.ReactNode;
    /// The latest run of the active script, e.g. the id of its latest query. A new one shows the results on a compact
    /// window.
    runKey?: number | null;
}

/// The panes of the console on a compact window, one shows at a time
export enum ConsolePane {
    Editor = 'editor',
    Results = 'results',
    Sidebar = 'sidebar',
}

const PANES: [ConsolePane, string][] = [
    [ConsolePane.Editor, 'SQL'],
    [ConsolePane.Results, 'Results'],
    [ConsolePane.Sidebar, 'Inputs'],
];

/// The pane that a compact console shows: the editor until the active script runs, then its results. Another tab keeps
/// the pane.
function useCompactPane(activeTab: number | null, runKey: number | null): [ConsolePane, (pane: ConsolePane) => void] {
    const [pane, setPane] = React.useState(ConsolePane.Editor);
    // The tab and the run of the last render, a change adjusts the pane while rendering
    const [seen, setSeen] = React.useState({ activeTab, runKey });
    if (seen.activeTab !== activeTab || seen.runKey !== runKey) {
        if (activeTab === seen.activeTab && runKey != null) setPane(ConsolePane.Results);
        setSeen({ activeTab, runKey });
    }
    return [pane, setPane];
}

/// The console of a workbook: the scripts as tabs, the editor of the active one over its results, and a sidebar on the
/// right. A compact window shows one of them at a time, a segmented control picks it (docs/design/narrow_layouts.md).
export function ConsoleLayout(props: ConsoleLayoutProps): React.ReactElement {
    const { tabs, activeTab, onSelectTab, onAddTab } = props;
    const compact = useMediaQuery(COMPACT_WIDTH_QUERY);
    const [pane, setPane] = useCompactPane(activeTab, props.runKey ?? null);
    const editorPane = (
        <div className={styles.editor_pane}>
            {props.header()}
            <div className={styles.editor}>{props.editor()}</div>
        </div>
    );
    const resultsPane = <div className={styles.results_pane}>{props.results()}</div>;
    const sidebar = (hidden: boolean) => (
        <aside className={classNames(styles.sidebar, hidden && styles.pane_hidden)} aria-label="Workbook details" data-testid="console-sidebar">
            {props.sidebar()}
        </aside>
    );
    return (
        <div className={styles.console} data-testid="workbook-console">
            <div className={styles.tab_bar}>
                <div className={styles.tabs} role="tablist" aria-label="Scripts">
                    {tabs.map(tab => (
                        <button
                            key={tab.scriptKey}
                            type="button"
                            role="tab"
                            className={classNames(styles.tab, tab.scriptKey === activeTab && styles.tab_active)}
                            aria-selected={tab.scriptKey === activeTab}
                            title={tab.label}
                            data-testid="console-tab"
                            data-script-key={tab.scriptKey}
                            onClick={() => onSelectTab(tab.scriptKey)}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
                {onAddTab != null && (
                    <IconButton size={ButtonSize.Small} variant={ButtonVariant.Invisible} className={styles.add_tab}
                        aria-label="Add script" data-testid="console-add-script" onClick={onAddTab}>
                        <PlusIcon size={14} />
                    </IconButton>
                )}
            </div>
            {compact ? (
                // The panes stay mounted while hidden, the editor keeps its state when the results show
                <div className={styles.body_compact}>
                    <SegmentedControl className={styles.pane_switch} aria-label="Pane" data-testid="console-pane-switch" fullWidth
                        size={SegmentedControlSize.Small} onChange={index => setPane(PANES[index][0])}>
                        {PANES.map(([value, label]) => (
                            <SegmentedControl.Button key={value} selected={pane === value} data-pane={value}>{label}</SegmentedControl.Button>
                        ))}
                    </SegmentedControl>
                    {activeTab == null ? (
                        <div className={classNames(styles.empty, pane === ConsolePane.Sidebar && styles.pane_hidden)} data-testid="console-empty">No scripts yet</div>
                    ) : <>
                        <main className={classNames(styles.main, pane !== ConsolePane.Editor && styles.pane_hidden)}>{editorPane}</main>
                        <main className={classNames(styles.main, pane !== ConsolePane.Results && styles.pane_hidden)}>{resultsPane}</main>
                    </>}
                    {sidebar(pane !== ConsolePane.Sidebar)}
                </div>
            ) : (
                <div className={styles.body}>
                    <main className={styles.main}>
                        {activeTab == null ? (
                            <div className={styles.empty} data-testid="console-empty">No scripts yet</div>
                        ) : (
                            <VerticalSplit
                                className={styles.split}
                                defaultRatio={0.5}
                                minFirstSize={80}
                                minSecondSize={80}
                                separatorLabel="Resize editor and results"
                                first={editorPane}
                                second={resultsPane}
                            />
                        )}
                    </main>
                    {sidebar(false)}
                </div>
            )}
        </div>
    );
}
