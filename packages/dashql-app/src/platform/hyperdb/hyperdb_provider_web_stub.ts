import type { Logger } from '../logger/logger.js';
import type { HyperDB } from './hyperdb_wasm.js';

export async function setupWebHyperDB(_context: string, _logger: Logger): Promise<HyperDB> {
    throw new Error('HyperDB WASM is not available in native builds');
}
