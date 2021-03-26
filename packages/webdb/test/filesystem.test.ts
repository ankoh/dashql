import * as webdb from '../src/';

export function testFilesystem(db: () => webdb.AsyncWebDB, basedir: string) {
    let conn: webdb.AsyncWebDBConnection;

    beforeEach(async () => {
        conn = await db().connect();
    });

    afterEach(async () => {
        await conn.disconnect();
    });

    describe('URL registration', () => {
        let test = async () => {
            let result = await conn.sendQuery(`SELECT MatrNr FROM parquet_scan('${basedir}/studenten.parquet');`);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.AsyncChunkStreamIterator(conn, result);
            let vals: number[] = [];
            while (await chunks.nextAsync()) {
                for (const v of chunks.iterateNumberColumn(0)) {
                    vals.push(v!);
                }
            }
            expect(vals).toEqual([24002, 25403, 26120, 26830, 27550, 28106, 29120, 29555]);
        };

        it('URL used once', async () => {
            await db().registerURL(`${basedir}/studenten.parquet`);
            await test();
        });

        it('URL re-registered', async () => {
            await db().registerURL(`${basedir}/studenten.parquet`);
            await test();
            await db().registerURL(`${basedir}/studenten.parquet`);
            await test();
        });

        it('URL used twice', async () => {
            await db().registerURL(`${basedir}/studenten.parquet`);
            await test();
            await test();
        });
    });
}
