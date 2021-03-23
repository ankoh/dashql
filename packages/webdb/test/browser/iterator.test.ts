import * as webdb from '../../src/targets/sync_browser';

var db: webdb.WebDB;
var conn: webdb.WebDBConnection;
const testRows = 3000;
const logger = new webdb.ConsoleLogger();

beforeAll(async () => {
    db = new webdb.WebDB(logger, webdb.DefaultWebDBRuntime, '/static/webdb.wasm');
    await db.open();
});

beforeEach(() => {
    conn = db.connect();
});

afterEach(() => {
    conn.disconnect();
});

describe('QueryResultChunkStream', () => {
    describe('single column', () => {
        it('TINYINT', () => {
            let result = conn.sendQuery(`
                SELECT (v & 127)::TINYINT FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            let i = 0;
            while (chunks.nextBlocking()) {
                for (const v of chunks.iterateNumberColumn(0)) {
                    expect(v).toBe(i++ & 127);
                }
            }
            expect(i).toBe(testRows + 1);
        });

        it('SMALLINT', () => {
            let result = conn.sendQuery(`
                SELECT (v & 32767)::SMALLINT FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            let i = 0;
            while (chunks.nextBlocking()) {
                for (const v of chunks.iterateNumberColumn(0)) {
                    expect(v).toBe(i++ & 32767);
                }
            }
            expect(i).toBe(testRows + 1);
        });

        it('INTEGER', () => {
            let result = conn.sendQuery(`
                SELECT v::INTEGER FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            let i = 0;
            while (chunks.nextBlocking()) {
                for (const v of chunks.iterateNumberColumn(0)) {
                    expect(v).toBe(i++);
                }
            }
            expect(i).toBe(testRows + 1);
        });

        it('BIGINT', () => {
            let result = conn.sendQuery(`
                SELECT v::BIGINT FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            let i = 0;
            while (chunks.nextBlocking()) {
                for (const v of chunks.iterateBigIntColumn(0)) {
                    expect(v).toBe(BigInt(i++));
                }
            }
            expect(i).toBe(testRows + 1);
        });

        it('HUGEINT', () => {
            let result = conn.sendQuery(`
                SELECT v::HUGEINT FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            let i = 0;
            while (chunks.nextBlocking()) {
                for (const v of chunks.iterateHugeIntColumn(0)) {
                    expect(v).toBe(BigInt(i++));
                }
            }
            expect(i).toBe(testRows + 1);
        });

        it('STRING', () => {
            let result = conn.sendQuery(`
                SELECT v::VARCHAR FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            let i = 0;
            while (chunks.nextBlocking()) {
                for (const v of chunks.iterateStringColumn(0)) {
                    expect(v).toBe(String(i++));
                }
            }
            expect(i).toBe(testRows + 1);
        });

        it('BOOLEAN', () => {
            let result = conn.sendQuery(`
                SELECT v > 0 FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            let i = 0;
            while (chunks.nextBlocking()) {
                for (const v of chunks.iterateBooleanColumn(0)) {
                    expect(v).toBe(i++ > 0);
                }
            }
            expect(i).toBe(testRows + 1);
        });
    });

    describe('buffering column', () => {
        it('TINYINT', () => {
            let result = conn.sendQuery(`
                SELECT (v & 127)::TINYINT FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunkStream = new webdb.ChunkStreamIterator(conn, result);
            let chunks = new webdb.BufferingChunkIterator(chunkStream);
            let i = 0;
            while (chunks.nextBlocking()) {
                for (const v of chunks.iterateNumberColumn(0)) {
                    expect(v).toBe(i++ & 127);
                }
            }
            expect(i).toBe(testRows + 1);
            chunks.rewind();
            i = 0;
            while (chunks.nextBlocking()) {
                for (const v of chunks.iterateNumberColumn(0)) {
                    expect(v).toBe(i++ & 127);
                }
            }
            expect(i).toBe(testRows + 1);
        });
    });
});
