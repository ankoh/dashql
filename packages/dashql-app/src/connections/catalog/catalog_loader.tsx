import * as React from 'react';

import { useOptionalCoreRuntime } from '../../runtime/runtime_hooks.js';

// The catalog loader is a service of the runtime: it follows the connections, describes the ones that come online and
// asks a connection about the relations that statements touched. The runtime announces a new catalog in the view of the
// connection, the scripts that use the connection are analyzed again.

/// The hook to resolve the catalog queue: add a connection, `force` to refresh its whole catalog. It resolves the
/// runtime when it is called, a test may render a component without the runtime as long as it doesn't call it.
export function useCatalogLoaderQueue(): (connectionId: string, force: boolean) => void {
    const runtime = useOptionalCoreRuntime();
    return React.useCallback((connectionId: string, force: boolean) => {
        if (runtime == null) throw new Error('the catalog loader needs a RuntimeProvider');
        runtime.refreshCatalog(connectionId, force);
    }, [runtime]);
}
