import { describe, expect, it } from 'vitest';

import { TestLogger } from '../testing/test_logger.js';
import { cloneWorkbook, copyWorkbook, verifyWorkbook } from './workbook_transfer.js';
import { WorkbookTestBackend, TEST_CONNECTION_ID, TEST_WORKBOOK_ID, testWorkbook } from '../testing/workbook_test_backend.js';

/// Write the test workbook with two scripts, returns the number of files it wrote
async function seed(backend: WorkbookTestBackend): Promise<number> {
    const scripts = [['01_a.sql', 'SELECT 1'], ['02_b.sql', 'SELECT 2']];
    await backend.saveWorkbookManifest(TEST_WORKBOOK_ID, testWorkbook());
    for (const [name, text] of scripts) await backend.saveScript(TEST_WORKBOOK_ID, name, text);
    return 1 + scripts.length;
}

describe('workbook transfer', () => {
    it('copies and clones binary data and detects byte corruption', async () => {
        const source = new WorkbookTestBackend();
        const target = new WorkbookTestBackend();
        const seeded = await seed(source);
        const bytes = new Uint8Array([0, 255, 128]);
        await source.saveDataFile(TEST_WORKBOOK_ID, 'payload.parquet', bytes);
        expect(await copyWorkbook(TEST_WORKBOOK_ID, source, target, new TestLogger())).toEqual({ workbookCount: 1, fileCount: seeded + 1 });
        expect(await verifyWorkbook(TEST_WORKBOOK_ID, source, target)).toBe(true);
        const cloneId = '99999999-8888-4777-8666-555555555555';
        await cloneWorkbook(TEST_WORKBOOK_ID, source, target, cloneId, new TestLogger());
        expect(await target.loadDataFile(cloneId, 'payload.parquet')).toEqual(bytes);
        await target.saveDataFile(TEST_WORKBOOK_ID, 'payload.parquet', new Uint8Array([0, 254, 128]));
        expect(await verifyWorkbook(TEST_WORKBOOK_ID, source, target)).toBe(false);
    });
    it('copies all flat durable files and verifies the result', async () => {
        const source = new WorkbookTestBackend();
        const target = new WorkbookTestBackend();
        const seeded = await seed(source);
        await expect(copyWorkbook(TEST_WORKBOOK_ID, source, target, new TestLogger()))
            .resolves.toEqual({ workbookCount: 1, fileCount: seeded });
        expect(await target.loadScripts(TEST_WORKBOOK_ID)).toEqual(await source.loadScripts(TEST_WORKBOOK_ID));
        expect(await verifyWorkbook(TEST_WORKBOOK_ID, source, target)).toBe(true);
    });

    it('clones under a new UUID sharing the connections and rolls back a failed clone', async () => {
        const source = new WorkbookTestBackend();
        await seed(source);
        await source.saveScript(TEST_WORKBOOK_ID, '03_attachment.sql', 'SELECT * FROM :payload');
        const target = new WorkbookTestBackend();
        const cloneId = '99999999-8888-4777-8666-555555555555';
        await cloneWorkbook(TEST_WORKBOOK_ID, source, target, cloneId, new TestLogger());
        const cloned = await target.loadWorkbook(cloneId);
        expect(cloned).toMatchObject({ workbookId: cloneId, name: `${testWorkbook().name} (copy)` });
        expect(cloned.connections.map(connection => connection.connectionId)).toEqual([TEST_CONNECTION_ID]);
        const scripts = await target.loadScripts(cloneId);
        expect(scripts).toHaveLength(3);
        expect(scripts.find(script => script.name === '03_attachment.sql')?.sql).toBe('SELECT * FROM :payload');

        const failing = new WorkbookTestBackend();
        failing.saveScript = async () => { throw new Error('write failed'); };
        await expect(cloneWorkbook(TEST_WORKBOOK_ID, source, failing, cloneId, new TestLogger()))
            .rejects.toThrow('write failed');
        expect(failing.workbooks.has(cloneId)).toBe(false);
    });
});
