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

    describe('Parquet Scans', () => {
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
}
