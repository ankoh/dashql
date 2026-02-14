import * as React from 'react';

import { useLocation } from 'react-router-dom';

import { ConnectionHealth, printConnectionHealth } from '../connection/connection_state.js';
import { ConnectorInfo, ConnectorType } from '../connection/connector_info.js';
import { KeyEventHandler, useKeyEvents } from '../utils/key_events.js';
import { QueryType } from '../connection/query_execution_state.js';
import { DELETE_NOTEBOOK, getSelectedEntry, REGISTER_QUERY, SELECT_NEXT_ENTRY, SELECT_PREV_ENTRY } from './notebook_state.js';
import { useCatalogLoaderQueue } from '../connection/catalog_loader.js';
import { nextConnectionIdMustBeLargerThan, useConnectionState } from '../connection/connection_registry.js';
import { useLogger } from '../platform/logger_provider.js';
import { useQueryExecutor } from '../connection/query_executor.js';
import { CONNECTION_PATH, useRouteContext, useRouterNavigate, NOTEBOOK_PATH } from '../router.js';
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
    EditNotebookConnection = 8,
    DeleteNotebook = 9,
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
    const location = useLocation();
    const logger = useLogger();

    const registry = useNotebookRegistry()[0];
    const [notebook, modifyNotebook] = useNotebookState(route.notebookId ?? null);
    const [connection, _dispatchConnection] = useConnectionState(notebook?.connectionId ?? null);
    const executeQuery = useQueryExecutor();
    const refreshCatalog = useCatalogLoaderQueue();

    // Setup command dispatch logic
    const commandDispatch = React.useCallback(
        async (command: NotebookCommandType) => {
            if (notebook == null) {
                logger.error("notebook is null", {});
                return;
            }
            switch (command) {
                // Execute the query script in the current notebook
                case NotebookCommandType.ExecuteEditorQuery:
                    if (connection!.connectionHealth != ConnectionHealth.ONLINE) {
                        logger.error("cannot execute query command with an unhealthy connection", {
                            connection: route.connectionId?.toString(),
                            notebook: route.notebookId?.toString(),
                            status: printConnectionHealth(connection?.connectionHealth ?? ConnectionHealth.NOT_STARTED)
                        }, LOG_CTX);
                    } else {
                        const entry = getSelectedEntry(notebook);
                        if (!entry) break;
                        const scriptData = notebook.scripts[entry.scriptId];
                        const mainScriptText = scriptData.script?.toString() ?? "";
                        const [queryId, _run] = executeQuery(notebook.connectionId, {
                            query: mainScriptText,
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
                            value: [notebook.selectedPageIndex, notebook.selectedEntryInPage, scriptData.scriptKey, queryId]
                        })
                    }
                    break;
                case NotebookCommandType.RefreshCatalog:
                    if (connection?.connectionHealth != ConnectionHealth.ONLINE) {
                        logger.error("cannot refresh the catalog of unhealthy connection", {}, LOG_CTX);
                    } else {
                        refreshCatalog(connection.connectionId, true);
                    }
                    break;
                case NotebookCommandType.DeleteNotebook: {
                    // Don't delete the last one
                    if (registry.notebookMap.size <= 1) {
                        logger.warn("refusing to delete the last notebook", {
                            notebook: notebook.notebookId.toString(),
                            connection: connection?.connectionId.toString(),
                        }, LOG_CTX);
                        break;
                    }
                    // By default, navigate to a different notebook of the same type
                    let next: [number, number] | null = null;
                    let candidate = registry.notebooksByConnectionType[notebook.connectorInfo.connectorType].find(v => v != notebook.notebookId);
                    if (candidate !== undefined) {
                        const wb = registry.notebookMap.get(candidate)!;
                        next = [wb.notebookId, wb.connectionId];
                    } else {
                        // Check if there's a dataless notebook
                        candidate = registry.notebooksByConnectionType[ConnectorType.DATALESS].find(v => v != notebook.notebookId);
                        if (candidate !== undefined) {
                            const wb = registry.notebookMap.get(candidate)!;
                            next = [wb.notebookId, wb.connectionId];
                        } else {
                            // Alternatively pick an arbitrary remaining one
                            const wb = [...registry.notebookMap.values()].find(v => v.notebookId != notebook.notebookId);
                            next = (wb == undefined) ? null : [wb.notebookId, wb.connectionId];
                        }
                    }
                    modifyNotebook({
                        type: DELETE_NOTEBOOK,
                        value: null
                    });
                    navigate({
                        type: NOTEBOOK_PATH,
                        value: next == null ? null : {
                            notebookId: next[0],
                            connectionId: next[1],
                        },
                    });
                    break;
                }

                case NotebookCommandType.SaveNotebookAsLink:
                    console.log('save notebook as link');
                    break;
                case NotebookCommandType.SaveQueryAsSql:
                    console.log('save query as sql command');
                    break;
                case NotebookCommandType.SaveQueryResultsAsArrow:
                    console.log('save query results as arrow');
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
                case NotebookCommandType.EditNotebookConnection:
                    if (notebook.connectionId != null) {
                        navigate({
                            type: CONNECTION_PATH,
                            value: {
                                connectionId: notebook.connectionId,
                                notebookId: null,
                            }
                        });
                    }
                    break;
            }
        },
        [connection, notebook, notebook?.connectorInfo],
    );

    // Helper to require connector info
    const requireConnector = (handler: (connectorInfo: ConnectorInfo) => () => void) => {
        const connectorInfo = notebook?.connectorInfo ?? null;
        if (connectorInfo == null) {
            return () => console.warn(`command requires an active connector`);
        } else {
            return handler(connectorInfo);
        }
    };

    // Helper to signal that a command is not implemented
    const commandNotImplemented = (connector: ConnectorInfo, actionName: string) => {
        console.warn(`connector '${connector.names.displayLong}' does not implement the command '${actionName}'`);
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
                key: 'u',
                ctrlKey: true,
                callback: () => commandDispatch(NotebookCommandType.SaveNotebookAsLink),
            },
            {
                key: 'u',
                ctrlKey: true,
                callback: () => commandDispatch(NotebookCommandType.SaveNotebookAsLink),
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
        ],
        [notebook?.connectorInfo, commandDispatch],
    );

    // Setup key event handlers
    useKeyEvents(keyHandlers);

    return <COMMAND_DISPATCH_CTX.Provider value={commandDispatch}>{props.children}</COMMAND_DISPATCH_CTX.Provider>;
};
