import * as dashql from '@ankoh/dashql-core';

import { generateFunctionScriptHeader } from './catalog_function_sql_generator.js';
import { CatalogSource } from './catalog_sql_generator.js';
import { publishCatalogBatchSync, type CatalogSourceScript } from './catalog_batch.js';

import { PREFETCHED_HYPER_FUNCTIONS_SQL } from './prefetched_hyper_functions_sql.js';

export { PREFETCHED_HYPER_FUNCTIONS_SQL };

export function qualifyPrefetchedHyperFunctions(databaseName: string, updatedAt: Date = new Date()): string {
    const quotedDatabase = `"${databaseName.replace(/"/g, '""')}"`;
    const functions = PREFETCHED_HYPER_FUNCTIONS_SQL.replace(
        /"hyper"\./g,
        `${quotedDatabase}.`,
    );
    return `${generateFunctionScriptHeader(CatalogSource.Hyper, updatedAt)}${functions}`;
}

export async function fetchPrefetchedHyperFunctions(signal?: AbortSignal): Promise<string> {
    signal?.throwIfAborted();
    return PREFETCHED_HYPER_FUNCTIONS_SQL;
}

export function loadPrefetchedHyperFunctions(
    dql: dashql.DashQL,
    catalog: dashql.DashQLCatalog,
    catalogFunctionScript: CatalogSourceScript,
    sql: string,
): number {
    return publishCatalogBatchSync(dql, catalog, [{
        script: catalogFunctionScript, text: sql, requireFunctions: true,
    }])[0].functions;
}
