import * as React from 'react';
import { type StorageBackend, StorageBackendType } from '@akohn/dashql/platform/storage/storage_backend';
import { OPFSStorageBackend } from '@akohn/dashql/platform/storage/opfs_storage_backend';
import { CompositeStorageBackend } from '@akohn/dashql/platform/storage/composite_storage_backend';
import { type WorkbookLocation } from '@akohn/dashql/platform/storage/workbook_locator';
import { type WorkbookTreeFolder, emptyWorkbookTree } from '@akohn/dashql/platform/storage/workbook_tree';
import { useLogger } from '../host/logger_provider.js';
import { stringifyError } from '@akohn/dashql/platform/logger/logger';
import { migrateStorage } from './storage_migration.js';
import { useAppHandOver } from '../host/app_hand_over.js';
import { IndicatorStatus } from '@akohn/dashql-react/components/status_indicator';
import { APP_SETUP_NOT_STARTED, AppSetupPage } from '../app/app_setup_page.js';
import { useDashQLCoreSetup } from '../host/core_provider.js';

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
    const setupCore = useDashQLCoreSetup();
    const [backend, setBackend] = React.useState<StorageBackend | null>(providedBackend || null);
    const [migrationStatus, setMigrationStatus] = React.useState<IndicatorStatus>(providedBackend ? IndicatorStatus.Skip : IndicatorStatus.None);
    const [migrationError, setMigrationError] = React.useState<string | null>(null);
    const initialization = React.useRef<Promise<void> | null>(null);

    // Initialize the configured backend if no backend was provided, with the logger and the core of the render that
    // starts it: the storage is set up once per backend
    const setUpBackend = React.useEffectEvent((providedBackend: StorageBackend | undefined) => {
        if (providedBackend) {
            logger.info("Using provided storage backend", {}, "storage_provider");
            setBackend(providedBackend);
            return;
        }

        const initBackend = async () => {
            const initStartTime = performance.now();

            // The storage is brought to the current version before anything reads it, the runtime of the core migrates it
            setMigrationStatus(IndicatorStatus.Running);
            try {
                const migrated = await migrateStorage(logger, setupCore);
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
            // The backends ask the core about the names of attachments and folders and the changes of the workbook tree
            const instance = await setupCore('storage_provider');
            const opfsBackend = new OPFSStorageBackend(instance);
            const composite = new CompositeStorageBackend(instance, opfsBackend, logger);
            await composite.initialize();

            const initDuration = performance.now() - initStartTime;
            logger.info("Storage backend initialized", {
                backend: composite.getBackendType(),
                durationMs: initDuration.toFixed(2)
            }, "storage_provider");

            setBackend(composite);
        };

        initialization.current = initBackend();
    });
    React.useEffect(() => setUpBackend(providedBackend), [providedBackend]);

    // Another tab takes over the app, the migration finishes first. The runtime stops its writer.
    useAppHandOver(async () => {
        await initialization.current;
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
        };
    }, [backend]);

    if (!backend || !reader) {
        // Still migrating or initializing, the app providers below are not set up yet
        return <AppSetupPage status={{ ...APP_SETUP_NOT_STARTED, applyMigrations: migrationStatus }} error={migrationError} showInternals={false} />;
    }

    return (
        <StorageMigrationStatusContext.Provider value={migrationStatus}>
            <StorageReaderContext.Provider value={reader}>
                {children}
            </StorageReaderContext.Provider>
        </StorageMigrationStatusContext.Provider>
    );
};

/// The status of the migration of the storage at startup
export function useStorageMigrationStatus(): IndicatorStatus {
    return React.useContext(StorageMigrationStatusContext);
}

/// The tree of a backend without per-workbook routing
const EMPTY_WORKBOOK_TREE = emptyWorkbookTree();
/// Listen to nothing
const NO_SUBSCRIPTION = () => () => {};

/// The workbook tree of the storage, the folders and workbooks of the sidebar: a change of the tree renders again, also
/// one of another component. Empty for a bare backend without per-workbook routing.
export function useWorkbookTree(workbookFolders: CompositeStorageBackend | null): WorkbookTreeFolder {
    const subscribe = React.useMemo(
        () => workbookFolders == null ? NO_SUBSCRIPTION : (listener: () => void) => workbookFolders.subscribeWorkbookTree(listener),
        [workbookFolders],
    );
    return React.useSyncExternalStore(subscribe, () => workbookFolders?.getWorkbookTree() ?? EMPTY_WORKBOOK_TREE);
}

export function useStorageReader(): StorageReader {
    const reader = React.useContext(StorageReaderContext);
    if (!reader) {
        throw new Error('useStorageReader must be used within StorageProvider');
    }
    return reader;
}
