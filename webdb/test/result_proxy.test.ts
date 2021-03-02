import { beforeAll, beforeEach, afterEach, describe, test, expect } from '@jest/globals';
import * as webdb from '../src/index_node';
import * as path from 'path';

var db: webdb.WebDB;
var conn: webdb.WebDBConnection;
const testRows = 3000;
const logger = new webdb.ConsoleLogger();

beforeAll(async () => {
    db = new webdb.WebDB(logger, {}, path.resolve(__dirname, "../src/webdb_wasm.wasm"));
    await db.open();
});

beforeEach(() => {
    conn = db.connect();
});

afterEach(() => {
    conn.disconnect();
});

describe('ResultProxy', () => {
    describe('single columns', () => {
        test('INTEGER', () => {
            const result = conn.sendQuery(`
                SELECT v::INTEGER AS foo FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            interface Row extends webdb.RowProxy {
                foo: number | null;
            }
            const proxyType = new webdb.RowProxyType<Row>(result);
            const chunks = new webdb.QueryResultChunkStream(conn, result);
            let expected = 0;
            while (chunks.nextBlocking()) {
                const rows = proxyType.proxyChunkRows(chunks.currentChunk);
                for (let i = 0; i < rows.length; ++i) {
                    let e = expected++;
                    expect(rows[i].foo).toBe(e);
                    expect(rows[i].__attribute__(0)).toBe(e);
                }
            }
        });
    });
});
