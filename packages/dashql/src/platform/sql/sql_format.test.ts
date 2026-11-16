import * as core from '../../core/index.js';

import { formatSqlScript } from './sql_format.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: core.DashQL;
beforeAll(async () => {
    dql = await core.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});

const HYPER = core.buffers.formatting.FormattingDialect.HYPER;
const TRINO = core.buffers.formatting.FormattingDialect.TRINO;

describe('formatting a SQL script', () => {
    it('prints lowercase keywords with a line break at the end', () => {
        expect(formatSqlScript(dql, 'SELECT  1', HYPER)).toEqual({ formatted: 'select 1;\n' });
        expect(formatSqlScript(dql, 'CALL t.f(a=>1)', HYPER)).toEqual({ formatted: 'call t.f (a => 1);\n' });
    });

    it('formats in the dialect of the script', () => {
        const script = 'select cast(a as array(integer));\n';
        expect(formatSqlScript(dql, script, HYPER)).toEqual({ formatted: 'select cast(a as integer[]);\n' });
        expect(formatSqlScript(dql, script, TRINO)).toEqual({ formatted: 'select cast(a as array(integer));\n' });
    });

    it('keeps a script with errors', () => {
        const result = formatSqlScript(dql, 'select 1 +;\n', HYPER);
        expect('error' in result && result.error.startsWith('syntax error')).toBe(true);
    });

    it('keeps a script that the formatter cannot print', () => {
        expect(formatSqlScript(dql, 'select somefunc(default);\n', HYPER)).toEqual({ error: "the formatter doesn't know all of the script" });
    });
});
