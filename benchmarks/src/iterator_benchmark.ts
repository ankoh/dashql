import * as webdb from '@dashql/webdb';
import * as benny from 'benny';
import kleur from 'kleur';

import wasmPath from '@dashql/webdb/dist/webdb.wasm';

let db = new webdb.WebDB({}, wasmPath);
db.open().then(() => main()).catch((e) => console.error(e));

function main() {
    const noop = () => {};

    let tupleCount = 1000000;
    let tupleSize = 0;

    function formatBytes(bytes: number, decimals = 2) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB', 'ZiB', 'YiB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    benny.suite(`Chunks | 1 column | 1m rows`,
        benny.add('TINYINT', () => {
            tupleSize = 1;
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT (v & 127)::TINYINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            while (true) {
                if (!chunks.next())
                    break;
                chunks.iterateNumberColumn(0, (row: number, v: number | null) => { noop(); });
            }
            conn.disconnect();
        }),

        benny.add('SMALLINT', () => {
            tupleSize = 2;
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT (v & 32767)::SMALLINT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            while (true) {
                if (!chunks.next())
                    break;
                chunks.iterateNumberColumn(0, (row: number, v: number | null) => { noop(); });
            }
            conn.disconnect();
        }),

        benny.add('INTEGER', () => {
            tupleSize = 4;
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT v::INTEGER FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            while (true) {
                if (!chunks.next())
                    break;
                chunks.iterateNumberColumn(0, (row: number, v: number | null) => { noop(); });
            }
            conn.disconnect();
        }),

        benny.add('FLOAT', () => {
            tupleSize = 4;
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT v::FLOAT FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            while (true) {
                if (!chunks.next())
                    break;
                chunks.iterateNumberColumn(0, (row: number, v: number | null) => { noop(); });
            }
            conn.disconnect();
        }),

        benny.add('DOUBLE', () => {
            tupleSize = 8;
            let conn = db.connect();
            let result = conn.sendQuery(`
                SELECT v::DOUBLE FROM generate_series(0, ${tupleCount}) as t(v);
            `);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            while (true) {
                if (!chunks.next())
                    break;
                chunks.iterateNumberColumn(0, (row: number, v: number | null) => { noop(); });
            }
            conn.disconnect();
        }),

        benny.cycle((result: any, _summary: any) => {
            let bytes = tupleCount * tupleSize;
            let duration = result.details.median;
            let throughput = bytes / duration;
            console.log(`${kleur.cyan(result.name)} t: ${duration.toFixed(3)} s tp: ${formatBytes(throughput)}/s`)
        }),
    );
}
