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

describe('RowProxy', () => {
    describe('single column, zero rows', () => {
        test('INTEGER', () => {
            const result = conn.sendQuery(`
                SELECT v::INTEGER AS foo FROM generate_series(0, 1) as t(v) WHERE v < 0;
            `);
            expect(result.columnTypesLength()).toBe(1);
            interface Row extends webdb.RowProxy {
                foo: number | null;
            }
            const chunks = new webdb.ChunkStreamIterator(conn, result);
            const row = chunks.collectOne<Row>();
            expect(row.foo).toBeNull();
        });
    });

    describe('single column, single row', () => {
        test('INTEGER', () => {
            const result = conn.sendQuery(`
                SELECT v::INTEGER AS foo FROM generate_series(42, 42) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            interface Row extends webdb.RowProxy {
                foo: number | null;
            }
            const chunks = new webdb.ChunkStreamIterator(conn, result);
            expect(chunks.nextBlocking()).toBe(true);
            const row = chunks.collectOne<Row>();
            expect(row.foo).toBe(42);
        });
    });

    describe('single column, single row, underspecified type', () => {
        test('INTEGER', () => {
            const result = conn.sendQuery(`
                SELECT v::INTEGER AS foo FROM generate_series(42, 42) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            interface Row extends webdb.RowProxy {
            }
            const chunks = new webdb.ChunkStreamIterator(conn, result);
            expect(chunks.nextBlocking()).toBe(true);
            const row = chunks.collectOne<Row>();
            expect(row.__attribute__(0)).toBe(42);
        });
    });

    describe('single column, many rows', () => {
        test('INTEGER', () => {
            const result = conn.sendQuery(`
                SELECT v::INTEGER AS foo FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            interface Row extends webdb.RowProxy {
                foo: number | null;
            }
            const chunks = new webdb.ChunkStreamIterator(conn, result);
            let expected = 0;
            while (chunks.nextBlocking()) {
                for (const row of chunks.collect<Row>()) {
                    let e = expected++;
                    expect(row.foo).toBe(e);
                    expect(row.__attribute__(0)).toBe(e);
                }
            }
        });
    });
});
