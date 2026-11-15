import * as core from '@ankoh/dashql-core';

import { TestLogger } from '../testing/test_logger.js';
import { testCore } from '../testing/test_runtime.js';
import { TEST_WORKBOOK_ID, WorkbookTestBackend } from '../testing/workbook_test_backend.js';
import { groupScriptWrites, StorageWriter, WRITE_SCRIPT } from './storage_writer.js';

// A test file of Node gets modules of its own, the core is not instantiated before this test asks for it. The browsers
// run the test files of a page with the same modules.
describe('storage writer before the core', () => {
    it('lets the calls wait for the core and runs them in order once it is there', async () => {
        expect(core.DashQL.instantiated()).toBeNull();
        const backend = new WorkbookTestBackend();
        let deliver: ((instance: core.DashQL) => void) | null = null;
        const writer = new StorageWriter(new TestLogger(), backend, () => new Promise(resolve => { deliver = resolve; }));
        const key = groupScriptWrites(TEST_WORKBOOK_ID, 'a.sql');
        // Pausing and flushing don't ask for a core, nothing was written yet
        writer.pause();
        await writer.flush();
        expect(deliver).toBeNull();
        const write = writer.write(key, { type: WRITE_SCRIPT, value: [TEST_WORKBOOK_ID, 'a.sql', 'select 1'] }, 0);
        // The queries see none of the calls that wait for the core
        expect(writer.getPendingKeysForWorkbook(TEST_WORKBOOK_ID)).toEqual([]);
        expect(writer.isWorkbookPaused(TEST_WORKBOOK_ID)).toBe(false);
        expect(deliver).not.toBeNull();
        deliver!(await testCore());
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(writer.isWorkbookPaused(TEST_WORKBOOK_ID)).toBe(true);
        expect(writer.getPendingKeysForWorkbook(TEST_WORKBOOK_ID)).toEqual([key]);
        writer.resume();
        await expect(write).resolves.toBe(true);
        expect(backend.calls).toEqual([`write:${TEST_WORKBOOK_ID}/a.sql=select 1`]);

        // A writer that is created once the core is instantiated takes it right away
        const next = new StorageWriter(new TestLogger(), backend);
        void next.write(key, { type: WRITE_SCRIPT, value: [TEST_WORKBOOK_ID, 'a.sql', 'select 2'] }, 1000);
        expect(next.getPendingKeysForWorkbook(TEST_WORKBOOK_ID)).toEqual([key]);
        next.cancelPendingWritesForWorkbook(TEST_WORKBOOK_ID);
    });
});
