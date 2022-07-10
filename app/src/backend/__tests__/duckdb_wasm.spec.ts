import { DUCKDB_WASM } from '../../testenv';

import * as duckdb from '@duckdb/duckdb-wasm';
import { Int32 } from 'apache-arrow/type';
import * as tmp from 'tmp';
import * as fs from 'fs';

describe('DuckDB Wasm', () => {
    let conn: duckdb.AsyncDuckDBConnection | null = null;

    beforeEach(async () => {
        conn = await DUCKDB_WASM.connect();
    });
    afterEach(async () => {
        await conn.close();
    });

    it('hello world', async () => {
        const table = await conn.query<{ hello_world: Int32 }>('SELECT 1::INTEGER as hello_world');
        expect(table.numCols).toBe(1);
        expect(table.getChildAt(0).length).toBe(1);
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
        await DUCKDB_WASM.registerFileURL('foo.csv', tmpName);
        const result = await conn.query<{ a: Int32; b: Int32 }>(`SELECT * FROM read_csv_auto('foo.csv') LIMIT 10`);
        expect(result.numCols).toEqual(2);

        // Drop the temporary file
        dropTmp();
    });
});
