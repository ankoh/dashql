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
            await db().addFileBuffer('all.zip', all!);
            // XXX revisit with default duckdb runtime

            //const zip = new duckdb.ZipBindings(db());
            //const archive = zip.loadFile(`${basedir}/all.zip`);
            //expect(archive.getEntryCount()).toBe(7);
        });
    });
}
