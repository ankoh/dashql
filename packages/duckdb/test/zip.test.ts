import * as duckdb from '../src/';
//import * as arrow from 'apache-arrow';

export function testZip(db: () => duckdb.DuckDBBindings, basedir: string) {
    let conn: duckdb.DuckDBConnection;

    beforeEach(async () => {
        conn = await db().connect();
    });

    afterEach(async () => {
        await conn.disconnect();
    });

    describe('Zipper', () => {
        it('Zip entries', async () => {
            await db().registerURL(`${basedir}/uni/out/all.zip`);
            // XXX revisit with default duckdb runtime

            //const zip = new duckdb.ZipBindings(db());
            //const archive = zip.loadFile(`${basedir}/all.zip`);
            //expect(archive.getEntryCount()).toBe(7);
        });
    });
}
