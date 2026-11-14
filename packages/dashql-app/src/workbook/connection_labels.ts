import * as React from 'react';

import type { ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { useConnectionReferences, useConnectionRegistryStore } from '../connections/connection_registry.js';
import { connectionLabelParts, type ConnectionLabelParts } from '@ankoh/dashql-runtime/connections/connection_label';
import { connectionOrdinals } from '@ankoh/dashql-runtime/connections/connection_registry_state';
import { useWorkbookScriptsRegistry } from './scripts/workbook_scripts_registry.js';

const subscribeNever = () => () => {};

/// The ordinals that tell connections of the same connector apart, see `connectionOrdinals`.
/// The map keeps its identity while the ordinals are unchanged.
export function useConnectionOrdinals(): ReadonlyMap<string, number> {
    // Re-number when the workbooks use other connections
    const [scripts] = useWorkbookScriptsRegistry();
    const references = useConnectionReferences();
    // The registry changes with every query, the selector returns a string to compare by value
    const selectKey = React.useCallback(
        (registry: Parameters<typeof connectionOrdinals>[0]) => [...connectionOrdinals(registry, references)]
            .map(([connectionId, ordinal]) => `${connectionId}=${ordinal}`)
            .join(','),
        [references, scripts],
    );
    // Views outside of a connection registry (e.g. in tests) number no connections
    const store = useConnectionRegistryStore();
    const key = React.useSyncExternalStore(store?.subscribe ?? subscribeNever, () => store == null ? '' : selectKey(store.current));
    return React.useMemo(() => new Map(key.length === 0 ? [] : key.split(',').map(entry => {
        const [connectionId, ordinal] = entry.split('=');
        return [connectionId, Number(ordinal)] as const;
    })), [key]);
}

/// Label connections after their connectors and their ordinals
export function useConnectionLabeler(): (database: ConnectionState) => ConnectionLabelParts {
    const ordinals = useConnectionOrdinals();
    return React.useCallback(
        (database: ConnectionState) => connectionLabelParts(database, ordinals.get(database.connectionId) ?? null),
        [ordinals],
    );
}
