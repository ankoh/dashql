import * as arrow from 'apache-arrow';
import * as duckdb from '@dashql/duckdb/src/';
import add from 'benny/src/add';
import suite from 'benny/src/suite';
import cycle from 'benny/src/cycle';
import kleur from 'kleur';
import * as SQL from 'sql.js';
import alasql from 'alasql';

// lovefield, arquero, sql.js, alasql, TaffyDB, nano-sql

export async function benchmarkCompetitions(duckdb: () => duckdb.DuckDBBindings, sqljs: () => SQL.Database) {
    for (const tupleCount of [100, 1000, 10000]) {
        await suite(
            `INSERT ${tupleCount} simple rows individually`,
            add('DuckDB', () => {
                const conn = duckdb().connect();
                conn.runQuery(`CREATE TABLE test_table (a_value INTEGER)`);
                for (let i = 0; i < tupleCount; i++) {
                    conn.runQuery(`INSERT INTO test_table(a_value) VALUES(${i})`);
                }
                const table = conn.runQuery<{ foo: arrow.Int32 }>(`SELECT COUNT(*) FROM test_table`);
                if (table.getColumnAt(0)!.get(0) != tupleCount) {
                    console.error('Row mismatch');
                }
                conn.runQuery(`DROP TABLE test_table`);
                conn.disconnect();
            }),
            add('sql.js', () => {
                sqljs().run(`CREATE TABLE test_table (a_value INTEGER)`);
                for (let i = 0; i < tupleCount; i++) {
                    sqljs().run(`INSERT INTO test_table(a_value) VALUES(${i})`);
                }
                const rows = sqljs().exec(`SELECT COUNT(*) FROM test_table`);
                if (rows[0].values[0][0] != tupleCount) {
                    console.error('Row mismatch');
                }
                sqljs().run(`DROP TABLE test_table`);
            }),
            add('AlaSQL', () => {
                alasql(`CREATE TABLE test_table (a_value INTEGER)`);
                for (let i = 0; i < tupleCount; i++) {
                    alasql(`INSERT INTO test_table(a_value) VALUES(${i})`);
                }
                const rows = alasql(`SELECT COUNT(*) FROM test_table`);
                if (rows[0]['COUNT(*)'] != tupleCount) {
                    console.error('Row mismatch');
                }
                alasql(`DROP TABLE test_table`);
            }),
            cycle((result: any, _summary: any) => {
                const duration = result.details.median;
                console.log(
                    `${kleur.cyan(result.name)} t: ${duration.toFixed(3)} ${(tupleCount / duration).toFixed(3)} rows/s`,
                );
            }),
        );

        console.log(tupleCount);
    }
}
