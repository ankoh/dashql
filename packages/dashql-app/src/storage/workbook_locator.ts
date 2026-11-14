import { StorageBackendType, STORAGE_WORKBOOKS_FOLDER, type WorkbookEntry } from '@ankoh/dashql-sdk/storage/storage_backend';

/// Where a single workbook's files live.
///
/// The workbook UUID is the authoritative identity; this describes the *physical* location of that
/// workbook's files. `nativePath` is the absolute directory that directly holds the workbook's files
/// (one directory == one workbook) and is only set when `type` is `Native`.
export interface WorkbookLocation {
    /// The storage backend that physically holds this workbook's files
    type: StorageBackendType;
    /// The absolute directory holding the workbook's files (only for native workbooks)
    nativePath?: string;
}

/// Derive a workbook's physical location from its manifest entry.
///
/// A `native` entry must carry a `nativePath`; anything else (including the common case of an entry
/// with no storageType field at all) is treated as living in the OPFS root.
export function locationFromEntry(entry: WorkbookEntry): WorkbookLocation {
    if (entry.storageType === StorageBackendType.Native && entry.nativePath) {
        return { type: StorageBackendType.Native, nativePath: entry.nativePath };
    }
    return { type: StorageBackendType.OPFS };
}

/// Build the display path for a workbook.
///
/// This value is purely for display (the workbook bar, the storage overlay). Nothing parses it for
/// identity or routing — the UUID + `WorkbookLocation` are the source of truth.
export function displayPath(uuid: string, loc: WorkbookLocation): string {
    if (loc.type === StorageBackendType.Native && loc.nativePath) {
        return `fs://${loc.nativePath}`;
    }
    return `opfs://${STORAGE_WORKBOOKS_FOLDER}/${uuid}`;
}
