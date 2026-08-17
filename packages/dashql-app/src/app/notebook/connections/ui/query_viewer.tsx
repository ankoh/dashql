import * as React from 'react';

import {
    getQueryTarget,
    QueryHistoryViewer,
    type QueryEntry,
} from '../../../../query/ui/query_history_viewer.js';
import { QueryType } from '../../../../query/query_execution_state.js';
import { useConnectionRegistry } from '../connection_registry.js';

export * from '../../../../query/ui/query_history_viewer.js';

export function QueryViewer(props: { onClose: () => void }) {
    const [connReg] = useConnectionRegistry();
    const snapshots = React.useRef<Uint32Array>(new Uint32Array());
    const [entries, setEntries] = React.useState<QueryEntry[]>([]);

    React.useEffect(() => {
        const snaps = new Uint32Array(connReg.connectionMap.size);
        let i = 0;
        for (const [, conn] of connReg.connectionMap) {
            snaps[i++] = conn.snapshotQueriesActiveFinished;
        }

        let changed = snaps.length !== snapshots.current.length;
        if (!changed) {
            for (let j = 0; j < snaps.length; j++) {
                if (snaps[j] !== snapshots.current[j]) { changed = true; break; }
            }
        }
        if (!changed) return;
        snapshots.current = snaps;

        const next: QueryEntry[] = [];
        for (const [connectionId, conn] of connReg.connectionMap) {
            const connectorName = conn.connectorInfo.names.displayShort;
            for (const queryIds of [conn.queriesFinishedOrdered, conn.queriesActiveOrdered]) {
                for (const queryId of queryIds) {
                    const query = conn.queriesActive.get(queryId) ?? conn.queriesFinished.get(queryId);
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
        setEntries(next);
    });

    return <QueryHistoryViewer entries={entries} onClose={props.onClose} />;
}
