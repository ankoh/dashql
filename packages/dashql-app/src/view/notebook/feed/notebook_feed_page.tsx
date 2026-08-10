import * as React from 'react';
import * as styles from './notebook_feed_page.module.css';

import { ThreeBarsIcon } from '@primer/octicons-react';

import type { ConnectionState } from '../../../connection/connection_state.js';
import {
    CREATE_SCRIPT_FOLDER,
    SELECT_NEXT_SCRIPT,
    SELECT_NEXT_SCRIPT_FOLDER,
    SELECT_PREV_SCRIPT,
    SELECT_PREV_SCRIPT_FOLDER,
    SELECT_SCRIPT_FOLDER,
    SELECT_SCRIPT_PATH,
    getSortedScriptFolderNames,
    type NotebookScripts,
} from '../../../scripts/notebook_scripts.js';
import type { ModifyNotebookScripts } from '../../../scripts/notebook_scripts_registry.js';
import { KeyEventHandler, useKeyEvents } from '../../../utils/key_events.js';
import { CHANGE_NOTEBOOK, useRouterNavigate } from '../../../router.js';
import { ButtonVariant, IconButton } from '../../foundations/button.js';
import { CatalogFunctionsView } from '../catalog_functions_view.js';
import { CatalogSchemaView } from '../catalog_schema_view.js';
import { NotebookActionMenu } from '../notebook_action_menu.js';
import { NotebookConnectionSection } from '../notebook_connection_section.js';
import {
    NotebookFileTree,
    type NotebookFileTreeCatalogTab as CatalogTab,
    type NotebookFileTreeNavigationLevel,
} from '../notebook_file_tree.js';
import { NotebookNavigationDrawer } from '../notebook_navigation_drawer.js';
import { prepareForNotebookTreeNavigation } from '../notebook_navigation_keyboard.js';
import { ScriptDetails, TabKey as DetailsTabKey } from '../script_details.js';
import { NotebookFeed } from './notebook_feed.js';

interface FeedScrollTarget {
    fileName: string;
    version: number;
}

interface Props {
    notebookScripts: NotebookScripts;
    modifyNotebookScripts: ModifyNotebookScripts;
    connection: ConnectionState | null;
    active: boolean;
    openConnectionOverlay: (anchor?: HTMLButtonElement | null) => void;
}

export const NotebookFeedPage: React.FC<Props> = (props) => {
    const navigate = useRouterNavigate();
    const [showDetails, setShowDetails] = React.useState(false);
    const [detailsScriptId, setDetailsScriptId] = React.useState<number | undefined>(undefined);
    const [detailsInitialTab, setDetailsInitialTab] = React.useState<DetailsTabKey | undefined>(undefined);
    const [feedScrollTarget, setFeedScrollTarget] = React.useState<FeedScrollTarget | null>(null);
    const [catalogTab, setCatalogTab] = React.useState<CatalogTab | null>(null);
    const [navigationDrawerOpen, setNavigationDrawerOpen] = React.useState(false);
    const [treeNavigationLevel, setTreeNavigationLevel] = React.useState<NotebookFileTreeNavigationLevel>('scripts');
    const navigationDrawerTriggerRef = React.useRef<HTMLButtonElement>(null);
    const lastScrolledFolderRef = React.useRef(props.notebookScripts.scriptFocus.folderName);
    const requestFeedScroll = React.useCallback((fileName: string) => {
        setFeedScrollTarget(previous => ({
            fileName,
            version: (previous?.version ?? 0) + 1,
        }));
    }, []);

    const keyHandlers = React.useMemo<KeyEventHandler[]>(() => [
        {
            key: 'Escape',
            ctrlKey: false,
            callback: () => {
                if (!props.active) return;
                if (catalogTab != null) {
                    setCatalogTab(null);
                    setShowDetails(false);
                    const folders = getSortedScriptFolderNames(props.notebookScripts.scriptFolders);
                    if (folders.length > 0 && props.notebookScripts.scriptFocus.folderName !== folders[0]) {
                        props.modifyNotebookScripts({ type: SELECT_SCRIPT_FOLDER, value: folders[0] });
                    }
                    return;
                }
                if (showDetails) return;
                const active = document.activeElement as HTMLElement | null;
                if (active && active !== document.body && active !== document.documentElement) {
                    active.blur();
                    return;
                }
                navigate({ type: CHANGE_NOTEBOOK, value: null });
            },
        },
        {
            key: 'l',
            ctrlKey: true,
            callback: (event) => {
                if (!props.active || showDetails || catalogTab != null) return;
                prepareForNotebookTreeNavigation(event);
                setTreeNavigationLevel('scripts');
            },
        },
        {
            key: 'h',
            ctrlKey: true,
            callback: (event) => {
                if (!props.active || showDetails || catalogTab != null) return;
                prepareForNotebookTreeNavigation(event);
                setTreeNavigationLevel('folders');
            },
        },
        {
            key: 'j',
            ctrlKey: true,
            callback: (event) => {
                if (!props.active || showDetails || catalogTab != null) return;
                prepareForNotebookTreeNavigation(event);
                props.modifyNotebookScripts({
                    type: treeNavigationLevel === 'folders' ? SELECT_NEXT_SCRIPT_FOLDER : SELECT_NEXT_SCRIPT,
                    value: null,
                });
            },
        },
        {
            key: 'k',
            ctrlKey: true,
            callback: (event) => {
                if (!props.active || showDetails || catalogTab != null) return;
                prepareForNotebookTreeNavigation(event);
                props.modifyNotebookScripts({
                    type: treeNavigationLevel === 'folders' ? SELECT_PREV_SCRIPT_FOLDER : SELECT_PREV_SCRIPT,
                    value: null,
                });
            },
        },
    ], [catalogTab, navigate, props.active, props.modifyNotebookScripts, props.notebookScripts, showDetails, treeNavigationLevel]);
    useKeyEvents(keyHandlers);

    React.useEffect(() => {
        if (showDetails) return;
        const folderName = props.notebookScripts.scriptFocus.folderName;
        const folderChanged = folderName !== lastScrolledFolderRef.current;
        lastScrolledFolderRef.current = folderName;
        requestFeedScroll(folderChanged ? '' : props.notebookScripts.scriptFocus.fileName);
    }, [props.notebookScripts.scriptFocus.interactionCounter, requestFeedScroll, showDetails]);

    const feedActive = props.active && catalogTab == null && !showDetails;
    const selectFolder = (folderName: string) => {
        const folderChanged = folderName !== props.notebookScripts.scriptFocus.folderName;
        const isSelected = catalogTab == null && !folderChanged;
        setCatalogTab(null);
        if (!isSelected) {
            if (folderChanged) requestFeedScroll('');
            props.modifyNotebookScripts({ type: SELECT_SCRIPT_FOLDER, value: folderName });
        }
        setShowDetails(false);
        setDetailsScriptId(undefined);
        setDetailsInitialTab(undefined);
    };
    const selectScript = (folderName: string, fileName: string) => {
        setCatalogTab(null);
        setShowDetails(false);
        setDetailsScriptId(undefined);
        setDetailsInitialTab(undefined);
        props.modifyNotebookScripts({ type: SELECT_SCRIPT_PATH, value: { folderName, fileName } });
    };
    const selectCatalog = (tab: CatalogTab) => {
        if (showDetails && catalogTab == null) return;
        setCatalogTab(tab);
        setShowDetails(true);
    };
    const selectPreviousTreeItem = () => props.modifyNotebookScripts({
        type: treeNavigationLevel === 'folders' ? SELECT_PREV_SCRIPT_FOLDER : SELECT_PREV_SCRIPT,
        value: null,
    });
    const selectNextTreeItem = () => props.modifyNotebookScripts({
        type: treeNavigationLevel === 'folders' ? SELECT_NEXT_SCRIPT_FOLDER : SELECT_NEXT_SCRIPT,
        value: null,
    });
    const fileTree = (closeAfterSelection: boolean) => (
        <div className={styles.file_navigation}>
            <NotebookConnectionSection
                conn={props.connection}
                notebookScripts={props.notebookScripts}
                onOpenSettings={props.openConnectionOverlay}
                actions={(
                    <NotebookActionMenu
                        conn={props.connection}
                        notebookScripts={props.notebookScripts}
                        modifyNotebookScripts={props.modifyNotebookScripts}
                        navigationDisabled={showDetails}
                        navigationLevel={treeNavigationLevel}
                        onSelectFolderLevel={() => setTreeNavigationLevel('folders')}
                        onSelectScriptLevel={() => setTreeNavigationLevel('scripts')}
                        onSelectPreviousTreeItem={selectPreviousTreeItem}
                        onSelectNextTreeItem={selectNextTreeItem}
                        listItem
                    />
                )}
            />
            <NotebookFileTree
                notebookScripts={props.notebookScripts}
                modifyNotebookScripts={props.modifyNotebookScripts}
                catalogTab={catalogTab}
                navigationLevel={treeNavigationLevel}
                showCatalogEntries={props.connection != null}
                onSelectFolder={(folderName) => {
                    setTreeNavigationLevel('scripts');
                    selectFolder(folderName);
                    if (closeAfterSelection) setNavigationDrawerOpen(false);
                }}
                onSelectScript={(folderName, fileName) => {
                    selectScript(folderName, fileName);
                    if (closeAfterSelection) setNavigationDrawerOpen(false);
                }}
                onSelectCatalog={(tab) => {
                    selectCatalog(tab);
                    if (closeAfterSelection) setNavigationDrawerOpen(false);
                }}
                onAddFolder={() => {
                    if (showDetails && catalogTab == null) return;
                    props.modifyNotebookScripts({ type: CREATE_SCRIPT_FOLDER, value: null });
                    setCatalogTab(null);
                    setShowDetails(false);
                }}
            />
        </div>
    );

    return (
        <div className={styles.page}>
            <header className={styles.mobile_header} data-tauri-drag-region="deep">
                <IconButton ref={navigationDrawerTriggerRef} variant={ButtonVariant.Default} aria-label="Open notebook navigation" onClick={() => setNavigationDrawerOpen(true)}>
                    <ThreeBarsIcon />
                </IconButton>
            </header>
            <aside className={styles.navigation_sidebar}>
                {fileTree(false)}
            </aside>
            <main className={styles.body_container} id="notebook-body">
                <div className={feedActive ? styles.feed_layer : styles.feed_layer_hidden}>
                    <NotebookFeed
                        notebookScripts={props.notebookScripts}
                        modifyNotebookScripts={props.modifyNotebookScripts}
                        active={feedActive}
                        showDetails={(fileName?: string, initialTab?: DetailsTabKey) => {
                            const targetFileName = fileName ?? props.notebookScripts.scriptFocus.fileName;
                            setDetailsScriptId(props.notebookScripts.scriptFolders[props.notebookScripts.scriptFocus.folderName]?.scripts[targetFileName]?.scriptId);
                            setDetailsInitialTab(initialTab);
                            setShowDetails(true);
                        }}
                        scrollTarget={feedScrollTarget}
                        conn={props.connection}
                        openConnectionOverlay={() => props.openConnectionOverlay()}
                    />
                </div>
                {catalogTab === 'relations' && props.connection
                    ? <CatalogSchemaView connection={props.connection} />
                    : catalogTab === 'functions' && props.connection
                        ? <CatalogFunctionsView connection={props.connection} />
                        : showDetails
                            ? <ScriptDetails
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
                                    if (!target?.folderName || !target.fileName) return;
                                    props.modifyNotebookScripts({
                                        type: SELECT_SCRIPT_PATH,
                                        value: { folderName: target.folderName, fileName: target.fileName },
                                    });
                                    setDetailsScriptId(scriptKey);
                                    setDetailsInitialTab(undefined);
                                }}
                            />
                            : null}
            </main>
            {navigationDrawerOpen && (
                <NotebookNavigationDrawer open onClose={() => setNavigationDrawerOpen(false)} returnFocusRef={navigationDrawerTriggerRef}>
                    {fileTree(true)}
                </NotebookNavigationDrawer>
            )}
        </div>
    );
};
