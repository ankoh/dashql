import * as webdb from '../../webdb/dist/webdb-node-serial.js';
import * as core from '../../core/dist/dashql-core-node.js';
import * as benny from 'benny';
import path from 'path';
import kleur from 'kleur';

function main(db: webdb.WebDB) {
    let tupleSize = 8;
    for (const tupleCount of [1000, 10000, 1000000, 10000000]) {
        benny.suite(
            `Single DOUBLE column | ${tupleCount} rows`,
            benny.add('column scan', () => {
                let conn = db.connect();
                let result = conn.runQuery(`
                    SELECT v::DOUBLE AS foo FROM generate_series(1, ${tupleCount}) as t(v);
                `);
                conn.disconnect();
                return () => {
                    let chunks = new webdb.ChunkArrayIterator(result);
                    let sum = 0;
                    let count = 0;
                    while (chunks.nextBlocking()) {
                        for (const v of chunks.iterateNumberColumn(0)) {
                            sum += v!;
                            ++count;
                        }
                    }
                    if (count != tupleCount || sum != (tupleCount * (tupleCount + 1)) / 2) {
                        console.log(
                            `1 WRONG RESULT ${count} ${tupleCount} ${sum} ${(tupleCount * (tupleCount + 1)) / 2}`,
                        );
                    }
                };
            }),

            benny.add('row proxies (collect)', () => {
                let conn = db.connect();
                let result = conn.runQuery(`
                    SELECT v::DOUBLE AS foo FROM generate_series(1, ${tupleCount}) as t(v);
                `);
                conn.disconnect();
                return () => {
                    const chunks = new webdb.ChunkArrayIterator(result);
                    interface Row extends webdb.RowProxy {
                        foo: number | null;
                    }
                    let sum = 0;
                    let count = 0;
                    while (chunks.nextBlocking()) {
                        for (const row of chunks.collect<Row>()) {
                            sum += row.foo!;
                            ++count;
                        }
                    }
                    if (count != tupleCount || sum != (tupleCount * (tupleCount + 1)) / 2) {
                        console.log(
                            `2 WRONG RESULT ${count} ${tupleCount} ${sum} ${(tupleCount * (tupleCount + 1)) / 2}`,
                        );
                    }
                };
            }),

            benny.add('row proxies (iter)', () => {
                let conn = db.connect();
                let result = conn.runQuery(`
                    SELECT v::DOUBLE AS foo FROM generate_series(1, ${tupleCount}) as t(v);
                `);
                conn.disconnect();
                return () => {
                    const chunks = new webdb.ChunkArrayIterator(result);
                    interface Row extends webdb.RowProxy {
                        foo: number | null;
                    }
                    let sum = 0;
                    let count = 0;
                    for (const row of chunks.iter<Row>()) {
                        sum += row.foo!;
                        ++count;
                    }
                    if (count != tupleCount || sum != (tupleCount * (tupleCount + 1)) / 2) {
                        console.log(
                            `3 WRONG RESULT ${count} ${tupleCount} ${sum} ${(tupleCount * (tupleCount + 1)) / 2}`,
                        );
                    }
                };
            }),

            benny.cycle((result: any, _summary: any) => {
                let bytes = tupleCount * tupleSize;
                let duration = result.details.median;
                let tupleThroughput = tupleCount / duration;
                let dataThroughput = bytes / duration;
                console.log(
                    `${kleur.cyan(result.name)} t: ${duration.toFixed(3)} s ttp: ${core.utils.formatThousands(
                        tupleThroughput,
                    )}/s dtp: ${core.utils.formatBytes(dataThroughput)}/s`,
                );
            }),
        );
    }
}

const logger = new webdb.VoidLogger();
const db = new webdb.WebDB(logger, webdb.DefaultWebDBRuntime, path.join(__dirname, '../../webdb/dist/webdb.wasm'));
db.open()
    .then(() => main(db))
    .catch(e => console.error(e));
