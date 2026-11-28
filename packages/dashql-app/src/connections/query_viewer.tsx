import * as React from 'react';

import {
    getQuerySourceName,
    QueryHistoryViewer,
    type QueryEntry,
} from '@akohn/dashql-react/components/query_history_viewer';
import { useAllQueries, useConnections } from '@akohn/dashql-react/hooks';
import { connectorInfoOf } from '@akohn/dashql/platform/connections/connection_state';

export function QueryViewer(props: {
    onClose: () => void;
}) {
    const connections = useConnections();
    const queries = useAllQueries();
    const entries = React.useMemo(() => {
        const next: QueryEntry[] = [];
        for (const conn of connections.values()) {
            const connectorName = connectorInfoOf(conn).names.displayShort;
            for (const queryIds of [conn.queriesFinishedOrdered, conn.queriesActiveOrdered]) {
                for (const queryId of queryIds) {
                    const query = queries.get(queryId);
                    if (query == null) continue;
                    next.push({ sourceName: getQuerySourceName(query, connectorName), query });
                }
            }
        }
        return next;
    }, [connections, queries]);

    return <QueryHistoryViewer entries={entries} onClose={props.onClose} />;
}
