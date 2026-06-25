import * as React from 'react';
import * as styles from './notebook_page.module.css';

import { LinkIcon, PaperAirplaneIcon, SyncIcon, ThreeBarsIcon } from '@primer/octicons-react';

import * as ActionList from '../foundations/action_list.js';
import { ConnectionHealth } from '../../connection/connection_state.js';
import { ConnectionStatus } from '../connection/connection_status.js';
import { ConnectionSettingsOverlay } from '../connection/connection_settings_overlay.js';
import { ButtonGroup } from '../foundations/button_group.js';
import { ButtonSize, ButtonVariant, IconButton } from '../foundations/button.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { useNotebookRegistry, useNotebookState } from '../../notebook/notebook_state_registry.js';
import { CREATE_PAGE, SELECT_NEXT_ENTRY, SELECT_NEXT_PAGE, SELECT_PAGE, SELECT_PREV_ENTRY, SELECT_PREV_PAGE, UPDATE_PAGE_FOLDER_NAME, getSortedFolderNames } from '../../notebook/notebook_state.js';
import { NotebookCommandType, useNotebookCommandDispatch } from '../../notebook/notebook_commands.js';
import { NotebookURLShareOverlay } from './notebook_url_share_overlay.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useRouteContext, useRouterNavigate, NOTEBOOK_PATH, CHANGE_SESSION } from '../../router.js';

import { CatalogSchemaView } from './catalog_schema_view.js';
import { CatalogFunctionsView } from './catalog_functions_view.js';
import { ConnectionCommandList, NotebookCommandList } from './notebook_command_lists.js';
import { NotebookScriptDetails, TabKey as DetailsTabKey } from './notebook_script_details.js';
import { NotebookScriptFeed } from './notebook_script_feed.js';

const LOG_CTX = 'notebook_page';

type CatalogTab = 'relations' | 'functions';

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
    const [sharingIsOpen, setSharingIsOpen] = React.useState<boolean>(false);
    const [connectionOverlayOpen, setConnectionOverlayOpen] = React.useState<boolean>(false);
    const [showDetails, setShowDetails] = React.useState<boolean>(false);
    const [detailsInitialTab, setDetailsInitialTab] = React.useState<DetailsTabKey | undefined>(undefined);
    const [feedScrollTarget, setFeedScrollTarget] = React.useState<FeedScrollTarget | null>(null);
    const [catalogTab, setCatalogTab] = React.useState<CatalogTab | null>(null);
    const [editingFolder, setEditingFolder] = React.useState<string | null>(null);
    const [editingPageTitle, setEditingPageTitle] = React.useState<string>("");
    const editInputRef = React.useRef<HTMLInputElement>(null);
    const connectionStatusRef = React.useRef<HTMLButtonElement>(null);

    const sessionCommand = useNotebookCommandDispatch();
    const requestFeedScroll = React.useCallback((fileName: string) => {
        setFeedScrollTarget(prev => ({
            fileName,
            version: (prev?.version ?? 0) + 1,
        }));
    }, []);
    const restoreSelectedFeedScroll = React.useCallback(() => {
        requestFeedScroll(notebook?.notebookUserFocus.fileName ?? '');
    }, [notebook?.notebookUserFocus.fileName, requestFeedScroll]);

    const startEditingPage = React.useCallback((folderName: string, currentTitle: string, event: React.MouseEvent) => {
        event.stopPropagation();
        setEditingFolder(folderName);
        setEditingPageTitle(currentTitle);
    }, []);

    const savePageEdit = React.useCallback(() => {
        if (editingFolder === null) return;

        const page = notebook?.notebookPages[editingFolder];
        if (page) {
            // Update the page's folder name
            modifyNotebook({
                type: UPDATE_PAGE_FOLDER_NAME,
                value: { folderName: editingFolder, newFolderName: editingPageTitle.trim() || 'Untitled' }
            });
        }

        setEditingFolder(null);
        setEditingPageTitle("");
    }, [editingFolder, editingPageTitle, notebook, modifyNotebook]);

    const cancelPageEdit = React.useCallback(() => {
        setEditingFolder(null);
        setEditingPageTitle("");
    }, []);

    const handleEditKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            savePageEdit();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            cancelPageEdit();
        }
    }, [savePageEdit, cancelPageEdit]);

    // Focus input when entering edit mode
    React.useEffect(() => {
        if (editingFolder !== null && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingFolder]);

    const keyHandlers = React.useMemo<KeyEventHandler[]>(
        () => [
            {
                key: 'Escape',
                ctrlKey: false,
                callback: () => {
                    if (editingFolder !== null) return;
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
            // Tab navigation across the combined bar: [page tabs..., relations, functions].
            // The meta tabs (relations/functions) only exist when a connection is present, so they
            // are only reachable then. Stepping past the last page tab jumps to the first meta tab,
            // and stepping left off the first meta tab returns to the last page tab.
            {
                key: 'l',
                ctrlKey: true,
                callback: () => {
                    if (editingFolder !== null || notebook == null) return;
                    if (catalogTab === 'functions') return; // already the right-most tab
                    if (catalogTab === 'relations') { setCatalogTab('functions'); return; }
                    // Currently on a page tab; step into the meta tabs only from the last page.
                    const folders = getSortedFolderNames(notebook.notebookPages);
                    const cur = folders.indexOf(notebook.notebookUserFocus.folderName);
                    if (conn && folders.length > 0 && cur === folders.length - 1) {
                        setCatalogTab('relations');
                        setShowDetails(true);
                        return;
                    }
                    modifyNotebook({ type: SELECT_NEXT_PAGE, value: null });
                },
            },
            {
                key: 'h',
                ctrlKey: true,
                callback: () => {
                    if (editingFolder !== null || notebook == null) return;
                    if (catalogTab === 'functions') { setCatalogTab('relations'); return; }
                    if (catalogTab === 'relations') {
                        // Stepping left off the first meta tab lands on the last page tab.
                        const folders = getSortedFolderNames(notebook.notebookPages);
                        setCatalogTab(null);
                        setShowDetails(false);
                        const last = folders[folders.length - 1];
                        if (last != null && last !== notebook.notebookUserFocus.folderName) {
                            modifyNotebook({ type: SELECT_PAGE, value: last });
                        }
                        return;
                    }
                    modifyNotebook({ type: SELECT_PREV_PAGE, value: null });
                },
            },
            // Feed navigation: step the selected entry within the current page. Only meaningful
            // when the feed is showing, so it is a no-op while a meta tab is open or a page title
            // is being edited (mirrors the page-bar handlers above).
            {
                key: 'j',
                ctrlKey: true,
                callback: () => {
                    if (editingFolder !== null || catalogTab != null || notebook == null) return;
                    modifyNotebook({ type: SELECT_NEXT_ENTRY, value: null });
                },
            },
            {
                key: 'k',
                ctrlKey: true,
                callback: () => {
                    if (editingFolder !== null || catalogTab != null || notebook == null) return;
                    modifyNotebook({ type: SELECT_PREV_ENTRY, value: null });
                },
            },
        ],
        [catalogTab, showDetails, editingFolder, notebook, modifyNotebook, navigate, conn],
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
        requestFeedScroll(notebook.notebookUserFocus.fileName);
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
    const isDisconnected = conn?.connectionHealth !== ConnectionHealth.ONLINE;
    return (
        <div className={styles.page}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.page_title}>Notebook</div>
                </div>
                <div className={styles.header_right_container}>
                    {conn && <ConnectionStatus conn={conn} sessionId={route.sessionId} onClick={() => setConnectionOverlayOpen(true)} compact />}
                </div>
                <div className={styles.header_action_container}>
                    <div>
                        <ButtonGroup>
                            {catalogTab == null && (
                                <IconButton
                                    variant={ButtonVariant.Default}
                                    aria-label="Execute Query"
                                    disabled={isDisconnected}
                                    onClick={() => sessionCommand(NotebookCommandType.ExecuteEditorQuery)}
                                >
                                    <PaperAirplaneIcon />
                                </IconButton>
                            )}
                            <IconButton
                                variant={ButtonVariant.Default}
                                aria-label="Refresh Schema"
                                disabled={isDisconnected}
                                onClick={() => sessionCommand(NotebookCommandType.RefreshCatalog)}
                            >
                                <SyncIcon />
                            </IconButton>
                            <IconButton
                                variant={ButtonVariant.Default}
                                aria-label="Share Notebook"
                                onClick={() => setSharingIsOpen(s => !s)}
                            >
                                <LinkIcon />
                            </IconButton>
                        </ButtonGroup>
                        <NotebookURLShareOverlay isOpen={sharingIsOpen} setIsOpen={setSharingIsOpen} />
                    </div>
                    <IconButton variant={ButtonVariant.Default} aria-label="Open Notebook Actions">
                        <ThreeBarsIcon />
                    </IconButton>
                </div>
            </div>
            <div className={styles.page_tabs_container}>
                <div className={styles.page_tabs} role="tablist" aria-label="Notebook pages">
                    {getSortedFolderNames(notebook.notebookPages).map((folderName) => {
                        const page = notebook.notebookPages[folderName];
                        const isSelected = catalogTab == null && folderName === notebook.notebookUserFocus.folderName;
                        const isEditing = editingFolder === folderName;
                        const label = page.folderName || 'Untitled';

                        const PencilIcon = SymbolIcon('pencil_16');
                        const canEdit = true; // Allow editing folder name for all pages

                        return (
                            <div
                                key={folderName}
                                className={isSelected ? styles.page_tab_selected : styles.page_tab}
                                onClick={() => {
                                    if (isEditing) return; // Don't change page while editing
                                    setCatalogTab(null);
                                    if (isSelected) {
                                        setShowDetails(false);
                                    } else {
                                        modifyNotebook({ type: SELECT_PAGE, value: folderName });
                                        setShowDetails(false);
                                    }
                                }}
                            >
                                <div className={styles.page_tab_button}>
                                    {isEditing ? (
                                        <input
                                            ref={editInputRef}
                                            type="text"
                                            className={styles.page_tab_input}
                                            value={editingPageTitle}
                                            onChange={(e) => setEditingPageTitle(e.target.value)}
                                            onBlur={savePageEdit}
                                            onKeyDown={handleEditKeyDown}
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                    ) : (
                                        <>
                                            <span className={styles.page_tab_label}>{label}</span>
                                            <div className={styles.page_tab_actions}>
                                                {canEdit && (
                                                    <IconButton
                                                        variant={ButtonVariant.Invisible}
                                                        size={ButtonSize.Tiny}
                                                        aria-label="Rename page"
                                                        onClick={(e) => startEditingPage(folderName, label, e)}
                                                        className={styles.page_tab_action_button}
                                                    >
                                                        <PencilIcon size={12} />
                                                    </IconButton>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    <button
                        type="button"
                        className={styles.page_tab_add}
                        aria-label="Add page"
                        onClick={() => {
                            modifyNotebook({ type: CREATE_PAGE, value: null });
                            setCatalogTab(null);
                            setShowDetails(false);
                        }}
                    >
                        +
                    </button>
                    {conn && (
                        <div
                            className={catalogTab === 'relations' ? styles.catalog_tab_selected : styles.catalog_tab}
                            onClick={() => {
                                setCatalogTab('relations');
                                setShowDetails(true);
                            }}
                        >
                            <div className={styles.page_tab_button}>
                                <span className={styles.page_tab_label}>relations</span>
                            </div>
                        </div>
                    )}
                    {conn && (
                        <div
                            className={catalogTab === 'functions' ? styles.functions_tab_selected : styles.functions_tab}
                            onClick={() => {
                                setCatalogTab('functions');
                                setShowDetails(true);
                            }}
                        >
                            <div className={styles.page_tab_button}>
                                <span className={styles.page_tab_label}>functions</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            <div className={styles.body_container} id="notebook-body" role="tabpanel" aria-labelledby={notebook.notebookUserFocus.folderName ? `notebook-page-tab-${notebook.notebookUserFocus.folderName}` : undefined}>
                {
                    catalogTab === 'relations' && conn
                        ? <CatalogSchemaView connection={conn} />
                        : catalogTab === 'functions' && conn
                            ? <CatalogFunctionsView connection={conn} />
                            : showDetails
                                ? <NotebookScriptDetails notebook={notebook} modifyNotebook={modifyNotebook} connection={conn} hideDetails={() => { setShowDetails(false); setDetailsInitialTab(undefined); }} initialTab={detailsInitialTab} />
                                : <NotebookScriptFeed notebook={notebook} modifyNotebook={modifyNotebook} showDetails={(initialTab?: DetailsTabKey) => { setDetailsInitialTab(initialTab); setShowDetails(true); }} scrollTarget={feedScrollTarget} conn={conn ?? null} openConnectionOverlay={() => setConnectionOverlayOpen(true)} />
                }
            </div>
            <div className={styles.action_sidebar}>
                <div className={styles.action_sidebar_header}>
                    {conn && <ConnectionStatus ref={connectionStatusRef} conn={conn} sessionId={route.sessionId} onClick={() => setConnectionOverlayOpen(true)} />}
                </div>
                <div className={styles.action_sidebar_body}>
                    <ActionList.List aria-label="Actions">
                        <ActionList.GroupHeading>Connection</ActionList.GroupHeading>
                        <ConnectionCommandList
                            conn={conn ?? null}
                            notebook={notebook}
                        />
                        <ActionList.GroupHeading>Notebook</ActionList.GroupHeading>
                        <NotebookCommandList
                            conn={conn ?? null}
                            notebook={notebook}
                            modifyNotebook={modifyNotebook}
                        />
                    </ActionList.List>
                </div>
            </div>
            <ConnectionSettingsOverlay
                sessionId={route.sessionId}
                isOpen={connectionOverlayOpen}
                onClose={() => setConnectionOverlayOpen(false)}
                anchorRef={connectionStatusRef}
            />
        </div>
    );
};
