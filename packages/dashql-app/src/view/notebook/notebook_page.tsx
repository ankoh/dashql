import * as React from 'react';
import * as styles from './notebook_page.module.css';

import { motion } from 'framer-motion';
import { LinkIcon, PaperAirplaneIcon, SyncIcon, ThreeBarsIcon } from '@primer/octicons-react';

import * as ActionList from '../foundations/action_list.js';
import { ConnectionStatus } from '../connection/connection_status.js';
import { ButtonGroup } from '../foundations/button_group.js';
import { ButtonSize, ButtonVariant, IconButton } from '../foundations/button.js';
import { SymbolIcon } from '../foundations/symbol_icon.js';
import { useNotebookRegistry, useNotebookState } from '../../notebook/notebook_state_registry.js';
import { CREATE_PAGE, DELETE_PAGE, SELECT_PAGE, UPDATE_NOTEBOOK_ENTRY } from '../../notebook/notebook_state.js';
import { NotebookCommandType, useNotebookCommandDispatch } from '../../notebook/notebook_commands.js';
import { NotebookScriptThumbnails } from './notebook_script_thumbnails.js';
import { NotebookListDropdown } from './notebook_list_dropdown.js';
import { NotebookURLShareOverlay } from './notebook_url_share_overlay.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useLogger } from '../../platform/logger_provider.js';
import { useRouteContext, useRouterNavigate, NOTEBOOK_PATH } from '../../router.js';

import { ConnectionCommandList, NotebookCommandList } from './notebook_command_lists.js';
import { NotebookScriptDetails } from './notebook_script_details.js';
import { NotebookScriptFeed } from './notebook_script_feed.js';

const LOG_CTX = 'notebook_page';

interface FeedScrollTarget {
    entryIndex: number;
    version: number;
}

interface Props { }

export const NotebookPage: React.FC<Props> = (_props: Props) => {
    const route = useRouteContext();
    const navigate = useRouterNavigate();
    const logger = useLogger();
    const notebookRegistry = useNotebookRegistry()[0];
    const [notebook, modifyNotebook] = useNotebookState(route.notebookId ?? null);
    const [conn, _modifyConn] = useConnectionState(notebook?.connectionId ?? null);
    const [sharingIsOpen, setSharingIsOpen] = React.useState<boolean>(false);
    const [showDetails, setShowDetails] = React.useState<boolean>(true);
    const [feedScrollTarget, setFeedScrollTarget] = React.useState<FeedScrollTarget | null>(null);
    const [editingPageIndex, setEditingPageIndex] = React.useState<number | null>(null);
    const [editingPageTitle, setEditingPageTitle] = React.useState<string>("");
    const editInputRef = React.useRef<HTMLInputElement>(null);

    const sessionCommand = useNotebookCommandDispatch();
    const requestFeedScroll = React.useCallback((entryIndex: number) => {
        setFeedScrollTarget(prev => ({
            entryIndex,
            version: (prev?.version ?? 0) + 1,
        }));
    }, []);
    const restoreSelectedFeedScroll = React.useCallback(() => {
        requestFeedScroll(notebook?.notebookUserFocus.entryInPage ?? 0);
    }, [notebook?.notebookUserFocus.entryInPage, requestFeedScroll]);

    const startEditingPage = React.useCallback((index: number, currentTitle: string, event: React.MouseEvent) => {
        event.stopPropagation();
        setEditingPageIndex(index);
        setEditingPageTitle(currentTitle);
    }, []);

    const savePageEdit = React.useCallback(() => {
        if (editingPageIndex === null) return;

        const page = notebook?.notebookPages[editingPageIndex];
        if (page && page.scripts.length > 0) {
            // Need to switch to the page first if not already there
            if (notebook && editingPageIndex !== notebook.notebookUserFocus.pageIndex) {
                modifyNotebook({ type: SELECT_PAGE, value: editingPageIndex });
            }
            // Update first script's title to rename the page
            modifyNotebook({
                type: UPDATE_NOTEBOOK_ENTRY,
                value: { entryIndex: 0, title: editingPageTitle.trim() || null }
            });
        }

        setEditingPageIndex(null);
        setEditingPageTitle("");
    }, [editingPageIndex, editingPageTitle, notebook, modifyNotebook]);

    const cancelPageEdit = React.useCallback(() => {
        setEditingPageIndex(null);
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
        if (editingPageIndex !== null && editInputRef.current) {
            editInputRef.current.focus();
            editInputRef.current.select();
        }
    }, [editingPageIndex]);

    React.useEffect(() => {
        if (showDetails || notebook == null) {
            return;
        }
        requestFeedScroll(notebook.notebookUserFocus.entryInPage);
    }, [notebook, notebook?.notebookUserFocus.entryInPage, notebook?.notebookUserFocus.pageIndex, requestFeedScroll, showDetails]);

    React.useEffect(() => {
        if (route.notebookId === null) {
            if (route.connectionId !== null) {
                const connectionNotebooks = notebookRegistry.notebooksByConnection.get(route.connectionId);
                if ((connectionNotebooks?.length ?? 0) > 0) {
                    navigate({
                        type: NOTEBOOK_PATH,
                        value: {
                            ...route,
                            notebookId: connectionNotebooks![0],
                            connectionId: route.connectionId,
                        },
                    });
                }
            } else {
                logger.warn('missing notebook id', {}, LOG_CTX);
            }
        }
    }, [route.notebookId, route.connectionId]);

    if (route.notebookId === null || notebook == null) {
        return <div />;
    }
    return (
        <div className={styles.page}>
            <div className={styles.header_container}>
                <div className={styles.header_left_container}>
                    <div className={styles.page_title}>Notebook</div>
                    <NotebookListDropdown />
                </div>
                <div className={styles.header_right_container}>
                    {conn && <ConnectionStatus conn={conn} notebookId={route.notebookId} />}
                </div>
                <div className={styles.header_action_container}>
                    <div>
                        <ButtonGroup>
                            <IconButton
                                variant={ButtonVariant.Default}
                                aria-label="Execute Query"
                                onClick={() => sessionCommand(NotebookCommandType.ExecuteEditorQuery)}
                            >
                                <PaperAirplaneIcon />
                            </IconButton>
                            <IconButton
                                variant={ButtonVariant.Default}
                                aria-label="Refresh Schema"
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
                    {notebook.notebookPages.map((page, index) => {
                        const isSelected = index === notebook.notebookUserFocus.pageIndex;
                        const isEditing = editingPageIndex === index;
                        const label = page.scripts.length > 0 && page.scripts[0].title
                            ? page.scripts[0].title
                            : `Page ${index + 1}`;

                        const PencilIcon = SymbolIcon('pencil_16');
                        const canEdit = page.scripts.length > 0; // Only allow editing if page has scripts

                        return (
                            <motion.div
                                key={index}
                                className={isSelected ? styles.page_tab_selected : styles.page_tab}
                                layout
                                initial={false}
                                animate={{
                                    scale: isSelected ? 1 : 0.98,
                                    opacity: isSelected ? 1 : 0.85,
                                }}
                                transition={{
                                    duration: 0.2,
                                    ease: [0.33, 1, 0.68, 1]
                                }}
                                onClick={() => {
                                    if (isEditing) return; // Don't change page while editing
                                    if (isSelected) {
                                        setShowDetails(false);
                                    } else {
                                        modifyNotebook({ type: SELECT_PAGE, value: index });
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
                                                        onClick={(e) => startEditingPage(index, label, e)}
                                                        className={styles.page_tab_action_button}
                                                    >
                                                        <PencilIcon size={12} />
                                                    </IconButton>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </motion.div>
                        );
                    })}
                    <button
                        type="button"
                        className={styles.page_tab_add}
                        aria-label="Add page"
                        onClick={() => {
                            modifyNotebook({ type: CREATE_PAGE, value: null });
                            setShowDetails(false);
                        }}
                    >
                        +
                    </button>
                </div>
            </div>
            <div className={styles.notebook_entry_sidebar}>
                <NotebookScriptThumbnails notebook={notebook} modifyNotebook={modifyNotebook} onHoverEntry={requestFeedScroll} onHoverExit={restoreSelectedFeedScroll} onSelectEntry={requestFeedScroll} />
            </div>
            <div className={styles.body_container} id="notebook-body" role="tabpanel" aria-labelledby={notebook.notebookPages.length > 0 ? `notebook-page-tab-${notebook.notebookUserFocus.pageIndex}` : undefined}>
                {
                    showDetails
                        ? <NotebookScriptDetails notebook={notebook} connection={conn} hideDetails={() => setShowDetails(false)} />
                        : <NotebookScriptFeed notebook={notebook} modifyNotebook={modifyNotebook} showDetails={() => setShowDetails(true)} scrollTarget={feedScrollTarget} />
                }
            </div>
            <div className={styles.action_sidebar}>
                <div className={styles.action_sidebar_header}>
                    {conn && <ConnectionStatus conn={conn} notebookId={route.notebookId} />}
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
        </div>
    );
};
