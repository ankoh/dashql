import * as React from 'react';
import * as styles from './notebook_page.module.css';

import { ThreeBarsIcon } from '@primer/octicons-react';

import { ConnectionHealth } from '../../connection/connection_state.js';
import { ConnectionSettingsOverlay } from '../connection/connection_settings_overlay.js';
import { ButtonVariant, IconButton } from '../foundations/button.js';
import { KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { useNotebookScriptsRegistry, useNotebookScripts } from '../../scripts/notebook_scripts_registry.js';
import { CREATE_SCRIPT_FOLDER, SELECT_NEXT_SCRIPT, SELECT_NEXT_SCRIPT_FOLDER, SELECT_SCRIPT_PATH, SELECT_SCRIPT_FOLDER, SELECT_PREV_SCRIPT, SELECT_PREV_SCRIPT_FOLDER, getSortedScriptFolderNames } from '../../scripts/notebook_scripts.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useRouteContext, useRouterNavigate, NOTEBOOK_PATH, CHANGE_NOTEBOOK } from '../../router.js';

import { CatalogSchemaView } from './catalog_schema_view.js';
import { CatalogFunctionsView } from './catalog_functions_view.js';
import { ScriptDetails, TabKey as DetailsTabKey } from './script_details.js';
import { NotebookFeed } from './notebook_feed.js';
import { NotebookFileTree, type NotebookFileTreeCatalogTab as CatalogTab, type NotebookFileTreeNavigationLevel } from './notebook_file_tree.js';
import { NotebookActionMenu } from './notebook_action_menu.js';
import { NotebookNavigationDrawer } from './notebook_navigation_drawer.js';
import { NotebookConnectionSection } from './notebook_connection_section.js';
import { prepareForNotebookTreeNavigation } from './notebook_navigation_keyboard.js';

const LOG_CTX = 'notebook_page';

interface FeedScrollTarget {
    fileName: string;
    version: number;
}

interface Props { }

export const NotebookPage: React.FC<Props> = (_props: Props) => {
    const route = useRouteContext();
    const navigate = useRouterNavigate();
    const logger = useLogger();
    const notebookScriptsRegistry = useNotebookScriptsRegistry()[0];
    const [notebookScripts, modifyNotebookScripts] = useNotebookScripts(route.notebookId ?? null);
    const [conn, _modifyConn] = useConnectionState(notebookScripts?.notebookId ?? null);
    const [connectionOverlayOpen, setConnectionOverlayOpen] = React.useState<boolean>(false);
    const [showDetails, setShowDetails] = React.useState<boolean>(false);
    const [detailsScriptId, setDetailsScriptId] = React.useState<number | undefined>(undefined);
    const [detailsInitialTab, setDetailsInitialTab] = React.useState<DetailsTabKey | undefined>(undefined);
    const [feedScrollTarget, setFeedScrollTarget] = React.useState<FeedScrollTarget | null>(null);
    const [catalogTab, setCatalogTab] = React.useState<CatalogTab | null>(null);
    const [navigationDrawerOpen, setNavigationDrawerOpen] = React.useState(false);
    const [treeNavigationLevel, setTreeNavigationLevel] = React.useState<NotebookFileTreeNavigationLevel>('scripts');
    const navigationDrawerTriggerRef = React.useRef<HTMLButtonElement>(null);
    const connectionSettingsAnchorRef = React.useRef<HTMLButtonElement>(null);
    const requestFeedScroll = React.useCallback((fileName: string) => {
        setFeedScrollTarget(prev => ({
            fileName,
            version: (prev?.version ?? 0) + 1,
        }));
    }, []);
    const lastScrolledFolderRef = React.useRef(notebookScripts?.scriptFocus.folderName ?? '');
    const restoreSelectedFeedScroll = React.useCallback(() => {
        requestFeedScroll(notebookScripts?.scriptFocus.fileName ?? '');
    }, [notebookScripts?.scriptFocus.fileName, requestFeedScroll]);

    const keyHandlers = React.useMemo<KeyEventHandler[]>(
        () => [
            {
                key: 'Escape',
                ctrlKey: false,
                callback: () => {
                    if (catalogTab != null) {
                        setCatalogTab(null);
                        setShowDetails(false);
                        if (notebookScripts) {
                            const folders = getSortedScriptFolderNames(notebookScripts.scriptFolders);
                            if (folders.length > 0 && notebookScripts.scriptFocus.folderName !== folders[0]) {
                                modifyNotebookScripts({ type: SELECT_SCRIPT_FOLDER, value: folders[0] });
                            }
                        }
                        return;
                    }
                    if (showDetails) return;
                    // Only leave for the notebook selector when nothing holds focus. If the user
                    // is in the compose editor (SQL/AI mode) or has tabbed onto a button, Escape
                    // should first surrender that focus; a second Escape — with nothing focused —
                    // then navigates back to the notebook selector.
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
                    if (showDetails || catalogTab != null || notebookScripts == null) return;
                    prepareForNotebookTreeNavigation(event);
                    setTreeNavigationLevel('scripts');
                },
            },
            {
                key: 'h',
                ctrlKey: true,
                callback: (event) => {
                    if (showDetails || catalogTab != null || notebookScripts == null) return;
                    prepareForNotebookTreeNavigation(event);
                    setTreeNavigationLevel('folders');
                },
            },
            {
                key: 'j',
                ctrlKey: true,
                callback: (event) => {
                    if (showDetails || catalogTab != null || notebookScripts == null) return;
                    prepareForNotebookTreeNavigation(event);
                    modifyNotebookScripts({
                        type: treeNavigationLevel === 'folders' ? SELECT_NEXT_SCRIPT_FOLDER : SELECT_NEXT_SCRIPT,
                        value: null,
                    });
                },
            },
            {
                key: 'k',
                ctrlKey: true,
                callback: (event) => {
                    if (showDetails || catalogTab != null || notebookScripts == null) return;
                    prepareForNotebookTreeNavigation(event);
                    modifyNotebookScripts({
                        type: treeNavigationLevel === 'folders' ? SELECT_PREV_SCRIPT_FOLDER : SELECT_PREV_SCRIPT,
                        value: null,
                    });
                },
            },
        ],
        [catalogTab, showDetails, notebookScripts, modifyNotebookScripts, navigate, treeNavigationLevel],
    );
    useKeyEvents(keyHandlers);

    // Auto-close the connection settings overlay once a connect attempt succeeds
    const prevConnectionHealth = React.useRef<ConnectionHealth | null>(null);
    React.useEffect(() => {
        const health = conn?.connectionHealth ?? null;
        if (
            connectionOverlayOpen &&
            prevConnectionHealth.current === ConnectionHealth.CONNECTING &&
            health === ConnectionHealth.ONLINE
        ) {
            setConnectionOverlayOpen(false);
        }
        prevConnectionHealth.current = health;
    }, [conn?.connectionHealth, connectionOverlayOpen]);

    React.useEffect(() => {
        if (showDetails || notebookScripts == null) {
            return;
        }
        const folderName = notebookScripts.scriptFocus.folderName;
        const folderChanged = folderName !== lastScrolledFolderRef.current;
        lastScrolledFolderRef.current = folderName;
        requestFeedScroll(folderChanged ? '' : notebookScripts.scriptFocus.fileName);
    }, [notebookScripts?.scriptFocus.interactionCounter, requestFeedScroll, showDetails]);

    React.useEffect(() => {
        if (route.notebookId === null) {
            if (route.notebookId !== null) {
                const notebookId = notebookScriptsRegistry.notebookScriptsByConnection.get(route.notebookId);
                if (notebookId) {
                    navigate({
                        type: NOTEBOOK_PATH,
                        value: notebookId
                    });
                }
            } else {
                logger.warn('missing notebook id', {}, LOG_CTX);
            }
        }
    }, [route.notebookId]);

    if (route.notebookId === null || notebookScripts == null) {
        return <div />;
    }
    // The feed sits below the catalog/details overlay and is the visible, interactive layer only
    // when neither a catalog tab nor the details view is open. While hidden it must not react to the
    // global feed key handlers (Enter/Escape/…), so this flag is threaded down to gate them.
    const feedActive = catalogTab == null && !showDetails;
    const selectFolder = (folderName: string) => {
        const folderChanged = folderName !== notebookScripts.scriptFocus.folderName;
        const isSelected = catalogTab == null && !folderChanged;
        setCatalogTab(null);
        if (!isSelected) {
            if (folderChanged) requestFeedScroll('');
            modifyNotebookScripts({ type: SELECT_SCRIPT_FOLDER, value: folderName });
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
        modifyNotebookScripts({ type: SELECT_SCRIPT_PATH, value: { folderName, fileName } });
    };
    const selectCatalog = (tab: CatalogTab) => {
        if (showDetails && catalogTab == null) return;
        setCatalogTab(tab);
        setShowDetails(true);
    };
    const selectPreviousTreeItem = () => modifyNotebookScripts({
        type: treeNavigationLevel === 'folders' ? SELECT_PREV_SCRIPT_FOLDER : SELECT_PREV_SCRIPT,
        value: null,
    });
    const selectNextTreeItem = () => modifyNotebookScripts({
        type: treeNavigationLevel === 'folders' ? SELECT_NEXT_SCRIPT_FOLDER : SELECT_NEXT_SCRIPT,
        value: null,
    });
    const fileTree = (closeAfterSelection: boolean) => (
        <div className={styles.file_navigation}>
            <NotebookConnectionSection
                conn={conn ?? null}
                notebookScripts={notebookScripts}
                onOpenSettings={(anchor) => {
                    connectionSettingsAnchorRef.current = anchor;
                    setConnectionOverlayOpen(true);
                }}
                actions={(
                    <NotebookActionMenu
                        conn={conn ?? null}
                        notebookScripts={notebookScripts}
                        modifyNotebookScripts={modifyNotebookScripts}
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
                notebookScripts={notebookScripts}
                modifyNotebookScripts={modifyNotebookScripts}
                catalogTab={catalogTab}
                navigationLevel={treeNavigationLevel}
                showCatalogEntries={conn != null}
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
                    modifyNotebookScripts({ type: CREATE_SCRIPT_FOLDER, value: null });
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
                {/*
                    The feed stays permanently mounted underneath the catalog/details overlay rather
                    than being swapped out by the ternary below. Opening Details used to unmount it and
                    returning remounted it cold — scroll position, react-window's measured row heights
                    and the container size all reset to zero — so the restore-scroll had to fight a
                    cold start and often landed short. Keeping it mounted (just hidden via CSS, which
                    still lays it out so its ResizeObserver keeps measuring) means it stays warm and the
                    user returns exactly where they left, matching Ctrl+H/J/K/L precision.
                */}
                <div className={feedActive ? styles.feed_layer : styles.feed_layer_hidden}>
                    <NotebookFeed notebookScripts={notebookScripts} modifyNotebookScripts={modifyNotebookScripts} active={feedActive} showDetails={(fileName?: string, initialTab?: DetailsTabKey) => { const targetFileName = fileName ?? notebookScripts.scriptFocus.fileName; setDetailsScriptId(notebookScripts.scriptFolders[notebookScripts.scriptFocus.folderName]?.scripts[targetFileName]?.scriptId); setDetailsInitialTab(initialTab); setShowDetails(true); }} scrollTarget={feedScrollTarget} conn={conn ?? null} openConnectionOverlay={() => setConnectionOverlayOpen(true)} />
                </div>
                {
                    catalogTab === 'relations' && conn
                        ? <CatalogSchemaView connection={conn} />
                        : catalogTab === 'functions' && conn
                            ? <CatalogFunctionsView connection={conn} />
                            : showDetails
                                ? <ScriptDetails notebookScripts={notebookScripts} modifyNotebookScripts={modifyNotebookScripts} connection={conn} hideDetails={() => { setShowDetails(false); setDetailsScriptId(undefined); setDetailsInitialTab(undefined); }} scriptId={detailsScriptId} initialTab={detailsInitialTab} />
                                : null
                }
            </main>
            {navigationDrawerOpen && (
                <NotebookNavigationDrawer open onClose={() => setNavigationDrawerOpen(false)} returnFocusRef={navigationDrawerTriggerRef}>
                    {fileTree(true)}
                </NotebookNavigationDrawer>
            )}
            <ConnectionSettingsOverlay
                notebookId={route.notebookId}
                isOpen={connectionOverlayOpen}
                onClose={() => setConnectionOverlayOpen(false)}
                anchorRef={connectionSettingsAnchorRef}
            />
        </div>
    );
};
