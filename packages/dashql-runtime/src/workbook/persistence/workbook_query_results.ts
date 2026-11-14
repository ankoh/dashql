import type { QueryResultCache } from '../../query/query_result_cache.js';
import type { WorkbookBundleResult } from '../../storage/workbook_bundle.js';
import type { WorkbookScripts } from '../scripts/workbook_scripts.js';
import { computeWorkbookResultCacheKeys, type ScriptRunServices } from '../scripts/script_run.js';
import { stringifyError, type LoggerLike } from '../../platform/logger/logger.js';

const LOG_CTX = 'workbook_query_results';

/// The folder of the query results in an exported workbook of older versions, `results/<key>.parquet`
export const WORKBOOK_RESULTS_FOLDER = 'results';
/// The file of a query result in an exported workbook, named after its cache key
const RESULT_FILE = /^([0-9a-f]{64})\.parquet$/;

/// The path of a query result in an exported workbook of older versions
export function workbookResultPath(key: string): string {
    return `${WORKBOOK_RESULTS_FOLDER}/${key}.parquet`;
}

/// The cache key of a file of the results folder of an exported workbook, null for any other file
export function workbookResultKey(fileName: string): string | null {
    return RESULT_FILE.exec(fileName)?.[1] ?? null;
}

/// The cached results of the scripts of a workbook
export interface RetainedWorkbookQueryResults {
    /// The results, one per key
    results: WorkbookBundleResult[];
    /// The number of scripts with a cached result
    cachedScripts: number;
    /// The number of scripts
    totalScripts: number;
    /// Unpin the files, once the export read them
    release: () => Promise<void>;
}

/// Find and pin the cached results of the scripts of a workbook, under the keys that a run of the workbook reads
export async function retainWorkbookQueryResults(
    services: ScriptRunServices,
    workbook: WorkbookScripts,
    cache: QueryResultCache,
): Promise<RetainedWorkbookQueryResults> {
    const keys = await computeWorkbookResultCacheKeys(services, workbook);
    const releases: Array<() => Promise<void>> = [];
    const release = async () => { await Promise.all(releases.map(r => r().catch(() => {}))); };
    try {
        const results = new Map<string, WorkbookBundleResult>();
        let cachedScripts = 0;
        for (const key of keys) {
            if (key == null) continue;
            if (!results.has(key)) {
                const retained = await cache.retain(key);
                if (retained == null) continue;
                releases.push(retained.release);
                results.set(key, { key, bytes: await cache.readFile(retained.entry.name) });
            }
            ++cachedScripts;
        }
        return { results: [...results.values()], cachedScripts, totalScripts: keys.length, release };
    } catch (error) {
        await release();
        throw error;
    }
}

/// The cached results of the scripts of a workbook, counted without reading them
export interface WorkbookQueryResultCounts {
    /// The number of scripts with a cached result
    cachedScripts: number;
    /// The number of scripts
    totalScripts: number;
    /// The bytes of the results, one file per key. An archive stores them as they are, it grows by about as much.
    bytes: number;
}

/// Count the cached results of the scripts of a workbook, of all scripts
export async function countWorkbookQueryResults(
    services: ScriptRunServices,
    workbook: WorkbookScripts,
    cache: QueryResultCache,
): Promise<WorkbookQueryResultCounts> {
    const keys = await computeWorkbookResultCacheKeys(services, workbook);
    const sizes = new Map<string, number | null>();
    for (const key of keys) {
        if (key != null && !sizes.has(key)) sizes.set(key, (await cache.lookup(key))?.size ?? null);
    }
    let bytes = 0;
    for (const size of sizes.values()) bytes += size ?? 0;
    return { cachedScripts: keys.filter(key => key != null && sizes.get(key) != null).length, totalScripts: keys.length, bytes };
}

/// The outcome of an import of the query results of a workbook
export interface ImportedWorkbookQueryResults {
    /// The results of the workbook
    total: number;
    /// The results that became files of the cache
    added: number;
    /// The results whose keys were cached already, the results of the app win
    kept: number;
    /// The results that couldn't be added, e.g. a file that is gone or whose checksum differs
    failed: number;
    /// The results left out because the workbook holds more than the cache keeps: they would evict each other
    dropped: number;
    /// The bytes of the results that were added
    bytes: number;
    /// Why the first result that failed couldn't be added, or why none was
    error: string | null;
}

/// The outcome of an import whose results all failed at once, e.g. without a cache
export function failedWorkbookQueryResults(total: number, error: unknown): ImportedWorkbookQueryResults {
    return { total, added: 0, kept: 0, failed: total, dropped: 0, bytes: 0, error: errorMessage(error) };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/// Add the query results of an imported workbook to the cache, the results of the app win. A result that fails leaves
/// the others alone.
export async function importWorkbookQueryResults(
    cache: QueryResultCache,
    results: readonly WorkbookBundleResult[],
    logger?: LoggerLike,
): Promise<ImportedWorkbookQueryResults> {
    const outcome: ImportedWorkbookQueryResults = { total: results.length, added: 0, kept: 0, failed: 0, dropped: 0, bytes: 0, error: null };
    // The results beyond the limits of the cache are left out, the ones before them would be evicted again. The import
    // may evict the least recently read results of the app.
    let budgetBytes = cache.capacity.maxBytes;
    let budgetFiles = cache.capacity.maxFiles;
    for (const result of results) {
        const fields = { key: result.key, bytes: result.bytes.size.toString() };
        if (result.bytes.size > budgetBytes || budgetFiles < 1) {
            ++outcome.dropped;
            logger?.warn('Left out an imported query result, the cache is full', fields, LOG_CTX);
            continue;
        }
        budgetBytes -= result.bytes.size;
        budgetFiles -= 1;
        try {
            if (await cache.importFile(result.key, result.bytes, { crc32: result.crc32 })) {
                ++outcome.added;
                outcome.bytes += result.bytes.size;
                logger?.debug('Added an imported query result to the cache', fields, LOG_CTX);
            } else {
                ++outcome.kept;
                logger?.debug('Kept the cached query result of an imported key', fields, LOG_CTX);
            }
        } catch (error) {
            ++outcome.failed;
            outcome.error ??= errorMessage(error);
            logger?.warn('Adding an imported query result to the cache failed', { ...fields, error: stringifyError(error) }, LOG_CTX);
        }
    }
    return outcome;
}
