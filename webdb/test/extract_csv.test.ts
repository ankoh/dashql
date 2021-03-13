import { beforeAll, afterAll, beforeEach, afterEach, describe, test, expect } from '@jest/globals';
import Worker from 'web-worker';
import * as webdb from '../src/index_async';
import * as path from 'path';
import { NodeBlobStream } from '../src/webdb_bindings_node';
import { TextEncoder } from 'util';

let worker: Worker;
let db: webdb.AsyncWebDB;
var conn: webdb.AsyncWebDBConnection;
const logger = new webdb.ConsoleLogger();
const encoder = new TextEncoder();
const testRows = 3000;

beforeAll(async () => {
    worker = new Worker(path.resolve(__dirname, '../dist/webdb_node_async.worker.js'));
    db = new webdb.AsyncWebDB(logger, worker);
    await db.open(path.resolve(__dirname, '../src/webdb_wasm.wasm'));
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
    test('SimpleColumns', async () => {
        await conn.importCSV(
            new NodeBlobStream(
                encoder.encode(`1,2,3
4,5,4
7,8,9`),
            ),
            'test_schema',
            'test_table',
        );
    });

    test('InvalidCSV', async () => {
        let test = async function (text: string, error: string) {
            expect(
                conn.importCSV(new NodeBlobStream(encoder.encode(text)), 'test_schema', 'test_table'),
            ).rejects.toThrow(error);
        };

        // Column mismatch
        test('1,2,3,X\n4,5,6\n7,8,9\n', 'Line 0: expected 3 values per row, but got more.');
        test('1,2,3\n4,5,6,X\n7,8,9\n', 'Line 1: expected 3 values per row, but got more.');
        test('1,2,3\n4,5,6\n7,8,9,X\n', 'Line 2: expected 3 values per row, but got more.');
        test('1,2\n4,5,6\n7,8,9\n', 'Line 1: expected 3 values per row, but got 2.');
        test('1,2,3\n4,5\n7,8,9\n', 'Line 2: expected 3 values per row, but got 2.');
        test('1,2,3\n4,5,6\n7,8\n', 'Line 3: expected 3 values per row, but got 2.');

        // Unterminated quotes
        test('"1,2,3\n4,5,6\n7,8,9\n', 'Line 0: unterminated quotes.');
        test('1,2,"3\n4,5,6\n7,8,9\n', 'Line 0: unterminated quotes.');
        test(
            '1,2,3"\n4,5,6\n7,8,9\n',
            "Conversion Error: Could not convert string '3\"' to INT32 in column 0 between line 0 and 3",
        );
        test('1,2,3\n"4,5,6\n7,8,9\n', 'Line 1: unterminated quotes.');
        test(
            '1,2,3\n4",5,6\n7,8,9\n',
            "Conversion Error: Could not convert string '4\"' to INT32 in column 0 between line 0 and 3",
        );
        test('1,2,3\n4,5,6\n7,8,9\n"', 'Line 3: unterminated quotes.');

        // Invalid Escapes
        test(
            '\\1,2,3\n4,5,6\n7,8,9\n',
            "Conversion Error: Could not convert string '\\1' to INT32 in column 0 between line 0 and 3",
        );
        test(
            '1\\,2,3\n4,5,6\n7,8,9\n',
            "Conversion Error: Could not convert string '1\\' to INT32 in column 0 between line 0 and 3",
        );
        test(
            '1,2,\\3\n4,5,6\n7,8,9\n',
            "Conversion Error: Could not convert string '\\3' to INT32 in column 0 between line 0 and 3",
        );
        test('1,2,3\\\n4,5,6\n7,8,9\n\\', 'Line 4: expected 3 values per row, but got 1.');
    });
});
