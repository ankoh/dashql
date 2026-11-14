import type { EmbeddedComputeDatabase, EmbeddedExternalFileDatabase } from '@ankoh/dashql-runtime/platform/database/embedded_database';
import { exportArrowTableAsParquet, supportsParquetExport, type ParquetExportDatabase } from '@ankoh/dashql-runtime/platform/hyperdb/hyperdb_parquet_export';
import { workbookTableFromArrow, workbookTableToArrow, TABLE_FILE_EXTENSION, type WorkbookTableName, type WorkbookTables } from '@ankoh/dashql-runtime/storage/workbook_tables';

/// A database that reads Parquet files: the embedded Hyper mounts a file and scans it
export type ParquetReadDatabase = ParquetExportDatabase & EmbeddedExternalFileDatabase;

/// Can the database read Parquet files?
export function supportsParquetRead(database: EmbeddedComputeDatabase | null): database is ParquetReadDatabase {
    return supportsParquetExport(database) && 'registerExternalFile' in database && 'removeExternalFile' in database;
}

/// The file name of a table in a `.dashql` file
export function workbookTableFileName(tableName: string): string {
    return `${tableName}${TABLE_FILE_EXTENSION}`;
}

/// Write the rows of a workbook table as Parquet file with the embedded Hyper
export async function writeWorkbookTableParquet<N extends WorkbookTableName>(
    database: ParquetExportDatabase,
    name: N,
    rows: WorkbookTables[N],
): Promise<Uint8Array> {
    return await exportArrowTableAsParquet(database, workbookTableToArrow(name, rows));
}

/// Read the rows of a workbook table from a Parquet file with the embedded Hyper
export async function readWorkbookTableParquet<N extends WorkbookTableName>(
    database: ParquetReadDatabase,
    name: N,
    file: Blob,
    signal?: AbortSignal,
): Promise<WorkbookTables[N]> {
    // Every read mounts the file under a name of its own, reads of several archives may run at the same time
    const path = await database.registerExternalFile(`${crypto.randomUUID()}-${workbookTableFileName(name)}`, file, undefined, signal);
    try {
        const connection = await database.connect({ pooled: true });
        try {
            const table = await connection.query(`SELECT * FROM external('${path.replace(/'/g, "''")}', format => 'parquet')`, signal);
            return workbookTableFromArrow(name, table);
        } finally {
            await connection.close();
        }
    } finally {
        await database.removeExternalFile(path);
    }
}
