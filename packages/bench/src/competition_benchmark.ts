import add from 'benny/src/add';
import suite from 'benny/src/suite';
import cycle from 'benny/src/cycle';
import kleur from 'kleur';
import * as format from '@dashql/core/src/utils/format';

import { DBWrapper } from './db_wrappers';

function gaussSum(n: number): number {
    return Math.trunc(0.5 * n * (n + 1));
}

export async function benchmarkCompetitions(dbs: DBWrapper[]) {
    for (const tupleCount of [100, 1000, 10000]) {
        console.log('Setting up tables');
        /////////////////////////////////////////////

        let plain_rows: { a_value: number }[] = [];
        for (let i = 0; i <= tupleCount; i++) {
            plain_rows.push({ a_value: i });
        }

        const scans = [];

        for (let db of dbs) {
            await db.init();

            await db.create(`test_table${tupleCount}`, {
                a_value: 'INTEGER',
            });

            await db.load(`test_table${tupleCount}`, plain_rows);

            scans.push(
                add(db.name, async () => {
                    await db.scan_int(`test_table${tupleCount}`);
                }),
            );
        }

        await suite(
            `Table Scan ${tupleCount} simple rows`,
            ...scans,
            cycle((result: any, _summary: any) => {
                const duration = result.details.median;
                console.log(
                    `${kleur.cyan(result.name)} t: ${duration.toFixed(5)}s ${format.formatThousands(
                        tupleCount / duration,
                    )} rows/s`,
                );
            }),
        );

        for (let db of dbs) {
            await db.close();
        }

        /////////////////////////////////////////////

        /*await suite(
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
        );*/

        /////////////////////////////////////////////
    }
}
