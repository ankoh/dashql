import { describe, expect, it, vi } from 'vitest';

import { createTestRuntime } from './testing/test_runtime.js';
import { openTestHyperDB } from '../platform/testing/test_hyperdb.js';
import { tableFromArrays } from '../platform/testing/arrow_fixtures.js';
import { exportArrowTableAsParquet } from '../platform/hyperdb/hyperdb_parquet_export.js';
import { newDefaultHyperWasmConnection } from '../platform/connections/connection_params.js';

// A runtime without storage, e.g. of an embed in a frame without the origin private file system, opens a shared
// workbook into memory. The files of its attachments stay in memory with the workbook and the embedded Hyper mounts
// them at the paths of the folder of a stored workbook, so the scripts read them alike.

describe('a runtime without storage', () => {
    it('opens an archive with an attachment into memory, mounts it, renames it and lets it go with the workbook', async () => {
        const hyper = await openTestHyperDB('memory-workbooks');
        const parquet = await exportArrowTableAsParquet(hyper, tableFromArrays({ region: ['north', 'south'], amount: [1, 2] }));
        // A workbook with an attachment whose name a single file mount could not have, exported as an archive
        const source = await createTestRuntime({ computeDatabase: hyper, archiveDatabase: async () => hyper });
        const target = await createTestRuntime({ storage: null, computeDatabase: hyper, archiveDatabase: async () => hyper });
        try {
            const connection = source.createConnection(newDefaultHyperWasmConnection({ active: true }));
            const workbook = source.addWorkbook(connection.connectionId, [['totals.sql', 'select 1']]);
            const attached = await source.attachFiles(workbook.workbookId, [{ name: 'Sales 2024 – Q1.parquet', file: parquet }]);
            const fileName = attached.attached[0].fileName;
            const { archive } = await source.exportArchive(workbook.workbookId);

            const preview = await target.readImport({ archive });
            const outcome = await target.commitImport(preview.importId, {});
            expect(outcome.restored).toBe(true);
            const workbookId = outcome.workbookId;
            const columns = (name: string) => target.store.get('workbook', workbookId)?.attachments?.find(attachment => attachment.fileName === name)?.columns;
            // The runtime reads the columns of the attachment through the mount of the files in memory
            await vi.waitFor(() => expect(columns(fileName)).toEqual(['region', 'amount']));

            // A rename renames the file in memory, the mount follows it
            const renamed = await target.renameAttachment(workbookId, fileName, 'sales');
            expect(renamed).toBe('sales.parquet');
            await vi.waitFor(() => expect(columns('sales.parquet')).toEqual(['region', 'amount']));

            // The workbook keeps a handle of the file, it goes with the workbook
            const handles = target.handles.size;
            target.deleteWorkbook(workbookId);
            expect(target.handles.size).toBe(handles - 1);
            // The mounts change one at a time, this one waits until the runtime unmounted the files of the workbook
            await target.attachmentMounts.unmount(workbookId);
        } finally {
            await source.destroy();
            await target.destroy();
        }
    });
});
