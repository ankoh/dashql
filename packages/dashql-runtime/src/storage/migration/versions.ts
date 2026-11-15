/// The version of the storage of the app (the OPFS root), stored as `storageVersion` in the manifest.
/// A manifest without a version is at version 1. `STORAGE_MIGRATION_STEPS` ends with this version.
export const STORAGE_VERSION = 9;

/// The format version of the workbook metadata, stored as `formatVersion` in `dashql-workbook.json`.
/// The migrations of the core (`workbook_format::migration`) end with this version, a test checks that they agree.
export const WORKBOOK_FORMAT_VERSION = 11;
