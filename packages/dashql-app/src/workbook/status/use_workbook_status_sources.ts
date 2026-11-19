import * as React from 'react';

import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import type { ConnectionLabelParts } from '../../connections/connection_label.js';
import { QueryExecutionStatus, queryIsDone } from '@akohn/dashql/platform/query/query_execution_state';
import type { WorkbookExecutionState } from '@akohn/dashql/platform/workbook/workbook_execution';
import type { ScriptDataMap, WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import { formatMilliseconds } from '../../utils/format.js';
import { getQueryStatusText } from '../entry_status_model.js';
import type { CloudPublishStatus } from '../../cloud/cloud_publish_status.js';
import { WorkbookStatusSource, WorkbookStatusTone, type WorkbookStatus } from './workbook_status.js';
import { useLiveWorkbookStatuses, useWorkbookOutcomeTransitions } from './workbook_status_store.js';
import { useOptionalRuntime } from '@akohn/dashql-react/hooks';
import type { QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';

/// The latest query of a script
export interface ScriptQuery {
    scriptKey: number;
    name: string;
    queryId: number;
    status: QueryExecutionStatus;
    durationMs: number | null;
    error: string | null;
    /// The rows that the query received
    rows: number | null;
    fromCache: boolean;
}

/// The latest queries of the scripts of a workbook, in the order of the scripts
export function scriptQueries(workbookScripts: Pick<WorkbookScripts, 'scriptOrder' | 'scriptRefs'>, scripts: ScriptDataMap, connections: ReadonlyMap<string, ConnectionState>, readQuery: (queryId: number) => QueryExecutionState | null): ScriptQuery[] {
    const queries: ScriptQuery[] = [];
    for (const fileName of workbookScripts.scriptOrder) {
        const scriptKey = workbookScripts.scriptRefs[fileName]?.scriptId;
        const script = scriptKey != null ? scripts[scriptKey] : undefined;
        const queryId = script?.latestQueryId;
        if (scriptKey == null || script == null || queryId == null) continue;
        for (const connection of connections.values()) {
            // Fakes of connections may leave out the queries
            const query = connection.queriesActiveOrdered?.includes(queryId) || connection.queriesFinishedOrdered?.includes(queryId) ? readQuery(queryId) : null;
            if (query == null) continue;
            queries.push({
                scriptKey,
                name: scriptDisplayName(script.fileName),
                queryId,
                status: query.status,
                durationMs: query.metrics.queryDurationMs,
                error: query.error?.message ?? null,
                rows: query.metrics.streamMetrics?.totalRowsReceived ?? null,
                fromCache: query.servedFromCache === true,
            });
            break;
        }
    }
    return queries;
}

/// A connection of the workbook as the status tells it
export interface WorkbookConnectionStatus {
    connectionId: string;
    name: string;
    health: ConnectionHealth;
    refreshingCatalog: boolean;
}

export function workbookConnectionStatuses(connections: ReadonlyMap<string, ConnectionState>, label: (connection: ConnectionState) => ConnectionLabelParts): WorkbookConnectionStatus[] {
    return [...connections.values()].map(connection => ({
        connectionId: connection.connectionId,
        name: label(connection).name,
        health: connection.connectionHealth,
        refreshingCatalog: (connection.catalogUpdates?.tasksRunning.length ?? 0) > 0,
    }));
}

/// Keeps the identity of a value while its JSON is unchanged
function useStable<T>(value: T): T {
    const json = JSON.stringify(value);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return React.useMemo(() => value, [json]);
}

const RUNNING_PHASES = new Set<WorkbookExecutionState['phase']>(['planning', 'running', 'stopping']);

/// What runs: the queries of single scripts, all scripts, connections that connect and refresh their catalog, a
/// publish. What needs the user: connections that are not connected.
export function liveWorkbookStatuses(args: {
    queries: readonly ScriptQuery[];
    execution: WorkbookExecutionState | null;
    connections: readonly WorkbookConnectionStatus[];
    publish: CloudPublishStatus | null;
    now: number;
}): WorkbookStatus[] {
    const { now } = args;
    const live: WorkbookStatus[] = [];
    const execution = args.execution;
    const executing = execution != null && RUNNING_PHASES.has(execution.phase);
    if (executing) {
        const active = execution.activeFileName != null ? ` · ${scriptDisplayName(execution.activeFileName)}` : '';
        live.push({
            key: 'execute_all',
            source: WorkbookStatusSource.ExecuteAll,
            tone: WorkbookStatusTone.Progress,
            text: execution.phase === 'planning' ? 'Planning the run of all scripts'
                : execution.phase === 'stopping' ? 'Stopping the run of all scripts' : 'Running all scripts',
            detail: execution.phase === 'running' ? `${execution.completedScripts}/${execution.totalScripts}${active}` : null,
            at: now,
        });
    } else {
        // Execute All tells the queries of its run
        for (const query of args.queries) {
            if (queryIsDone(query.status)) continue;
            live.push({
                key: `query:${query.scriptKey}`,
                source: WorkbookStatusSource.Query,
                tone: WorkbookStatusTone.Progress,
                text: `Running ${query.name}`,
                // Every step of the query is a line of the log
                detail: getQueryStatusText(query.status),
                scriptKey: query.scriptKey,
                at: now,
            });
        }
    }
    if (args.publish?.phase === 'publishing') {
        live.push({ key: 'cloud:publish', source: WorkbookStatusSource.Cloud, tone: WorkbookStatusTone.Progress, text: 'Publishing the workbook', at: now });
    }
    for (const connection of args.connections) {
        if (connection.health === ConnectionHealth.CONNECTING) {
            live.push({
                key: `connection:${connection.connectionId}`,
                source: WorkbookStatusSource.Connection,
                tone: WorkbookStatusTone.Progress,
                text: `Connecting to ${connection.name}`,
                at: now,
            });
        } else if (connection.health !== ConnectionHealth.ONLINE) {
            live.push({
                key: `connection:${connection.connectionId}`,
                source: WorkbookStatusSource.Connection,
                tone: WorkbookStatusTone.Attention,
                text: `${connection.name} is not connected`,
                detail: connection.health === ConnectionHealth.FAILED ? 'the connection failed' : null,
                at: now,
            });
        } else if (connection.refreshingCatalog) {
            live.push({
                key: `catalog:${connection.connectionId}`,
                source: WorkbookStatusSource.Connection,
                tone: WorkbookStatusTone.Progress,
                text: `Refreshing the catalog of ${connection.name}`,
                at: now,
            });
        }
    }
    return live;
}

/// The lines of the log when queries of single scripts finish. Execute All logs its run as a whole, `executing`
/// leaves out the successes of its queries.
export function diffScriptQueries(prev: readonly ScriptQuery[], next: readonly ScriptQuery[], executing: boolean, now: number): WorkbookStatus[] {
    const lines: WorkbookStatus[] = [];
    for (const query of next) {
        if (!queryIsDone(query.status)) continue;
        const before = prev.find(q => q.scriptKey === query.scriptKey);
        if (before != null && before.queryId === query.queryId && queryIsDone(before.status)) continue;
        const key = `query:${query.queryId}:${now}`;
        if (query.status === QueryExecutionStatus.SUCCEEDED) {
            if (executing) continue;
            const parts: string[] = [];
            if (query.fromCache) parts.push('from the cache');
            else if (query.durationMs != null) parts.push(`in ${formatMilliseconds(query.durationMs)}`);
            if (query.rows != null) parts.push(query.rows === 1 ? '1 row' : `${query.rows.toLocaleString()} rows`);
            const detail = parts.length > 0 ? parts.join(' · ') : null;
            lines.push({ key, source: WorkbookStatusSource.Query, tone: WorkbookStatusTone.Success, text: `${query.name} ran`, detail, scriptKey: query.scriptKey, at: now });
        } else if (query.status === QueryExecutionStatus.FAILED) {
            lines.push({ key, source: WorkbookStatusSource.Query, tone: WorkbookStatusTone.Failed, text: `${query.name} failed`, detail: query.error, scriptKey: query.scriptKey, at: now });
        } else {
            lines.push({ key, source: WorkbookStatusSource.Query, tone: WorkbookStatusTone.Attention, text: `${query.name} was stopped`, scriptKey: query.scriptKey, at: now });
        }
    }
    return lines;
}

/// The line of the log when a run of all scripts finishes
export function diffExecution(prev: WorkbookExecutionState | null, next: WorkbookExecutionState | null, now: number): WorkbookStatus[] {
    if (prev == null || next == null || !RUNNING_PHASES.has(prev.phase) || RUNNING_PHASES.has(next.phase)) return [];
    const key = `execute_all:${now}`;
    const skipped = next.skippedScripts > 0 ? ` · ${next.skippedScripts} skipped, they need a connection` : '';
    switch (next.phase) {
        case 'succeeded':
            return [{ key, source: WorkbookStatusSource.ExecuteAll, tone: WorkbookStatusTone.Success, text: 'Ran all scripts', detail: `${next.completedScripts} scripts${skipped}`, at: now }];
        case 'failed':
            return [{ key, source: WorkbookStatusSource.ExecuteAll, tone: WorkbookStatusTone.Failed, text: 'Running all scripts failed', detail: next.error, at: now }];
        default:
            return [{ key, source: WorkbookStatusSource.ExecuteAll, tone: WorkbookStatusTone.Attention, text: 'Stopped the run of all scripts', detail: `${next.completedScripts}/${next.totalScripts}`, at: now }];
    }
}

/// The lines of the log when connections connect, fail or refreshed their catalog
export function diffConnections(prev: readonly WorkbookConnectionStatus[], next: readonly WorkbookConnectionStatus[], now: number): WorkbookStatus[] {
    const lines: WorkbookStatus[] = [];
    for (const connection of next) {
        const before = prev.find(c => c.connectionId === connection.connectionId);
        if (before == null) continue;
        const key = `connection:${connection.connectionId}:${now}`;
        if (before.health !== connection.health && connection.health === ConnectionHealth.ONLINE) {
            lines.push({ key, source: WorkbookStatusSource.Connection, tone: WorkbookStatusTone.Success, text: `Connected to ${connection.name}`, at: now });
        } else if (before.health !== connection.health && connection.health === ConnectionHealth.FAILED) {
            lines.push({ key, source: WorkbookStatusSource.Connection, tone: WorkbookStatusTone.Failed, text: `Connecting to ${connection.name} failed`, at: now });
        }
        if (before.refreshingCatalog && !connection.refreshingCatalog) {
            lines.push({ key: `catalog:${connection.connectionId}:${now}`, source: WorkbookStatusSource.Connection, tone: WorkbookStatusTone.Success, text: `Refreshed the catalog of ${connection.name}`, at: now });
        }
    }
    return lines;
}

/// The line of the log when a publish finishes
export function diffPublish(prev: CloudPublishStatus | null, next: CloudPublishStatus | null, now: number): WorkbookStatus[] {
    if (next == null || prev?.phase !== 'publishing' || next.phase === 'publishing') return [];
    return [next.phase === 'published' ? {
        key: `cloud:${now}`, source: WorkbookStatusSource.Cloud, tone: WorkbookStatusTone.Success,
        text: 'Published the workbook', at: now,
    } : {
        key: `cloud:${now}`, source: WorkbookStatusSource.Cloud, tone: WorkbookStatusTone.Failed,
        text: 'Publishing the workbook failed', detail: next.error, at: now,
    }];
}

/// Tell the runs, the connections and the publishes of a workbook to its bars of Wobble
export function useWorkbookStatusSources(args: {
    workbookScripts: WorkbookScripts;
    /// The scripts of the workbook by key
    scripts: ScriptDataMap;
    connections: ReadonlyMap<string, ConnectionState>;
    label: (connection: ConnectionState) => ConnectionLabelParts;
    execution: WorkbookExecutionState | null;
    publish: CloudPublishStatus | null;
}): void {
    const workbookId = args.workbookScripts.workbookId;
    const runtime = useOptionalRuntime();
    const readQuery = React.useCallback((queryId: number) => (runtime?.store.get('query', queryId) ?? null) as QueryExecutionState | null, [runtime]);
    const queries = useStable(scriptQueries(args.workbookScripts, args.scripts, args.connections, readQuery));
    const connections = useStable(workbookConnectionStatuses(args.connections, args.label));
    const execution = args.execution;
    const executing = execution != null && RUNNING_PHASES.has(execution.phase);
    const live = React.useMemo(
        () => liveWorkbookStatuses({ queries, execution, connections, publish: args.publish, now: Date.now() }),
        [queries, execution, connections, args.publish],
    );
    useLiveWorkbookStatuses(workbookId, 'workbook', live);
    useWorkbookOutcomeTransitions(workbookId, queries, (prev, next) => diffScriptQueries(prev, next, executing, Date.now()));
    useWorkbookOutcomeTransitions(workbookId, execution, (prev, next) => diffExecution(prev, next, Date.now()));
    useWorkbookOutcomeTransitions(workbookId, connections, (prev, next) => diffConnections(prev, next, Date.now()));
    useWorkbookOutcomeTransitions(workbookId, args.publish, (prev, next) => diffPublish(prev, next, Date.now()));
}
