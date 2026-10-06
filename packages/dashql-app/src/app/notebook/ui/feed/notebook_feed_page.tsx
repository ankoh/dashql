import * as React from 'react';
import * as styles from './notebook_feed_page.module.css';

import { ThreeBarsIcon } from '../../../../ui/foundations/symbol_icon.js';

import type { AttachedDatabaseState } from '../../connections/attached_database_state.js';
import {
    SELECT_SCRIPT,
    type NotebookScripts,
} from '../../scripts/notebook_scripts.js';
import type { ModifyNotebookScripts } from '../../scripts/notebook_scripts_registry.js';
import { ButtonVariant, IconButton } from '../../../../ui/foundations/button.js';
import { NotebookNavigationDrawer } from '../notebook_navigation_drawer.js';
import { NotebookWorkbenchSidebar } from '../notebook_workbench_sidebar.js';
import { ScriptDetails, TabKey as DetailsTabKey } from '../script_details.js';
import { NotebookFeed } from './notebook_feed.js';
import { Dashboard } from '../../dashboard/dashboard.js';
import { NotebookViewMode, useNotebookViewMode } from '../../scripts/notebook_commands.js';
import { SegmentedControl, SegmentedControlSize } from '../../../../ui/foundations/segmented_control.js';

export interface NotebookFeedPageDependencies {
    NotebookFeed: typeof NotebookFeed;
    ScriptDetails: typeof ScriptDetails;
    NotebookWorkbenchSidebar: typeof NotebookWorkbenchSidebar;
    NotebookNavigationDrawer: typeof NotebookNavigationDrawer;
    ThreeBarsIcon: typeof ThreeBarsIcon;
    IconButton: typeof IconButton;
    Dashboard: typeof Dashboard;
    useNotebookViewMode: typeof useNotebookViewMode;
    SegmentedControl: typeof SegmentedControl;
}

const DEFAULT_DEPENDENCIES: NotebookFeedPageDependencies = {
    NotebookFeed,
    ScriptDetails,
    NotebookWorkbenchSidebar,
    NotebookNavigationDrawer,
    ThreeBarsIcon,
    IconButton,
    Dashboard,
    useNotebookViewMode,
    SegmentedControl,
};

interface Props {
    notebookScripts: NotebookScripts;
    modifyNotebookScripts: ModifyNotebookScripts;
    connection: AttachedDatabaseState | null;
    active: boolean;
    dependencies?: NotebookFeedPageDependencies;
}

export const NotebookFeedPage: React.FC<Props> = (props) => {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const [showDetails, setShowDetails] = React.useState(false);
    const [detailsScriptId, setDetailsScriptId] = React.useState<number | undefined>(undefined);
    const [detailsInitialTab, setDetailsInitialTab] = React.useState<DetailsTabKey | undefined>(undefined);
    const [feedShadowContainer, setFeedShadowContainer] = React.useState<HTMLDivElement | null>(null);
    const [navigationDrawerOpen, setNavigationDrawerOpen] = React.useState(false);
    const navigationDrawerTriggerRef = React.useRef<HTMLButtonElement>(null);
    const { mode, setMode } = dependencies.useNotebookViewMode();
    const dashboardActive = mode === NotebookViewMode.Dashboard;
    const feedActive = props.active && !dashboardActive && !showDetails;
    const workbench = (closeAfterSelection: boolean) => (
        <dependencies.NotebookWorkbenchSidebar
            notebookScripts={props.notebookScripts}
            closeAfterSelection={closeAfterSelection ? () => setNavigationDrawerOpen(false) : undefined}
        />
    );

    return (
        <div className={styles.page}>
            <header className={styles.mobile_header} data-electron-drag-region>
                <dependencies.IconButton ref={navigationDrawerTriggerRef} variant={ButtonVariant.Default} aria-label="Open notebook workbench" onClick={() => setNavigationDrawerOpen(true)}>
                    <dependencies.ThreeBarsIcon />
                </dependencies.IconButton>
            </header>
            <aside className={styles.navigation_sidebar}>
                {workbench(false)}
            </aside>
            <main className={styles.body_container} id="notebook-body">
                <div className={styles.view_bar}>
                    <dependencies.SegmentedControl
                        aria-label="Notebook view"
                        size={SegmentedControlSize.Small}
                        onChange={(selectedIndex) => setMode(selectedIndex === 0
                            ? NotebookViewMode.Notebook
                            : NotebookViewMode.Dashboard)}
                    >
                        <dependencies.SegmentedControl.Button selected={!dashboardActive}>Notebook</dependencies.SegmentedControl.Button>
                        <dependencies.SegmentedControl.Button selected={dashboardActive}>Dashboard</dependencies.SegmentedControl.Button>
                    </dependencies.SegmentedControl>
                </div>
                <div className={styles.content_container}>
                    <div className={feedActive ? styles.feed_layer : styles.feed_layer_hidden}>
                        <dependencies.NotebookFeed
                            notebookScripts={props.notebookScripts}
                            modifyNotebookScripts={props.modifyNotebookScripts}
                            active={feedActive}
                            scrollShadowContainer={feedShadowContainer}
                            showDetails={(fileName?: string, initialTab?: DetailsTabKey) => {
                                const targetFileName = fileName ?? props.notebookScripts.scriptFocus.fileName;
                                setDetailsScriptId(props.notebookScripts.scriptRefs[targetFileName]?.scriptId);
                                setDetailsInitialTab(initialTab);
                                setShowDetails(true);
                            }}
                            conn={props.connection}
                        />
                    </div>
                    {!dashboardActive && showDetails
                                ? <dependencies.ScriptDetails
                                    notebookScripts={props.notebookScripts}
                                    modifyNotebookScripts={props.modifyNotebookScripts}
                                    connection={props.connection}
                                    hideDetails={() => {
                                        setShowDetails(false);
                                        setDetailsScriptId(undefined);
                                        setDetailsInitialTab(undefined);
                                    }}
                                    scriptId={detailsScriptId}
                                    initialTab={detailsInitialTab}
                                    navigateToScript={(scriptKey) => {
                                        const target = props.notebookScripts.scripts[scriptKey];
                                        if (!target?.fileName) return;
                                        props.modifyNotebookScripts({
                                            type: SELECT_SCRIPT,
                                            value: target.fileName,
                                        });
                                        setDetailsScriptId(scriptKey);
                                        setDetailsInitialTab(undefined);
                                    }}
                                />
                                : null}
                    {dashboardActive && (
                        <dependencies.Dashboard
                            notebookScripts={props.notebookScripts}
                            modifyNotebookScripts={props.modifyNotebookScripts}
                        />
                    )}
                    <div
                        ref={setFeedShadowContainer}
                        className={dashboardActive ? styles.feed_shadow_layer_hidden : styles.feed_shadow_layer}
                        aria-hidden="true"
                    />
                </div>
            </main>
            {navigationDrawerOpen && (
                <dependencies.NotebookNavigationDrawer open onClose={() => setNavigationDrawerOpen(false)} returnFocusRef={navigationDrawerTriggerRef}>
                    {workbench(true)}
                </dependencies.NotebookNavigationDrawer>
            )}
        </div>
    );
};
