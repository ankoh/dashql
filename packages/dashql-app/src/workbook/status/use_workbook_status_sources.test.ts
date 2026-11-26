import { describe, expect, it } from 'vitest';

import { ConnectionHealth } from '@akohn/dashql/platform/connections/connection_state';
import { QueryExecutionStatus } from '@akohn/dashql/platform/query/query_execution_state';
import type { WorkbookRunState } from '@akohn/dashql';
import type { QueryExecutionState } from '@akohn/dashql/platform/query/query_execution_state';
import type { ScriptData, ScriptDataMap } from '@akohn/dashql/platform/workbook/workbook_scripts';
import { createScriptRef } from '@akohn/dashql/platform/workbook/script_types';
import { diffConnections, diffExecution, diffPublish, diffScriptQueries, liveWorkbookStatuses, scriptQueries, scriptsWithQueries, type ScriptQuery, type WorkbookConnectionStatus } from './use_workbook_status_sources.js';
import { pickWorkbookStatus, WorkbookStatusSource, WorkbookStatusTone, type WorkbookStatus } from './workbook_status.js';

const NOW = 1000;

function query(scriptKey: number, queryId: number, status: QueryExecutionStatus, extra: Partial<ScriptQuery> = {}): ScriptQuery {
    return {
        scriptKey, name: `${scriptKey}_script`, queryId, status, durationMs: 120, error: null,
        rows: 42, fromCache: false, ...extra,
    };
}

function execution(phase: WorkbookRunState['phase'], extra: Partial<WorkbookRunState> = {}): WorkbookRunState {
    return {
        phase, busy: phase === 'planning' || phase === 'running' || phase === 'stopping', totalScripts: 3, completedScripts: 1, totalStatements: 3, completedStatements: 1,
        activeFileName: '2_revenue.sql', activeStatementIndex: 0, activeStatementCount: 1,
        error: null, skippedScripts: 0, skippedFiles: [], failedScripts: [], step: null, ...extra,
    };
}

function connection(health: ConnectionHealth, refreshingCatalog = false): WorkbookConnectionStatus {
    return { connectionId: 'c1', name: 'Trino', health, refreshingCatalog };
}

const texts = (statuses: WorkbookStatus[]) => statuses.map(status => [status.tone, status.text, status.detail ?? null]);

describe('Workbook status', () => {
    it('picks what runs, then what needs the user, then how the last thing ended', () => {
        const at = NOW;
        const line: WorkbookStatus = { key: 'l', source: WorkbookStatusSource.Query, tone: WorkbookStatusTone.Success, text: 'ran', at };
        const attention: WorkbookStatus = { key: 'a', source: WorkbookStatusSource.Connection, tone: WorkbookStatusTone.Attention, text: 'not connected', at };
        const query: WorkbookStatus = { key: 'q', source: WorkbookStatusSource.Query, tone: WorkbookStatusTone.Progress, text: 'query', at };
        const agent: WorkbookStatus = { key: 'g', source: WorkbookStatusSource.Agent, tone: WorkbookStatusTone.Progress, text: 'agent', at };
        expect(pickWorkbookStatus([], null)).toBeNull();
        expect(pickWorkbookStatus([], line)).toBe(line);
        expect(pickWorkbookStatus([attention], line)).toBe(attention);
        expect(pickWorkbookStatus([attention, query], line)).toBe(query);
        expect(pickWorkbookStatus([query, agent], line)).toBe(agent);
    });

    it('tells the running queries, a run of all scripts instead of its queries, publishes and connections', () => {
        const queries = [query(1, 10, QueryExecutionStatus.RUNNING), query(2, 11, QueryExecutionStatus.SUCCEEDED)];
        expect(texts(liveWorkbookStatuses({ queries, execution: null, connections: [], publish: null, now: NOW }))).toEqual([
            ['progress', 'Running 1_script', 'Executing query'],
        ]);
        expect(texts(liveWorkbookStatuses({ queries, execution: execution('running'), connections: [], publish: null, now: NOW }))).toEqual([
            ['progress', 'Running all scripts', '1/3 · 2_revenue'],
        ]);
        // The steps before the statements run, with the names of the connections
        const step = (phase: WorkbookRunState['phase'], runStep: WorkbookRunState['step']) =>
            texts(liveWorkbookStatuses({ queries: [], execution: execution(phase, { step: runStep }), connections: [connection(ConnectionHealth.ONLINE)], publish: null, now: NOW }))[0];
        expect(step('planning', null)).toEqual(['progress', 'Planning the run of all scripts', null]);
        expect(step('planning', { type: 'analyzing' })).toEqual(['progress', 'Analyzing the scripts', null]);
        expect(step('planning', { type: 'checking', fileName: '2_revenue.sql' })).toEqual(['progress', 'Looking up the stored result of 2_revenue', null]);
        expect(step('planning', { type: 'reading', fileName: '2_revenue.sql' })).toEqual(['progress', 'Reading the stored result of 2_revenue', null]);
        expect(step('planning', { type: 'connecting', connectionIds: ['c1', 'c9'] })).toEqual(['progress', 'Connecting to Trino, c9', null]);
        expect(step('running', { type: 'mountingAttachments' })).toEqual(['progress', 'Mounting the attachments of the workbook', '1/3 · 2_revenue']);
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
            ['success', '1_script ran', 'stored result · 42 rows'],
        ]);
        // The stored result of a script that showed no query is the workbook opening
        expect(diffScriptQueries([], [query(1, 12, QueryExecutionStatus.SUCCEEDED, { fromCache: true })], false, NOW)).toEqual([]);
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
        // The scripts that failed, the others ran on
        const one = [{ fileName: 'a.sql', message: 'boom' }];
        expect(texts(diffExecution(execution('running'), execution('failed', { error: 'boom', failedScripts: one }), NOW))).toEqual([['failed', 'Running all scripts failed', 'a: boom']]);
        const two = [...one, { fileName: 'b.sql', message: 'bang' }];
        expect(texts(diffExecution(execution('running'), execution('failed', { error: 'boom', failedScripts: two }), NOW))).toEqual([['failed', 'Running all scripts failed', '2 scripts failed: a, b']]);
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

    it('reads the latest query of each script in feed order, without the queries the runtime no longer holds', () => {
        const fakeScript = (scriptKey: number, fileName: string, latestQueryId: number | null) => ({ scriptKey, fileName, latestQueryId }) as ScriptData;
        const scripts: ScriptDataMap = { 1: fakeScript(1, '1_a.sql', 10), 2: fakeScript(2, '2_b.sql', null), 3: fakeScript(3, '3_c.sql', 30), 4: fakeScript(4, '4_d.sql', 40) };
        const scriptRefs = Object.fromEntries(Object.values(scripts).map(script => [script.fileName, createScriptRef(script.scriptKey, script.fileName)]));
        const latest = scriptsWithQueries({ scriptOrder: ['3_c.sql', '1_a.sql', '2_b.sql', '4_d.sql'], scriptRefs }, scripts);
        expect(latest).toEqual([
            { scriptKey: 3, name: '3_c', queryId: 30 },
            { scriptKey: 1, name: '1_a', queryId: 10 },
            { scriptKey: 4, name: '4_d', queryId: 40 },
        ]);
        const held = (status: QueryExecutionStatus) => ({ status, metrics: { queryDurationMs: 5, streamMetrics: { totalRowsReceived: 2 } }, error: null }) as unknown as QueryExecutionState;
        const queries = new Map([[10, held(QueryExecutionStatus.SUCCEEDED)], [30, held(QueryExecutionStatus.RUNNING)]]);
        expect(scriptQueries(latest, queryId => queries.get(queryId) ?? null).map(q => [q.scriptKey, q.status])).toEqual([
            [3, QueryExecutionStatus.RUNNING],
            [1, QueryExecutionStatus.SUCCEEDED],
        ]);
    });

    it('logs the end of a publish', () => {
        const publishing = { phase: 'publishing' as const, error: null };
        expect(texts(diffPublish(publishing, { phase: 'published', error: null }, NOW))).toEqual([['success', 'Published the workbook', null]]);
        expect(texts(diffPublish(publishing, { phase: 'failed', error: 'offline' }, NOW))).toEqual([['failed', 'Publishing the workbook failed', 'offline']]);
        expect(diffPublish(null, publishing, NOW)).toEqual([]);
    });
});
