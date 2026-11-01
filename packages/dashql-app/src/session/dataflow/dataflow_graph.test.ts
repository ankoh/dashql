import * as core from '@ankoh/dashql-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DataflowEdgeKind, deriveDataflowGraph, forgetDataflowGraph, mergeDataflowGraph, statementTypeLabel, type DataflowGraph, type DataflowScript } from './dataflow_graph.js';
import { analyzedTestSession } from './dataflow_test_session.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL;
beforeAll(async () => { dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED }); });
afterEach(() => { dql.resetUnsafe(); });

function edges(graph: DataflowGraph): string[] {
    const name = (key: number) => graph.scripts.find(s => s.scriptKey === key)?.fileName;
    return graph.edges.map(e => `${name(e.from.scriptKey)}.${e.from.statementId} -> ${name(e.to.scriptKey)}.${e.to.statementId} ${e.kind} ${e.name}`);
}

describe('dataflow graph', () => {
    it('derives the statements and the edges of a session with the core', () => {
        const session = analyzedTestSession(dql, [
            ['schema.sql', 'create table t (a int);\ninsert into t values (1)'],
            ['report.sql', 'select a\nfrom t'],
            ['chart.sql', 'select * from :report'],
        ]);
        const graph = deriveDataflowGraph(session);
        expect(graph.scripts.map(s => s.fileName)).toEqual(['schema.sql', 'report.sql', 'chart.sql']);
        expect(graph.scripts[0].statements.map(s => [statementTypeLabel(s.statementType), s.label])).toEqual([['CREATE', 't'], ['INSERT', 't']]);
        // A query is labeled with its first line
        expect(graph.scripts[1].statements.map(s => s.label)).toEqual(['select a']);
        expect(edges(graph)).toEqual([
            'schema.sql.0 -> schema.sql.1 table t',
            'schema.sql.1 -> report.sql.0 table t',
            'report.sql.0 -> chart.sql.0 inline report',
        ]);
        // The same session gives the same graph, until the session is forgotten
        expect(deriveDataflowGraph(session)).toBe(graph);
        forgetDataflowGraph(session.sessionId);
        const derived = deriveDataflowGraph(session);
        expect(derived).not.toBe(graph);
        expect(derived).toEqual(graph);
    });

    it('labels statement types with their first word', () => {
        const StatementType = core.buffers.parser.StatementType;
        expect(statementTypeLabel(StatementType.CREATE_TABLE_AS)).toBe('CREATE');
        expect(statementTypeLabel(StatementType.DROP_VIEW)).toBe('DROP');
        expect(statementTypeLabel(StatementType.SELECT)).toBe('SELECT');
    });
});

describe('dataflow graph merge', () => {
    const SELECT = core.buffers.parser.StatementType.SELECT;
    const statement = (statementId: number, label: string) => ({ statementId, statementType: SELECT, target: null, from: 0, to: 1, label });
    const script = (scriptKey: number, statements: number, current = true): DataflowScript => ({
        scriptKey,
        fileName: `${scriptKey}.sql`,
        connectionId: 'main',
        statements: Array.from({ length: statements }, (_, i) => statement(i, `s${i}`)),
        current,
    });
    const edge = (from: number, to: number) => ({
        key: `${from}.0>${to}.0:table:t`,
        from: { scriptKey: from, statementId: 0 },
        to: { scriptKey: to, statementId: 0 },
        kind: DataflowEdgeKind.Table,
        name: 't',
    });

    it('keeps the statements and the edges of a script that is being edited', () => {
        const previous = { scripts: [script(1, 1), script(2, 1)], edges: [edge(1, 2)] };
        const next = { scripts: [script(1, 1), { ...script(2, 0), current: false }], edges: [] };
        const merged = mergeDataflowGraph(previous, next);
        expect(merged.scripts[0]).toBe(previous.scripts[0]);
        expect(merged.scripts[1].statements).toBe(previous.scripts[1].statements);
        expect(merged.scripts[1].current).toBe(false);
        expect(merged.edges).toEqual([edge(1, 2)]);
    });

    it('drops the edges of scripts that are gone and keeps the identity of an unchanged graph', () => {
        const previous = { scripts: [script(1, 1), script(2, 1)], edges: [edge(1, 2)] };
        expect(mergeDataflowGraph(previous, { scripts: [script(1, 1), script(2, 1)], edges: [edge(1, 2)] })).toBe(previous);
        const merged = mergeDataflowGraph(previous, { scripts: [{ ...script(1, 0), current: false }], edges: [] });
        expect(merged.edges).toEqual([]);
    });
});
