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
        it('Entry Info', async () => {
            const all = await resolveData('/uni/all.zip');
            expect(all).not.toBeNull();
            await db().addFileBuffer('/uni/all.zip', all!);

            const zip = new duckdb.ZipBindings(db());
            zip.loadFile('/uni/all.zip');

            const entryCount = zip.readEntryCount();
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
                const entry = zip.readEntryInfo(i);
                expect(entry.fileName).toEqual(expectedFileNames[i]);
            }
        });

        it('Extraction', async () => {
            const all = await resolveData('/uni/all.zip')!;
            const assistenten = await resolveData('/uni/assistenten.parquet')!;
            expect(all).not.toBeNull();
            await db().addFileBuffer('/uni/all.zip', all!);
            const outID = await db().addFileBuffer('/out/assistenten.parquet', new Uint8Array());

            const zip = new duckdb.ZipBindings(db());
            zip.loadFile('/uni/all.zip');

            const entryCount = zip.readEntryCount();
            expect(entryCount).toBe(7);
            const entry = zip.readEntryInfo(0);
            expect(entry.fileName).toEqual('assistenten.parquet');

            const written = zip.extractEntryToFile(0, '/out/assistenten.parquet');
            expect(written).toEqual(assistenten!.length);

            const assistentenWritten = db().getFileBuffer(outID);
            expect(assistenten).toEqual(assistentenWritten);
        });
    });
}
