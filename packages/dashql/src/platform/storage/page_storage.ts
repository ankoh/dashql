import type * as core from '../../core/index.js';
import { stringifyError, type Logger } from '../logger/logger.js';
import { requestPersistentStorage } from '../opfs_root.js';
import { CompositeStorageBackend } from './composite_storage_backend.js';
import { OPFSStorageBackend } from './opfs_storage_backend.js';

/// Open the storage of a page: the workbooks and connections in the origin private file system, and the native
/// workbook folders of the desktop app (docs/design/storage_layout.md). The storage must be migrated before
/// (`migrateStorage` of `storage_migration.ts`), and only one tab of an origin may write it at a time.
export async function openPageStorage(instance: core.DashQL, logger: Logger): Promise<CompositeStorageBackend> {
    void requestPersistentStorage().then(persisted => {
        logger.info('Requested persistent storage', { persisted: String(persisted) }, 'storage');
    }, error => {
        logger.warn('Failed to request persistent storage', { error: stringifyError(error) }, 'storage');
    });
    // The backends ask the core about the names of attachments and folders and the changes of the workbook tree
    const composite = new CompositeStorageBackend(instance, new OPFSStorageBackend(instance), logger);
    await composite.initialize();
    return composite;
}
