import * as dashql from '@ankoh/dashql-core';

import { beforeAll, describe, expect, it } from 'vitest';

import { createScriptFormatConfig } from '../../session/scripts/script_format.js';
import { addResultProjection, ResultProjectionError } from './result_projection.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

const PRETTY = () => createScriptFormatConfig(dashql.buffers.formatting.FormattingMode.PRETTY);

describe('result projection', () => {
    it('wraps the query into a common table expression and selects its columns', () => {
        expect(addResultProjection(dql, 'select a, b from t;', ['a', 'b'], PRETTY())).toBe(`with base as (
    select a, b
    from t
)
select a, b
from base;`);
    });

    it('keeps the statements and the comments before the terminal query', () => {
        const text = `create temp table t as select 1 as a;
/* @vis table */
select * from t;
`;
        const projected = addResultProjection(dql, text, ['a'], PRETTY());
        expect(projected).toMatch(/^create temp table t as select 1 as a;\n\/\* @vis table \*\/\nwith base as \(/);
        expect(projected).toMatch(/from base;\n$/);
    });

    it('quotes column names that do not read back unquoted', () => {
        const projected = addResultProjection(dql, 'select 1 as "user", 2 as "Name", 3 as "a b"', ['user', 'Name', 'a b'], PRETTY());
        expect(projected).toContain('"user"');
        expect(projected).toContain('"Name"');
        expect(projected).toContain('"a b"');
        expect(projected).not.toMatch(/;$/);
    });

    it('keeps non-ASCII text around the query', () => {
        const projected = addResultProjection(dql, `/* é */ select 'ü' as x;`, ['x'], PRETTY());
        expect(projected).toMatch(/^\/\* é \*\/ with base as \(/);
        expect(projected).toContain(`'ü'`);
    });

    it('rejects scripts and results that cannot get a projection', () => {
        expect(addResultProjection(dql, 'select from', ['a'], PRETTY())).toBe(ResultProjectionError.NotParsed);
        expect(addResultProjection(dql, 'select 1 as a; drop table t;', ['a'], PRETTY())).toBe(ResultProjectionError.NoQuery);
        expect(addResultProjection(dql, 'select 1', [], PRETTY())).toBe(ResultProjectionError.NoColumns);
        expect(addResultProjection(dql, 'select 1 as a, 2 as a', ['a', 'a'], PRETTY())).toBe(ResultProjectionError.DuplicateColumns);
    });
});
