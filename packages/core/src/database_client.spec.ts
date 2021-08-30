import * as duckdb from '@dashql/duckdb/dist/duckdb.module.js';
import * as arrow from 'apache-arrow';
import * as test from './test';
import * as tmp from 'tmp';
import * as fs from 'fs';

describe('DuckDB', () => {
    let db: duckdb.AsyncDuckDB | null = null;
    let conn: duckdb.AsyncConnection | null = null;

    beforeAll(async () => {
        db = await test.initDuckDB();
    });
    beforeEach(async () => {
        conn = await db.connect();
    });
    afterAll(async () => {
        await db.terminate();
    });
    afterEach(async () => {
        await conn.close();
    });

    it('hello world', async () => {
        const table = await conn.runQuery<{ hello_world: arrow.Int32 }>('SELECT 1::INTEGER as hello_world');
        expect(table.numCols).toBe(1);
        expect(table.getColumnAt(0).length).toBe(1);
        const rows = table.toArray();
        expect(rows[0].hello_world).toBe(1);
    });

    it('scan file', async () => {
        const [tmpName, dropTmp] = await new Promise((resolve, reject) => {
            tmp.file((err, name, _fd, removeCallback) => {
                if (err) reject(err);
                resolve([name, removeCallback]);
            });
        });

        // Write the temporary file
        const text = 'a,b\n1,2\n3,4\n5,6\n';
        if (fs.existsSync(tmpName)) {
            fs.truncateSync(tmpName);
        }
        fs.writeFileSync(tmpName, text, {
            encoding: 'utf8',
        });
        const read = await fs.promises.readFile(tmpName, 'utf8');
        expect(read).toEqual(text);

        // Scan the temporary file
        await db.registerFileURL('foo.csv', tmpName);
        const result = await conn.runQuery<{ a: arrow.Int32; b: arrow.Int32 }>(
            `SELECT * FROM read_csv_auto('foo.csv') LIMIT 10`,
        );
        expect(result.numCols).toEqual(2);

        // Drop the temporary file
        dropTmp();
    });
});
