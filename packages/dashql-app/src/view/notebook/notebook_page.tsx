import * as React from 'react';
import * as styles from './notebook_page.module.css';

import { PaperAirplaneIcon, SparklesFillIcon, SyncIcon, ThreeBarsIcon } from '@primer/octicons-react';

import * as ActionList from '../foundations/action_list.js';
import { ConnectionHealth } from '../../connection/connection_state.js';
import { ConnectionStatus } from '../connection/connection_status.js';
import { ConnectionSettingsOverlay } from '../connection/connection_settings_overlay.js';
import { ButtonGroup } from '../foundations/button_group.js';
import { ButtonSize, ButtonVariant, IconButton } from '../foundations/button.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { useNotebookRegistry, useNotebookState } from '../../notebook/notebook_state_registry.js';
import { CREATE_PAGE, REORDER_PAGES, SELECT_NEXT_ENTRY, SELECT_NEXT_PAGE, SELECT_PAGE, SELECT_PREV_ENTRY, SELECT_PREV_PAGE, UPDATE_PAGE_FOLDER_NAME, getSortedFolderNames } from '../../notebook/notebook_state.js';
import { normalizePageName } from '../../notebook/notebook_types.js';
import { NotebookCommandType, useNotebookCommandDispatch } from '../../notebook/notebook_commands.js';
import { useAIClient } from '../../platform/ai_client_provider.js';
import {
    DndContext,
    DragEndEvent,
    KeyboardSensor,
    PointerSensor,
    closestCenter,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    SortableContext,
    arrayMove,
    horizontalListSortingStrategy,
    sortableKeyboardCoordinates,
    useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
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

interface SortablePageTabProps {
    /// The page's storage folder name (carries any ordering prefix); the sortable id and selection key.
    folderName: string;
    /// The display label (folder name with the ordering prefix stripped).
    label: string;
    isSelected: boolean;
    isEditing: boolean;
    editingPageTitle: string;
    editInputRef: React.RefObject<HTMLInputElement | null>;
    onSelect: () => void;
    onStartEditing: (event: React.MouseEvent) => void;
    onEditingTitleChange: (value: string) => void;
    onSavePageEdit: () => void;
    onEditKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}

/// A single draggable page tab. Split out because @dnd-kit's useSortable is a hook and must run
/// once per tab. Dragging is pointer/keyboard-driven; a plain click still selects the page because
/// the PointerSensor only starts a drag after a small activation distance (see the sensor config).
const SortablePageTab: React.FC<SortablePageTabProps> = (props) => {
    const PencilIcon = SymbolIcon('pencil_16');
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: props.folderName,
        // While the inline rename input is open, a drag would steal pointer/keyboard focus from it.
        disabled: props.isEditing,
    });
    const style: React.CSSProperties = {
        transform: CSS.Transform.toString(transform),
        transition,
        // Lift the dragged tab above its neighbours and hint the cursor.
        zIndex: isDragging ? 1 : undefined,
        opacity: isDragging ? 0.8 : undefined,
    };
    return (
        <div
            ref={setNodeRef}
            style={style}
            // Spread dnd-kit's attributes/listeners first so the tablist roles below win over
            // useSortable's default role="button".
            {...attributes}
            {...listeners}
            className={props.isSelected ? styles.page_tab_selected : styles.page_tab}
            role="tab"
            id={`notebook-page-tab-${props.folderName}`}
            aria-selected={props.isSelected}
            onClick={() => {
                if (props.isEditing) return; // Don't change page while editing
                props.onSelect();
            }}
        >
            <div className={styles.page_tab_button}>
                {props.isEditing ? (
                    <input
                        ref={props.editInputRef}
                        type="text"
                        className={styles.page_tab_input}
                        value={props.editingPageTitle}
                        onChange={(e) => props.onEditingTitleChange(e.target.value)}
                        onBlur={props.onSavePageEdit}
                        onKeyDown={props.onEditKeyDown}
                        onClick={(e) => e.stopPropagation()}
                        // The input lives inside a dnd listener; stop pointer events from arming a drag.
                        onPointerDown={(e) => e.stopPropagation()}
                        // A page name is an identifier, not prose: suppress the browser's text
                        // assistance so e.g. "random" isn't auto-capitalised to "Random".
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                    />
                ) : (
                    <>
                        <span className={styles.page_tab_label}>{props.label}</span>
                        <div className={styles.page_tab_actions}>
                            <IconButton
                                variant={ButtonVariant.Invisible}
                                size={ButtonSize.Tiny}
                                aria-label="Rename page"
                                onClick={props.onStartEditing}
                                // Don't let grabbing the pencil start a tab drag.
                                onPointerDown={(e) => e.stopPropagation()}
                                className={styles.page_tab_action_button}
                            >
                                <PencilIcon size={12} />
                            </IconButton>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export const NotebookPage: React.FC<Props> = (_props: Props) => {
    const route = useRouteContext();
    const navigate = useRouterNavigate();
    const logger = useLogger();
    const notebookRegistry = useNotebookRegistry()[0];
    const [notebook, modifyNotebook] = useNotebookState(route.sessionId ?? null);
    const [conn, _modifyConn] = useConnectionState(notebook?.sessionId ?? null);
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
    const aiAvailable = useAIClient() != null;
    const requestFeedScroll = React.useCallback((fileName: string) => {
        setFeedScrollTarget(prev => ({
            fileName,
            version: (prev?.version ?? 0) + 1,
        }));
    }, []);
    const restoreSelectedFeedScroll = React.useCallback(() => {
        requestFeedScroll(notebook?.notebookUserFocus.fileName ?? '');
    }, [notebook?.notebookUserFocus.fileName, requestFeedScroll]);

    // Page-tab drag-and-drop. The PointerSensor's activation distance lets a plain click through
    // to tab selection while still allowing a drag once the pointer moves a few pixels.
    const dndSensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );
    const handlePageDragEnd = React.useCallback((event: DragEndEvent) => {
        const { active, over } = event;
        if (notebook == null || over == null || active.id === over.id) return;
        const folders = getSortedFolderNames(notebook.notebookPages);
        const fromIndex = folders.indexOf(String(active.id));
        const toIndex = folders.indexOf(String(over.id));
        if (fromIndex < 0 || toIndex < 0) return;
        const reordered = arrayMove(folders, fromIndex, toIndex);
        modifyNotebook({ type: REORDER_PAGES, value: reordered });
    }, [notebook, modifyNotebook]);

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
    // The feed sits below the catalog/details overlay and is the visible, interactive layer only
    // when neither a catalog tab nor the details view is open. While hidden it must not react to the
    // global feed key handlers (Enter/Escape/…), so this flag is threaded down to gate them.
    const feedActive = catalogTab == null && !showDetails;
    return (
        <div className={styles.page}>
            <div className={styles.header_container} data-tauri-drag-region="deep">
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
                                    aria-label="Execute Script"
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
                                aria-label="Switch Mode"
                                disabled={!aiAvailable}
                                onClick={() => sessionCommand(NotebookCommandType.ToggleComposeInputMode)}
                            >
                                <SparklesFillIcon />
                            </IconButton>
                        </ButtonGroup>
                    </div>
                    <IconButton variant={ButtonVariant.Default} aria-label="Open Notebook Actions">
                        <ThreeBarsIcon />
                    </IconButton>
                </div>
            </div>
            <div className={styles.page_tabs_container}>
                <div className={styles.page_tabs} role="tablist" aria-label="Notebook pages">
                    <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handlePageDragEnd}>
                        <SortableContext items={getSortedFolderNames(notebook.notebookPages)} strategy={horizontalListSortingStrategy}>
                            {getSortedFolderNames(notebook.notebookPages).map((folderName) => {
                                const isSelected = catalogTab == null && folderName === notebook.notebookUserFocus.folderName;
                                const isEditing = editingFolder === folderName;
                                // The ordering prefix is an on-disk implementation detail; show the clean name.
                                const label = normalizePageName(folderName) || 'Untitled';
                                return (
                                    <SortablePageTab
                                        key={folderName}
                                        folderName={folderName}
                                        label={label}
                                        isSelected={isSelected}
                                        isEditing={isEditing}
                                        editingPageTitle={editingPageTitle}
                                        editInputRef={editInputRef}
                                        onSelect={() => {
                                            setCatalogTab(null);
                                            if (isSelected) {
                                                setShowDetails(false);
                                            } else {
                                                modifyNotebook({ type: SELECT_PAGE, value: folderName });
                                                setShowDetails(false);
                                            }
                                        }}
                                        onStartEditing={(e) => startEditingPage(folderName, label, e)}
                                        onEditingTitleChange={setEditingPageTitle}
                                        onSavePageEdit={savePageEdit}
                                        onEditKeyDown={handleEditKeyDown}
                                    />
                                );
                            })}
                        </SortableContext>
                    </DndContext>
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
                    <NotebookScriptFeed notebook={notebook} modifyNotebook={modifyNotebook} active={feedActive} showDetails={(initialTab?: DetailsTabKey) => { setDetailsInitialTab(initialTab); setShowDetails(true); }} scrollTarget={feedScrollTarget} conn={conn ?? null} openConnectionOverlay={() => setConnectionOverlayOpen(true)} />
                </div>
                {
                    catalogTab === 'relations' && conn
                        ? <CatalogSchemaView connection={conn} />
                        : catalogTab === 'functions' && conn
                            ? <CatalogFunctionsView connection={conn} />
                            : showDetails
                                ? <NotebookScriptDetails notebook={notebook} modifyNotebook={modifyNotebook} connection={conn} hideDetails={() => { setShowDetails(false); setDetailsInitialTab(undefined); }} initialTab={detailsInitialTab} />
                                : null
                }
            </div>
            <div className={styles.action_sidebar} data-tauri-drag-region="deep">
                <div className={styles.action_sidebar_body}>
                    <ActionList.List aria-label="Actions">
                        <ActionList.GroupHeading>Connection</ActionList.GroupHeading>
                        <ConnectionCommandList
                            conn={conn ?? null}
                            notebook={notebook}
                            onOpenSettings={() => setConnectionOverlayOpen(true)}
                            settingsRef={connectionStatusRef}
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
