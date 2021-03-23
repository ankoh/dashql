import * as webdb from '../../src/targets/sync_browser';

var db: webdb.WebDB;
var conn: webdb.WebDBConnection;
const logger = new webdb.ConsoleLogger();

beforeAll(async () => {
    db = new webdb.WebDB(logger, webdb.DefaultWebDBRuntime, '/static/webdb.wasm');
    await db.open();
});

beforeEach(() => {
    conn = db.connect();
});

afterEach(() => {
    conn.disconnect();
});

describe('WebDBBindings', () => {
    describe('error handling', () => {
        it('INVALID SQL', async () => {
            let error: Error | null = null;
            try {
                conn.sendQuery('INVALID');
            } catch (e) {
                error = e;
            }
            expect(error).not.toBe(null);
        });
    });
});
