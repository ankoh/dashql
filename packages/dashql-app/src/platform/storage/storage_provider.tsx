import * as React from 'react';
import { StorageWriter } from './storage_writer.js';
import type { StorageBackend } from './storage_backend.js';
import { OPFSStorageBackend } from './opfs_storage_backend.js';
import { useLogger } from '../logger/logger_provider.js';
import type { DashQL } from '../../core/api.js';
import { restoreAppState, type RestoredAppState, type AppStateRestorationProgress } from './app_state_restorer.js';

// Storage context for the writer
const StorageWriterContext = React.createContext<StorageWriter | null>(null);

// Storage context for reading
export interface StorageReader {
    backend: StorageBackend;
    restoreAppState(core: DashQL, progressConsumer: (progress: AppStateRestorationProgress) => void): Promise<RestoredAppState>;
    waitForInitialRestore(): Promise<void>;
}
const StorageReaderContext = React.createContext<StorageReader | null>(null);

interface StorageProviderProps {
    backend?: StorageBackend;
    children?: React.ReactNode;
}

export const StorageProvider: React.FC<StorageProviderProps> = ({ backend: providedBackend, children }) => {
    const logger = useLogger();
    const [backend, setBackend] = React.useState<StorageBackend | null>(providedBackend || null);

    // Initialize OPFS backend if no backend was provided
    React.useEffect(() => {
        if (providedBackend) {
            setBackend(providedBackend);
            return;
        }

        const initBackend = async () => {
            const opfsBackend = new OPFSStorageBackend();
            await opfsBackend.initialize();
            setBackend(opfsBackend);
        };

        initBackend();
    }, [providedBackend]);

    // Create storage writer instance
    const writer = React.useMemo(() => {
        if (!backend) return null;
        return new StorageWriter(logger, backend);
    }, [logger, backend]);


    // Create storage reader
    const reader = React.useMemo<StorageReader | null>(() => {
        if (!backend) return null;

        return {
            backend,
            async restoreAppState(core: DashQL, progressConsumer: (progress: AppStateRestorationProgress) => void): Promise<RestoredAppState> {
                return restoreAppState(core, backend, logger, progressConsumer);
            },
            async waitForInitialRestore(): Promise<void> {
                // Nothing to wait for in current implementation
                return Promise.resolve();
            }
        };
    }, [backend, logger]);

    if (!backend || !writer || !reader) {
        // Still initializing
        return null;
    }

    return (
        <StorageReaderContext.Provider value={reader}>
            <StorageWriterContext.Provider value={writer}>
                {children}
            </StorageWriterContext.Provider>
        </StorageReaderContext.Provider>
    );
};

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
