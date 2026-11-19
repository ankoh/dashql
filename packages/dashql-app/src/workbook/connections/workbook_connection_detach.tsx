import * as React from 'react';

import { useEmbeddedConnection } from '../../connections/embedded_connection_hooks.js';
import { useOptionalRuntime } from '@akohn/dashql-react/hooks';

/// Detach a connection from the workbooks
export type ConnectionDetach = (connectionId: string) => Promise<void>;

/// Detach a connection from every workbook whose next script would merely run on it.
///
/// Workbooks without scripts hold the embedded Hyper again. Workbooks with scripts on the connection
/// keep it, see the action `detachConnection` of a workbook.
export function useDetachConnection(): ConnectionDetach {
    const resolveEmbeddedConnection = useEmbeddedConnection();
    const runtime = useOptionalRuntime();
    return React.useCallback(async (connectionId: string) => {
        if (runtime == null) throw new Error('the workbooks need a RuntimeProvider');
        const embedded = resolveEmbeddedConnection();
        if (embedded.connectionId === connectionId) return;
        for (const workbookId of runtime.connection(connectionId)?.workbooks ?? []) {
            runtime.dispatch({ workbook: workbookId }, { kind: 'detachConnection', value: { from: connectionId, into: embedded.connectionId } });
        }
        runtime.flush();
    }, [resolveEmbeddedConnection, runtime]);
}
