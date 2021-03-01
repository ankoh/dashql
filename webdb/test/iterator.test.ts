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

describe('BlockingQueryResultRowIterator', () => {
    describe('single column', () => {
        test('TINYINT', () => {
            let result = conn.sendQuery(`
                SELECT (v & 127)::TINYINT FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            let iter = webdb.BlockingQueryResultRowIterator.iterate(chunks);
            let value = new webdb.Value();
            for (let i = 0; i <= testRows; ++i) {
                expect(iter.isEnd()).toBe(false);
                expect(iter.getValue(0, value).castAsInteger()).toBe(i & 127);
                iter.nextBlocking();
            }
            expect(iter.isEnd()).toBe(true);
        });

        test('SMALLINT', () => {
            let result = conn.sendQuery(`
                SELECT (v & 32767)::SMALLINT FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            let iter = webdb.BlockingQueryResultRowIterator.iterate(chunks);
            let value = new webdb.Value();
            for (let i = 0; i <= testRows; ++i) {
                expect(iter.isEnd()).toBe(false);
                expect(iter.getValue(0, value).castAsInteger()).toBe(i & 32767);
                iter.nextBlocking();
            }
            expect(iter.isEnd()).toBe(true);
        });

        test('INTEGER', () => {
            let result = conn.sendQuery(`
                SELECT v::INTEGER FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);

            let chunks = new webdb.QueryResultChunkStream(conn, result);
            let iter = webdb.BlockingQueryResultRowIterator.iterate(chunks);
            let value = new webdb.Value();
            for (let i = 0; i <= testRows; ++i) {
                expect(iter.isEnd()).toBe(false);
                expect(iter.getValue(0, value).castAsInteger()).toBe(i);
                iter.nextBlocking();
            }
            expect(iter.isEnd()).toBe(true);
        });

        test('BIGINT', () => {
            let result = conn.sendQuery(`
                SELECT v::BIGINT FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            let iter = webdb.BlockingQueryResultRowIterator.iterate(chunks);
            let value = new webdb.Value();
            for (let i = 0; i <= testRows; ++i) {
                expect(iter.isEnd()).toBe(false);
                expect(iter.getValue(0, value).castAsInteger()).toBe(i);
                iter.nextBlocking();
            }
            expect(iter.isEnd()).toBe(true);
        });
    });
});

describe('QueryResultChunkStream', () => {
    describe('single column', () => {
        test('TINYINT', () => {
            let result = conn.sendQuery(`
                SELECT (v & 127)::TINYINT FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            let i = 0;
            while (chunks.nextBlocking()) {
                chunks.iterateNumberColumn(0, (_row: number, v: number | null) => {
                    expect(v).toBe(i++ & 127);
                });
            }
            expect(i).toBe(testRows + 1);
        });

        test('SMALLINT', () => {
            let result = conn.sendQuery(`
                SELECT (v & 32767)::SMALLINT FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            let i = 0;
            while (chunks.nextBlocking()) {
                chunks.iterateNumberColumn(0, (_row: number, v: number | null) => {
                    expect(v).toBe(i++ & 32767);
                });
            }
            expect(i).toBe(testRows + 1);
        });

        test('INTEGER', () => {
            let result = conn.sendQuery(`
                SELECT v::INTEGER FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.QueryResultChunkStream(conn, result);
            let i = 0;
            while (chunks.nextBlocking()) {
                chunks.iterateNumberColumn(0, (_row: number, v: number | null) => {
                    expect(v).toBe(i++);
                });
            }
            expect(i).toBe(testRows + 1);
        });
    });
});
