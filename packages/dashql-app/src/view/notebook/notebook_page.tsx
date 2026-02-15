import * as React from 'react';
import * as styles from './notebook_page.module.css';
import * as theme from '../../github_theme.module.css';

import { ButtonGroup, IconButton as IconButtonLegacy } from '@primer/react';
import { LinkIcon, PaperAirplaneIcon, SyncIcon, ThreeBarsIcon } from '@primer/octicons-react';

import * as ActionList from '../foundations/action_list.js';
import { ConnectionStatus } from '../connection/connection_status.js';
import { ConnectorType } from '../../connection/connector_info.js';
import { ModifyNotebook, useNotebookRegistry, useNotebookState } from '../../notebook/notebook_state_registry.js';
import { CREATE_PAGE, NotebookState, SELECT_PAGE } from '../../notebook/notebook_state.js';
import { NotebookCommandType, useNotebookCommandDispatch } from '../../notebook/notebook_commands.js';
import { NotebookScriptThumbnails } from './notebook_script_thumbnails.js';
import { NotebookListDropdown } from './notebook_list_dropdown.js';
import { NotebookURLShareOverlay } from './notebook_url_share_overlay.js';
import { useConnectionState } from '../../connection/connection_registry.js';
import { useLogger } from '../../platform/logger_provider.js';
import { useRouteContext, useRouterNavigate, NOTEBOOK_PATH } from '../../router.js';

import { ConnectionCommandList, NotebookCommandList } from './notebook_command_lists.js';
import { NotebookScriptCard } from './notebook_script_card.js';
import { NotebookScriptList } from './notebook_script_list.js';

const LOG_CTX = 'notebook_page';

interface Props { }

export const NotebookPage: React.FC<Props> = (_props: Props) => {
    const route = useRouteContext();
    const navigate = useRouterNavigate();
    const logger = useLogger();
    const notebookRegistry = useNotebookRegistry()[0];
    const [notebook, modifyNotebook] = useNotebookState(route.notebookId ?? null);
    const [conn, _modifyConn] = useConnectionState(notebook?.connectionId ?? null);
    const [sharingIsOpen, setSharingIsOpen] = React.useState<boolean>(false);
    const [showDetails, setShowDetails] = React.useState<boolean>(false);

    const sessionCommand = useNotebookCommandDispatch();

    let warning: React.ReactElement | null = null;
    if (conn?.connectorInfo.connectorType == ConnectorType.DEMO) {
        warning = (
            <div className={styles.demo_info_card}>
                Changes are not persisted for Demo connections.
            </div>
        );
    }

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
                        const isSelected = index === notebook.selectedPageIndex;
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
                <NotebookScriptThumbnails notebook={notebook} modifyNotebook={modifyNotebook} />
            </div>
            <div className={styles.body_container} id="notebook-body" role="tabpanel" aria-labelledby={notebook.notebookPages.length > 0 ? `notebook-page-tab-${notebook.selectedPageIndex}` : undefined}>
                {
                    showDetails
                        ? <NotebookScriptCard notebook={notebook} connection={conn} hideDetails={() => setShowDetails(false)} />
                        : <NotebookScriptList notebook={notebook} modifyNotebook={modifyNotebook} showDetails={() => setShowDetails(true)} />
                }
            </div>
            <div className={styles.body_action_sidebar}>
                {warning}
                <div className={styles.body_action_sidebar_card}>
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
