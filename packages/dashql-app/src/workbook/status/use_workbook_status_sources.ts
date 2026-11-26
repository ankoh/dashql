import * as React from 'react';

import { ConnectionHealth, type ConnectionState } from '@akohn/dashql/platform/connections/connection_state';
import type { ConnectionLabelParts } from '../../connections/connection_label.js';
import { QueryExecutionStatus, queryIsDone } from '@akohn/dashql/platform/query/query_execution_state';
import type { WorkbookRunState } from '@akohn/dashql';
import type { ScriptDataMap, WorkbookScripts } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { scriptDisplayName } from '@akohn/dashql/platform/workbook/script_types';
import { formatMilliseconds } from '@akohn/dashql-react/format/format';
import { getQueryStatusText } from '../entry_status_model.js';
import { runStepText } from '../feed/workbook_run_step.js';
import { useCloudPublishStatus, type CloudPublishStatus } from '../../cloud/cloud_publish_status.js';
import { WorkbookStatusSource, WorkbookStatusTone, type WorkbookStatus } from './workbook_status.js';
import { useLiveWorkbookStatuses, useWorkbookOutcomeTransitions } from './workbook_status_store.js';
import { useOptionalRuntime, useWorkbookExecution, useWorkbookScriptMap } from '@akohn/dashql-react/hooks';
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

/// A script with a query, the status reads its latest query
export interface ScriptLatestQuery {
    scriptKey: number;
    name: string;
    queryId: number;
}

/// The scripts of a workbook that have a query, in the order of the scripts
export function scriptsWithQueries(workbookScripts: Pick<WorkbookScripts, 'scriptOrder' | 'scriptRefs'>, scripts: ScriptDataMap): ScriptLatestQuery[] {
    const latest: ScriptLatestQuery[] = [];
    for (const fileName of workbookScripts.scriptOrder) {
        const scriptKey = workbookScripts.scriptRefs[fileName]?.scriptId;
        const script = scriptKey != null ? scripts[scriptKey] : undefined;
        if (scriptKey == null || script?.latestQueryId == null) continue;
        latest.push({ scriptKey, name: scriptDisplayName(script.fileName), queryId: script.latestQueryId });
    }
    return latest;
}

/// The latest queries of the scripts, a query that the runtime no longer holds is left out
export function scriptQueries(latest: readonly ScriptLatestQuery[], readQuery: (queryId: number) => QueryExecutionState | null): ScriptQuery[] {
    const queries: ScriptQuery[] = [];
    for (const { scriptKey, name, queryId } of latest) {
        const query = readQuery(queryId);
        if (query == null) continue;
        queries.push({
            scriptKey,
            name,
            queryId,
            status: query.status,
            durationMs: query.metrics.queryDurationMs,
            error: query.error?.message ?? null,
            rows: query.metrics.streamMetrics?.totalRowsReceived ?? null,
            fromCache: query.servedFromCache === true,
        });
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

/// The latest queries of the scripts of a workbook, see `scriptQueries`. The component renders again when one of these
/// queries changes, e.g. with a step of a running query, which the views of the connections leave out.
function useScriptQueries(workbookScripts: Pick<WorkbookScripts, 'scriptOrder' | 'scriptRefs'>, scripts: ScriptDataMap): ScriptQuery[] {
    const store = useOptionalRuntime()?.store ?? null;
    // The scripts with a query keep their identity while no script gets a new query or another name, e.g. while the
    // user types
    const latest = useStable(scriptsWithQueries(workbookScripts, scripts));
    const subscribe = React.useCallback((listener: () => void) => {
        const unsubscribes = store == null ? [] : latest.map(({ queryId }) => store.subscribe('query', queryId, listener));
        return () => unsubscribes.forEach(unsubscribe => unsubscribe());
    }, [store, latest]);
    // The JSON of the queries keeps the snapshot while they are unchanged
    const snapshot = React.useCallback(
        () => JSON.stringify(scriptQueries(latest, queryId => (store?.get('query', queryId) ?? null) as QueryExecutionState | null)),
        [store, latest],
    );
    const json = React.useSyncExternalStore(subscribe, snapshot, snapshot);
    return React.useMemo(() => JSON.parse(json) as ScriptQuery[], [json]);
}

/// Keeps the identity of a value of plain JSON while its JSON is unchanged
function useStable<T>(value: T): T {
    const json = JSON.stringify(value);
    return React.useMemo(() => JSON.parse(json) as T, [json]);
}

/// What runs: the queries of single scripts, all scripts, connections that connect and refresh their catalog, a
/// publish. What needs the user: connections that are not connected.
export function liveWorkbookStatuses(args: {
    queries: readonly ScriptQuery[];
    execution: WorkbookRunState | null;
    connections: readonly WorkbookConnectionStatus[];
    publish: CloudPublishStatus | null;
    now: number;
}): WorkbookStatus[] {
    const { now } = args;
    const live: WorkbookStatus[] = [];
    const execution = args.execution;
    const executing = execution?.busy === true;
    const connectionName = (connectionId: string) => args.connections.find(c => c.connectionId === connectionId)?.name ?? connectionId;
    if (executing) {
        const active = execution.activeFileName != null ? ` · ${scriptDisplayName(execution.activeFileName)}` : '';
        live.push({
            key: 'execute_all',
            source: WorkbookStatusSource.ExecuteAll,
            tone: WorkbookStatusTone.Progress,
            text: execution.phase === 'stopping' ? 'Stopping the run of all scripts'
                : execution.step != null ? runStepText(execution.step, connectionName)
                    : execution.phase === 'planning' ? 'Planning the run of all scripts' : 'Running all scripts',
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
            // A stored result that a script without a query shows is the workbook opening, no script ran
            if (query.fromCache && before == null) continue;
            const parts: string[] = [];
            if (query.fromCache) parts.push('stored result');
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
export function diffExecution(prev: WorkbookRunState | null, next: WorkbookRunState | null, now: number): WorkbookStatus[] {
    if (prev == null || next == null || !prev.busy || next.busy) return [];
    const key = `execute_all:${now}`;
    const skipped = next.skippedScripts > 0 ? ` · ${next.skippedScripts} skipped, they need a connection` : '';
    switch (next.phase) {
        case 'succeeded':
            return [{ key, source: WorkbookStatusSource.ExecuteAll, tone: WorkbookStatusTone.Success, text: 'Ran all scripts', detail: `${next.completedScripts} scripts${skipped}`, at: now }];
        case 'failed': {
            // The scripts that failed, the others ran on
            const failed = next.failedScripts;
            const detail = failed.length === 1 ? `${scriptDisplayName(failed[0].fileName)}: ${failed[0].message}`
                : failed.length > 1 ? `${failed.length} scripts failed: ${failed.map(f => scriptDisplayName(f.fileName)).join(', ')}` : next.error;
            return [{ key, source: WorkbookStatusSource.ExecuteAll, tone: WorkbookStatusTone.Failed, text: 'Running all scripts failed', detail, at: now }];
        }
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

interface WorkbookStatusSourcesProps {
    workbookScripts: WorkbookScripts;
    /// The connections that the scripts run on
    connections: ReadonlyMap<string, ConnectionState>;
    label: (connection: ConnectionState) => ConnectionLabelParts;
}

/// Tell the runs, the queries, the connections and the publishes of a workbook to its bars of Wobble. A component of its
/// own that shows nothing: it reads the latest query of every script, so it renders again with every keystroke and
/// every step of a run, the prompt around it doesn't.
export const WorkbookStatusSources = React.memo(function WorkbookStatusSources({ workbookScripts, connections: connectionStates, label }: WorkbookStatusSourcesProps): null {
    const workbookId = workbookScripts.workbookId;
    const scripts = useWorkbookScriptMap(workbookId);
    const execution = useWorkbookExecution(workbookId).state;
    const publish = useCloudPublishStatus(workbookId);
    const queries = useScriptQueries(workbookScripts, scripts);
    const connections = useStable(workbookConnectionStatuses(connectionStates, label));
    const executing = execution?.busy === true;
    const live = React.useMemo(
        () => liveWorkbookStatuses({ queries, execution, connections, publish, now: Date.now() }),
        [queries, execution, connections, publish],
    );
    useLiveWorkbookStatuses(workbookId, 'workbook', live);
    useWorkbookOutcomeTransitions(workbookId, queries, (prev, next) => diffScriptQueries(prev, next, executing, Date.now()));
    useWorkbookOutcomeTransitions(workbookId, execution, (prev, next) => diffExecution(prev, next, Date.now()));
    useWorkbookOutcomeTransitions(workbookId, connections, (prev, next) => diffConnections(prev, next, Date.now()));
    useWorkbookOutcomeTransitions(workbookId, publish, (prev, next) => diffPublish(prev, next, Date.now()));
    return null;
});
