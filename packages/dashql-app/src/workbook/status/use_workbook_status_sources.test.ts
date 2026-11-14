import { describe, expect, it } from 'vitest';

import { ConnectionHealth } from '../../connections/connection_state.js';
import { QueryExecutionStatus } from '../../query/query_execution_state.js';
import type { WorkbookExecutionState } from '../scripts/workbook_execution.js';
import { diffConnections, diffExecution, diffPublish, diffScriptQueries, liveWorkbookStatuses, type ScriptQuery, type WorkbookConnectionStatus } from './use_workbook_status_sources.js';
import { pickWorkbookStatus, WorkbookStatusSource, WorkbookStatusTone, type WorkbookStatus } from './workbook_status.js';

const NOW = 1000;

function query(scriptKey: number, queryId: number, status: QueryExecutionStatus, extra: Partial<ScriptQuery> = {}): ScriptQuery {
    return {
        scriptKey, name: `${scriptKey}_script`, queryId, status, durationMs: 120, error: null,
        statementIndex: null, statementCount: null, statementSucceeded: false, rows: 42, fromCache: false, ...extra,
    };
}

function execution(phase: WorkbookExecutionState['phase'], extra: Partial<WorkbookExecutionState> = {}): WorkbookExecutionState {
    return {
        phase, totalScripts: 3, completedScripts: 1, totalStatements: 3, completedStatements: 1,
        activeFileName: '2_revenue.sql', activeStatementIndex: 0, activeStatementCount: 1,
        error: null, skippedScripts: 0, skippedFiles: [], ...extra,
    };
}

function connection(health: ConnectionHealth, refreshingCatalog = false): WorkbookConnectionStatus {
    return { connectionId: 'c1', name: 'Trino', health, refreshingCatalog };
}

const texts = (statuses: WorkbookStatus[]) => statuses.map(status => [status.tone, status.text, status.detail ?? null]);

describe('Workbook status', () => {
    it('picks what runs, then what needs the user, then the newest line of the log', () => {
        const at = NOW;
        const line: WorkbookStatus = { key: 'l', source: WorkbookStatusSource.Query, tone: WorkbookStatusTone.Success, text: 'ran', at };
        const attention: WorkbookStatus = { key: 'a', source: WorkbookStatusSource.Connection, tone: WorkbookStatusTone.Attention, text: 'not connected', at };
        const query: WorkbookStatus = { key: 'q', source: WorkbookStatusSource.Query, tone: WorkbookStatusTone.Progress, text: 'query', at };
        const agent: WorkbookStatus = { key: 'g', source: WorkbookStatusSource.Agent, tone: WorkbookStatusTone.Progress, text: 'agent', at };
        expect(pickWorkbookStatus([], [])).toBeNull();
        expect(pickWorkbookStatus([], [line])).toBe(line);
        expect(pickWorkbookStatus([attention], [line])).toBe(attention);
        expect(pickWorkbookStatus([attention, query], [line])).toBe(query);
        expect(pickWorkbookStatus([query, agent], [line])).toBe(agent);
    });

    it('tells the running queries, a run of all scripts instead of its queries, publishes and connections', () => {
        const queries = [query(1, 10, QueryExecutionStatus.RUNNING, { statementIndex: 1, statementCount: 3 }), query(2, 11, QueryExecutionStatus.SUCCEEDED)];
        expect(texts(liveWorkbookStatuses({ queries, execution: null, connections: [], publish: null, now: NOW }))).toEqual([
            ['progress', 'Running 1_script', 'Executing statement 1 of 3'],
        ]);
        expect(texts(liveWorkbookStatuses({ queries, execution: execution('running'), connections: [], publish: null, now: NOW }))).toEqual([
            ['progress', 'Running all scripts', '1/3 · 2_revenue'],
        ]);
        expect(texts(liveWorkbookStatuses({
            queries: [], execution: execution('succeeded'), publish: { phase: 'publishing', error: null }, now: NOW,
            connections: [connection(ConnectionHealth.CONNECTING), { ...connection(ConnectionHealth.FAILED), connectionId: 'c2' }, { ...connection(ConnectionHealth.ONLINE, true), connectionId: 'c3' }],
        }))).toEqual([
            ['progress', 'Publishing the workbook', null],
            ['progress', 'Connecting to Trino', null],
            ['attention', 'Trino is not connected', 'the connection failed'],
            ['progress', 'Refreshing the catalog of Trino', null],
        ]);
    });

    it('logs the queries that finish, without the successes of a run of all scripts', () => {
        const running = [query(1, 10, QueryExecutionStatus.RUNNING), query(2, 11, QueryExecutionStatus.RUNNING)];
        const done = [query(1, 10, QueryExecutionStatus.SUCCEEDED), query(2, 11, QueryExecutionStatus.FAILED, { error: 'no such table' })];
        expect(texts(diffScriptQueries(running, done, false, NOW))).toEqual([
            ['success', '1_script ran', 'in 120 ms · 42 rows'],
            ['failed', '2_script failed', 'no such table'],
        ]);
        expect(texts(diffScriptQueries(running, done, true, NOW))).toEqual([['failed', '2_script failed', 'no such table']]);
        // Nothing new, nothing to log
        expect(diffScriptQueries(done, done, false, NOW)).toEqual([]);
        // A query that started and finished between two renders
        expect(texts(diffScriptQueries(done, [query(1, 12, QueryExecutionStatus.SUCCEEDED, { fromCache: true })], false, NOW))).toEqual([
            ['success', '1_script ran', 'from the cache · 42 rows'],
        ]);
        expect(texts(diffScriptQueries(running, [query(1, 10, QueryExecutionStatus.CANCELLED)], false, NOW))).toEqual([
            ['attention', '1_script was stopped', null],
        ]);
    });

    it('logs the end of a run of all scripts', () => {
        expect(diffExecution(null, execution('running'), NOW)).toEqual([]);
        expect(texts(diffExecution(execution('running'), execution('succeeded', { completedScripts: 3, skippedScripts: 1 }), NOW))).toEqual([
            ['success', 'Ran all scripts', '3 scripts · 1 skipped, they need a connection'],
        ]);
        expect(texts(diffExecution(execution('running'), execution('failed', { error: 'boom' }), NOW))).toEqual([['failed', 'Running all scripts failed', 'boom']]);
        expect(texts(diffExecution(execution('stopping'), execution('cancelled'), NOW))).toEqual([['attention', 'Stopped the run of all scripts', '1/3']]);
        expect(diffExecution(execution('succeeded'), execution('succeeded'), NOW)).toEqual([]);
    });

    it('logs connections that connect or fail and refreshed catalogs', () => {
        expect(texts(diffConnections([connection(ConnectionHealth.CONNECTING)], [connection(ConnectionHealth.ONLINE)], NOW))).toEqual([
            ['success', 'Connected to Trino', null],
        ]);
        expect(texts(diffConnections([connection(ConnectionHealth.CONNECTING)], [connection(ConnectionHealth.FAILED)], NOW))).toEqual([
            ['failed', 'Connecting to Trino failed', null],
        ]);
        expect(texts(diffConnections([connection(ConnectionHealth.ONLINE, true)], [connection(ConnectionHealth.ONLINE)], NOW))).toEqual([
            ['success', 'Refreshed the catalog of Trino', null],
        ]);
    });

    it('logs the end of a publish', () => {
        const publishing = { phase: 'publishing' as const, error: null };
        expect(texts(diffPublish(publishing, { phase: 'published', error: null }, NOW))).toEqual([['success', 'Published the workbook', null]]);
        expect(texts(diffPublish(publishing, { phase: 'failed', error: 'offline' }, NOW))).toEqual([['failed', 'Publishing the workbook failed', 'offline']]);
        expect(diffPublish(null, publishing, NOW)).toEqual([]);
    });
});
