import type * as core from '@akohn/dashql';
import { createDashQLCoreSetup } from '@akohn/dashql/platform/node/node_core';

import { lineColumn, SqlLinter } from './sql_lint.js';

let dql: core.DashQL;
beforeAll(async () => {
    dql = await createDashQLCoreSetup()('sql_lint.test');
});

const lintOne = (linter: SqlLinter, text: string) => linter.lint({ id: 'test.sql', text });

describe('the SQL linter', () => {
    it('resolves byte offsets to lines and columns in code points', () => {
        const text = 'ab\näöc\nx';
        expect(lineColumn(text, 0)).toEqual([1, 1]);
        expect(lineColumn(text, 3)).toEqual([2, 1]);
        // ä and ö take two bytes each
        expect(lineColumn(text, 7)).toEqual([2, 3]);
        expect(lineColumn(text, 9)).toEqual([3, 1]);
        expect(lineColumn(text, 100)).toEqual([3, 2]);
    });

    it('reports nothing for a clean script', () => {
        expect(lintOne(new SqlLinter(dql), 'select 1;\nselect a from b where c = 42;')).toEqual([]);
    });

    it('reports errors of the scanner', () => {
        const diagnostics = lintOne(new SqlLinter(dql), "select 'unterminated");
        expect(diagnostics.some(d => d.stage === 'scan' && d.severity === 'error')).toBe(true);
    });

    it('reports errors of the parser with their position', () => {
        const diagnostics = lintOne(new SqlLinter(dql), 'select 1;\nselect 1 +;');
        const parse = diagnostics.find(d => d.stage === 'parse')!;
        expect(parse.severity).toBe('error');
        expect([parse.location!.line, parse.location!.column]).toEqual([2, 11]);
        expect(parse.message.length).toBeGreaterThan(0);
    });

    it('counts the columns of a position after other characters in code points', () => {
        const parse = lintOne(new SqlLinter(dql), "select 'äöü';\nselect 1 +;").find(d => d.stage === 'parse')!;
        expect([parse.location!.line, parse.location!.column]).toEqual([2, 11]);
        const sameLine = lintOne(new SqlLinter(dql), "select 'äöü' +;").find(d => d.stage === 'parse')!;
        expect([sameLine.location!.line, sameLine.location!.column]).toEqual([1, 15]);
    });

    it('reports errors of the analyzer against a schema', () => {
        const linter = new SqlLinter(dql);
        expect(linter.addSchema({ id: 'schema.sql', text: 'create table a (id integer); create table b (id integer);' })).toEqual([]);
        const diagnostics = lintOne(linter, 'select id from a, b;');
        expect(diagnostics).toHaveLength(1);
        expect([diagnostics[0].stage, diagnostics[0].severity]).toEqual(['analyze', 'error']);
        expect([diagnostics[0].location!.line, diagnostics[0].location!.column]).toEqual([1, 8]);
    });

    it('skips a schema with errors', () => {
        const linter = new SqlLinter(dql);
        const diagnostics = linter.addSchema({ id: 'schema.sql', text: 'create table a (id integer); create table b (id integer' });
        expect(diagnostics.some(d => d.severity === 'error')).toBe(true);
        // Without the schema, the column is not ambiguous
        expect(lintOne(linter, 'select id from a, b;').filter(d => d.stage === 'analyze' && d.message.includes('ambiguous'))).toEqual([]);
    });
});
