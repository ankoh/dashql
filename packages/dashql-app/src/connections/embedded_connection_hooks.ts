import * as React from 'react';

import type { ConnectionState } from '@ankoh/dashql/platform/connections/connection_state';
import { embeddedConnection, newWorkbookConnection } from './embedded_connection.js';
import { useOptionalRuntime } from '../runtime/runtime_hooks.js';
import { getHyperLinkTabState } from './hyper/hyper_link_tab.js';

/// Resolve the connection that new workbooks start on, see `newWorkbookConnection`
export function useNewWorkbookConnection(): () => ConnectionState {
    const runtime = useOptionalRuntime();
    return React.useCallback(() => {
        if (runtime == null) throw new Error('the connections need a RuntimeProvider');
        const connections = runtime.store.all('connection') as ReadonlyMap<string, ConnectionState>;
        return newWorkbookConnection(connections, (connection, id) => runtime.createConnection(connection, id), getHyperLinkTabState().current);
    }, [runtime]);
}

/// Resolve the connection to the embedded Hyper, see `embeddedConnection`
export function useEmbeddedConnection(): () => ConnectionState {
    const runtime = useOptionalRuntime();
    return React.useCallback(() => {
        if (runtime == null) throw new Error('the connections need a RuntimeProvider');
        const connections = runtime.store.all('connection') as ReadonlyMap<string, ConnectionState>;
        return embeddedConnection(connections.values(), (connection, id) => runtime.createConnection(connection, id));
    }, [runtime]);
}
