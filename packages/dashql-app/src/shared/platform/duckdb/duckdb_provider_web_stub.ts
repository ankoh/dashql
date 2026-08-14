import type { Logger } from '../logger/logger.js';

import { DuckDB } from './duckdb_api.js';

export async function setupWebDuckDB(_context: string, _logger: Logger): Promise<DuckDB> {
    throw new Error('Web DuckDB is not available in native builds');
}
