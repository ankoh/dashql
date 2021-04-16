import * as duckdb from '../src/';
//import * as arrow from 'apache-arrow';

export function testZip(
    db: () => duckdb.DuckDBBindings,
    resolveData: (url: string) => Promise<Uint8Array | null>,
): void {
    let conn: duckdb.DuckDBConnection;

    beforeEach(async () => {
        conn = await db().connect();
    });

    afterEach(async () => {
        await conn.disconnect();
    });

    describe('Zipper', () => {
        it('Zip entries', async () => {
            const all = await resolveData('/uni/all.zip');
            expect(all).not.toBeNull();
            await db().addFileBuffer('/uni/all.zip', all!);

            const zip = new duckdb.ZipBindings(db());
            zip.loadFile('/uni/all.zip');

            const entryCount = zip.getEntryCount();
            expect(entryCount).toBe(7);

            const expectedFileNames = [
                'assistenten.parquet',
                'hoeren.parquet',
                'professoren.parquet',
                'pruefen.parquet',
                'studenten.parquet',
                'vorlesungen.parquet',
                'vorraussetzen.parquet',
            ];
            for (let i = 0; i < entryCount; ++i) {
                const entry = zip.getEntryInfo(i);
                expect(entry.fileName).toEqual(expectedFileNames[i]);
            }
        });
    });
}
