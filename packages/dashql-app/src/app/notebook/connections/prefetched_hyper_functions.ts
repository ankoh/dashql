import * as dashql from '../../../core/index.js';

import { CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK } from './catalog_update_state.js';
import { generateFunctionScriptHeader } from './catalog_function_sql_generator.js';
import { CatalogSource } from './catalog_sql_generator.js';

import prefetchedHyperFunctionsSql from '../../../../static/catalog/hyper/dashql-functions.sql?raw';

export const PREFETCHED_HYPER_FUNCTIONS_SQL = prefetchedHyperFunctionsSql;

export function qualifyPrefetchedHyperFunctions(databaseName: string, updatedAt: Date = new Date()): string {
    const quotedDatabase = `"${databaseName.replace(/"/g, '""')}"`;
    const functions = PREFETCHED_HYPER_FUNCTIONS_SQL.replace(
        /"default"\."pg_catalog"/g,
        `${quotedDatabase}."pg_catalog"`,
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
    catalogFunctionScript: dashql.DashQLScript,
    sql: string,
    rank = CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK,
): number {
    const validationScript = dql.createScript(catalog);
    let functionCount: number;
    try {
        validationScript.replaceText(sql);
        validationScript.parse();
        const parsed = validationScript.getParsed().read();
        if (parsed.scannerErrorsLength() > 0 || parsed.parserErrorsLength() > 0) {
            throw new Error('prefetched Hyper function catalog contains invalid SQL');
        }
        functionCount = parsed.statementsLength();
        if (functionCount === 0) {
            throw new Error('prefetched Hyper function catalog is empty');
        }
    } finally {
        validationScript.destroy();
    }

    try {
        catalog.dropScript(catalogFunctionScript);
    } catch {
        // Script may not have been loaded yet.
    }
    catalogFunctionScript.replaceText(sql);
    catalogFunctionScript.analyze();
    catalog.loadScript(catalogFunctionScript, rank);
    return functionCount;
}
