import * as duckdb from '../src/';
import * as arrow from 'apache-arrow';

export function testZipAsync(
    db: () => duckdb.AsyncDuckDB,
    resolveData: (url: string) => Promise<Uint8Array | null>,
): void {
    let conn: duckdb.AsyncDuckDBConnection;

    beforeEach(async () => {
        conn = await db().connect();
    });

    afterEach(async () => {
        await conn.disconnect();
    });

    describe('Async Zipper', () => {
        it('Scan Loaded', async () => {
            const all = await resolveData('/uni/all.zip')!;
            expect(all).not.toBeNull();
            const zip = await db().addFileBuffer('/uni/all.zip', all!);
            const out = await db().addFileBuffer('/out/assistenten.parquet', new Uint8Array());

            await db().extractZipPath(zip, out, 'assistenten.parquet');

            const table = await conn.runQuery<{
                PersNr: arrow.Int;
                Name: arrow.Utf8;
                Fachgebiet: arrow.Utf8;
                Boss: arrow.Int;
            }>("SELECT * FROM parquet_scan('/out/assistenten.parquet')");

            // Test values
            expect(table.numCols).toBe(4);
            const expected = [
                { PersNr: 3002, Name: 'Platon', Fachgebiet: 'Ideenlehre', Boss: 2125 },
                { PersNr: 3003, Name: 'Aristoteles', Fachgebiet: 'Syllogistik', Boss: 2125 },
                { PersNr: 3004, Name: 'Wittgenstein', Fachgebiet: 'Sprachteorie', Boss: 2126 },
                { PersNr: 3005, Name: 'Rhetikus', Fachgebiet: 'Planetenbewegung', Boss: 2127 },
                { PersNr: 3006, Name: 'Newton', Fachgebiet: 'Keplersche Gesetze', Boss: 2127 },
                { PersNr: 3007, Name: 'Spinoza', Fachgebiet: 'Gott und Natur', Boss: 2126 },
            ];
            let rowIdx = 0;
            for (const row of table.toArray()) {
                const i = rowIdx++;
                expect(row.PersNr).toEqual(expected[i].PersNr);
                expect(row.Name).toEqual(expected[i].Name);
                expect(row.Fachgebiet).toEqual(expected[i].Fachgebiet);
                expect(row.Boss).toEqual(expected[i].Boss);
            }
        });
    });
}