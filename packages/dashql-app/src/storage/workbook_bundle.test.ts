import * as dashql from '@ankoh/dashql-core';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { bundleCatalogPath, filterInvalidWorkbookCatalogs, reconcileStoredWorkbookFiles, renameBundleCatalogs, type WorkbookBundle, type WorkbookBundleCatalog } from '@ankoh/dashql-runtime/storage/workbook_bundle';
import { WorkbookTestBackend, TEST_CONNECTION_ID, TEST_WORKBOOK_ID, testWorkbook } from '@ankoh/dashql-runtime/testing/workbook_test_backend';
import type { WorkbookData } from '@ankoh/dashql-runtime/storage/storage_backend';

declare const DASHQL_PRECOMPILED: Promise<Uint8Array>;

let dql: dashql.DashQL;
beforeAll(async () => {
    dql = await dashql.DashQL.create({ wasmBinary: await DASHQL_PRECOMPILED });
});
afterEach(() => {
    dql.resetUnsafe();
});

const bundleOf = (...catalogs: WorkbookBundleCatalog[]): WorkbookBundle => ({ workbook: {} as WorkbookData, catalogs, scripts: [] });

describe('filterInvalidWorkbookCatalogs', () => {
    it('keeps a bundle with catalogs that parse', () => {
        const bundle = bundleOf({ connectionId: 'c1', relations: 'create table t (a int);', functions: null });
        expect(filterInvalidWorkbookCatalogs(dql, bundle)).toEqual({ bundle, invalidFiles: [] });
        expect(filterInvalidWorkbookCatalogs(dql, bundle).bundle).toBe(bundle);
    });

    it('drops the catalog files that do not parse', () => {
        const bundle = bundleOf(
            { connectionId: 'c1', relations: 'create table t (a int);', functions: 'create function (' },
            { connectionId: 'c2', relations: 'create tabel t;', functions: null },
        );
        const { bundle: filtered, invalidFiles } = filterInvalidWorkbookCatalogs(dql, bundle);
        expect(filtered.catalogs).toEqual([
            { connectionId: 'c1', relations: 'create table t (a int);', functions: null },
            { connectionId: 'c2', relations: null, functions: null },
        ]);
        expect(invalidFiles).toHaveLength(2);
        expect(invalidFiles[0].startsWith(bundleCatalogPath('c1', ''))).toBe(true);
        expect(invalidFiles[1].startsWith(bundleCatalogPath('c2', ''))).toBe(true);
    });
});

describe('renameBundleCatalogs', () => {
    it('renames the connections and keeps the first catalog of merged connections', () => {
        const catalog = (connectionId: string, relations: string) => ({ connectionId, relations, functions: null });
        expect(renameBundleCatalogs([catalog('a', 'A'), catalog('b', 'B'), catalog('c', 'C')], new Map([['a', 'x'], ['b', 'x']]))).toEqual([
            catalog('x', 'A'),
            catalog('c', 'C'),
        ]);
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

