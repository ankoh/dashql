import * as React from 'react';
import * as core from '@ankoh/dashql-core';

import { useEmbeddedConnection } from '../connections/embedded_connection_hooks.js';
import { DETACH_CONNECTION, scriptConnectionOf } from '@ankoh/dashql-runtime/workbook/scripts/workbook_scripts';
import { useConnectionScriptsDispatch } from './scripts/workbook_scripts_registry.js';

/// Detach a connection from the workbooks
export type ConnectionDetach = (dql: core.DashQL, connectionId: string) => Promise<void>;

/// Detach a connection from every workbook whose next script would merely run on it.
///
/// Workbooks without scripts hold the embedded Hyper again. Workbooks with scripts on the connection
/// keep it, see DETACH_CONNECTION.
export function useDetachConnection(): ConnectionDetach {
    const resolveEmbeddedConnection = useEmbeddedConnection();
    const scriptsDispatch = useConnectionScriptsDispatch();
    return React.useCallback(async (dql: core.DashQL, connectionId: string) => {
        const embedded = resolveEmbeddedConnection(dql);
        if (embedded.connectionId === connectionId) return;
        await scriptsDispatch(connectionId, { type: DETACH_CONNECTION, value: { from: connectionId, into: scriptConnectionOf(embedded) } });
    }, [resolveEmbeddedConnection, scriptsDispatch]);
}
