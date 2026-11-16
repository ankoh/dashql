import * as React from 'react';

import type { ConnectionState } from '@ankoh/dashql-runtime/connections/connection_state';
import { connectionLabelParts, connectionOrdinals, type ConnectionLabelParts } from '@ankoh/dashql-runtime/connections/connection_label';
import { useConnectionList } from '../runtime/runtime_hooks.js';

/// The ordinals that tell connections of the same connector apart, from the list of the connections of the runtime.
/// The list changes when connections come, go or are used by other workbooks, not with their queries. Views outside of
/// a runtime (e.g. in tests) number no connections.
export function useConnectionOrdinals(): ReadonlyMap<string, number> {
    const list = useConnectionList();
    return React.useMemo(() => connectionOrdinals(list), [list]);
}

/// Label connections after their connectors and their ordinals
export function useConnectionLabeler(): (database: ConnectionState) => ConnectionLabelParts {
    const ordinals = useConnectionOrdinals();
    return React.useCallback(
        (database: ConnectionState) => connectionLabelParts(database, ordinals.get(database.connectionId) ?? null),
        [ordinals],
    );
}
