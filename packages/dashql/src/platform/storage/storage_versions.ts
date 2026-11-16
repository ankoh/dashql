import * as core from '../../core/index.js';

/// The versions of the storage format come from the core module (`Runtime.storageVersions`), the one source of them:
/// `storageVersion` of the manifest and `formatVersion` of a workbook file.

/// The versions, once a core gave them
let versions: core.StorageVersions | null = null;

/// Read the versions from a core, e.g. the core of a runtime. A core may come from another copy of the package, e.g. the
/// one of the page that runs the browser tests.
export function provideStorageVersions(instance: core.DashQL): void {
    versions ??= instance.storageVersions();
}

/// The versions of the storage format. Needs a core: one that was provided, or the core of this copy of the package
/// once it is instantiated.
export function storageVersions(): core.StorageVersions {
    versions ??= core.DashQL.instantiated()?.storageVersions() ?? null;
    if (versions == null) throw new Error('The versions of the storage need the core, which is not instantiated yet');
    return versions;
}
