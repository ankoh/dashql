import * as duckdb from '../src/';
import * as arrow from 'apache-arrow';

export function testFilesystem(db: () => duckdb.AsyncDuckDB, basedir: string) {
    let conn: duckdb.AsyncDuckDBConnection;

    beforeEach(async () => {
        conn = await db().connect();
    });

    afterEach(async () => {
        await conn.disconnect();
    });

    describe('URL registration', () => {
        let test = async () => {
            const result = await conn.sendQuery(`SELECT MatrNr FROM parquet_scan('${basedir}/studenten.parquet');`);
            const table = await arrow.Table.from<{ MatrNr: arrow.Int }>(result);
            expect(table.getColumnAt(0)?.toArray()).toEqual(
                new Int32Array([24002, 25403, 26120, 26830, 27550, 28106, 29120, 29555]),
            );
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
            const result = await conn.sendQuery(`SELECT MatrNr FROM parquet_scan('${basedir}/studenten.parquet');`);
            const table = await arrow.Table.from<{ MatrNr: arrow.Int }>(result);
            expect(table.getColumnAt(0)?.toArray()).toEqual(
                new Int32Array([24002, 25403, 26120, 26830, 27550, 28106, 29120, 29555]),
            );
        });

        it('simple join', async () => {
            await db().registerURL(`${basedir}/studenten.parquet`);
            await db().registerURL(`${basedir}/hoeren.parquet`);
            await db().registerURL(`${basedir}/vorlesungen.parquet`);

            const result = await conn.sendQuery(`
                    SELECT studenten.MatrNr, vorlesungen.Titel
                    FROM parquet_scan('${basedir}/studenten.parquet') studenten
                    INNER JOIN parquet_scan('${basedir}/hoeren.parquet') hoeren ON (studenten.MatrNr = hoeren.MatrNr)
                    INNER JOIN parquet_scan('${basedir}/vorlesungen.parquet') vorlesungen ON (vorlesungen.VorlNr = hoeren.VorlNr);
                `);
            const table = await arrow.Table.from<{ MatrNr: arrow.Int; Titel: arrow.Utf8 }>(result);
            expect(table.numCols).toBe(2);
            let flat = [];
            for (const row of table) {
                flat.push({
                    MatrNr: row.MatrNr,
                    Titel: row.Titel?.toString(),
                });
            }
            expect(flat).toEqual([
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
