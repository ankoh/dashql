import * as webdb from '../src/';

const encoder = new TextEncoder();

export function testExtractCSV(db: () => webdb.AsyncWebDB, tmp_file: (buf: Uint8Array) => string) {
    describe('Extract CSV', () => {
        let conn: webdb.AsyncWebDBConnection;

        beforeEach(async () => {
            conn = await db().connect();
        });

        afterEach(async () => {
            await conn.disconnect();
        });

        it('SimpleColumns', async () => {
            let blobId = await db().registerURL(tmp_file(encoder.encode('1,2,3\n4,5,4\n7,8,9')));
            await expectAsync(conn.importCSV(blobId, 'test_schema', 'test_table')).toBeResolvedTo(null);
        });

        it('InvalidCSV', async () => {
            let test = async function (text: string, error: string) {
                let blobId = await db().registerURL(tmp_file(encoder.encode(text)));
                await expectAsync(conn.importCSV(blobId, 'test_schema', 'test_table')).toBeRejectedWithError(error);
            };

            // Column mismatch
            await test('1,2,3,X\n4,5,6\n7,8,9\n', 'Line 0: expected 3 values per row, but got more.');
            await test('1,2,3\n4,5,6,X\n7,8,9\n', 'Line 1: expected 3 values per row, but got more.');
            await test('1,2,3\n4,5,6\n7,8,9,X\n', 'Line 2: expected 3 values per row, but got more.');
            await test('1,2\n4,5,6\n7,8,9\n', 'Line 1: expected 3 values per row, but got 2.');
            await test('1,2,3\n4,5\n7,8,9\n', 'Line 2: expected 3 values per row, but got 2.');
            await test('1,2,3\n4,5,6\n7,8\n', 'Line 3: expected 3 values per row, but got 2.');

            // Unterminated quotes
            await test('"1,2,3\n4,5,6\n7,8,9\n', 'Line 0: unterminated quotes.');
            await test('1,2,"3\n4,5,6\n7,8,9\n', 'Line 0: unterminated quotes.');
            await test(
                '1,2,3"\n4,5,6\n7,8,9\n',
                "Conversion Error: Could not convert string '3\"' to INT32 in column 0 between line 0 and 3",
            );
            await test('1,2,3\n"4,5,6\n7,8,9\n', 'Line 1: unterminated quotes.');
            await test(
                '1,2,3\n4",5,6\n7,8,9\n',
                "Conversion Error: Could not convert string '4\"' to INT32 in column 0 between line 0 and 3",
            );
            await test('1,2,3\n4,5,6\n7,8,9\n"', 'Line 3: unterminated quotes.');

            // Invalid Escapes
            await test(
                '\\1,2,3\n4,5,6\n7,8,9\n',
                "Conversion Error: Could not convert string '\\1' to INT32 in column 0 between line 0 and 3",
            );
            await test(
                '1\\,2,3\n4,5,6\n7,8,9\n',
                "Conversion Error: Could not convert string '1\\' to INT32 in column 0 between line 0 and 3",
            );
            await test(
                '1,2,\\3\n4,5,6\n7,8,9\n',
                "Conversion Error: Could not convert string '\\3' to INT32 in column 0 between line 0 and 3",
            );
            await test('1,2,3\\\n4,5,6\n7,8,9\n\\', 'Line 4: expected 3 values per row, but got 1.');
        });
    });
}
