import { StorageBackendType, STORAGE_NOTEBOOKS_FOLDER, type NotebookEntry } from './storage_backend.js';

/// Where a single notebook's files live.
///
/// The notebook UUID is the authoritative identity; this describes the *physical* location of that
/// notebook's files. `nativePath` is the absolute directory that directly holds the notebook's files
/// (one directory == one notebook) and is only set when `type` is `Native`.
export interface NotebookLocation {
    /// The storage backend that physically holds this notebook's files
    type: StorageBackendType;
    /// The absolute directory holding the notebook's files (only for native notebooks)
    nativePath?: string;
}

/// Derive a notebook's physical location from its manifest entry.
///
/// A `native` entry must carry a `nativePath`; anything else (including the common case of an entry
/// with no storageType field at all) is treated as living in the OPFS root.
export function locationFromEntry(entry: NotebookEntry): NotebookLocation {
    if (entry.storageType === StorageBackendType.Native && entry.nativePath) {
        return { type: StorageBackendType.Native, nativePath: entry.nativePath };
    }
    return { type: StorageBackendType.OPFS };
}

/// Build the display path for a notebook.
///
/// This value is purely for display (the notebook bar, the storage overlay). Nothing parses it for
/// identity or routing — the UUID + `NotebookLocation` are the source of truth.
export function displayPath(uuid: string, loc: NotebookLocation): string {
    if (loc.type === StorageBackendType.Native && loc.nativePath) {
        return `fs://${loc.nativePath}`;
    }
    return `opfs://${STORAGE_NOTEBOOKS_FOLDER}/${uuid}`;
}
