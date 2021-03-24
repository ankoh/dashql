import Worker from 'web-worker';
import * as webdb from '@dashql/webdb/dist/webdb-node-parallel.js';
import * as core from '@dashql/core/dist/dashql-core-node.js';
import * as benny from 'benny';
import kleur from 'kleur';

import path from 'path';
const workerPath = path.resolve(__dirname, '../../webdb/dist/webdb-node-parallel.worker.js');
const wasmPath = path.resolve(__dirname, '../../webdb/dist/webdb.wasm');

const noop = () => {};

async function main(db: webdb.AsyncWebDB) {
    let tupleCount = 1000000;
    let bytes = 0;

    await benny.suite(
        `Chunks | 1 column | 1m rows | materialized`,
        benny.add('BOOLEAN', async () => {
            let conn = await db.connect();
            let result = await conn.runQuery(`
            SELECT v > 0 FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkArrayIterator(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                for (const _ of chunks.iterateBooleanColumn(0)) {
                    noop();
                }
            }
            await conn.disconnect();
            bytes = tupleCount * 1;
        }),

        benny.add('TINYINT', async () => {
            let conn = await db.connect();
            let result = await conn.runQuery(`
            SELECT (v & 127)::TINYINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkArrayIterator(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                for (const _ of chunks.iterateNumberColumn(0)) {
                    noop();
                }
            }
            await conn.disconnect();
            bytes = tupleCount * 1;
        }),

        benny.add('SMALLINT', async () => {
            try {
                let conn = await db.connect();
                let result = await conn.runQuery(`
                SELECT (v & 32767)::SMALLINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
                let chunks = new webdb.ChunkArrayIterator(result);
                while (true) {
                    if (!chunks.nextBlocking()) break;
                    for (const _ of chunks.iterateNumberColumn(0)) {
                        noop();
                    }
                }
                await conn.disconnect();
            } catch (e) {
                console.error(e);
            }
            bytes = tupleCount * 2;
        }),

        benny.add('INTEGER', async () => {
            let conn = await db.connect();
            let result = await conn.runQuery(`
                SELECT v::INTEGER FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkArrayIterator(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                for (const _ of chunks.iterateNumberColumn(0)) {
                    noop();
                }
            }
            await conn.disconnect();
            bytes = tupleCount * 4;
        }),

        benny.add('BIGINT', async () => {
            let conn = await db.connect();
            let result = await conn.runQuery(`
                SELECT v::BIGINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkArrayIterator(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                for (const _ of chunks.iterateBigIntColumn(0)) {
                    noop();
                }
            }
            await conn.disconnect();
            bytes = tupleCount * 8;
        }),

        benny.add('HUGEINT', async () => {
            let conn = await db.connect();
            let result = await conn.runQuery(`
                SELECT v::HUGEINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkArrayIterator(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                for (const _ of chunks.iterateBigIntColumn(0)) {
                    noop();
                }
            }
            await conn.disconnect();
            bytes = tupleCount * 16;
        }),

        benny.add('FLOAT', async () => {
            let conn = await db.connect();
            let result = await conn.runQuery(`
                SELECT v::FLOAT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkArrayIterator(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                for (const _ of chunks.iterateNumberColumn(0)) {
                    noop();
                }
            }
            await conn.disconnect();
            bytes = tupleCount * 4;
        }),

        benny.add('DOUBLE', async () => {
            let conn = await db.connect();
            let result = await conn.runQuery(`
                SELECT v::DOUBLE FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkArrayIterator(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                for (const _ of chunks.iterateNumberColumn(0)) {
                    noop();
                }
            }
            await conn.disconnect();
            bytes = tupleCount * 8;
        }),

        benny.add('STRING', async () => {
            let conn = await db.connect();
            let result = await conn.runQuery(`
                SELECT v::VARCHAR FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkArrayIterator(result);

            bytes = 0;
            while (true) {
                if (!chunks.nextBlocking()) break;
                for (const v of chunks.iterateStringColumn(0)) {
                    bytes += v!.length;
                }
            }
            await conn.disconnect();
        }),

        benny.cycle((result: any, _summary: any) => {
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

    await benny.suite(
        `Chunks | 1 column | 1m rows | streaming`,
        benny.add('BOOLEAN', async () => {
            let conn = await db.connect();
            let result = await conn.sendQuery(`
                SELECT v > 0 FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            while (true) {
                if (!(await chunks.nextAsync())) break;
                for (const _ of chunks.iterateBooleanColumn(0)) {
                    noop();
                }
            }
            await conn.disconnect();
            bytes = tupleCount * 1;
        }),

        benny.add('TINYINT', async () => {
            let conn = await db.connect();
            let result = await conn.sendQuery(`
                SELECT (v & 127)::TINYINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            while (true) {
                if (!(await chunks.nextAsync())) break;
                for (const _ of chunks.iterateNumberColumn(0)) {
                    noop();
                }
            }
            await conn.disconnect();
            bytes = tupleCount * 1;
        }),

        benny.add('SMALLINT', async () => {
            let conn = await db.connect();
            let result = await conn.sendQuery(`
                SELECT (v & 32767)::SMALLINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            while (true) {
                if (!(await chunks.nextAsync())) break;
                for (const _ of chunks.iterateNumberColumn(0)) {
                    noop();
                }
            }
            await conn.disconnect();
            bytes = tupleCount * 2;
        }),

        benny.add('INTEGER', async () => {
            let conn = await db.connect();
            let result = await conn.sendQuery(`
                SELECT v::INTEGER FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            while (true) {
                if (!(await chunks.nextAsync())) break;
                for (const _ of chunks.iterateNumberColumn(0)) {
                    noop();
                }
            }
            await conn.disconnect();
            bytes = tupleCount * 4;
        }),

        benny.add('BIGINT', async () => {
            let conn = await db.connect();
            let result = await conn.sendQuery(`
                SELECT v::BIGINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            while (true) {
                if (!(await chunks.nextAsync())) break;
                for (const _ of chunks.iterateBigIntColumn(0)) {
                    noop();
                }
            }
            await conn.disconnect();
            bytes = tupleCount * 8;
        }),

        benny.add('HUGEINT', async () => {
            let conn = await db.connect();
            let result = await conn.sendQuery(`
                SELECT v::HUGEINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            while (true) {
                if (!(await chunks.nextAsync())) break;
                for (const _ of chunks.iterateBigIntColumn(0)) {
                    noop();
                }
            }
            await conn.disconnect();
            bytes = tupleCount * 16;
        }),

        benny.add('FLOAT', async () => {
            let conn = await db.connect();
            let result = await conn.sendQuery(`
                SELECT v::FLOAT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            while (true) {
                if (!(await chunks.nextAsync())) break;
                for (const _ of chunks.iterateNumberColumn(0)) {
                    noop();
                }
            }
            await conn.disconnect();
            bytes = tupleCount * 4;
        }),

        benny.add('DOUBLE', async () => {
            let conn = await db.connect();
            let result = await conn.sendQuery(`
                SELECT v::DOUBLE FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            while (true) {
                if (!(await chunks.nextAsync())) break;
                for (const _ of chunks.iterateNumberColumn(0)) {
                    noop();
                }
            }
            await conn.disconnect();
            bytes = tupleCount * 8;
        }),

        benny.add('STRING', async () => {
            let conn = await db.connect();
            let result = await conn.sendQuery(`
                SELECT v::VARCHAR FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            bytes = 0;
            while (true) {
                if (!(await chunks.nextAsync())) break;
                for (const v of chunks.iterateStringColumn(0)) {
                    bytes += v!.length;
                }
            }
            await conn.disconnect();
        }),

        benny.cycle((result: any, _summary: any) => {
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

const logger = new webdb.VoidLogger();
const worker = new Worker(workerPath);
const db = new webdb.AsyncWebDB(logger, worker);
db.open(wasmPath)
    .then(() => main(db))
    .then(() => db.terminate())
    .catch(e => console.error(e));
