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
