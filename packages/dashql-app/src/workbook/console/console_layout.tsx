import * as React from 'react';
import * as styles from './console_layout.module.css';

import { IconButton, ButtonSize, ButtonVariant } from '@akohn/dashql-react/components/button';
import { PlusIcon } from '@akohn/dashql-react/components/symbol_icon';
import { VerticalSplit } from '@akohn/dashql-react/components/vertical_split';
import { classNames } from '@akohn/dashql-react/dom/classnames';

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
}

/// The console of a workbook: the scripts as tabs, the editor of the active one over its results, and a sidebar on the
/// right
export function ConsoleLayout(props: ConsoleLayoutProps): React.ReactElement {
    const { tabs, activeTab, onSelectTab, onAddTab } = props;
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
            <div className={styles.body}>
                <main className={styles.main}>
                    {activeTab == null ? (
                        <div className={styles.empty} data-testid="console-empty">No scripts yet</div>
                    ) : (
                        <VerticalSplit
                            className={styles.split}
                            defaultRatio={0.5}
                            separatorLabel="Resize editor and results"
                            first={(
                                <div className={styles.editor_pane}>
                                    {props.header()}
                                    <div className={styles.editor}>{props.editor()}</div>
                                </div>
                            )}
                            second={<div className={styles.results_pane}>{props.results()}</div>}
                        />
                    )}
                </main>
                <aside className={styles.sidebar} aria-label="Workbook details" data-testid="console-sidebar">
                    {props.sidebar()}
                </aside>
            </div>
        </div>
    );
}
