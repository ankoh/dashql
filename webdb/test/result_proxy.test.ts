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
            let result = conn.sendQuery(`
                SELECT v::INTEGER AS foo FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            interface Row {
                foo: number | null
            }
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            let rows = webdb.proxyMaterializedChunkRows<Row>(chunks);
            expect(rows.length).toBe(testRows + 1);
            for (let i = 0; i < rows.length; ++i) {
                expect(rows[i].foo).toBe(i);
            }
        });
    });
});
