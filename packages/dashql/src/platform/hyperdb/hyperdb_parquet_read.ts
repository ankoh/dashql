import type * as arrow from 'apache-arrow';

import type { EmbeddedComputeDatabase } from '../embedded_database.js';

/// Scan a Parquet file with the embedded Hyper, e.g. a workbook table of a `.dashql` archive
export async function readParquetFile(database: EmbeddedComputeDatabase, file: Blob): Promise<arrow.Table> {
    // Every read mounts the file under a name of its own, reads of several files may run at the same time
    const path = await database.registerExternalFile(`${crypto.randomUUID()}.parquet`, file);
    try {
        const connection = await database.connect({ pooled: true });
        try {
            return await connection.query(`SELECT * FROM external('${path.replace(/'/g, "''")}', format => 'parquet')`);
        } finally {
            await connection.close();
        }
    } finally {
        await database.removeExternalFile(path);
    }
}

/// Read Parquet files with a query over their paths, e.g. the parts of a table that a UNION ALL reads as one
export async function readParquetFiles(
    database: EmbeddedComputeDatabase,
    files: readonly Blob[],
    query: (paths: string[]) => string,
): Promise<arrow.Table> {
    const paths: string[] = [];
    try {
        for (const file of files) paths.push(await database.registerExternalFile(`${crypto.randomUUID()}.parquet`, file));
        const connection = await database.connect({ pooled: true });
        try {
            return await connection.query(query(paths));
        } finally {
            await connection.close();
        }
    } finally {
        for (const path of paths) await database.removeExternalFile(path);
    }
}
