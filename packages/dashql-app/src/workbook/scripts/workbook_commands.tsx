import * as React from 'react';

import { ConnectionHealth, type ConnectionState } from '@ankoh/dashql/platform/connections/connection_state';
import { KeyEventHandler, useKeyEvents } from '../../utils/key_events.js';
import { type ScriptData, type WorkbookScripts } from '@ankoh/dashql/platform/workbook/scripts/workbook_scripts';
import { useScriptSelection } from './script_selection.js';
import type { ScriptRef } from '@ankoh/dashql/platform/workbook/scripts/script_types';
import { useLogger } from '../../platform/logger/logger_provider.js';
import { useRouteContext } from '../../app/router/router.js';
import { useConnectionViews, useOptionalRuntime, useScriptRun, useWorkbook } from '../../runtime/runtime_hooks.js';
import { connectionHealthKey, WorkbookConnectionAttentionContext, useWorkbookConnectionAttention } from '../workbook_connection_attention.js';
import { WorkbookViewMode, useWorkbookViewMode } from '../workbook_view_mode.js';

const LOG_CTX = "workbook_commands";

/// The selected script and the connection it runs on, the connection of the next script without a selected script
function selectedScriptConnection(
    workbookScripts: WorkbookScripts,
    entry: ScriptRef | undefined,
    readConnection: (connectionId: string) => ConnectionState | null,
    readScript: (scriptKey: number) => ScriptData | null,
): {
    entry: ScriptRef | undefined;
    scriptData: ScriptData | undefined;
    scriptConnection: ConnectionState | null;
} {
    const scriptData = entry != null ? readScript(entry.scriptId) ?? undefined : undefined;
    const connectionId = scriptData?.connectionId ?? workbookScripts.nextScriptConnectionId ?? null;
    const scriptConnection = connectionId == null ? null : readConnection(connectionId);
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
    useWorkbook: typeof useWorkbook;
    useConnectionsOfWorkbook: typeof useConnectionsOfWorkbook;
    useConnectionReader: typeof useConnectionReader;
    useRefreshCatalog: typeof useRefreshCatalog;
    useLogger: typeof useLogger;
    useWorkbookViewMode: typeof useWorkbookViewMode;
    useScriptReader: typeof useScriptReader;
    useScriptRun: typeof useScriptRun;
}

/// Read a script of the last flush without subscribing to it
function useScriptReader(): (scriptKey: number) => ScriptData | null {
    const runtime = useOptionalRuntime();
    return React.useCallback((scriptKey: number) => runtime?.store.get('script', scriptKey) ?? null, [runtime]);
}

/// Read a connection of the last flush without subscribing to it
function useConnectionReader(): (connectionId: string) => ConnectionState | null {
    const runtime = useOptionalRuntime();
    return React.useCallback((connectionId: string) => (runtime?.store.get('connection', connectionId) ?? null) as ConnectionState | null, [runtime]);
}

/// Refresh the catalog of a connection, `force` refreshes the whole catalog. Without a runtime nothing is refreshed.
function useRefreshCatalog(): (connectionId: string, force: boolean) => void {
    const runtime = useOptionalRuntime();
    return React.useCallback((connectionId: string, force: boolean) => runtime?.module.refreshCatalog(connectionId, force), [runtime]);
}

/// The connections that a workbook uses, from the view of the workbook: the connections of its scripts, then its
/// pending connection. Null while one of them is unknown.
function useConnectionsOfWorkbook(workbookId: string | null): ConnectionState[] | null {
    return useConnectionViews(useWorkbook(workbookId)?.connectionIds);
}

const DEFAULT_DEPENDENCIES: WorkbookCommandsDependencies = {
    useWorkbook, useConnectionsOfWorkbook, useConnectionReader,
    useRefreshCatalog, useLogger, useWorkbookViewMode, useScriptReader, useScriptRun,
};

const COMMAND_DISPATCH_CTX = React.createContext<ScriptCommandDispatch | null>(null);
export const useWorkbookCommandDispatch = () => React.useContext(COMMAND_DISPATCH_CTX)!;

export const WorkbookCommands: React.FC<Props> = (props: Props) => {
    const dependencies = props.dependencies ?? DEFAULT_DEPENDENCIES;
    const route = useRouteContext();
    const logger = dependencies.useLogger();
    const viewMode = dependencies.useWorkbookViewMode().mode;

    const workbookScripts = dependencies.useWorkbook(route.workbookId ?? null);
    const connections = dependencies.useConnectionsOfWorkbook(workbookScripts?.workbookId ?? null);
    const readConnection = dependencies.useConnectionReader();
    const connectionAttention = useWorkbookConnectionAttention(workbookScripts?.workbookId ?? null, connectionHealthKey(connections));
    const refreshCatalog = dependencies.useRefreshCatalog();
    const readScript = dependencies.useScriptReader();
    const runScript = dependencies.useScriptRun();
    const selection = useScriptSelection();

    // Setup command dispatch logic.
    // The workbook and the connection change with the workbook and with every query event. Read them through a ref to
    // keep the dispatch (and the context value) stable.
    const latest = React.useRef({ workbookScripts, connectionAttention, refreshCatalog, viewMode, workbookId: route.workbookId, readConnection, readScript, runScript });
    latest.current = { workbookScripts, connectionAttention, refreshCatalog, viewMode, workbookId: route.workbookId, readConnection, readScript, runScript };
    const commandDispatch = React.useCallback(
        async (command: WorkbookCommandType) => {
            const { workbookScripts, connectionAttention, refreshCatalog, viewMode, workbookId, readConnection, readScript, runScript } = latest.current;
            if (workbookScripts == null) {
                logger.warn("Workbook is null", {});
                return;
            }
            const selected = selection.selectedRef(workbookScripts);
            switch (command) {
                // Execute the query script in the current workbook
                case WorkbookCommandType.ExecuteEditorQuery:
                    logger.info("Ctrl+E workbook command received", {
                        workbookId,
                        viewMode: viewMode.toString(),
                        focusedFile: selected?.fileName ?? '',
                    }, LOG_CTX);
                    if (viewMode !== WorkbookViewMode.Workbook) {
                        logger.warn("Ignoring Ctrl+E outside workbook view", { workbookId }, LOG_CTX);
                        break;
                    }
                    {
                        const { entry, scriptData, scriptConnection } = selectedScriptConnection(workbookScripts, selected, readConnection, readScript);
                        if (scriptConnection == null || scriptConnection.connectionHealth !== ConnectionHealth.ONLINE) {
                            connectionAttention.request(workbookScripts.workbookId);
                            logger.warn("Cannot execute query command with an unhealthy connection", {
                                workbookId,
                                status: scriptConnection?.healthLabel ?? 'Not Started',
                            }, LOG_CTX);
                        } else if (!entry) {
                            logger.warn("Ignoring Ctrl+E because no committed script is selected", {
                                workbookId,
                                focusedFile: selected?.fileName ?? '',
                            }, LOG_CTX);
                        } else if (!scriptData) {
                            logger.warn("Ignoring Ctrl+E because selected script data is missing", {
                                workbookId,
                                scriptKey: entry.scriptId.toString(),
                            }, LOG_CTX);
                        } else if (runScript == null) {
                            logger.warn("Ignoring Ctrl+E without the runtime", { workbookId }, LOG_CTX);
                        } else {
                            await runScript(workbookScripts.workbookId, scriptData.scriptKey);
                        }
                    }
                    break;
                case WorkbookCommandType.RefreshCatalog: {
                    // The catalog of the connection that the selected script runs on is refreshed
                    const { scriptConnection } = selectedScriptConnection(workbookScripts, selected, readConnection, readScript);
                    if (scriptConnection?.connectionHealth != ConnectionHealth.ONLINE) {
                        logger.warn("Cannot refresh the catalog of unhealthy connection", {}, LOG_CTX);
                    } else if (scriptConnection.catalogUpdates.refreshRunning) {
                        logger.debug("Catalog refresh already running", { workbookId: workbookScripts.workbookId }, LOG_CTX);
                    } else {
                        refreshCatalog(scriptConnection.connectionId, true);
                    }
                    break;
                }
                case WorkbookCommandType.SelectPreviousWorkbookScript:
                    selection.selectNeighbor(workbookScripts, -1);
                    break;
                case WorkbookCommandType.SelectNextWorkbookScript:
                    selection.selectNeighbor(workbookScripts, 1);
                    break;
            }
        },
        [logger, selection],
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
