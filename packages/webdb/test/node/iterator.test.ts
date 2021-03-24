import * as webdb from '../../src/platform/node/index_serial';
import path from 'path';

var db: webdb.WebDB;
var conn: webdb.WebDBConnection;
const testRows = 3000;
const logger = new webdb.ConsoleLogger();

beforeAll(async () => {
    const wasm = path.resolve(__dirname, './webdb.wasm');
    db = new webdb.WebDB(logger, webdb.DefaultWebDBRuntime, wasm);
    await db.open();
});

beforeEach(() => {
    conn = db.connect();
});

afterEach(() => {
    conn.disconnect();
});

describe('QueryResultChunkStream', () => {
    describe('single column', () => {
        it('TINYINT', () => {
            let result = conn.sendQuery(`
                SELECT (v & 127)::TINYINT FROM generate_series(0, ${testRows}) as t(v);
            `);
            expect(result.columnTypesLength()).toBe(1);
            let chunks = new webdb.ChunkStreamIterator(conn, result);
            let i = 0;
            while (chunks.nextBlocking()) {
                for (const v of chunks.iterateNumberColumn(0)) {
                    expect(v).toBe(i++ & 127);
                }
            }
            expect(i).toBe(testRows + 1);
        });
    });
});
