import * as dashql from '../../../core/index.js';

import { CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK } from './catalog_update_state.js';

import prefetchedHyperFunctionsUrl from '../../../../static/catalog/hyper/dashql-functions.sql?url';

export async function fetchPrefetchedHyperFunctions(signal?: AbortSignal): Promise<string> {
    const response = await fetch(prefetchedHyperFunctionsUrl, { signal });
    if (!response.ok) {
        throw new Error(`failed to load prefetched Hyper functions: ${response.status} ${response.statusText}`);
    }
    const sql = await response.text();
    if (sql.trim().length === 0) {
        throw new Error('prefetched Hyper function catalog is empty');
    }
    return sql;
}

export function loadPrefetchedHyperFunctions(
    catalog: dashql.DashQLCatalog,
    catalogFunctionScript: dashql.DashQLScript,
    sql: string,
    rank = CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK,
): number {
    catalogFunctionScript.replaceText(sql);
    catalogFunctionScript.analyze();
    const functionCount = catalogFunctionScript.getParsed().read().statementsLength();

    try {
        catalog.dropScript(catalogFunctionScript);
    } catch {
        // Script may not have been loaded yet.
    }
    catalog.loadScript(catalogFunctionScript, rank);
    return functionCount;
}
