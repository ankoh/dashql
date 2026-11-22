import type * as arrow from 'apache-arrow';
import { vi } from 'vitest';

import type { WorkbookResultFiles } from '../workbook/workbook_result_files.js';

/// A file of the results of a workbook in memory
interface MemoryResultFile {
    /// The time of the write
    mtimeMs: number;
    /// The table that a run wrote, null for the bytes of an import
    table: arrow.Table | null;
    /// The bytes of the file, those of an imported file or the ones a test gives
    bytes?: Uint8Array;
}

/// The results of the workbooks of the tests in memory. Writes and reads don't touch the database, the names are the
/// ones the runtime gives.
export function memoryWorkbookResultFiles() {
    const workbooks = new Map<string, Map<string, MemoryResultFile>>();
    let clock = 0;
    const folder = (workbookId: string) => {
        let files = workbooks.get(workbookId);
        if (files == null) {
            files = new Map();
            workbooks.set(workbookId, files);
        }
        return files;
    };
    const results = {
        workbooks,
        /// Add a file of the results of a workbook
        put: (workbookId: string, name: string, table: arrow.Table | null = null, bytes?: Uint8Array) => {
            folder(workbookId).set(name, { mtimeMs: ++clock, table, bytes });
            return name;
        },
        /// The names of the files of a workbook
        names: (workbookId: string) => [...folder(workbookId).keys()].sort(),
        mount: vi.fn(async (_database: unknown, _workbookId: string) => {}),
        unmount: vi.fn(async (_workbookId: string) => {}),
        files: vi.fn(async (workbookId: string) => [...folder(workbookId)].map(([name, file]) => ({
            name, size: file.bytes?.length ?? 1, mtimeMs: file.mtimeMs,
        }))),
        pin: vi.fn(async (_workbookId: string, _name: string) => async () => {}),
        writeTable: vi.fn(async (_database: unknown, workbookId: string, table: arrow.Table, name: string) => {
            folder(workbookId).set(name, { mtimeMs: ++clock, table });
            return table.numRows;
        }),
        readTable: vi.fn(async (_database: unknown, workbookId: string, name: string) => folder(workbookId).get(name)?.table ?? null),
        readFile: vi.fn(async (workbookId: string, name: string) => {
            const file = folder(workbookId).get(name);
            if (file == null) throw new Error(`The workbook has no result ${name}`);
            return new Blob([(file.bytes ?? new Uint8Array()) as Uint8Array<ArrayBuffer>]);
        }),
        importFile: vi.fn(async (workbookId: string, name: string, data: Blob, _options?: { crc32?: number }) => {
            folder(workbookId).set(name, { mtimeMs: ++clock, table: null, bytes: new Uint8Array(await data.arrayBuffer()) });
        }),
        move: vi.fn(async (workbookId: string, from: string, to: string) => {
            const files = folder(workbookId);
            const file = files.get(from);
            if (file != null) {
                files.delete(from);
                files.set(to, file);
            }
            return true;
        }),
        remove: vi.fn(async (workbookId: string, name: string) => {
            folder(workbookId).delete(name);
            return true;
        }),
    } satisfies WorkbookResultFiles & Record<string, unknown>;
    return results;
}
