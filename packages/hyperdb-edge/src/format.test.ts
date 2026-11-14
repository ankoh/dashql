import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { formatStatementResult, type FormatOptions } from './format.js';
import { openEngine, WORK_MOUNT, type OpenEngine } from './node/open_engine.js';
import { runStatement } from './run_statement.js';

let engine: OpenEngine;
let workDirectory: string;

beforeAll(async () => {
    workDirectory = mkdtempSync(path.join(tmpdir(), 'hyperdb-edge-format-'));
    engine = await openEngine({ workDirectory });
});

afterAll(async () => {
    await engine?.close();
    rmSync(workDirectory, { recursive: true, force: true });
});

const TABLE: FormatOptions = { format: 'table', maxRows: 20 };
const JSON_LINES: FormatOptions = { format: 'json', maxRows: 20 };
const CSV: FormatOptions = { format: 'csv', maxRows: 20 };

async function format(sql: string, options: FormatOptions, statement = 1) {
    return formatStatementResult(await runStatement(engine.connection, sql), statement, options);
}

describe('the table format', () => {
    it('aligns the columns under their names and counts the rows', async () => {
        const out = await format("select 1 as a, 'xyz' as bb union all select 22, 'q'", TABLE);
        expect(out.stdout).toBe(['a  | bb', '---+----', '1  | xyz', '22 | q', '(2 rows)', ''].join('\n'));
        expect(out.stderr).toBeUndefined();
    });

    it('says 1 row in the singular', async () => {
        const out = await format('select 1 as a', TABLE);
        expect(out.stdout).toBe(['a', '-', '1', '(1 row)', ''].join('\n'));
    });

    it('prints the names of a result without rows', async () => {
        const out = await format('select 1 as a, 2 as b where false', TABLE);
        expect(out.stdout).toBe(['a | b', '--+--', '(0 rows)', ''].join('\n'));
    });

    it('prints NULL for null', async () => {
        const out = await format('select null::int as a', TABLE);
        expect(out.stdout).toBe(['a', '----', 'NULL', '(1 row)', ''].join('\n'));
    });

    it('spreads a value with line breaks over several lines, as a plan has', async () => {
        const out = await format("select 'x' || chr(10) || 'yy' as a, 1 as b", TABLE);
        expect(out.stdout).toBe(['a  | b', '---+--', 'x  | 1', 'yy |', '(1 row)', ''].join('\n'));
    });

    it('prints the first rows and says how many there are', async () => {
        const out = await format('select g from generate_series(1, 5) as s(g) order by g', { format: 'table', maxRows: 2 });
        expect(out.stdout).toBe(['g', '-', '1', '2', '(5 rows, 2 shown)', ''].join('\n'));
    });

    it('prints every row with --max-rows 0', async () => {
        const out = await format('select g from generate_series(1, 3) as s(g) order by g', { format: 'table', maxRows: 0 });
        expect(out.stdout).toBe(['g', '-', '1', '2', '3', '(3 rows)', ''].join('\n'));
    });

    it('prints the kind and the affected rows of a statement without rows', async () => {
        expect((await format('create temporary table t(a int)', TABLE)).stdout).toBe('CREATE\n');
        expect((await format('insert into t values (1), (2), (3)', TABLE)).stdout).toBe('INSERT 3\n');
        expect((await format('update t set a = a + 1 where a > 1', TABLE)).stdout).toBe('UPDATE 2\n');
        expect((await format('delete from t where a = 1', TABLE)).stdout).toBe('DELETE 1\n');
        expect((await format('drop table t', TABLE)).stdout).toBe('DROP\n');
    });

    it('prints the rows that a COPY wrote', async () => {
        const out = await format(
            `copy (select g from generate_series(1, 4) as s(g)) to '${WORK_MOUNT}/four.parquet' with (format => 'parquet')`,
            TABLE,
        );
        expect(out.stdout).toBe('COPY 4\n');
        expect(existsSync(path.join(workDirectory, 'four.parquet'))).toBe(true);
    });
});

describe('the json format', () => {
    it('prints one line of JSON per statement with the columns, their types and the rows', async () => {
        const out = await format("select 1 as a, 'x' as b, null::int as c", JSON_LINES, 3);
        expect(out.stdout.endsWith('\n')).toBe(true);
        expect(out.stdout.trimEnd().split('\n')).toHaveLength(1);
        expect(JSON.parse(out.stdout)).toEqual({
            statement: 3,
            kind: 'SELECT',
            columns: [
                { name: 'a', type: 'integer' },
                { name: 'b', type: 'text' },
                { name: 'c', type: 'integer' },
            ],
            rows: [[1, 'x', null]],
            rowCount: 1,
            truncated: false,
        });
    });

    it('keeps columns with the same name apart', async () => {
        const out = JSON.parse((await format('select 1 as a, 2 as a', JSON_LINES)).stdout);
        expect(out.columns.map((c: { name: string }) => c.name)).toEqual(['a', 'a']);
        expect(out.rows).toEqual([[1, 2]]);
    });

    it('marks a result that --max-rows cut', async () => {
        const out = JSON.parse((await format('select g from generate_series(1, 5) as s(g) order by g', { format: 'json', maxRows: 2 })).stdout);
        expect(out.rows).toEqual([[1], [2]]);
        expect(out.rowCount).toBe(5);
        expect(out.truncated).toBe(true);
    });

    it('prints the kind and the affected rows of a statement without rows', async () => {
        await format('create temporary table j(a int)', JSON_LINES);
        const out = JSON.parse((await format('insert into j values (1), (2)', JSON_LINES, 2)).stdout);
        expect(out).toEqual({ statement: 2, kind: 'INSERT', rowCount: 2 });
    });

    it('prints bigints beyond the safe integers as strings', async () => {
        const out = JSON.parse((await format('select 9007199254740993::bigint as a', JSON_LINES)).stdout);
        expect(out.rows).toEqual([['9007199254740993']]);
    });
});

describe('the csv format', () => {
    it('prints a header and quotes values as RFC 4180 does', async () => {
        const out = await format(
            `select 'a,b' as x, 'say "hi"' as y, '' as z, null::text as w, ' p' as v, 'l1' || chr(10) || 'l2' as n, 7 as k`,
            CSV,
        );
        expect(out.stdout).toBe(['x,y,z,w,v,n,k', '"a,b","say ""hi""","",," p","l1\nl2",7', ''].join('\n'));
    });

    it('quotes a column name that needs it', async () => {
        const out = await format('select 1 as "a,b"', CSV);
        expect(out.stdout).toBe(['"a,b"', '1', ''].join('\n'));
    });

    it('prints nothing for a statement without rows', async () => {
        expect((await format('create temporary table c(a int)', CSV)).stdout).toBe('');
    });

    it('says on stderr that --max-rows cut the rows', async () => {
        const out = await format('select g from generate_series(1, 5) as s(g) order by g', { format: 'csv', maxRows: 2 });
        expect(out.stdout).toBe(['g', '1', '2', ''].join('\n'));
        expect(out.stderr).toBe('hyperdb-edge: statement 1 printed 2 of 5 rows, --max-rows 0 prints all\n');
    });
});
