import type * as arrow from 'apache-arrow';
import { vi } from 'vitest';

import type { ComputeQueryExecution } from '../../compute/computation_tasks.js';
import { DataFrame } from '../../compute/data_frame.js';
import type { EmbeddedComputeDatabase } from '../../platform/database/embedded_database.js';

/// A data frame of a table name without a database
export function mockDataFrame(tableName: string): DataFrame {
    return new DataFrame({} as EmbeddedComputeDatabase, tableName);
}

/// A query execution that skips the query and returns a data frame that reads the table
export function executeReturning(read: arrow.Table | (() => Promise<arrow.Table>)) {
    const dataFrame = {
        readTable: vi.fn(typeof read === 'function' ? read : async () => read),
        destroy: vi.fn().mockResolvedValue(undefined),
    };
    const executeQuery = vi.fn(async () => dataFrame) as unknown as ComputeQueryExecution;
    return { dataFrame, executeQuery };
}
