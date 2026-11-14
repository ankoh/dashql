import * as React from 'react';

import { ConnectionHealth, printConnectionHealth, type ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { getSelectedScriptRef, newScriptConnection, SELECT_NEXT_SCRIPT, SELECT_PREV_SCRIPT, type ScriptData, type WorkbookScripts } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import type { ScriptRef } from '@ankoh/dashql-runtime/workbook/scripts/script_types';
import { useCatalogLoaderQueue } from '../../connections/catalog/catalog_loader.js';
import { useConnectionRegistryStore, useWorkbookConnections, type ConnectionRegistry } from '../../connections/connection_registry.js';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useQueryExecutor } from '../../connections/query_executor.js';
import { useRouteContext } from '../../app/router/router.js';
import { useWorkbookScripts } from './workbook_scripts_registry.js';
import { isCatalogRefreshRunning } from '@ankoh/dashql-runtime/connections/catalog/catalog_update_state';
import { runWorkbookScript } from './rerun_query.js';
import { connectionHealthKey, WorkbookConnectionAttentionContext, useWorkbookConnectionAttention } from '../workbook_connection_attention.js';
import { WorkbookViewMode, useWorkbookViewMode } from '../workbook_view_mode.js';

const LOG_CTX = "workbook_commands";

/// The selected script and the connection it runs on, the connection of the next script without a selected script
function selectedScriptConnection(workbookScripts: WorkbookScripts, registry: ConnectionRegistry): {
    entry: ScriptRef | undefined;
    scriptData: ScriptData | undefined;
    scriptConnection: ConnectionState | null;
} {
    const entry = getSelectedScriptRef(workbookScripts);
    const scriptData = entry != null ? workbookScripts.scripts[entry.scriptId] : undefined;
    const connectionId = scriptData?.connection.connectionId ?? newScriptConnection(workbookScripts, null)?.connectionId;
    const scriptConnection = connectionId == null ? null : registry.connections.get(connectionId) ?? null;
    return { entry, scriptData, scriptConnection };
}

export enum WorkbookCommandType {
    ExecuteEditorQuery = 1,
    RefreshCatalog = 2,
    SelectPreviousWorkbookScript = 6,
    SelectNextWorkbookScript = 7,
}

export type ScriptCommandDispatch = (command: WorkbookCommandType) => void;

interface Props {
    children?: React.ReactElement | React.ReactElement[];
    dependencies?: WorkbookCommandsDependencies;
}

export interface WorkbookCommandsDependencies {
    useWorkbookScripts: typeof useWorkbookScripts;
    useWorkbookConnections: typeof useWorkbookConnections;
    useConnectionRegistryStore: typeof useConnectionRegistryStore;
    useQueryExecutor: typeof useQueryExecutor;
    useCatalogLoaderQueue: typeof useCatalogLoaderQueue;
    useLogger: typeof useLogger;
    useWorkbookViewMode: typeof useWorkbookViewMode;
    runWorkbookScript: typeof runWorkbookScript;
}

const DEFAULT_DEPENDENCIES: WorkbookCommandsDependencies = {
    useWorkbookScripts, useWorkbookConnections, useConnectionRegistryStore,
    useQueryExecutor, useCatalogLoaderQueue, useLogger, useWorkbookViewMode, runWorkbookScript,
};

const COMMAND_DISPATCH_CTX = React.createContext<ScriptCommandDispatch | null>(null);
export const useWorkbookCommandDispatch = () => React.useContext(COMMAND_DISPATCH_CTX)!;

export const WorkbookCommands: React.FC<Props> = (props: Props) => {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const route = useRouteContext();
    const logger = dependencies.useLogger();
    const viewMode = dependencies.useWorkbookViewMode().mode;

    const [workbookScripts, modifyWorkbookScripts] = dependencies.useWorkbookScripts(route.workbookId ?? null);
    const connections = dependencies.useWorkbookConnections(workbookScripts?.workbookId ?? null);
    const connectionRegistryStore = dependencies.useConnectionRegistryStore();
    const connectionAttention = useWorkbookConnectionAttention(workbookScripts?.workbookId ?? null, connectionHealthKey(connections));
    const executeQuery = dependencies.useQueryExecutor();
    const refreshCatalog = dependencies.useCatalogLoaderQueue();

    // Setup command dispatch logic.
    // The workbook scripts change with every keystroke and the connection with every query event.
    // Read them through a ref to keep the dispatch (and the context value) stable.
    const latest = React.useRef({ workbookScripts, modifyWorkbookScripts, connectionAttention, executeQuery, refreshCatalog, viewMode, workbookId: route.workbookId });
    latest.current = { workbookScripts, modifyWorkbookScripts, connectionAttention, executeQuery, refreshCatalog, viewMode, workbookId: route.workbookId };
    const commandDispatch = React.useCallback(
        async (command: WorkbookCommandType) => {
            const { workbookScripts, modifyWorkbookScripts, connectionAttention, executeQuery, refreshCatalog, viewMode, workbookId } = latest.current;
            if (workbookScripts == null) {
                logger.warn("Workbook is null", {});
                return;
            }
            switch (command) {
                // Execute the query script in the current workbook
                case WorkbookCommandType.ExecuteEditorQuery:
                    logger.info("Ctrl+E workbook command received", {
                        workbookId,
                        viewMode: viewMode.toString(),
                        focusedFile: workbookScripts.scriptFocus.fileName,
                    }, LOG_CTX);
                    if (viewMode !== WorkbookViewMode.Workbook) {
                        logger.warn("Ignoring Ctrl+E outside workbook view", { workbookId }, LOG_CTX);
                        break;
                    }
                    {
                        const { entry, scriptData, scriptConnection } = selectedScriptConnection(workbookScripts, connectionRegistryStore.current);
                        if (scriptConnection == null || scriptConnection.connectionHealth !== ConnectionHealth.ONLINE) {
                            connectionAttention.request(workbookScripts.workbookId);
                            logger.warn("Cannot execute query command with an unhealthy connection", {
                                workbookId,
                                status: printConnectionHealth(scriptConnection?.connectionHealth ?? ConnectionHealth.NOT_STARTED)
                            }, LOG_CTX);
                        } else if (!entry) {
                            logger.warn("Ignoring Ctrl+E because no committed script is selected", {
                                workbookId,
                                focusedFile: workbookScripts.scriptFocus.fileName,
                            }, LOG_CTX);
                        } else if (!scriptData) {
                            logger.warn("Ignoring Ctrl+E because selected script data is missing", {
                                workbookId,
                                scriptKey: entry.scriptId.toString(),
                            }, LOG_CTX);
                        } else {
                            await dependencies.runWorkbookScript(
                                workbookScripts,
                                scriptData,
                                executeQuery,
                                modifyWorkbookScripts,
                                logger,
                            );
                        }
                    }
                    break;
                case WorkbookCommandType.RefreshCatalog: {
                    // The catalog of the connection that the selected script runs on is refreshed
                    const { scriptConnection } = selectedScriptConnection(workbookScripts, connectionRegistryStore.current);
                    if (scriptConnection?.connectionHealth != ConnectionHealth.ONLINE) {
                        logger.warn("Cannot refresh the catalog of unhealthy connection", {}, LOG_CTX);
                    } else if (isCatalogRefreshRunning(scriptConnection)) {
                        logger.debug("Catalog refresh already running", { workbookId: workbookScripts.workbookId }, LOG_CTX);
                    } else {
                        refreshCatalog(scriptConnection.connectionId, true);
                    }
                    break;
                }
                case WorkbookCommandType.SelectPreviousWorkbookScript:
                    if (modifyWorkbookScripts) {
                        modifyWorkbookScripts({
                            type: SELECT_PREV_SCRIPT,
                            value: null,
                        });
                    }
                    break;
                case WorkbookCommandType.SelectNextWorkbookScript:
                    if (modifyWorkbookScripts) {
                        modifyWorkbookScripts({
                            type: SELECT_NEXT_SCRIPT,
                            value: null,
                        });
                    }
                    break;
            }
        },
        [logger],
    );

    // Create key event handlers
    const keyHandlers = React.useMemo<KeyEventHandler[]>(
        () => [
            {
                key: 'e',
                ctrlKey: true,
                callback: () => commandDispatch(WorkbookCommandType.ExecuteEditorQuery),
            },
            {
                key: 'r',
                ctrlKey: true,
                callback: () => commandDispatch(WorkbookCommandType.RefreshCatalog),
            },
            // Ctrl+H / Ctrl+L (page-bar navigation) and Ctrl+J / Ctrl+K (feed navigation) are
            // handled in the workbook page, where the meta tabs (relations/functions) and the
            // editing/details view state are in scope. They fold the meta tabs into the same
            // left/right stepping and become no-ops when the feed isn't showing. They are
            // intentionally not bound here to avoid double-handling the key.
        ],
        [commandDispatch],
    );

    // Setup key event handlers
    useKeyEvents(keyHandlers);

    return (
        <WorkbookConnectionAttentionContext.Provider value={connectionAttention}>
            <COMMAND_DISPATCH_CTX.Provider value={commandDispatch}>
                {props.children}
            </COMMAND_DISPATCH_CTX.Provider>
        </WorkbookConnectionAttentionContext.Provider>
    );
};
