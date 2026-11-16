import * as React from 'react';

import { useEmbeddedDatabaseSetup } from '../../platform/database/embedded_database_provider.js';
import { supportsParquetRead, type ParquetReadDatabase } from '@ankoh/dashql/runtime/storage/workbook_archives';

/// Resolve the embedded database that writes and reads the workbook tables of a `.dashql` file and of a cloud, set up
/// when needed
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
