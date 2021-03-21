import { beforeAll, beforeEach, afterEach, describe, test, expect } from '@jest/globals';
import * as webdb from '../src/index_node';
import * as path from 'path';

var db: webdb.WebDB;
var conn: webdb.WebDBConnection;
const testRows = 3000;
const logger = new webdb.ConsoleLogger();

beforeAll(async () => {
    db = new webdb.WebDB(logger, webdb.DefaultWebDBRuntime, path.resolve(__dirname, '../src/webdb_wasm.wasm'));
    await db.open();
});

beforeEach(() => {
    conn = db.connect();
});

afterEach(() => {
    conn.disconnect();
});

describe('RowProxy', () => {
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

        test('BIGINT', () => {
            const result = conn.sendQuery(`
                SELECT v::BIGINT AS foo FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            interface Row extends webdb.RowProxy {
                foo: bigint | null;
            }
            const chunks = new webdb.ChunkStreamIterator(conn, result);
            let expected = 0;
            while (chunks.nextBlocking()) {
                for (const row of chunks.collect<Row>()) {
                    let e = BigInt(expected++);
                    expect(row.foo).toBe(e);
                    expect(row.__attribute__(0)).toBe(e);
                }
            }
        });

        test('HUGEINT', () => {
            const result = conn.sendQuery(`
                SELECT v::HUGEINT AS foo FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            interface Row extends webdb.RowProxy {
                foo: bigint | null;
            }
            const chunks = new webdb.ChunkStreamIterator(conn, result);
            let expected = 0;
            while (chunks.nextBlocking()) {
                for (const row of chunks.collect<Row>()) {
                    let e = BigInt(expected++);
                    expect(row.foo).toBe(e);
                    expect(row.__attribute__(0)).toBe(e);
                }
            }
        });

        test('STRING', () => {
            const result = conn.sendQuery(`
                SELECT v::VARCHAR AS foo FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            interface Row extends webdb.RowProxy {
                foo: string | null;
            }
            const chunks = new webdb.ChunkStreamIterator(conn, result);
            let expected = 0;
            while (chunks.nextBlocking()) {
                for (const row of chunks.collect<Row>()) {
                    let e = String(expected++);
                    expect(row.foo).toBe(e);
                    expect(row.__attribute__(0)).toBe(e);
                }
            }
        });

        test('BOOLEAN', () => {
            const result = conn.sendQuery(`
                SELECT v > 0 AS foo FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            interface Row extends webdb.RowProxy {
                foo: boolean | null;
            }
            const chunks = new webdb.ChunkStreamIterator(conn, result);
            let counter = 0;
            while (chunks.nextBlocking()) {
                for (const row of chunks.collect<Row>()) {
                    let reference = counter > 0;
                    expect(row.foo).toBe(reference);
                    expect(row.__attribute__(0)).toBe(reference);

                    counter++;
                }
            }
        });
    });

    describe('multiple columns, many rows', () => {
        test('ALLTYPES', () => {
            const result = conn.sendQuery(`
                SELECT v::INTEGER AS foo, v::BIGINT as bar, v::VARCHAR as fizz, v > 0 as buzz FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(4);
            interface Row extends webdb.RowProxy {
                foo: number | null;
                bar: bigint | null;
                fizz: string | null;
                buzz: boolean | null;
            }
            const chunks = new webdb.ChunkStreamIterator(conn, result);
            let expected = 0;
            while (chunks.nextBlocking()) {
                for (const row of chunks.collect<Row>()) {
                    let e = expected++;
                    expect(row.foo).toBe(e);
                    expect(row.__attribute__(0)).toBe(e);
                    expect(row.bar).toBe(BigInt(e));
                    expect(row.__attribute__(1)).toBe(BigInt(e));
                    expect(row.fizz).toBe(String(e));
                    expect(row.__attribute__(2)).toBe(String(e));
                    expect(row.buzz).toBe(e > 0);
                    expect(row.__attribute__(3)).toBe(e > 0);
                }
            }
        });

        test('Iterator', () => {
            const result = conn.sendQuery(`
                SELECT v::INTEGER AS foo, v::BIGINT as bar, v::VARCHAR as fizz, v > 0 as buzz FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(4);
            interface Row extends webdb.RowProxy {
                foo: number | null;
                bar: bigint | null;
                fizz: string | null;
                buzz: boolean | null;
            }
            const chunks = new webdb.ChunkStreamIterator(conn, result);
            let expected = 0;
            for (const row of chunks.iter<Row>()) {
                let e = expected++;
                expect(row.foo).toBe(e);
                expect(row.__attribute__(0)).toBe(e);
                expect(row.bar).toBe(BigInt(e));
                expect(row.__attribute__(1)).toBe(BigInt(e));
                expect(row.fizz).toBe(String(e));
                expect(row.__attribute__(2)).toBe(String(e));
                expect(row.buzz).toBe(e > 0);
                expect(row.__attribute__(3)).toBe(e > 0);
            }
        });
    });

    describe('single column, chunked partition boundaries, single integer', () => {
        test('INTEGER', () => {
            const result = conn.sendQuery(
                `
                SELECT v::INTEGER AS foo, (v::INTEGER / 100) AS bar FROM generate_series(0, ${testRows}) as t(v);
            `,
                {
                    partitionBoundaries: [1],
                },
            );
            expect(result.columnTypesLength()).toBe(2);
            interface Row extends webdb.RowProxy {
                foo: number | null;
                bar: number | null;
            }
            const chunks = new webdb.ChunkStreamIterator(conn, result);
            let expected = 0;
            while (chunks.nextBlocking()) {
                for (const row of chunks.collect<Row>()) {
                    let e = expected++;
                    expect(row.foo).toBe(e);
                    expect(row.bar).toBe(Math.trunc(e / 100));
                    expect(row.__attribute__(0)).toBe(e);
                    expect(row.__attribute__(1)).toBe(Math.trunc(e / 100));
                    expect(row.__is_partition_boundary__).toBe(e % 100 == 0);
                }
            }
        });
    });

    describe('single column, chunked partition boundaries, 2 integers', () => {
        test('INTEGER', () => {
            const result = conn.sendQuery(
                `
                SELECT v::INTEGER AS foo, (v::INTEGER / 200) AS bar, (v::INTEGER / 300) AS bam FROM generate_series(0, ${testRows}) as t(v);
            `,
                {
                    partitionBoundaries: [1, 2],
                },
            );
            expect(result.columnTypesLength()).toBe(3);
            interface Row extends webdb.RowProxy {
                foo: number | null;
                bar: number | null;
                bam: number | null;
            }
            const chunks = new webdb.ChunkStreamIterator(conn, result);
            let expected = 0;
            while (chunks.nextBlocking()) {
                for (const row of chunks.collect<Row>()) {
                    let e = expected++;
                    expect(row.foo).toBe(e);
                    expect(row.bar).toBe(Math.trunc(e / 200));
                    expect(row.bam).toBe(Math.trunc(e / 300));
                    expect(row.__attribute__(0)).toBe(e);
                    expect(row.__attribute__(1)).toBe(Math.trunc(e / 200));
                    expect(row.__attribute__(2)).toBe(Math.trunc(e / 300));
                    expect(row.__is_partition_boundary__).toBe(e % 200 == 0 || e % 300 == 0);
                }
            }
        });
    });

    describe('single column, proxy partitions, 1 integer', () => {
        test('INTEGER', () => {
            const result = conn.sendQuery(
                `
                SELECT v::INTEGER AS foo, (v::INTEGER / 100) AS bar FROM generate_series(0, ${testRows - 1}) as t(v);
            `,
                {
                    partitionBoundaries: [1],
                },
            );
            expect(result.columnTypesLength()).toBe(2);
            interface Row extends webdb.RowProxy {
                foo: number | null;
                bar: number | null;
            }
            const chunks = new webdb.ChunkStreamIterator(conn, result);
            const partitions = chunks.collectPartitionsBlocking<Row>();
            expect(partitions.length).toBe(Math.ceil((testRows - 1) / 100));
            let expected = 0;
            for (let i = 0; i < partitions.length; ++i) {
                const partition = partitions[i];
                expect(partition.length).toBe(100);
                for (const row of partition) {
                    let e = expected++;
                    expect(row.__attribute__(1)).toBe(Math.trunc(e / 100));
                }
            }
        });
    });
});
