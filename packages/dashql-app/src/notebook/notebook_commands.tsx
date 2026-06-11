import * as React from 'react';

import { useLocation } from 'react-router-dom';

import { ConnectionHealth, printConnectionHealth } from '../connection/connection_state.js';
import { ConnectorInfo } from '../connection/connector_info.js';
import { KeyEventHandler, useKeyEvents } from '../utils/key_events.js';
import { QueryType } from '../connection/query_execution_state.js';
import { getSelectedEntry, REGISTER_QUERY, SELECT_NEXT_ENTRY, SELECT_NEXT_PAGE, SELECT_PREV_ENTRY, SELECT_PREV_PAGE } from './notebook_state.js';
import { useCatalogLoaderQueue } from '../connection/catalog_loader.js';
import { useConnectionState } from '../connection/connection_registry.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { useQueryExecutor } from '../connection/query_executor.js';
import { useRouteContext, useRouterNavigate, CHANGE_SESSION } from '../router.js';
import { useNotebookRegistry, useNotebookState } from './notebook_state_registry.js';

const LOG_CTX = "notebook_commands";

export enum NotebookCommandType {
    ExecuteEditorQuery = 1,
    RefreshCatalog = 2,
    SaveNotebookAsLink = 3,
    SaveQueryAsSql = 4,
    SaveQueryResultsAsArrow = 5,
    SelectPreviousNotebookScript = 6,
    SelectNextNotebookScript = 7,
    SelectPreviousNotebookPage = 10,
    SelectNextNotebookPage = 11,
    EditNotebookConnection = 8,
    CloseNotebook = 9,
}

export type ScriptCommandDispatch = (command: NotebookCommandType) => void;

interface Props {
    children?: React.ReactElement | React.ReactElement[];
}

const COMMAND_DISPATCH_CTX = React.createContext<ScriptCommandDispatch | null>(null);
export const useNotebookCommandDispatch = () => React.useContext(COMMAND_DISPATCH_CTX)!;

export const NotebookCommands: React.FC<Props> = (props: Props) => {
    const route = useRouteContext();
    const navigate = useRouterNavigate();
    const logger = useLogger();

    const registry = useNotebookRegistry()[0];
    const [notebook, modifyNotebook] = useNotebookState(route.sessionId ?? null);
    const [connection, _dispatchConnection] = useConnectionState(notebook?.sessionId ?? null);
    const executeQuery = useQueryExecutor();
    const refreshCatalog = useCatalogLoaderQueue();

    // Setup command dispatch logic
    const commandDispatch = React.useCallback(
        async (command: NotebookCommandType) => {
            if (notebook == null) {
                logger.error("Notebook is null", {});
                return;
            }
            switch (command) {
                // Execute the query script in the current notebook
                case NotebookCommandType.ExecuteEditorQuery:
                    if (connection!.connectionHealth != ConnectionHealth.ONLINE) {
                        logger.error("Cannot execute query command with an unhealthy connection", {
                            session: route.sessionId,
                            status: printConnectionHealth(connection?.connectionHealth ?? ConnectionHealth.NOT_STARTED)
                        }, LOG_CTX);
                    } else {
                        const entry = getSelectedEntry(notebook);
                        if (!entry) break;
                        const scriptData = notebook.scripts[entry.scriptId];
                        const queryText = scriptData.annotations.visualizeQuery?.sql ?? scriptData.script.toString();
                        const [queryId, _run] = executeQuery(notebook.sessionId, {
                            query: queryText,
                            analyzeResults: true,
                            metadata: {
                                queryType: QueryType.USER_PROVIDED,
                                title: "Notebook Query",
                                description: null,
                                issuer: "Query Execution Command",
                                userProvided: true
                            }
                        });
                        modifyNotebook({
                            type: REGISTER_QUERY,
                            value: [scriptData.scriptKey, queryId]
                        })
                    }
                    break;
                case NotebookCommandType.RefreshCatalog:
                    if (connection?.connectionHealth != ConnectionHealth.ONLINE) {
                        logger.error("Cannot refresh the catalog of unhealthy connection", {}, LOG_CTX);
                    } else {
                        refreshCatalog(connection.sessionId, true);
                    }
                    break;
                case NotebookCommandType.CloseNotebook: {
                    // Navigate back to the session selector
                    navigate({
                        type: CHANGE_SESSION,
                        value: null,
                    });
                    break;
                }

                case NotebookCommandType.SaveNotebookAsLink:
                    console.log('Save notebook as link');
                    break;
                case NotebookCommandType.SaveQueryAsSql:
                    console.log('Save query as sql command');
                    break;
                case NotebookCommandType.SaveQueryResultsAsArrow:
                    console.log('Save query results as arrow');
                    break;
                case NotebookCommandType.SelectPreviousNotebookScript:
                    if (modifyNotebook) {
                        modifyNotebook({
                            type: SELECT_PREV_ENTRY,
                            value: null,
                        });
                    }
                    break;
                case NotebookCommandType.SelectNextNotebookScript:
                    if (modifyNotebook) {
                        modifyNotebook({
                            type: SELECT_NEXT_ENTRY,
                            value: null,
                        });
                    }
                    break;
                case NotebookCommandType.SelectPreviousNotebookPage:
                    if (modifyNotebook) {
                        modifyNotebook({
                            type: SELECT_PREV_PAGE,
                            value: null,
                        });
                    }
                    break;
                case NotebookCommandType.SelectNextNotebookPage:
                    if (modifyNotebook) {
                        modifyNotebook({
                            type: SELECT_NEXT_PAGE,
                            value: null,
                        });
                    }
                    break;
                case NotebookCommandType.EditNotebookConnection:
                    // Connection settings are now handled via overlay in the UI
                    break;
            }
        },
        [connection, notebook, notebook?.connectorInfo],
    );

    // Helper to require connector info
    const requireConnector = (handler: (connectorInfo: ConnectorInfo) => () => void) => {
        const connectorInfo = notebook?.connectorInfo ?? null;
        if (connectorInfo == null) {
            return () => console.warn(`Command requires an active connector`);
        } else {
            return handler(connectorInfo);
        }
    };

    // Helper to signal that a command is not implemented
    const commandNotImplemented = (connector: ConnectorInfo, actionName: string) => {
        console.warn(`Connector '${connector.names.displayLong}' does not implement the command '${actionName}'`);
    };
    // Create key event handlers
    const keyHandlers = React.useMemo<KeyEventHandler[]>(
        () => [
            {
                key: 'e',
                ctrlKey: true,
                callback: requireConnector(c =>
                    !c.features.executeQueryAction
                        ? () => commandNotImplemented(c, 'EXECUTE_QUERY')
                        : () => commandDispatch(NotebookCommandType.ExecuteEditorQuery),
                ),
            },
            {
                key: 'r',
                ctrlKey: true,
                callback: requireConnector(c =>
                    !c.features.executeQueryAction
                        ? () => commandNotImplemented(c, 'REFRESH_SCHEMA')
                        : () => commandDispatch(NotebookCommandType.RefreshCatalog),
                ),
            },
            {
                key: 's',
                ctrlKey: true,
                callback: () => commandDispatch(NotebookCommandType.SaveQueryAsSql),
            },
            {
                key: 'a',
                ctrlKey: true,
                callback: requireConnector(c =>
                    !c.features.executeQueryAction
                        ? () => commandNotImplemented(c, 'SAVE_QUERY_RESULTS_AS_ARROW')
                        : () => commandDispatch(NotebookCommandType.SaveQueryResultsAsArrow),
                ),
            },
            {
                key: 'k',
                ctrlKey: true,
                callback: () => commandDispatch(NotebookCommandType.SelectPreviousNotebookScript),
            },
            {
                key: 'j',
                ctrlKey: true,
                callback: () => commandDispatch(NotebookCommandType.SelectNextNotebookScript),
            },
            {
                key: 'h',
                ctrlKey: true,
                callback: () => commandDispatch(NotebookCommandType.SelectPreviousNotebookPage),
            },
            {
                key: 'l',
                ctrlKey: true,
                callback: () => commandDispatch(NotebookCommandType.SelectNextNotebookPage),
            },
        ],
        [notebook?.connectorInfo, commandDispatch],
    );

    // Setup key event handlers
    useKeyEvents(keyHandlers);

    return <COMMAND_DISPATCH_CTX.Provider value={commandDispatch}>{props.children}</COMMAND_DISPATCH_CTX.Provider>;
};
