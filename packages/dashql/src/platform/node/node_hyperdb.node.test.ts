import * as arrow from 'apache-arrow';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { copyArrowTableAsParquet } from '../hyperdb/hyperdb_parquet_export.js';
import { setOPFSRootProvider } from '../opfs_root.js';
import { RESULT_ROW_COLUMN, resultsMountPath } from '../workbook/workbook_result_files.js';
import { openNodeComputeDatabase } from './node_hyperdb.js';

/// The instance folders of a root, without the files of their locks
const instanceFolders = (root: string) => readdirSync(path.join(root, 'instances'), { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name);

function tempRoot(): string {
    return mkdtempSync(path.join(process.env.TEST_TMPDIR ?? tmpdir(), 'dashql-root-'));
}

// Every test starts an engine of its own, which compiles hyperdb-wasm: a few seconds, more while other tests run
describe('the embedded Hyper of Node', { timeout: 30_000 }, () => {
    afterEach(() => setOPFSRootProvider(null));

    it('writes and reads the results of a workbook in the folder of the root', async () => {
        const root = tempRoot();
        const hyper = await openNodeComputeDatabase(root);
        const workbookId = '00000000-0000-4000-8000-000000000001';
        const folder = path.join(root, 'workbooks', workbookId, 'results');
        try {
            // The instance has a folder of its own, like a window of the app
            expect(instanceFolders(root)).toHaveLength(1);

            const table = arrow.tableFromArrays({ id: Int32Array.from([1, 2, 3]), name: ['a', 'b', 'c'] });
            const name = `a.${'a'.repeat(64)}.00000001.parquet`;
            expect(await hyper.results.writeTable(hyper.database, workbookId, table, name)).toBe(3);
            expect(readdirSync(folder)).toEqual([name]);
            expect((await hyper.results.files(workbookId)).map(file => file.name)).toEqual([name]);
            const read = await hyper.results.readTable(hyper.database, workbookId, name);
            expect(read?.numRows).toBe(3);
            expect(read?.getChild('name')?.toArray()).toEqual(['a', 'b', 'c']);
            // A file that is gone reads as none
            expect(await hyper.results.remove(workbookId, name)).toBe(true);
            expect(await hyper.results.readTable(hyper.database, workbookId, name)).toBeNull();
        } finally {
            await hyper.close();
        }
        // The results stay with the workbook, the instance goes
        expect(readdirSync(path.join(root, 'instances'))).toEqual([]);
        expect(existsSync(folder)).toBe(true);
    });

    it('reads the rows of a result in the order they were written, also those of a file of an earlier version', { timeout: 120_000 }, async () => {
        const root = tempRoot();
        const hyper = await openNodeComputeDatabase(root);
        const workbookId = '00000000-0000-4000-8000-000000000002';
        try {
            // Hyper scans a table or a file of millions of rows in parallel, in no particular order; at 10 000 rows a
            // scan still comes in order. Without the ORDER BY of the read this table comes back out of order from the
            // first row on.
            const rows = 3_000_000;
            const descending = Int32Array.from({ length: rows }, (_, i) => rows - i);
            const table = arrow.tableFromArrays({ value: descending });
            const name = `a.${'a'.repeat(64)}.00000001.parquet`;
            expect(await hyper.results.writeTable(hyper.database, workbookId, table, name)).toBe(rows);
            // The file has the order of its rows in a column, a read leaves it out
            const connection = await hyper.database.connect();
            try {
                const file = await connection.query(`SELECT * FROM external('${resultsMountPath(workbookId)}/${name}', format => 'parquet') LIMIT 0`);
                expect(file.schema.fields.map(field => field.name)).toEqual(['value', RESULT_ROW_COLUMN]);
            } finally {
                await connection.close();
            }
            const read = await hyper.results.readTable(hyper.database, workbookId, name);
            expect(read?.schema.fields.map(field => field.name)).toEqual(['value']);
            const values = read!.getChild('value')!.toArray() as Int32Array;
            expect(values.length).toBe(rows);
            expect(values.findIndex((value, i) => value !== rows - i)).toBe(-1);

            // A file of an earlier version, written without the column, reads with all its columns in the order Hyper
            // scans it
            const old = `b.${'b'.repeat(64)}.00000002.parquet`;
            await copyArrowTableAsParquet(hyper.database, arrow.tableFromArrays({ id: Int32Array.from([1, 2, 3]) }), `${resultsMountPath(workbookId)}/${old}`);
            const oldRead = await hyper.results.readTable(hyper.database, workbookId, old);
            expect(oldRead?.schema.fields.map(field => field.name)).toEqual(['id']);
            expect([...(oldRead!.getChild('id')!.toArray() as Int32Array)].sort()).toEqual([1, 2, 3]);
        } finally {
            await hyper.close();
        }
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
