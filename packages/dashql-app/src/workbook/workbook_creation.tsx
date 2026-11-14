import * as React from 'react';
import { OPEN_EPHEMERAL_WORKBOOK, useRouterNavigate } from '../app/router/router.js';
import { useConnectionAllocator, useConnectionRegistryStore } from '../connections/connection_registry.js';
import { ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { findEmbeddedConnection, newWorkbookConnection } from '@ankoh/dashql-runtime/connections/embedded_connection';
import { isHyperLinkParams } from '@ankoh/dashql-runtime/connections/hyper/hyper_link';
import { getHyperLinkTabState } from '../connections/hyper/hyper_link_tab.js';
import {
    EPHEMERAL_WORKBOOK_NAME,
    freeWorkbookName,
    isEphemeralWorkbook,
    newScriptConnection,
    scriptConnectionOf,
    WorkbookScripts,
    SET_PENDING_CONNECTION,
    takenWorkbookNames,
} from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { useWorkbookScriptsDispatch, useWorkbookScriptsRegistryReader, useWorkbookScriptsRegistryService } from './scripts/workbook_scripts_registry.js';
import { WorkbookViewMode, useWorkbookViewMode } from './workbook_view_mode.js';

/// Create a workbook whose first script runs on a connection, a workbook without a name gets a free one
export type WorkbookCreation = (database: ConnectionState, name?: string) => WorkbookScripts;

/// Allocate a workbook without scripts and write its first manifest
function useWorkbookAllocation(): (database: ConnectionState, name: string, ephemeral: boolean) => WorkbookScripts {
    const service = useWorkbookScriptsRegistryService();
    return React.useCallback((database: ConnectionState, name: string, ephemeral: boolean) => service.create(database, name, ephemeral), [service]);
}

export function useWorkbookCreation(): WorkbookCreation {
    const allocate = useWorkbookAllocation();
    const readRegistry = useWorkbookScriptsRegistryReader();
    return React.useCallback((database: ConnectionState, name?: string) => (
        allocate(database, name ?? freeWorkbookName(takenWorkbookNames(readRegistry().workbookScriptsMap.values())), false)
    ), [allocate, readRegistry]);
}

/// The ephemeral workbook of the greeter, created on the connection if there is none.
///
/// There is one at most: the app creates it at launch and again after every promotion. It keeps the connection that the
/// user picked, unless the connection is the one of a Hyper link: a link moves the workbook to its connection, and a
/// workbook on the connection of a link that is gone moves back.
export function useEphemeralWorkbook(): (database: ConnectionState) => WorkbookScripts {
    const allocate = useWorkbookAllocation();
    const readRegistry = useWorkbookScriptsRegistryReader();
    const modifyWorkbookScripts = useWorkbookScriptsDispatch();
    return React.useCallback((database: ConnectionState) => {
        const existing = [...readRegistry().workbookScriptsMap.values()].find(isEphemeralWorkbook);
        if (existing == null) return allocate(database, EPHEMERAL_WORKBOOK_NAME, true);
        const current = newScriptConnection(existing, null);
        if (current?.connectionId !== database.connectionId && (
            getHyperLinkTabState().current === database.connectionId || (current?.params != null && isHyperLinkParams(current.params))
        )) {
            void modifyWorkbookScripts(existing.workbookId, { type: SET_PENDING_CONNECTION, value: scriptConnectionOf(database) });
        }
        return existing;
    }, [allocate, modifyWorkbookScripts, readRegistry]);
}

/// The ephemeral workbook on the connection that new workbooks start on, null before the app set up its connections
export function useEnsureEphemeralWorkbook(): () => WorkbookScripts | null {
    const registryStore = useConnectionRegistryStore();
    const allocateConnection = useConnectionAllocator();
    const ephemeralWorkbook = useEphemeralWorkbook();
    return React.useCallback(() => {
        const { connections } = registryStore.current;
        const embedded = findEmbeddedConnection(connections.values());
        if (embedded == null) return null;
        return ephemeralWorkbook(newWorkbookConnection(connections, allocateConnection, embedded.instance, getHyperLinkTabState().current));
    }, [allocateConnection, ephemeralWorkbook, registryStore]);
}

/// Open the greeter, the feed of the ephemeral workbook at the root of the app
export function useOpenGreeter(): () => void {
    const ensureEphemeralWorkbook = useEnsureEphemeralWorkbook();
    const navigate = useRouterNavigate();
    const { setMode } = useWorkbookViewMode();
    return React.useCallback(() => {
        const workbook = ensureEphemeralWorkbook();
        if (workbook == null) return;
        setMode(WorkbookViewMode.Workbook);
        navigate({ type: OPEN_EPHEMERAL_WORKBOOK, value: workbook.workbookId });
    }, [ensureEphemeralWorkbook, navigate, setMode]);
}
