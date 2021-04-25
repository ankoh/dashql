import * as arrow from 'apache-arrow';
import * as duckdb from '@dashql/duckdb/src/';
import add from 'benny/src/add';
import suite from 'benny/src/suite';
import cycle from 'benny/src/cycle';
import kleur from 'kleur';
import * as SQL from 'sql.js';
import alasql from 'alasql';
import * as aq from 'arquero';
import { nSQL } from '@nano-sql/core';
import * as lf from 'lovefield-ts/dist/es6/lf.js';
import * as format from '@dashql/core/src/utils/format';

function gaussSum(n: number): number {
    return Math.trunc(0.5 * n * (n + 1));
}

function noop() {}

export async function benchmarkCompetitions(duckdb: () => duckdb.DuckDBBindings, sqljs: () => SQL.Database) {
    for (const tupleCount of [100, 1000, 10000]) {
        console.log('Setting up tables');
        /////////////////////////////////////////////

        let plain_rows: { a_value: number }[] = [];
        for (let i = 0; i <= tupleCount; i++) {
            plain_rows.push({ a_value: i });
        }

        // not inside the benny setup because apparently that gets
        // executed multiple times and doesnt really mesh with async

        // DuckDB
        const conn = duckdb().connect();
        conn.runQuery(
            `CREATE TABLE test_table${tupleCount} AS SELECT v FROM generate_series(0, ${tupleCount}) as t(v)`,
        );

        // sql.js
        sqljs().run(`CREATE TABLE test_table${tupleCount} (a_value INTEGER)`);
        let query = `INSERT INTO test_table${tupleCount} (a_value) VALUES`;
        for (let i = 0; i <= tupleCount; i++) {
            query += `(${i}),`;
        }
        sqljs().run(query.substr(0, query.length - 1));

        // AlaSQL
        alasql(`CREATE TABLE test_table${tupleCount} (a_value INTEGER)`);
        alasql(query.substr(0, query.length - 1));

        // Lovefield
        const builder = lf.schema.create('test_schema', 1);
        builder.createTable(`test_table${tupleCount}`).addColumn('a_value', lf.Type.INTEGER);
        let lf_db = await builder.connect({ storeType: lf.DataStoreType.MEMORY });
        let lf_table = lf_db.getSchema().table(`test_table${tupleCount}`);

        let rows = [];
        for (let i = 0; i <= tupleCount; i++) {
            rows.push(lf_table.createRow({ a_value: i }));
        }

        await lf_db.insert().into(lf_table).values(rows).exec();

        // arquero
        let aq_vals = [];
        for (let i = 0; i <= tupleCount; i++) aq_vals.push(i);
        let aq_table = aq.table({
            a_value: new Int32Array(aq_vals),
        });

        // nanoSQL
        await nSQL().createDatabase({
            id: 'test_schema',
            mode: 'TEMP',
            tables: [
                {
                    name: 'test_table',
                    model: {
                        'a_value:int': {},
                    },
                },
            ],
        });
        nSQL().useDatabase('test_schema');

        await nSQL('test_table').loadJS(plain_rows);

        /////////////////////////////////////////////

        await suite(
            `Table Scan ${tupleCount} simple rows`,
            add('DuckDB-m', () => {
                const table = conn.runQuery<{ v: arrow.Int32 }>(`SELECT v FROM test_table${tupleCount}`);
                for (const v of table.getColumnAt(0)!) {
                    noop();
                }
            }),
            add('DuckDB-s', () => {
                const table = conn.sendQuery<{ v: arrow.Int32 }>(`SELECT v FROM test_table${tupleCount}`);
                for (const batch of table) {
                    for (const v of batch.getChildAt(0)!) {
                        noop();
                    }
                }
            }),
            add('sql.js', () => {
                const results = sqljs().exec(`SELECT a_value FROM test_table${tupleCount}`);
                for (const row of results[0].values) {
                    noop();
                }
            }),
            add('AlaSQL', () => {
                const rows = alasql(`SELECT a_value FROM test_table${tupleCount}`);
                for (const row of rows) {
                    noop();
                }
            }),
            add('Lovefield', async () => {
                const rows = <{ a_value: number }[]>await lf_db.select().from(lf_table).exec();
                for (const row of rows) {
                    noop();
                }
            }),
            add('arquero', () => {
                for (const row of aq_table.objects()) {
                    noop();
                }
            }),
            add('nanoSQL', async () => {
                for (const row of await nSQL('test_table').query('select').exec()) {
                    noop();
                }
            }),
            add('plain JS', async () => {
                for (const row of plain_rows) {
                    noop();
                }
            }),
            cycle((result: any, _summary: any) => {
                const duration = result.details.median;
                console.log(
                    `${kleur.cyan(result.name)} t: ${duration.toFixed(5)}s ${format.formatThousands(
                        tupleCount / duration,
                    )} rows/s`,
                );
            }),
        );

        /////////////////////////////////////////////

        await suite(
            `Sum of ${tupleCount} int rows`,
            add('DuckDB', () => {
                const table = conn.runQuery<{ sum_v: arrow.Int32 }>(
                    `SELECT sum(v)::INTEGER as sum_v FROM test_table${tupleCount}`,
                );
                if (table.getColumnAt(0)!.get(0) != gaussSum(tupleCount)) {
                    throw 'DuckDB mismatch';
                }
            }),
            add('sql.js', () => {
                const results = sqljs().exec(`SELECT sum(a_value) as a_value FROM test_table${tupleCount}`);
                if (results[0].values[0][0] != gaussSum(tupleCount)) {
                    throw 'sql.js mismatch';
                }
            }),
            add('AlaSQL', () => {
                const rows = alasql(`SELECT sum(a_value) as a_value FROM test_table${tupleCount}`);
                if (rows[0]['a_value'] != gaussSum(tupleCount)) {
                    throw 'AlaSQL mismatch';
                }
            }),
            add('Lovefield', async () => {
                const rows = <{ a_value: number }[]>await lf_db
                    .select(lf.fn.sum(lf_table.col('a_value')).as('a_value'))
                    .from(lf_table)
                    .exec();
                if (rows[0].a_value != gaussSum(tupleCount)) {
                    throw 'Lovefield mismatch';
                }
            }),
            add('arquero', () => {
                const rows = aq_table.rollup({ a_value: (d: any) => aq.op.sum(d.a_value) }).objects();
                if (rows[0].a_value != gaussSum(tupleCount)) {
                    throw 'arquero mismatch';
                }
            }),
            add('nanoSQL', async () => {
                const rows = await nSQL('test_table').query('select', ['SUM(a_value) as a_value']).exec();
                if (rows[0].a_value != gaussSum(tupleCount)) {
                    throw 'nanoSQL mismatch';
                }
            }),
            add('plain JS', async () => {
                let sum = 0;
                for (const row of plain_rows) {
                    sum += <number>row.a_value;
                }

                if (sum != gaussSum(tupleCount)) {
                    throw 'plain JS mismatch';
                }
            }),
            cycle((result: any, _summary: any) => {
                const duration = result.details.median;
                console.log(`${kleur.cyan(result.name)} t: ${duration.toFixed(5)}s`);
            }),
        );

        /////////////////////////////////////////////

        // Teardown

        // DuckDB
        conn.disconnect();

        // Lovefield
        lf_db.close();

        // nanoSQL
        await nSQL().disconnect();
    }
}
