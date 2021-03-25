import * as webdb from '../../src/';

const testRows = 3000;

export function testAsyncIterator(db: () => webdb.AsyncWebDB, basedir: string) {
    var conn: webdb.AsyncWebDBConnection;

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

        describe('uni-schema from parquet', () => {
            it('single table', async () => {
                await db().registerURL(`${basedir}/studenten.parquet`);

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
            });

            it('simple join', async () => {
                await db().registerURL(`${basedir}/studenten.parquet`);
                await db().registerURL(`${basedir}/hoeren.parquet`);
                await db().registerURL(`${basedir}/vorlesungen.parquet`);

                let result = await conn.sendQuery(`
                    SELECT studenten.MatrNr, vorlesungen.Titel
                    FROM parquet_scan('${basedir}/studenten.parquet') studenten
                    INNER JOIN parquet_scan('${basedir}/hoeren.parquet') hoeren ON (studenten.MatrNr = hoeren.MatrNr)
                    INNER JOIN parquet_scan('${basedir}/vorlesungen.parquet') vorlesungen ON (vorlesungen.VorlNr = hoeren.VorlNr);
                `);
                expect(result.columnTypesLength()).toBe(2);
                let chunks = new webdb.AsyncChunkStreamIterator(conn, result);
                interface Row extends webdb.RowProxy {
                    MatrNr: number | null;
                    Titel: string | null;
                }
                let vals: object[] = [];
                while (await chunks.nextAsync()) {
                    for (let row of chunks.collect<Row>()) {
                        vals.push({
                            MatrNr: row.MatrNr,
                            Titel: row.Titel,
                        });
                    }
                }
                expect(vals).toEqual([
                    { MatrNr: 26120, Titel: 'Grundzüge' },
                    { MatrNr: 27550, Titel: 'Grundzüge' },
                    { MatrNr: 27550, Titel: 'Logik' },
                    { MatrNr: 28106, Titel: 'Ethik' },
                    { MatrNr: 28106, Titel: 'Wissenschaftstheorie' },
                    { MatrNr: 28106, Titel: 'Bioethik' },
                    { MatrNr: 28106, Titel: 'Der Wieer Kreis' },
                    { MatrNr: 29120, Titel: 'Grundzüge' },
                    { MatrNr: 29120, Titel: 'Ethik' },
                    { MatrNr: 29120, Titel: 'Mäeutik' },
                    { MatrNr: 29555, Titel: 'Glaube und Wissen' },
                    { MatrNr: 25403, Titel: 'Glaube und Wissen' },
                ]);
            });
        });
    });
}
