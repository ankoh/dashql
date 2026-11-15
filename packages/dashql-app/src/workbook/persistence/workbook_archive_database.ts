import * as React from 'react';

import { useEmbeddedDatabaseSetup } from '../../platform/database/embedded_database_provider.js';
import { useDashQLCoreSetup } from '../../runtime/core_provider.js';
import type { WorkbookArchiveWriter } from '@ankoh/dashql-runtime/workbook/persistence/workbook_export';
import { supportsParquetRead, type ParquetReadDatabase } from '@ankoh/dashql-runtime/storage/workbook_tables_parquet';

/// Resolve the embedded database that writes and reads the workbook tables of a `.dashql` file, set up when needed
export function useWorkbookArchiveDatabase(): (context: string) => Promise<ParquetReadDatabase> {
    const setupDatabase = useEmbeddedDatabaseSetup();
    return React.useCallback(async (context: string) => {
        const database = await setupDatabase(context);
        if (!supportsParquetRead(database)) {
            throw new Error('The embedded database cannot write or read Parquet files');
        }
        return database;
    }, [setupDatabase]);
}

/// Resolve the embedded database and the core that write the workbook tables of a `.dashql` file, set up when needed
export function useWorkbookArchiveWriter(): (context: string) => Promise<WorkbookArchiveWriter> {
    const archiveDatabase = useWorkbookArchiveDatabase();
    const setupCore = useDashQLCoreSetup();
    return React.useCallback(async (context: string) => {
        // One after the other, a failure leaves no rejection behind that nobody awaits
        const database = await archiveDatabase(context);
        const core = await setupCore(context);
        return { database, core };
    }, [archiveDatabase, setupCore]);
}
