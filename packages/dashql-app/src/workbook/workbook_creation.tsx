import * as React from 'react';
import { OPEN_EPHEMERAL_WORKBOOK, useRouterNavigate } from '../app/router.js';
import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { findEmbeddedConnection, newWorkbookConnection } from '../connections/embedded_connection.js';
import { getHyperLinkTabState } from '../connections/hyper/hyper_link.js';
import {
    EPHEMERAL_WORKBOOK_NAME,
    WorkbookScripts,
} from '@akohn/dashql/platform/workbook/workbook_scripts';
import { useCreateWorkbook } from './workbook_lifecycle.js';
import { useOptionalRuntime } from '@akohn/dashql-react/hooks';
import { WorkbookViewMode, useWorkbookViewMode } from './workbook_view_mode.js';

/// Create a workbook whose first script runs on a connection, a workbook without a name gets a free one
export type WorkbookCreation = (database: ConnectionState, name?: string) => WorkbookScripts;

export function useWorkbookCreation(): WorkbookCreation {
    const allocate = useCreateWorkbook();
    const runtime = useOptionalRuntime();
    return React.useCallback((database: ConnectionState, name?: string) => {
        // The runtime names a free name, the ephemeral workbook gives up its name
        return allocate(database.connectionId, name ?? runtime?.store.get('workbookList', 'root')?.nextWorkbookName ?? 'Untitled', false);
    }, [allocate, runtime]);
}

/// The ephemeral workbook of the greeter, created on the connection if there is none.
///
/// There is one at most: the app creates it at launch and again after every promotion. It keeps the connection that the
/// user picked, unless the connection is the one of a Hyper link: a link moves the workbook to its connection, and a
/// workbook on the connection of a link that is gone moves back.
export function useEphemeralWorkbook(): (database: ConnectionState) => WorkbookScripts {
    const allocate = useCreateWorkbook();
    const runtime = useOptionalRuntime();
    return React.useCallback((database: ConnectionState) => {
        const existing = [...runtime?.store.all('workbook').values() ?? []].find(workbook => workbook.ephemeral);
        if (existing == null) return allocate(database.connectionId, EPHEMERAL_WORKBOOK_NAME, true);
        const current = existing.nextScriptConnectionId ?? null;
        const currentLinked = current == null ? false : runtime?.connection(current)?.hyperLink ?? false;
        if (current !== database.connectionId && (getHyperLinkTabState().current === database.connectionId || currentLinked)) {
            runtime?.dispatch({ workbook: existing.workbookId }, { kind: 'setPendingConnection', value: { connectionId: database.connectionId } });
        }
        return existing;
    }, [allocate, runtime]);
}

/// The ephemeral workbook on the connection that new workbooks start on, null before the app set up its connections
export function useEnsureEphemeralWorkbook(): () => WorkbookScripts | null {
    const runtime = useOptionalRuntime();
    const ephemeralWorkbook = useEphemeralWorkbook();
    return React.useCallback(() => {
        if (runtime == null) return null;
        const connections = runtime.store.all('connection') as ReadonlyMap<string, ConnectionState>;
        const embedded = findEmbeddedConnection(connections.values());
        if (embedded == null) return null;
        const allocate = runtime.createConnection.bind(runtime);
        return ephemeralWorkbook(newWorkbookConnection(connections, allocate, getHyperLinkTabState().current));
    }, [ephemeralWorkbook, runtime]);
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
