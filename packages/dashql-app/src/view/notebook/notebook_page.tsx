import * as React from 'react';
import * as styles from './notebook_page.module.css';
import * as theme from '../../github_theme.module.css';

import { ButtonGroup, IconButton as IconButtonLegacy } from '@primer/react';
import { LinkIcon, PaperAirplaneIcon, SyncIcon, ThreeBarsIcon } from '@primer/octicons-react';

import * as ActionList from '../foundations/action_list.js';
import { ConnectionStatus } from '../connection/connection_status.js';
import { useNotebookRegistry, useNotebookState } from '../../notebook/notebook_state_registry.js';
import { CREATE_PAGE, SELECT_PAGE } from '../../notebook/notebook_state.js';
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
                        <ButtonGroup className={theme.button_group}>
                            <IconButtonLegacy
                                icon={PaperAirplaneIcon}
                                aria-labelledby="execute-query"
                                onClick={() => sessionCommand(NotebookCommandType.ExecuteEditorQuery)}
                            />
                            <IconButtonLegacy
                                icon={SyncIcon}
                                aria-labelledby="refresh-schema"
                                onClick={() => sessionCommand(NotebookCommandType.RefreshCatalog)}
                            />
                            <IconButtonLegacy
                                icon={LinkIcon}
                                aria-labelledby="visit-github-repository"
                                onClick={() => setSharingIsOpen(s => !s)}
                            />
                        </ButtonGroup>
                        <NotebookURLShareOverlay isOpen={sharingIsOpen} setIsOpen={setSharingIsOpen} />
                    </div>
                    <IconButtonLegacy icon={ThreeBarsIcon} aria-labelledby="visit-github-repository" />
                </div>
            </div>
            <div className={styles.page_tabs_container}>
                <div className={styles.page_tabs} role="tablist" aria-label="Notebook pages">
                    {notebook.notebookPages.map((page, index) => {
                        const isSelected = index === notebook.notebookUserFocus.pageIndex;
                        const label = page.scripts.length > 0 && page.scripts[0].title
                            ? page.scripts[0].title
                            : `Page ${index + 1}`;
                        return (
                            <div
                                key={index}
                                className={isSelected ? styles.page_tab_selected : styles.page_tab}
                                onClick={() => {
                                    if (isSelected) {
                                        setShowDetails(false);
                                    } else {
                                        modifyNotebook({ type: SELECT_PAGE, value: index });
                                        setShowDetails(false);
                                    }
                                }}
                            >
                                <div
                                    className={styles.page_tab_button}
                                >
                                    {label}
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
