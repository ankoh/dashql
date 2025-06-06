import * as React from 'react';

import { ConnectionHealth } from '../connection/connection_state.js';
import { ConnectorInfo } from '../connection/connector_info.js';
import { KeyEventHandler, useKeyEvents } from '../utils/key_events.js';
import { QueryType } from '../connection/query_execution_state.js';
import { REGISTER_QUERY, SELECT_NEXT_ENTRY, SELECT_PREV_ENTRY } from './workbook_state.js';
import { useCatalogLoaderQueue } from '../connection/catalog_loader.js';
import { useConnectionState } from '../connection/connection_registry.js';
import { useLogger } from '../platform/logger_provider.js';
import { useQueryExecutor } from '../connection/query_executor.js';
import { CONNECTION_PATH, useRouteContext, useRouterNavigate } from '../router.js';
import { useWorkbookState } from './workbook_state_registry.js';

export enum WorkbookCommandType {
    ExecuteEditorQuery = 1,
    RefreshCatalog = 2,
    SaveWorkbookAsLink = 3,
    SaveQueryAsSql = 4,
    SaveQueryResultsAsArrow = 5,
    SelectPreviousWorkbookEntry = 6,
    SelectNextWorkbookEntry = 7,
    EditWorkbookConnection = 8,
}

export type ScriptCommandDispatch = (command: WorkbookCommandType) => void;

interface Props {
    children?: React.ReactElement | React.ReactElement[];
}

const COMMAND_DISPATCH_CTX = React.createContext<ScriptCommandDispatch | null>(null);
export const useWorkbookCommandDispatch = () => React.useContext(COMMAND_DISPATCH_CTX)!;

export const WorkbookCommands: React.FC<Props> = (props: Props) => {
    const route = useRouteContext();
    const navigate = useRouterNavigate();
    const logger = useLogger();

    const [workbook, modifyWorkbook] = useWorkbookState(route.workbookId ?? null);
    const [connection, _dispatchConnection] = useConnectionState(workbook?.connectionId ?? null);
    const executeQuery = useQueryExecutor();
    const refreshCatalog = useCatalogLoaderQueue();

    // Setup command dispatch logic
    const commandDispatch = React.useCallback(
        async (command: WorkbookCommandType) => {
            if (workbook == null) {
                logger.error("workbook is null", {});
                return;
            }
            switch (command) {
                // Execute the query script in the current workbook
                case WorkbookCommandType.ExecuteEditorQuery:
                    if (connection!.connectionHealth != ConnectionHealth.ONLINE) {
                        logger.error("cannot execute query command with an unhealthy connection", {});
                    } else {
                        const entry = workbook.workbookEntries[workbook.selectedWorkbookEntry];
                        const script = workbook.scripts[entry.scriptKey];
                        const mainScriptText = script.toString();
                        const [queryId, _run] = executeQuery(workbook.connectionId, {
                            query: mainScriptText,
                            analyzeResults: true,
                            metadata: {
                                queryType: QueryType.USER_PROVIDED,
                                title: "Workbook Query",
                                description: null,
                                issuer: "Query Execution Command",
                                userProvided: true
                            }
                        });
                        modifyWorkbook({
                            type: REGISTER_QUERY,
                            value: [workbook.selectedWorkbookEntry, script.scriptKey, queryId]
                        })
                    }
                    break;
                case WorkbookCommandType.RefreshCatalog:
                    if (connection?.connectionHealth != ConnectionHealth.ONLINE) {
                        logger.error("cannot refresh the catalog of unhealthy connection", {});
                    } else {
                        refreshCatalog(connection.connectionId, true);
                    }
                    break;
                case WorkbookCommandType.SaveWorkbookAsLink:
                    console.log('save workbook as link');
                    break;
                case WorkbookCommandType.SaveQueryAsSql:
                    console.log('save query as sql command');
                    break;
                case WorkbookCommandType.SaveQueryResultsAsArrow:
                    console.log('save query results as arrow');
                    break;
                case WorkbookCommandType.SelectPreviousWorkbookEntry:
                    if (modifyWorkbook) {
                        modifyWorkbook({
                            type: SELECT_PREV_ENTRY,
                            value: null,
                        });
                    }
                    break;
                case WorkbookCommandType.SelectNextWorkbookEntry:
                    if (modifyWorkbook) {
                        modifyWorkbook({
                            type: SELECT_NEXT_ENTRY,
                            value: null,
                        });
                    }
                    break;
                case WorkbookCommandType.EditWorkbookConnection:
                    if (workbook.connectionId != null) {
                        navigate({
                            type: CONNECTION_PATH,
                            value: {
                                connectionId: workbook.connectionId,
                            }
                        });
                    }
                    break;
            }
        },
        [connection, workbook, workbook?.connectorInfo],
    );

    // Helper to require connector info
    const requireConnector = (handler: (connectorInfo: ConnectorInfo) => () => void) => {
        const connectorInfo = workbook?.connectorInfo ?? null;
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
                        : () => commandDispatch(WorkbookCommandType.ExecuteEditorQuery),
                ),
            },
            {
                key: 'r',
                ctrlKey: true,
                callback: requireConnector(c =>
                    !c.features.executeQueryAction
                        ? () => commandNotImplemented(c, 'REFRESH_SCHEMA')
                        : () => commandDispatch(WorkbookCommandType.RefreshCatalog),
                ),
            },
            {
                key: 'u',
                ctrlKey: true,
                callback: () => commandDispatch(WorkbookCommandType.SaveWorkbookAsLink),
            },
            {
                key: 'u',
                ctrlKey: true,
                callback: () => commandDispatch(WorkbookCommandType.SaveWorkbookAsLink),
            },
            {
                key: 's',
                ctrlKey: true,
                callback: () => commandDispatch(WorkbookCommandType.SaveQueryAsSql),
            },
            {
                key: 'a',
                ctrlKey: true,
                callback: requireConnector(c =>
                    !c.features.executeQueryAction
                        ? () => commandNotImplemented(c, 'SAVE_QUERY_RESULTS_AS_ARROW')
                        : () => commandDispatch(WorkbookCommandType.SaveQueryResultsAsArrow),
                ),
            },
            {
                key: 'k',
                ctrlKey: true,
                callback: () => commandDispatch(WorkbookCommandType.SelectPreviousWorkbookEntry),
            },
            {
                key: 'j',
                ctrlKey: true,
                callback: () => commandDispatch(WorkbookCommandType.SelectNextWorkbookEntry),
            },
        ],
        [workbook?.connectorInfo, commandDispatch],
    );

    // Setup key event handlers
    useKeyEvents(keyHandlers);

    return <COMMAND_DISPATCH_CTX.Provider value={commandDispatch}>{props.children}</COMMAND_DISPATCH_CTX.Provider>;
};
