import * as React from 'react';
import { StorageWriter } from '@ankoh/dashql-sdk/storage/storage_writer';
import { type StorageBackend, StorageBackendType } from '@ankoh/dashql-sdk/storage/storage_backend';
import { OPFSStorageBackend } from './opfs_storage_backend.js';
import { CompositeStorageBackend } from './composite_storage_backend.js';
import { type WorkbookLocation } from './workbook_locator.js';
import { type WorkbookTreeFolder, emptyWorkbookTree } from '@ankoh/dashql-sdk/storage/workbook_tree';
import { useLogger } from '../platform/logger/logger_provider.js';
import { stringifyError } from '@ankoh/dashql-sdk/platform/logger/logger';
import { migrateStorage } from './migration/storage_migration.js';
import { useAppHandOver } from '../platform/crosstab/app_hand_over.js';
import { IndicatorStatus } from '../ui/foundations/status_indicator.js';
import { APP_SETUP_NOT_STARTED, AppSetupPage } from '../app/app_setup_page.js';

// Storage context for the writer
const StorageWriterContext = React.createContext<StorageWriter | null>(null);

// Storage context for reading
export interface StorageReader {
    backend: StorageBackend;
    /// The backend that routes workbooks between the app storage and native folders.
    /// Null for a bare backend without per-workbook routing, e.g. an injected test backend.
    workbookFolders: CompositeStorageBackend | null;
    /// The physical location of a workbook's files (used by the UI for a display path).
    getWorkbookLocation(workbookId: string): WorkbookLocation;
    /// The user-facing workbook order (the order of the workbook tree), as workbook UUIDs. Empty for a
    /// bare backend without per-workbook routing.
    getWorkbookOrder(): string[];
    /// The workbook tree, the folders and workbooks of the sidebar. Empty for a bare backend without
    /// per-workbook routing.
    getWorkbookTree(): WorkbookTreeFolder;
}
const StorageReaderContext = React.createContext<StorageReader | null>(null);
/// The status of the migration of the storage at startup, skipped for a provided backend
const StorageMigrationStatusContext = React.createContext<IndicatorStatus>(IndicatorStatus.Skip);

interface StorageProviderProps {
    backend?: StorageBackend;
    children?: React.ReactNode;
}

export const StorageProvider: React.FC<StorageProviderProps> = ({ backend: providedBackend, children }) => {
    const logger = useLogger();
    const [backend, setBackend] = React.useState<StorageBackend | null>(providedBackend || null);
    const [migrationStatus, setMigrationStatus] = React.useState<IndicatorStatus>(providedBackend ? IndicatorStatus.Skip : IndicatorStatus.None);
    const [migrationError, setMigrationError] = React.useState<string | null>(null);
    const initialization = React.useRef<Promise<void> | null>(null);

    // Initialize the configured backend if no backend was provided
    React.useEffect(() => {
        if (providedBackend) {
            logger.info("Using provided storage backend", {}, "storage_provider");
            setBackend(providedBackend);
            return;
        }

        const initBackend = async () => {
            const initStartTime = performance.now();

            // The storage is brought to the current version before anything reads it
            setMigrationStatus(IndicatorStatus.Running);
            try {
                const migrated = await migrateStorage(logger);
                setMigrationStatus(migrated.steps + migrated.workbooks > 0 ? IndicatorStatus.Succeeded : IndicatorStatus.Skip);
            } catch (error) {
                logger.error("Failed to migrate the storage", { error: stringifyError(error) }, "storage_provider");
                setMigrationStatus(IndicatorStatus.Failed);
                setMigrationError(`The storage could not be migrated: ${error instanceof Error ? error.message : String(error)}`);
                return;
            }

            // OPFS is the only copy of browser workbooks, ask the browser not to evict it under storage pressure
            void navigator.storage?.persist?.().then(persisted => {
                logger.info("Requested persistent storage", { persisted: persisted.toString() }, "storage_provider");
            }, error => {
                logger.warn("Failed to request persistent storage", { error: stringifyError(error) }, "storage_provider");
            });

            logger.info("Initializing storage backend", {}, "storage_provider");
            const opfsBackend = new OPFSStorageBackend();
            const composite = new CompositeStorageBackend(opfsBackend, logger);
            await composite.initialize();

            const initDuration = performance.now() - initStartTime;
            logger.info("Storage backend initialized", {
                backend: composite.getBackendType(),
                durationMs: initDuration.toFixed(2)
            }, "storage_provider");

            setBackend(composite);
        };

        initialization.current = initBackend();
    }, [providedBackend]);

    // Create storage writer instance
    const writer = React.useMemo(() => {
        if (!backend) return null;
        return new StorageWriter(logger, backend);
    }, [logger, backend]);

    // Write the pending changes when the page goes away, the writer debounces them.
    // Browsers don't wait for the writes when the page unloads, a hidden page usually still finishes them.
    // Electron asks for the writes before it closes a window and waits for them.
    React.useEffect(() => {
        if (!writer) return;
        const flush = async () => {
            try {
                await writer.flush();
            } catch (error) {
                logger.error("Failed to flush the storage writer", { error: stringifyError(error) }, "storage_provider");
            }
        };
        const flushIfHidden = () => {
            if (document.visibilityState === 'hidden') void flush();
        };
        const flushOnPageHide = () => void flush();
        window.addEventListener('pagehide', flushOnPageHide);
        document.addEventListener('visibilitychange', flushIfHidden);
        const removeElectronFlush = globalThis.dashqlElectron?.onFlush(flush);
        return () => {
            window.removeEventListener('pagehide', flushOnPageHide);
            document.removeEventListener('visibilitychange', flushIfHidden);
            removeElectronFlush?.();
        };
    }, [writer, logger]);

    // Another tab takes over the app, the migration and the pending writes finish first
    useAppHandOver(async () => {
        await initialization.current;
        writer?.pause();
        await writer?.flush();
    });


    // Create storage reader
    const reader = React.useMemo<StorageReader | null>(() => {
        if (!backend) return null;

        const workbookFolders = backend instanceof CompositeStorageBackend ? backend : null;
        return {
            backend,
            workbookFolders,
            getWorkbookLocation(workbookId: string): WorkbookLocation {
                if (workbookFolders != null) {
                    return workbookFolders.getWorkbookLocation(workbookId);
                }
                // A bare backend (e.g. an injected test backend) has no per-workbook routing.
                return { type: backend.getBackendType() === StorageBackendType.Native ? StorageBackendType.Native : StorageBackendType.OPFS };
            },
            getWorkbookOrder(): string[] {
                // A bare backend has no workbook tree; the caller falls back to its own order.
                return workbookFolders?.getWorkbookOrder() ?? [];
            },
            getWorkbookTree(): WorkbookTreeFolder {
                return workbookFolders?.getWorkbookTree() ?? emptyWorkbookTree();
            },
        };
    }, [backend, logger]);

    if (!backend || !writer || !reader) {
        // Still migrating or initializing, the app providers below are not set up yet
        return <AppSetupPage status={{ ...APP_SETUP_NOT_STARTED, applyMigrations: migrationStatus }} error={migrationError} showInternals={false} />;
    }

    return (
        <StorageMigrationStatusContext.Provider value={migrationStatus}>
            <StorageReaderContext.Provider value={reader}>
                <StorageWriterContext.Provider value={writer}>
                    {children}
                </StorageWriterContext.Provider>
            </StorageReaderContext.Provider>
        </StorageMigrationStatusContext.Provider>
    );
};

/// The status of the migration of the storage at startup
export function useStorageMigrationStatus(): IndicatorStatus {
    return React.useContext(StorageMigrationStatusContext);
}

export function useStorageWriter(): StorageWriter {
    const writer = React.useContext(StorageWriterContext);
    if (!writer) {
        throw new Error('useStorageWriter must be used within StorageProvider');
    }
    return writer;
}

export function useStorage(): [StorageReader, StorageWriter] {
    const reader = React.useContext(StorageReaderContext);
    const writer = React.useContext(StorageWriterContext);
    if (!reader || !writer) {
        throw new Error('useStorage must be used within StorageProvider');
    }
    return [reader, writer];
}

export function useStorageReader(): StorageReader {
    const reader = React.useContext(StorageReaderContext);
    if (!reader) {
        throw new Error('useStorageReader must be used within StorageProvider');
    }
    return reader;
}
