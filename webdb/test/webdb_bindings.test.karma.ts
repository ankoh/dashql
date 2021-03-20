import * as webdb from '../src/index_web';

var db: webdb.WebDB;
var conn: webdb.WebDBConnection;
const logger = new webdb.ConsoleLogger();

beforeAll(async () => {
    db = new webdb.WebDB(logger, webdb.DefaultWebDBRuntime, "/base/dist/webdb.wasm");
    await db.open();
    console.log(db);
});

beforeEach(() => {
    conn = db.connect();
    console.log(conn);
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
