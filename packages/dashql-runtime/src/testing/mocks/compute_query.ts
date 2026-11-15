import { DataFrame } from '../../compute/data_frame.js';
import type { EmbeddedComputeDatabase } from '../../platform/database/embedded_database.js';

/// A data frame of a table name without a database
export function mockDataFrame(tableName: string): DataFrame {
    return new DataFrame({} as EmbeddedComputeDatabase, tableName);
}
