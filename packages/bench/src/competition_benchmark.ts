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

export async function benchmarkCompetitions(duckdb: () => duckdb.DuckDBBindings, sqljs: () => SQL.Database) {
    for (const tupleCount of [100, 1000, 10000]) {
        console.log('Setting up tables');
        /////////////////////////////////////////////

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

        let nsql_rows = [];
        for (let i = 0; i <= tupleCount; i++) {
            nsql_rows.push({ a_value: i });
        }
        await nSQL('test_table').loadJS(nsql_rows);

        /////////////////////////////////////////////

        await suite(
            `Table Scan ${tupleCount} simple rows`,
            add('DuckDB-m', () => {
                const table = conn.runQuery<{ v: arrow.Int32 }>(`SELECT v FROM test_table${tupleCount}`);
                let sum = 0;
                for (const v of table.getColumnAt(0)!) {
                    sum += v[0];
                }

                if (sum != gaussSum(tupleCount)) {
                    throw 'DuckDB Row mismatch';
                }
            }),
            add('DuckDB-s', () => {
                const table = conn.sendQuery<{ v: arrow.Int32 }>(`SELECT v FROM test_table${tupleCount}`);
                let sum = 0;
                for (const batch of table) {
                    for (const v of batch.getChildAt(0)!) {
                        sum += v[0];
                    }
                }

                if (sum != gaussSum(tupleCount)) {
                    throw 'DuckDB Row mismatch';
                }
            }),
            add('sql.js', () => {
                const results = sqljs().exec(`SELECT a_value FROM test_table${tupleCount}`);
                let sum = 0;
                for (const row of results[0].values) {
                    sum += <number>row[0];
                }

                if (sum != gaussSum(tupleCount)) {
                    throw 'sql.js Row mismatch';
                }
            }),
            add('AlaSQL', () => {
                const rows = alasql(`SELECT a_value FROM test_table${tupleCount}`);
                let sum = 0;
                for (const row of rows) {
                    sum += row['a_value'];
                }

                if (sum != gaussSum(tupleCount)) {
                    throw 'AlaSQL Row mismatch';
                }
            }),
            add('Lovefield', async () => {
                const rows = <{ a_value: number }[]>await lf_db.select().from(lf_table).exec();
                let sum = 0;
                for (const row of rows) {
                    sum += row.a_value;
                }

                if (sum != gaussSum(tupleCount)) {
                    throw 'Lovefield Row mismatch';
                }
            }),
            add('arquero', () => {
                let sum = 0;
                for (const row of aq_table) {
                    sum += (row as any)['a_value'];
                }

                if (sum != gaussSum(tupleCount)) {
                    throw 'Lovefield Row mismatch';
                }
            }),
            add('nanoSQL', async () => {
                let sum = 0;
                for (const row of await nSQL('test_table').query('select').exec()) {
                    sum += <number>row.a_value;
                }

                if (sum != gaussSum(tupleCount)) {
                    throw 'nanoSQL Row mismatch';
                }
            }),
            cycle((result: any, _summary: any) => {
                const duration = result.details.median;
                console.log(
                    `${kleur.cyan(result.name)} t: ${duration.toFixed(3)}s ${format.formatThousands(
                        tupleCount / duration,
                    )} rows/s`,
                );
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
