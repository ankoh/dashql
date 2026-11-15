import * as dashql from '@ankoh/dashql-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { readWorkbookBundleHead, reconcileStoredWorkbookFiles } from './workbook_bundle.js';
import { MemoryFolder } from './migration/migration_folder.js';
import { WorkbookTestBackend, TEST_CONNECTION_ID, TEST_WORKBOOK_ID, testWorkbook } from '../testing/workbook_test_backend.js';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => {
    dql.resetUnsafe();
});

// The decisions of bundles are tested in the core (`workbook_format::bundle`), these tests drive them over folders and
// backends
describe('readWorkbookBundleHead', () => {
    it('migrates the top-level files in memory and reads the catalogs of the connections of the migrated workbook', async () => {
        const session = {
            formatVersion: 10, sessionId: TEST_WORKBOOK_ID, name: 'n', metadata: {},
            connections: [{ connectionId: TEST_CONNECTION_ID, params: { hyper: {} } }], scripts: [], attachments: [],
        };
        const relations = `connections/${TEST_CONNECTION_ID}/dashql-catalog-relations.sql`;
        const folder = new MemoryFolder([['dashql-session.json', JSON.stringify(session)], [relations, 'create table t (a int);']]);
        const head = await readWorkbookBundleHead(folder, 'Invalid folder');
        expect(head.workbook.workbookId).toBe(TEST_WORKBOOK_ID);
        expect(head.catalogs).toEqual([{ connectionId: TEST_CONNECTION_ID, relations: 'create table t (a int);', functions: null }]);
        expect(head.filesValid).toBe(true);
        // The folder is only read
        expect([...folder.files.keys()]).toEqual(['dashql-session.json', relations]);
        await expect(readWorkbookBundleHead(new MemoryFolder(), 'Invalid folder')).rejects.toThrow('Invalid folder: missing dashql-workbook.json');
    });
});

describe('reconcileStoredWorkbookFiles', () => {
    it('lists the stored scripts and attachments and writes the workbook file only when they changed', async () => {
        const backend = new WorkbookTestBackend();
        backend.workbooks.set(TEST_WORKBOOK_ID, testWorkbook());
        await backend.saveScript(TEST_WORKBOOK_ID, 'a.sql', 'select 1');
        await backend.saveDataFile(TEST_WORKBOOK_ID, 'd.parquet', new Uint8Array([1]));

        const workbook = await reconcileStoredWorkbookFiles(backend, TEST_WORKBOOK_ID);
        expect(workbook.scripts.map(script => [script.name, script.connectionId])).toEqual([['a.sql', TEST_CONNECTION_ID]]);
        expect(workbook.attachments).toEqual([{ name: 'd.parquet' }]);
        expect(backend.workbooks.get(TEST_WORKBOOK_ID)).toEqual(workbook);

        const writes = backend.calls.filter(call => call.startsWith('manifest:')).length;
        await reconcileStoredWorkbookFiles(backend, TEST_WORKBOOK_ID);
        expect(backend.calls.filter(call => call.startsWith('manifest:')).length).toBe(writes);
    });
});

