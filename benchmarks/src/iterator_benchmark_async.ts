import Worker from 'web-worker';
import * as webdb from '@dashql/webdb/dist/webdb_async';
import * as core from '@dashql/core';
import * as benny from 'benny';
import kleur from 'kleur';

import workerPath from '@dashql/webdb/dist/webdb_node_async.worker.js';
import wasmPath from '@dashql/webdb/dist/webdb.wasm';

const noop = () => {};

async function main(db: webdb.AsyncWebDB) {
    let tupleCount = 1000000;
    let tupleSize = 0;

    await benny.suite(
        `Chunks | 1 column | 1m rows`,
        benny.add('TINYINT', async () => {
            tupleSize = 1;
            let conn = await db.connect();
            let result = await conn.sendQuery(`
                SELECT (v & 127)::TINYINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            while (true) {
                if (!await chunks.next()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            await conn.disconnect();
        }),

        benny.add('SMALLINT', async () => {
            tupleSize = 2;
            let conn = await db.connect();
            let result = await conn.sendQuery(`
                SELECT (v & 32767)::SMALLINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            while (true) {
                if (!await chunks.next()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            await conn.disconnect();
        }),

        benny.add('INTEGER', async () => {
            tupleSize = 4;
            let conn = await db.connect();
            let result = await conn.sendQuery(`
                SELECT v::INTEGER FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            while (true) {
                if (!await chunks.next()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            await conn.disconnect();
        }),

        benny.add('FLOAT', async () => {
            tupleSize = 4;
            let conn = await db.connect();
            let result = await conn.sendQuery(`
                SELECT v::FLOAT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            while (true) {
                if (!await chunks.next()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            await conn.disconnect();
        }),

        benny.add('DOUBLE', async () => {
            tupleSize = 8;
            let conn = await db.connect();
            let result = await conn.sendQuery(`
                SELECT v::DOUBLE FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            while (true) {
                if (!await chunks.next()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            await conn.disconnect();
        }),

        benny.cycle((result: any, _summary: any) => {
            let bytes = tupleCount * tupleSize;
            let duration = result.details.median;
            let throughput = bytes / duration;
            console.log(
                `${kleur.cyan(result.name)} t: ${duration.toFixed(3)} s tp: ${core.utils.formatBytes(throughput)}/s`,
            );
        }),
    );
}

const worker = new Worker(workerPath);
const db = new webdb.AsyncWebDB(worker);
db.open(wasmPath)
    .then(() => main(db))
    .then(() => db.terminate())
    .catch(e => console.error(e));
