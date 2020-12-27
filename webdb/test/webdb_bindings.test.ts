import * as webdb from '../src/index_node';
import * as path from 'path';

var db: webdb.WebDB;
var conn: webdb.WebDBConnection;

beforeAll(async () => {
    db = new webdb.WebDB(path.resolve(__dirname, "../src/webdb_wasm.wasm"));
    await db.open();
});

beforeEach(async () => {
    conn = await db.connect();
});

afterEach(async () => {
    await conn.disconnect();
});

describe('WebDBBindings', () => {
    describe('error handling', () => {
        test('INVALID SQL', async () => {
            let error: Error | null = null;
            try {
                await conn.sendQuery('INVALID');
            } catch (e) {
                error = e
            }
            expect(error).not.toBe(null);
        });
    });
});
