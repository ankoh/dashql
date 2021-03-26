import * as webdb from '../src/';

const testRows = 3000;

export function testAsyncIterator(db: () => webdb.AsyncWebDB) {
    let conn: webdb.AsyncWebDBConnection;

    beforeEach(async () => {
        conn = await db().connect();
    });

    afterEach(async () => {
        await conn.disconnect();
    });

    describe('AsyncWebDB', () => {
        it('ping', async () => {
            await db().ping();
        });
    });

    describe('QueryResultRowIterator', () => {
        describe('single column', () => {
            it('TINYINT', async () => {
                let result = await conn.sendQuery(
                    `SELECT (v & 127)::TINYINT FROM generate_series(0, ${testRows}) as t(v);`,
                );
                expect(result.columnTypesLength()).toBe(1);
                let chunks = new webdb.AsyncChunkStreamIterator(conn, result);
                let i = 0;
                while (await chunks.nextAsync()) {
                    for (const v of chunks.iterateNumberColumn(0)) {
                        expect(v).toBe(i++ & 127);
                    }
                }
                expect(i).toBe(testRows + 1);
            });
        });
    });
}
