import * as React from 'react';

import {
    getQueryTarget,
    QueryHistoryViewer,
    type QueryEntry,
} from '../query/query_history_viewer.js';
import { QueryType } from '@ankoh/dashql-runtime/query/query_execution_state';
import { useAllQueries, useConnections } from '../runtime/runtime_hooks.js';
import { connectorInfoOf } from '@ankoh/dashql-runtime/connections/connection_state';

export function QueryViewer(props: {
    onClose: () => void;
}) {
    const connections = useConnections();
    const queries = useAllQueries();
    const entries = React.useMemo(() => {
        const next: QueryEntry[] = [];
        for (const [connectionId, conn] of connections) {
            const connectorName = connectorInfoOf(conn).names.displayShort;
            for (const queryIds of [conn.queriesFinishedOrdered, conn.queriesActiveOrdered]) {
                for (const queryId of queryIds) {
                    const query = queries.get(queryId);
                    if (query == null) continue;
                    const sourceName = query.queryMetadata.queryType == QueryType.INTERNAL_SQLFRAME
                        ? 'SQLFrame'
                        : connectorName;
                    next.push({
                        connectionId,
                        sourceName,
                        target: getQueryTarget(query),
                        queryId,
                        query,
                    });
                }
            }
        }
        return next;
    }, [connections, queries]);

    return <QueryHistoryViewer entries={entries} onClose={props.onClose} />;
}
