import * as arrow from 'apache-arrow';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { setOPFSRootProvider } from '../platform/opfs_root.js';
import { openNodeComputeDatabase } from './node_hyperdb.js';

/// The instance folders of a root, without the files of their locks
const instanceFolders = (root: string) => readdirSync(path.join(root, 'instances'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);

function tempRoot(): string {
    return mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-root-'));
}

// Every test starts an engine of its own, which compiles hyperdb-wasm: a few seconds, more while other tests run
describe('the embedded Hyper of Node', { timeout: 30_000 }, () => {
    afterEach(() => setOPFSRootProvider(null));

    it('writes and reads the query result cache in the folder of the root', async () => {
        const root = tempRoot();
        const hyper = await openNodeComputeDatabase(root);
        try {
            // The instance has a folder of its own, like a window of the app
            expect(instanceFolders(root)).toHaveLength(1);

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

    it('removes the instance folders of processes that are gone and keeps those of living ones', async () => {
        const root = tempRoot();
        const gone = spawnSync(process.execPath, ['-e', '']).pid!;
        const stale = '6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f';
        const living = '7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d';
        for (const [id, pid] of [[stale, gone], [living, process.pid]] as const) {
            mkdirSync(path.join(root, 'instances', id, 'logs'), { recursive: true });
            writeFileSync(path.join(root, 'instances', `dashql-instance-${id}.pid`), String(pid));
        }
        const hyper = await openNodeComputeDatabase(root);
        try {
            expect(instanceFolders(root)).not.toContain(stale);
            expect(instanceFolders(root)).toContain(living);
            expect(instanceFolders(root)).toHaveLength(2);
        } finally {
            await hyper.close();
        }
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
