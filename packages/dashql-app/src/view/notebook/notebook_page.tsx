import * as React from 'react';
import * as styles from './notebook_page.module.css';

import { ThreeBarsIcon } from '@primer/octicons-react';

import { ConnectionHealth } from '../../connection/connection_state.js';
import { ConnectionSettingsOverlay } from '../connection/connection_settings_overlay.js';
import { ButtonVariant, IconButton } from '../foundations/button.js';
import { KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { useNotebookRegistry, useNotebookState } from '../../notebook/notebook_state_registry.js';
import { CREATE_PAGE, SELECT_NEXT_ENTRY, SELECT_NEXT_PAGE, SELECT_NOTEBOOK_PATH, SELECT_PAGE, SELECT_PREV_ENTRY, SELECT_PREV_PAGE, getSortedFolderNames } from '../../notebook/notebook_state.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useRouteContext, useRouterNavigate, NOTEBOOK_PATH, CHANGE_SESSION } from '../../router.js';

import { CatalogSchemaView } from './catalog_schema_view.js';
import { CatalogFunctionsView } from './catalog_functions_view.js';
import { NotebookScriptDetails, TabKey as DetailsTabKey } from './notebook_script_details.js';
import { NotebookScriptFeed } from './notebook_script_feed.js';
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
    const notebookRegistry = useNotebookRegistry()[0];
    const [notebook, modifyNotebook] = useNotebookState(route.sessionId ?? null);
    const [conn, _modifyConn] = useConnectionState(notebook?.sessionId ?? null);
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
    const lastScrolledFolderRef = React.useRef(notebook?.notebookUserFocus.folderName ?? '');
    const restoreSelectedFeedScroll = React.useCallback(() => {
        requestFeedScroll(notebook?.notebookUserFocus.fileName ?? '');
    }, [notebook?.notebookUserFocus.fileName, requestFeedScroll]);

    const keyHandlers = React.useMemo<KeyEventHandler[]>(
        () => [
            {
                key: 'Escape',
                ctrlKey: false,
                callback: () => {
                    if (catalogTab != null) {
                        setCatalogTab(null);
                        setShowDetails(false);
                        if (notebook) {
                            const folders = getSortedFolderNames(notebook.notebookPages);
                            if (folders.length > 0 && notebook.notebookUserFocus.folderName !== folders[0]) {
                                modifyNotebook({ type: SELECT_PAGE, value: folders[0] });
                            }
                        }
                        return;
                    }
                    if (showDetails) return;
                    // Only leave for the session selector when nothing holds focus. If the user
                    // is in the compose editor (SQL/AI mode) or has tabbed onto a button, Escape
                    // should first surrender that focus; a second Escape — with nothing focused —
                    // then navigates back to the session selector.
                    const active = document.activeElement as HTMLElement | null;
                    if (active && active !== document.body && active !== document.documentElement) {
                        active.blur();
                        return;
                    }
                    navigate({ type: CHANGE_SESSION, value: null });
                },
            },
            {
                key: 'l',
                ctrlKey: true,
                callback: (event) => {
                    if (showDetails || catalogTab != null || notebook == null) return;
                    prepareForNotebookTreeNavigation(event);
                    setTreeNavigationLevel('scripts');
                },
            },
            {
                key: 'h',
                ctrlKey: true,
                callback: (event) => {
                    if (showDetails || catalogTab != null || notebook == null) return;
                    prepareForNotebookTreeNavigation(event);
                    setTreeNavigationLevel('folders');
                },
            },
            {
                key: 'j',
                ctrlKey: true,
                callback: (event) => {
                    if (showDetails || catalogTab != null || notebook == null) return;
                    prepareForNotebookTreeNavigation(event);
                    modifyNotebook({
                        type: treeNavigationLevel === 'folders' ? SELECT_NEXT_PAGE : SELECT_NEXT_ENTRY,
                        value: null,
                    });
                },
            },
            {
                key: 'k',
                ctrlKey: true,
                callback: (event) => {
                    if (showDetails || catalogTab != null || notebook == null) return;
                    prepareForNotebookTreeNavigation(event);
                    modifyNotebook({
                        type: treeNavigationLevel === 'folders' ? SELECT_PREV_PAGE : SELECT_PREV_ENTRY,
                        value: null,
                    });
                },
            },
        ],
        [catalogTab, showDetails, notebook, modifyNotebook, navigate, treeNavigationLevel],
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
        if (showDetails || notebook == null) {
            return;
        }
        const folderName = notebook.notebookUserFocus.folderName;
        const folderChanged = folderName !== lastScrolledFolderRef.current;
        lastScrolledFolderRef.current = folderName;
        requestFeedScroll(folderChanged ? '' : notebook.notebookUserFocus.fileName);
    }, [notebook?.notebookUserFocus.interactionCounter, requestFeedScroll, showDetails]);

    React.useEffect(() => {
        if (route.sessionId === null) {
            if (route.sessionId !== null) {
                const sessionId = notebookRegistry.notebooksByConnection.get(route.sessionId);
                if (sessionId) {
                    navigate({
                        type: NOTEBOOK_PATH,
                        value: sessionId
                    });
                }
            } else {
                logger.warn('missing session id', {}, LOG_CTX);
            }
        }
    }, [route.sessionId]);

    if (route.sessionId === null || notebook == null) {
        return <div />;
    }
    // The feed sits below the catalog/details overlay and is the visible, interactive layer only
    // when neither a catalog tab nor the details view is open. While hidden it must not react to the
    // global feed key handlers (Enter/Escape/…), so this flag is threaded down to gate them.
    const feedActive = catalogTab == null && !showDetails;
    const selectFolder = (folderName: string) => {
        const folderChanged = folderName !== notebook.notebookUserFocus.folderName;
        const isSelected = catalogTab == null && !folderChanged;
        setCatalogTab(null);
        if (!isSelected) {
            if (folderChanged) requestFeedScroll('');
            modifyNotebook({ type: SELECT_PAGE, value: folderName });
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
        modifyNotebook({ type: SELECT_NOTEBOOK_PATH, value: { folderName, fileName } });
    };
    const selectCatalog = (tab: CatalogTab) => {
        if (showDetails && catalogTab == null) return;
        setCatalogTab(tab);
        setShowDetails(true);
    };
    const selectPreviousTreeItem = () => modifyNotebook({
        type: treeNavigationLevel === 'folders' ? SELECT_PREV_PAGE : SELECT_PREV_ENTRY,
        value: null,
    });
    const selectNextTreeItem = () => modifyNotebook({
        type: treeNavigationLevel === 'folders' ? SELECT_NEXT_PAGE : SELECT_NEXT_ENTRY,
        value: null,
    });
    const fileTree = (closeAfterSelection: boolean) => (
        <div className={styles.file_navigation}>
            <NotebookConnectionSection
                conn={conn ?? null}
                notebook={notebook}
                onOpenSettings={(anchor) => {
                    connectionSettingsAnchorRef.current = anchor;
                    setConnectionOverlayOpen(true);
                }}
                actions={(
                    <NotebookActionMenu
                        conn={conn ?? null}
                        notebook={notebook}
                        modifyNotebook={modifyNotebook}
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
                notebook={notebook}
                modifyNotebook={modifyNotebook}
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
                    modifyNotebook({ type: CREATE_PAGE, value: null });
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
                    <NotebookScriptFeed notebook={notebook} modifyNotebook={modifyNotebook} active={feedActive} showDetails={(fileName?: string, initialTab?: DetailsTabKey) => { const targetFileName = fileName ?? notebook.notebookUserFocus.fileName; setDetailsScriptId(notebook.notebookPages[notebook.notebookUserFocus.folderName]?.scripts[targetFileName]?.scriptId); setDetailsInitialTab(initialTab); setShowDetails(true); }} scrollTarget={feedScrollTarget} conn={conn ?? null} openConnectionOverlay={() => setConnectionOverlayOpen(true)} />
                </div>
                {
                    catalogTab === 'relations' && conn
                        ? <CatalogSchemaView connection={conn} />
                        : catalogTab === 'functions' && conn
                            ? <CatalogFunctionsView connection={conn} />
                            : showDetails
                                ? <NotebookScriptDetails notebook={notebook} modifyNotebook={modifyNotebook} connection={conn} hideDetails={() => { setShowDetails(false); setDetailsScriptId(undefined); setDetailsInitialTab(undefined); }} scriptId={detailsScriptId} initialTab={detailsInitialTab} />
                                : null
                }
            </main>
            {navigationDrawerOpen && (
                <NotebookNavigationDrawer open onClose={() => setNavigationDrawerOpen(false)} returnFocusRef={navigationDrawerTriggerRef}>
                    {fileTree(true)}
                </NotebookNavigationDrawer>
            )}
            <ConnectionSettingsOverlay
                sessionId={route.sessionId}
                isOpen={connectionOverlayOpen}
                onClose={() => setConnectionOverlayOpen(false)}
                anchorRef={connectionSettingsAnchorRef}
            />
        </div>
    );
};
