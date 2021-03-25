import { WebBlobStream } from 'src/bindings/runtime_browser';
import * as webdb from '../../src/';

let worker: Worker;
let db: webdb.parallel.AsyncWebDB;
var conn: webdb.parallel.AsyncWebDBConnection;
const logger = new webdb.ConsoleLogger();
const encoder = new TextEncoder();

beforeAll(async () => {
    worker = new Worker('/static/webdb-browser-parallel.worker.js');
    db = new webdb.parallel.AsyncWebDB(logger, worker);
    await db.open('/static/webdb.wasm');
});

afterAll(async () => {
    await db.terminate();
});
beforeEach(async () => {
    conn = await db.connect();
});

afterEach(async () => {
    await conn.disconnect();
});

describe('Extract CSV', () => {
    it('SimpleColumns', async () => {
        let url = URL.createObjectURL(new Blob([encoder.encode('1,2,3\n4,5,4\n7,8,9').buffer], { type: 'text/plain' }));
        let blobId = await db.registerURL(url);
        await expectAsync(conn.importCSV(blobId, 'test_schema', 'test_table')).toBeResolvedTo(null);
        URL.revokeObjectURL(url);
    });

    it('InvalidCSV', async () => {
        let test = async function (text: string, error: string) {
            let url = URL.createObjectURL(new Blob([encoder.encode(text).buffer], { type: 'text/plain' }));
            let blobId = await db.registerURL(url);
            await expectAsync(conn.importCSV(blobId, 'test_schema', 'test_table')).toBeRejectedWithError(error);
            URL.revokeObjectURL(url);
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
