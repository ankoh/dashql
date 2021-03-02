import * as webdb from '@dashql/webdb';
import * as core from '@dashql/core';
import * as benny from 'benny';
import kleur from 'kleur';

import wasmPath from '@dashql/webdb/dist/webdb.wasm';

const noop = () => {};

function main(db: webdb.WebDB) {
    let tupleCount = 1000000;
    let tupleSize = 8;

    benny.suite(
        `Chunks | 1 column | 1m rows | materialized`,
        benny.add('TINYINT', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT (v & 127)::TINYINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.MaterializedQueryResultChunks(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();
        }),

        benny.add('SMALLINT', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT (v & 32767)::SMALLINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.MaterializedQueryResultChunks(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();
        }),

        benny.add('INTEGER', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT v::INTEGER FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.MaterializedQueryResultChunks(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();
        }),

        benny.add('FLOAT', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT v::FLOAT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.MaterializedQueryResultChunks(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();
        }),

        benny.add('DOUBLE', () => {
            let conn = db.connect();
            let result = conn.runQuery(`
                SELECT v::DOUBLE FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.MaterializedQueryResultChunks(result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();
        }),

        benny.cycle((result: any, _summary: any) => {
            let bytes = tupleCount * tupleSize;
            let duration = result.details.median;
            let tupleThroughput = tupleCount / duration;
            let dataThroughput = bytes / duration;
            console.log(
                `${kleur.cyan(result.name)} t: ${duration.toFixed(3)} s ttp: ${core.utils.formatThousands(tupleThroughput)}/s dtp: ${core.utils.formatBytes(dataThroughput)}/s`,
            );
        }),
    );

    benny.suite(
        `Chunks | 1 column | 1m rows | streaming`,
        benny.add('TINYINT', () => {
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT (v & 127)::TINYINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();
        }),

        benny.add('SMALLINT', () => {
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT (v & 32767)::SMALLINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();
        }),

        benny.add('INTEGER', () => {
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT v::INTEGER FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();
        }),

        benny.add('FLOAT', () => {
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT v::FLOAT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();
        }),

        benny.add('DOUBLE', () => {
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT v::DOUBLE FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            while (true) {
                if (!chunks.nextBlocking()) break;
                chunks.iterateNumberColumn(0, (_row: number, _v: number | null) => {
                    noop();
                });
            }
            conn.disconnect();
        }),

        benny.cycle((result: any, _summary: any) => {
            let bytes = tupleCount * tupleSize;
            let duration = result.details.median;
            let tupleThroughput = tupleCount / duration;
            let dataThroughput = bytes / duration;
            console.log(
                `${kleur.cyan(result.name)} t: ${duration.toFixed(3)} s ttp: ${core.utils.formatThousands(tupleThroughput)}/s dtp: ${core.utils.formatBytes(dataThroughput)}/s`,
            );
        }),
    );
}

const logger = new webdb.VoidLogger();
const db = new webdb.WebDB(logger, {}, wasmPath);
db.open()
    .then(() => main(db))
    .catch(e => console.error(e));
