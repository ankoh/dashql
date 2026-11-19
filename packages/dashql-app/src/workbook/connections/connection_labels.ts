import * as React from 'react';

import type { ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import { connectionLabelOf, connectionLabels, type ConnectionLabelParts } from '../../connections/connection_label.js';
import { useConnectionList } from '@akohn/dashql-react/hooks';

/// The labels of the listed connections by id, numbered by the list of the connections of the runtime. The list changes
/// when connections come, go, are renamed or are used by other workbooks, not with their queries. Views outside of a
/// runtime (e.g. in tests) have none.
export function useConnectionLabels(): ReadonlyMap<string, ConnectionLabelParts> {
    const list = useConnectionList();
    return React.useMemo(() => connectionLabels(list), [list]);
}

/// Label connections with the labels of the list
export function useConnectionLabeler(): (database: Pick<ConnectionState, 'connectionId' | 'label'>) => ConnectionLabelParts {
    const labels = useConnectionLabels();
    return React.useCallback((database: Pick<ConnectionState, 'connectionId' | 'label'>) => connectionLabelOf(database, labels), [labels]);
}
