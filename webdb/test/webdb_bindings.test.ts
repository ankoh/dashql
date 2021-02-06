import { beforeAll, afterAll, beforeEach, afterEach, describe, test, expect } from '@jest/globals';
import * as webdb from '../src/index_node';
import * as path from 'path';

var db: webdb.WebDB;
var conn: webdb.WebDBConnection;
const logger = new webdb.ConsoleLogger();

beforeAll(async () => {
    db = new webdb.WebDB(logger, {}, path.resolve(__dirname, "../src/webdb_wasm.wasm"));
    await db.open();
});

beforeEach(() => {
    conn = db.connect();
});

afterEach (() => {
    conn.disconnect();
});

describe('WebDBBindings', () => {
    describe('error handling', () => {
        test('INVALID SQL', async () => {
            let error: Error | null = null;
            try {
                conn.sendQuery('INVALID');
            } catch (e) {
                error = e
            }
            expect(error).not.toBe(null);
        });
    });
});
