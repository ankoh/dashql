import { DuckDB } from '../dist/duckdb_node.js';
import * as duckdb from '../dist/duckdb_node.js';

var db: DuckDB;
var conn: number;

beforeEach(async () => {
    db = new DuckDB();
    await db.open();
    conn = await db.connect();
});

afterEach(async () => {
    await db.disconnect(conn);
});

describe('tuple iterator', () => {
    describe('single column', () => {
        test('TINYINT', async () => {
            let result = await db.sendQuery(conn, `
                SELECT (v & 127)::TINYINT FROM generate_series(0, 10000) as t(v);
            `);
            expect(result.root.columnTypesLength()).toBe(1);
            let chunks = new duckdb.webapi.QueryResultChunkStream(db, conn, result);
            let iter = await duckdb.webapi.QueryResultRowIterator.iterate(chunks);
            let value = new duckdb.webapi.Value();
            for (let i = 0; i <= 10000; ++i) {
                expect(iter.isEnd()).toBe(false);
                expect(iter.getValue(0, value).i8).toBe(i & 127);
                await iter.next();
            }
            expect(iter.isEnd()).toBe(true);
        });

        test('SMALLINT', async () => {
            let result = await db.sendQuery(conn, `
                SELECT (v & 32767)::SMALLINT FROM generate_series(0, 10000) as t(v);
            `);
            expect(result.root.columnTypesLength()).toBe(1);
            let chunks = new duckdb.webapi.QueryResultChunkStream(db, conn, result);
            let iter = await duckdb.webapi.QueryResultRowIterator.iterate(chunks);
            let value = new duckdb.webapi.Value();
            for (let i = 0; i <= 10000; ++i) {
                expect(iter.isEnd()).toBe(false);
                expect(iter.getValue(0, value).i16).toBe(i & 32767);
                await iter.next();
            }
            expect(iter.isEnd()).toBe(true);
        });

        test('INTEGER', async () => {
            let result = await db.sendQuery(conn, `
                SELECT v::INTEGER FROM generate_series(0, 10000) as t(v);
            `);
            expect(result.root.columnTypesLength()).toBe(1);

            let chunks = new duckdb.webapi.QueryResultChunkStream(db, conn, result);
            let iter = await duckdb.webapi.QueryResultRowIterator.iterate(chunks);
            let value = new duckdb.webapi.Value();
            for (let i = 0; i <= 10000; ++i) {
                expect(iter.isEnd()).toBe(false);
                expect(iter.getValue(0, value).i32).toBe(i);
                await iter.next();
            }
            expect(iter.isEnd()).toBe(true);
        });

        test('BIGINT', async () => {
            let result = await db.sendQuery(conn, `
                SELECT v::BIGINT FROM generate_series(0, 10000) as t(v);
            `);
            expect(result.root.columnTypesLength()).toBe(1);
            let chunks = new duckdb.webapi.QueryResultChunkStream(db, conn, result);
            let iter = await duckdb.webapi.QueryResultRowIterator.iterate(chunks);
            let value = new duckdb.webapi.Value();
            for (let i = 0; i <= 10000; ++i) {
                expect(iter.isEnd()).toBe(false);
                expect(iter.getValue(0, value).i64.low).toBe(i);
                await iter.next();
            }
            expect(iter.isEnd()).toBe(true);
        });
    });
});

describe('chunk iterator', () => {
    describe('single column', () => {
        test('TINYINT', async () => {
            let result = await db.sendQuery(conn, `
                SELECT (v & 127)::TINYINT FROM generate_series(0, 10000) as t(v);
            `);
            expect(result.root.columnTypesLength()).toBe(1);
            let chunks = new duckdb.webapi.QueryResultChunkStream(db, conn, result);
            let i = 0;
            while (await chunks.next()) {
                chunks.iterateNumberColumn(0, (_row: number, v: number | null) => {
                    expect(v).toBe(i++ & 127);
                });
            }
            expect(i).toBe(10001);
        });

        test('SMALLINT', async () => {
            let result = await db.sendQuery(conn, `
                SELECT (v & 32767)::SMALLINT FROM generate_series(0, 10000) as t(v);
            `);
            expect(result.root.columnTypesLength()).toBe(1);
            let chunks = new duckdb.webapi.QueryResultChunkStream(db, conn, result);
            let i = 0;
            while (await chunks.next()) {
                chunks.iterateNumberColumn(0, (_row: number, v: number | null) => {
                    expect(v).toBe(i++ & 32767);
                });
            }
            expect(i).toBe(10001);
        });

        test('INTEGER', async () => {
            let result = await db.sendQuery(conn, `
                SELECT v::INTEGER FROM generate_series(0, 10000) as t(v);
            `);
            expect(result.root.columnTypesLength()).toBe(1);
            let chunks = new duckdb.webapi.QueryResultChunkStream(db, conn, result);
            let i = 0;
            while (await chunks.next()) {
                chunks.iterateNumberColumn(0, (_row: number, v: number | null) => {
                    expect(v).toBe(i++);
                });
            }
            expect(i).toBe(10001);
        });
    });
});
