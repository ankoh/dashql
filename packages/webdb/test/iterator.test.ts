import * as webdb from '../src/';

const testRows = 3000;

export function testIterator(db: () => webdb.WebDBBindings) {
    let conn: webdb.WebDBConnection;

    beforeEach(() => {
        conn = db().connect();
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

            it('DATE', () => {
                const result = conn.sendQuery(`SELECT DATE '2021-03-25 18:20:00' as foo;`);
                expect(result.columnTypesLength()).toBe(1);
                const chunks = new webdb.ChunkStreamIterator(conn, result);
                chunks.nextBlocking();
                while (chunks.nextBlocking()) {
                    for (const v of chunks.iterateDateColumn(0)) {
                        expect(v).toEqual(new Date(Date.UTC(2021, 2, 25)));
                    }
                }
            });

            it('TIME', () => {
                const result = conn.sendQuery(`SELECT TIME '2021-03-25 18:20:00' as foo;`);
                expect(result.columnTypesLength()).toBe(1);
                interface Row extends webdb.RowProxy {
                    foo: Date | null;
                }
                const chunks = new webdb.ChunkStreamIterator(conn, result);
                while (chunks.nextBlocking()) {
                    for (const v of chunks.iterateDateColumn(0)) {
                        expect(v).toEqual(new Date('1970-01-01T18:20:00Z'));
                    }
                }
            });

            it('TIMESTAMP', () => {
                const result = conn.sendQuery(`SELECT TIMESTAMP '2021-03-25 18:20:00' as foo;`);
                expect(result.columnTypesLength()).toBe(1);
                interface Row extends webdb.RowProxy {
                    foo: Date | null;
                }
                const chunks = new webdb.ChunkStreamIterator(conn, result);
                while (chunks.nextBlocking()) {
                    for (const v of chunks.iterateDateColumn(0)) {
                        expect(v).toEqual(new Date('2021-03-25T18:20:00Z'));
                    }
                }
            });
        });

        describe('buffering column', () => {
            it('TINYINT', () => {
                let result = conn.sendQuery(`
                    SELECT (v & 127)::TINYINT FROM generate_series(0, ${testRows}) as t(v);
                `);
                expect(result.columnTypesLength()).toBe(1);
                let chunkStream = new webdb.ChunkStreamIterator(conn, result);
                let chunks = new webdb.MaterializingChunkIterator(chunkStream);
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
}
