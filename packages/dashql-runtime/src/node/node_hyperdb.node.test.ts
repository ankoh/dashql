import * as arrow from 'apache-arrow';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { setOPFSRootProvider } from '../platform/opfs_root.js';
import { openNodeComputeDatabase } from './node_hyperdb.js';

function tempRoot(): string {
    return mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-root-'));
}

describe('the embedded Hyper of Node', () => {
    afterEach(() => setOPFSRootProvider(null));

    it('writes and reads the query result cache in the folder of the root', async () => {
        const root = tempRoot();
        const hyper = await openNodeComputeDatabase(root);
        try {
            // The instance has a folder of its own, like a window of the app
            expect(readdirSync(path.join(root, 'instances'))).toHaveLength(1);

            const table = arrow.tableFromArrays({ id: Int32Array.from([1, 2, 3]), name: ['a', 'b', 'c'] });
            const key = 'a'.repeat(64);
            const name = hyper.resultCache.newFileName(key);
            await hyper.resultCache.writeTable(hyper.database, table, name);
            expect(readdirSync(path.join(root, 'cache')).filter(file => file.endsWith('.parquet'))).toEqual([name]);

            const entry = await hyper.resultCache.lookup(key);
            expect(entry?.name).toBe(name);
            const read = await hyper.resultCache.readTable(hyper.database, name);
            expect(read.numRows).toBe(3);
            expect(read.getChild('name')?.toArray()).toEqual(['a', 'b', 'c']);

            // A newer file of the key replaces the older one
            const newer = hyper.resultCache.newFileName(key);
            await hyper.resultCache.writeTable(hyper.database, table, newer);
            expect(readdirSync(path.join(root, 'cache')).filter(file => file.endsWith('.parquet'))).toEqual([newer]);
        } finally {
            await hyper.close();
        }
        // The cache stays, the instance goes
        expect(readdirSync(path.join(root, 'instances'))).toEqual([]);
        expect(existsSync(path.join(root, 'cache'))).toBe(true);
    });

    it('runs a statement on the compute database', async () => {
        const hyper = await openNodeComputeDatabase(tempRoot());
        try {
            const connection = await hyper.database.connect();
            try {
                const result = await connection.query('select 40 + 2 as answer');
                expect(Number(result.getChild('answer')?.get(0))).toBe(42);
            } finally {
                await connection.close();
            }
        } finally {
            await hyper.close();
        }
    });
});
