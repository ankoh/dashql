import { add, cycle, suite, complete } from 'benny';
import duckdb from '../dist/duckdb_node.js';
import kleur from 'kleur';

let db = new duckdb.DuckDB();
await db.open();
const noop = () => {};

let tupleCount = 10000000;
let tupleSize = 0;

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

suite("Chunks | Single Column",
    add('TINYINT', async () => {
        tupleSize = 1;
        let conn = await db.connect();
        let result = await db.sendQuery(conn, `
            SELECT (v & 127)::TINYINT FROM generate_series(0, ${tupleCount}) as t(v);
        `);
        let chunks = new duckdb.webapi.QueryResultChunkStream(db, conn, result);
        while (true) {
            if (!await chunks.next())
                break;
            chunks.iterateNumberColumn(0, (row, v) => {
                noop();
            });
        }
        db.disconnect(conn);
    }),

    add('SMALLINT', async () => {
        tupleSize = 2;
        let conn = await db.connect();
        let result = await db.sendQuery(conn, `
            SELECT (v & 32767)::SMALLINT FROM generate_series(0, ${tupleCount}) as t(v);
        `);
        let chunks = new duckdb.webapi.QueryResultChunkStream(db, conn, result);
        while (true) {
            if (!await chunks.next())
                break;
            chunks.iterateNumberColumn(0, (row, v) => {
                noop();
            });
        }
        db.disconnect(conn);
    }),

    add('INTEGER', async () => {
        tupleSize = 4;
        let conn = await db.connect();
        let result = await db.sendQuery(conn, `
            SELECT v::INTEGER FROM generate_series(0, ${tupleCount}) as t(v);
        `);
        let chunks = new duckdb.webapi.QueryResultChunkStream(db, conn, result);
        while (true) {
            if (!await chunks.next())
                break;
            chunks.iterateNumberColumn(0, (row, v) => {
                noop();
            });
        }
        db.disconnect(conn);
    }),

    add('FLOAT', async () => {
        tupleSize = 4;
        let conn = await db.connect();
        let result = await db.sendQuery(conn, `
            SELECT v::FLOAT FROM generate_series(0, ${tupleCount}) as t(v);
        `);
        let chunks = new duckdb.webapi.QueryResultChunkStream(db, conn, result);
        while (true) {
            if (!await chunks.next())
                break;
            chunks.iterateNumberColumn(0, (row, v) => {
                noop();
            });
        }
        db.disconnect(conn);
    }),

    add('DOUBLE', async () => {
        tupleSize = 8;
        let conn = await db.connect();
        let result = await db.sendQuery(conn, `
            SELECT v::DOUBLE FROM generate_series(0, ${tupleCount}) as t(v);
        `);
        let chunks = new duckdb.webapi.QueryResultChunkStream(db, conn, result);
        while (true) {
            if (!await chunks.next())
                break;
            chunks.iterateNumberColumn(0, (row, v) => {
                noop();
            });
        }
        db.disconnect(conn);
    }),

    cycle((result, summary) => {
        let bytes = tupleCount * tupleSize;
        let duration = result.details.median;
        let throughput = bytes / duration;
        console.log(`${kleur.cyan(result.name)} t: ${duration.toFixed(3)} s tp: ${formatBytes(throughput)}/s`,
        )
    }),
)

