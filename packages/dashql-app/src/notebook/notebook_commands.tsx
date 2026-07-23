import * as React from 'react';

import { useLocation } from 'react-router-dom';

import { ConnectionHealth, printConnectionHealth } from '../connection/connection_state.js';
import { ConnectorInfo } from '../connection/connector_info.js';
import { KeyEventHandler, useKeyEvents } from '../utils/key_events.js';
import { QueryType } from '../connection/query_execution_state.js';
import { getExecutableQueryText, getSelectedEntry, REGISTER_QUERY, SELECT_NEXT_ENTRY, SELECT_NEXT_PAGE, SELECT_PREV_ENTRY, SELECT_PREV_PAGE } from './notebook_state.js';
import { projectionForVisualizeQuery } from './notebook_types.js';
import { useCatalogLoaderQueue } from '../connection/catalog_loader.js';
import { useConnectionState } from '../connection/connection_registry.js';
import { useLogger } from '../platform/logger/logger_provider.js';
import { useQueryExecutor } from '../connection/query_executor.js';
import { useRouteContext, useRouterNavigate, CHANGE_SESSION } from '../router.js';
import { useNotebookRegistry, useNotebookState } from './notebook_state_registry.js';
import { useAIClient } from '../platform/ai_client_provider.js';

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
    ToggleComposeInputMode = 12,
}

export type ScriptCommandDispatch = (command: NotebookCommandType) => void;

interface Props {
    children?: React.ReactElement | React.ReactElement[];
}

const COMMAND_DISPATCH_CTX = React.createContext<ScriptCommandDispatch | null>(null);
export const useNotebookCommandDispatch = () => React.useContext(COMMAND_DISPATCH_CTX)!;

/// The compose editor's input mode: 0 = SQL, 1 = AI.
export const COMPOSE_INPUT_MODE_SQL = 0;
export const COMPOSE_INPUT_MODE_AI = 1;

/// The requested compose input mode lives here rather than in the script feed, so the
/// "Switch Mode" command and the Ctrl+M shortcut (dispatched from outside the feed) can drive
/// it directly. The feed is just a consumer. Hoisting it here also means the mode persists when
/// the feed is replaced by the details view and restored.
export interface ComposeInputModeContextValue {
    mode: number;
    setMode: React.Dispatch<React.SetStateAction<number>>;
}
const COMPOSE_INPUT_MODE_CTX = React.createContext<ComposeInputModeContextValue | null>(null);
export const useComposeInputMode = () => React.useContext(COMPOSE_INPUT_MODE_CTX)!;

export const NotebookCommands: React.FC<Props> = (props: Props) => {
    const route = useRouteContext();
    const navigate = useRouterNavigate();
    const logger = useLogger();

    const registry = useNotebookRegistry()[0];
    const [notebook, modifyNotebook] = useNotebookState(route.sessionId ?? null);
    const [connection, _dispatchConnection] = useConnectionState(notebook?.sessionId ?? null);
    const executeQuery = useQueryExecutor();
    const refreshCatalog = useCatalogLoaderQueue();
    const aiAvailable = useAIClient() != null;
    const aiAvailableRef = React.useRef(aiAvailable);
    aiAvailableRef.current = aiAvailable;

    // The compose editor's SQL/AI input mode, hoisted here so commands can drive it (see
    // useComposeInputMode). Kept in a ref too, so the command dispatch callback can toggle it
    // without listing the mode in its dependency array.
    const [composeInputMode, setComposeInputMode] = React.useState<number>(0);
    const composeInputModeRef = React.useRef(composeInputMode);
    composeInputModeRef.current = composeInputMode;
    // If the provider becomes unavailable while in AI mode, fall back to SQL.
    React.useEffect(() => {
        if (!aiAvailable && composeInputMode === COMPOSE_INPUT_MODE_AI) {
            setComposeInputMode(COMPOSE_INPUT_MODE_SQL);
        }
    }, [aiAvailable, composeInputMode]);
    const composeInputModeValue = React.useMemo<ComposeInputModeContextValue>(
        () => ({ mode: composeInputMode, setMode: setComposeInputMode }),
        [composeInputMode],
    );

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
                        // Scripts are analyzed eagerly at load and kept analyzed as
                        // they are edited, so the resolved VISUALIZE query / derived
                        // annotations are already present here.
                        const queryText = getExecutableQueryText(notebook, scriptData);
                        const [queryId, _run] = executeQuery(notebook.sessionId, {
                            query: queryText,
                            analyzeResults: true,
                            cacheable: true,
                            projection: projectionForVisualizeQuery(scriptData.annotations.visualizeQuery),
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
                case NotebookCommandType.ToggleComposeInputMode:
                    // AI mode requires a configured provider; otherwise stay in SQL.
                    if (!aiAvailableRef.current) break;
                    setComposeInputMode(composeInputModeRef.current === COMPOSE_INPUT_MODE_SQL
                        ? COMPOSE_INPUT_MODE_AI
                        : COMPOSE_INPUT_MODE_SQL);
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
            // Ctrl+H / Ctrl+L (page-bar navigation) and Ctrl+J / Ctrl+K (feed navigation) are
            // handled in NotebookPage, where the meta tabs (relations/functions) and the
            // editing/details view state are in scope. They fold the meta tabs into the same
            // left/right stepping and become no-ops when the feed isn't showing. They are
            // intentionally not bound here to avoid double-handling the key.
            {
                key: 'm',
                ctrlKey: true,
                callback: () => commandDispatch(NotebookCommandType.ToggleComposeInputMode),
            },
        ],
        [notebook?.connectorInfo, commandDispatch],
    );

    // Setup key event handlers
    useKeyEvents(keyHandlers);

    return (
        <COMMAND_DISPATCH_CTX.Provider value={commandDispatch}>
            <COMPOSE_INPUT_MODE_CTX.Provider value={composeInputModeValue}>
                {props.children}
            </COMPOSE_INPUT_MODE_CTX.Provider>
        </COMMAND_DISPATCH_CTX.Provider>
    );
};
