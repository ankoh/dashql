import type * as core from '@ankoh/dashql-core';

import type { WorkbookData } from '@ankoh/dashql-runtime/storage/storage_backend';

// The sources and previews of imports in tests: a workbook folder in memory that the runtime reads like a native
// folder or a folder of the browser, and a preview as the runtime returns it for a workbook file.

/// A workbook folder in memory: the workbook file, its scripts, its attachments and the catalog files of its
/// connections by their paths (`connections/<id>/<file>`)
export function memoryImportFolder(
    workbook: WorkbookData,
    scripts: { name: string; sql: string }[],
    options: { attachments?: { name: string; file: Blob | Uint8Array }[]; files?: Record<string, string>; nativePath?: string } = {},
): core.RuntimeImportFolder {
    const texts = new Map<string, string>(Object.entries(options.files ?? {}));
    texts.set('dashql-workbook.json', JSON.stringify(workbook));
    return {
        readText: async path => texts.get(path) ?? null,
        scripts: async () => scripts,
        attachments: async () => options.attachments ?? [],
        nativePath: options.nativePath ?? null,
    };
}

/// The preview of a read import of a workbook file, nothing registered and no questions
export function testImportPreview(workbook: WorkbookData, overrides: Partial<core.ImportPreview> = {}): core.ImportPreview {
    return {
        importId: 1,
        workbook,
        scriptCount: workbook.scripts.length,
        attachmentCount: workbook.attachments.length,
        results: { count: 0, bytes: 0 },
        conflict: null,
        questions: [],
        invalidCatalogs: [],
        filesValid: true,
        nativePath: null,
        ...overrides,
    };
}
