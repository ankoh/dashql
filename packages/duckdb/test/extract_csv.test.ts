import * as duckdb from '../src/';

const encoder = new TextEncoder();

export function testExtractCSV(db: () => duckdb.AsyncDuckDB, tmp_file: (buf: Uint8Array) => string) {
    //    describe('Extract CSV', () => {
    //        let conn: duckdb.AsyncDuckDBConnection;
    //
    //        beforeEach(async () => {
    //            conn = await db().connect();
    //        });
    //
    //        afterEach(async () => {
    //            await conn.disconnect();
    //        });
    //
    //        it('SimpleColumns', async () => {
    //            const file = tmp_file(encoder.encode('1,2,3\n4,5,4\n7,8,9'));
    //            await db().registerURL(file);
    //            await expectAsync(conn.importCSV(file, 'test_schema', 'test_table')).toBeResolvedTo(null);
    //        });
    //
    //        it('InvalidCSV', async () => {
    //            let test = async function (text: string) {
    //                const file = tmp_file(encoder.encode(text));
    //                await db().registerURL(file);
    //                await expectAsync(conn.importCSV(file, 'test_schema', 'test_table')).toBeRejected();
    //            };
    //
    //            // Column mismatch
    //            await test('1,2,3,X\n4,5,6\n7,8,9\n');
    //            await test('1,2,3\n4,5,6,X\n7,8,9\n');
    //            await test('1,2,3\n4,5,6\n7,8,9,X\n');
    //            await test('1,2\n4,5,6\n7,8,9\n');
    //            await test('1,2,3\n4,5\n7,8,9\n');
    //            await test('1,2,3\n4,5,6\n7,8\n');
    //
    //            // Unterminated quotes
    //            await test('"1,2,3\n4,5,6\n7,8,9\n');
    //            await test('1,2,"3\n4,5,6\n7,8,9\n');
    //            await test('1,2,3"\n4,5,6\n7,8,9\n');
    //            await test('1,2,3\n"4,5,6\n7,8,9\n');
    //            await test('1,2,3\n4",5,6\n7,8,9\n');
    //            await test('1,2,3\n4,5,6\n7,8,9\n"');
    //
    //            // Invalid Escapes
    //            await test('\\1,2,3\n4,5,6\n7,8,9\n');
    //            await test('1\\,2,3\n4,5,6\n7,8,9\n');
    //            await test('1,2,\\3\n4,5,6\n7,8,9\n');
    //            await test('1,2,3\\\n4,5,6\n7,8,9\n\\');
    //        });
    //    });
}
