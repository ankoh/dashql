import * as React from 'react';

import type { LogRecord } from '@ankoh/dashql-runtime/platform/logger/log_buffer';
import { pollLogVersion, useLogger } from '../../platform/logger/logger_provider.js';
import { findWorkbookQueries, useConnectionRegistryStore } from '../../connections/connection_registry.js';

/// The log key of the workbook that a record is about
export const WORKBOOK_LOG_KEY = 'workbookId';

/// Does a record of the log belong to a workbook? Records name their workbook with the key `workbookId`, the records
/// of a query belong to its trace.
export function isWorkbookLogRecord(record: LogRecord, workbookId: string, traceIds: ReadonlySet<number>): boolean {
    if (record.keyValues[WORKBOOK_LOG_KEY] === workbookId) return true;
    return record.tracing != null && traceIds.has(record.tracing.traceId);
}

/// The traces of the queries of a workbook, active and finished
function workbookTraceIds(store: ReturnType<typeof useConnectionRegistryStore>, workbookId: string): Set<number> {
    const traceIds = new Set<number>();
    // Outside the runtime, e.g. in a test, there are no connections
    for (const connection of store.current?.connections.values() ?? []) {
        for (const queryId of findWorkbookQueries(connection, workbookId)) {
            const query = connection.queriesActive.get(queryId) ?? connection.queriesFinished.get(queryId);
            if (query != null) traceIds.add(query.traceId);
        }
    }
    return traceIds;
}

/// The records of the log of the app that belong to a workbook, in their order. Follows the log while `enabled`,
/// e.g. while the log of Wobble is open. The records are the ones the log window shows, scoped to the workbook.
export function useWorkbookLog(workbookId: string, enabled: boolean): readonly LogRecord[] {
    const logger = useLogger();
    const registry = useConnectionRegistryStore();
    const version = pollLogVersion(200, enabled);
    // The records read so far, a new trace of the workbook reads the log again from the start
    const scan = React.useRef<{ workbookId: string; traceIds: Set<number>; scanned: number; records: LogRecord[] } | null>(null);
    return React.useMemo(() => {
        if (!enabled) return [];
        const traceIds = workbookTraceIds(registry, workbookId);
        let state = scan.current;
        const newTrace = state != null && [...traceIds].some(id => !state!.traceIds.has(id));
        if (state == null || state.workbookId !== workbookId || newTrace) {
            state = { workbookId, traceIds, scanned: 0, records: [] };
        }
        const buffer = logger.buffer;
        const length = buffer.length;
        const records = state.scanned < length ? [...state.records] : state.records;
        for (let i = state.scanned; i < length; ++i) {
            const record = buffer.at(i);
            if (record != null && isWorkbookLogRecord(record, workbookId, traceIds)) records.push(record);
        }
        scan.current = { workbookId, traceIds, scanned: length, records };
        return records;
        // The version of the log tells new records
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [logger, registry, workbookId, enabled, version]);
}
