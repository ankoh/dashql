import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { openEngine, type OpenEngine } from './node/open_engine.js';
import { runStatement } from './run_statement.js';
import { cellText, readCell, sqlTypeName, type CellValue } from './values.js';

// The values come from Hyper itself: the Arrow types and metadata of its results decide how they read
let engine: OpenEngine;
let workDirectory: string;

beforeAll(async () => {
    workDirectory = mkdtempSync(path.join(tmpdir(), 'hyperdb-edge-values-'));
    engine = await openEngine({ workDirectory });
});

afterAll(async () => {
    await engine?.close();
    rmSync(workDirectory, { recursive: true, force: true });
});

async function selectOne(expression: string): Promise<{ value: CellValue; type: string; text: string }> {
    const result = await runStatement(engine.connection, `select ${expression} as v`);
    const table = result.table!;
    const value = readCell(table, 0, 0);
    return { value, type: sqlTypeName(table.schema.fields[0]), text: cellText(value) };
}

describe('readCell, sqlTypeName and cellText', () => {
    const cases: [string, CellValue, string, string][] = [
        // expression, value, type, text
        ['true', true, 'boolean', 'true'],
        ['1::smallint', 1, 'smallint', '1'],
        ['2::int', 2, 'integer', '2'],
        ['42::bigint', 42, 'bigint', '42'],
        // Beyond the safe integers of JavaScript a bigint stays exact as a string
        ['9007199254740993::bigint', '9007199254740993', 'bigint', '9007199254740993'],
        ['-9007199254740993::bigint', '-9007199254740993', 'bigint', '-9007199254740993'],
        ['1.5::double precision', 1.5, 'double precision', '1.5'],
        ['2.5::real', 2.5, 'real', '2.5'],
        ["'NaN'::double precision", 'NaN', 'double precision', 'NaN'],
        ["'Infinity'::double precision", 'Infinity', 'double precision', 'Infinity'],
        ["'-Infinity'::double precision", '-Infinity', 'double precision', '-Infinity'],
        // Decimals keep every digit and their scale
        ['12345.678::numeric(18,3)', '12345.678', 'numeric(18,3)', '12345.678'],
        ['-0.5::numeric(10,2)', '-0.50', 'numeric(10,2)', '-0.50'],
        ['-12.5::numeric(10,2)', '-12.50', 'numeric(10,2)', '-12.50'],
        ['42::numeric(10,0)', '42', 'numeric(10,0)', '42'],
        ['123456789012345678901234.5::numeric(38,1)', '123456789012345678901234.5', 'numeric(38,1)', '123456789012345678901234.5'],
        ["'a,b\"c'::text", 'a,b"c', 'text', 'a,b"c'],
        ["'v'::varchar(10)", 'v', 'varchar(10)', 'v'],
        ["'c'::char(3)", 'c  ', 'char(3)', 'c  '],
        [`'{"a":1}'::json`, '{"a":1}', 'json', '{"a":1}'],
        ["date '2026-11-14'", '2026-11-14', 'date', '2026-11-14'],
        ["date '1969-12-31'", '1969-12-31', 'date', '1969-12-31'],
        ["time '13:45:01.5'", '13:45:01.5', 'time', '13:45:01.5'],
        ["time '00:00:00'", '00:00:00', 'time', '00:00:00'],
        ["timestamp '2026-11-14 13:45:01.123456'", '2026-11-14 13:45:01.123456', 'timestamp', '2026-11-14 13:45:01.123456'],
        ["timestamp '2026-11-14 13:45:01'", '2026-11-14 13:45:01', 'timestamp', '2026-11-14 13:45:01'],
        ["timestamp '1969-12-31 23:59:59.5'", '1969-12-31 23:59:59.5', 'timestamp', '1969-12-31 23:59:59.5'],
        ["timestamptz '2026-11-14 13:45:01+02'", '2026-11-14 11:45:01+00:00', 'timestamptz', '2026-11-14 11:45:01+00:00'],
        ["interval '1 day 2 hours'", '1 day 02:00:00', 'interval', '1 day 02:00:00'],
        ["interval '1 year 2 months 3 days'", '1 year 2 mons 3 days', 'interval', '1 year 2 mons 3 days'],
        ["interval '-1 hour'", '-01:00:00', 'interval', '-01:00:00'],
        ["interval '1.5 seconds'", '00:00:01.5', 'interval', '00:00:01.5'],
        ["interval '0 seconds'", '00:00:00', 'interval', '00:00:00'],
        ["'\\x0102'::bytea", '\\x0102', 'bytea', '\\x0102'],
        ['23::oid', 23, 'oid', '23'],
        ['array[1,2,null]', [1, 2, null], 'integer[]', '[1,2,null]'],
        ["array['x','y']", ['x', 'y'], 'text[]', '["x","y"]'],
        ['null::int', null, 'integer', 'NULL'],
        ['null::text', null, 'text', 'NULL'],
    ];

    it.each(cases)('reads %s', async (expression, value, type, text) => {
        const cell = await selectOne(expression);
        expect(cell.value).toEqual(value);
        expect(cell.type).toBe(type);
        expect(cell.text).toBe(text);
    });

    it('reads a geography as the hex of its bytes', async () => {
        const cell = await selectOne("'point(1 2)'::geography");
        expect(cell.type).toBe('geography');
        expect(cell.value).toMatch(/^\\x[0-9a-f]+$/);
    });

    it('reads the columns of a row by position, also when names repeat', async () => {
        const result = await runStatement(engine.connection, 'select 1 as a, 2 as a');
        expect(readCell(result.table!, 0, 0)).toBe(1);
        expect(readCell(result.table!, 1, 0)).toBe(2);
    });
});
