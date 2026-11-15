import * as React from 'react';

import { useOptionalRuntime } from '../../runtime/runtime_provider.js';

// The loader is a service of the runtime (packages/dashql-runtime/src/connections/catalog/catalog_loader_service.ts). The
// runtime passes it every registry and analyzes the scripts of a connection again when its catalog changed.

/// The hook to resolve the catalog queue: add a connection, `force` to refresh its whole catalog. It resolves the
/// runtime when it is called, a test may render a component without the runtime as long as it doesn't call it.
export function useCatalogLoaderQueue(): (connectionId: string, force: boolean) => void {
    const runtime = useOptionalRuntime();
    return React.useCallback((connectionId: string, force: boolean) => {
        if (runtime == null) throw new Error('the catalog loader needs a RuntimeProvider');
        runtime.catalogLoader.enqueue(connectionId, force);
    }, [runtime]);
}
