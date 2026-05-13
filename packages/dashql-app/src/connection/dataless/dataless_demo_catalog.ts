import * as dashql from '../../core/index.js';

import { DynamicConnectionDispatch } from "../connection_registry.js";
import { CATALOG_UPDATE_SCHEMA_SCRIPT } from "../connection_state.js";
import { CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK } from "../catalog_update_state.js";
import { generateCatalogScriptHeader, CatalogSource } from "../catalog_sql_generator.js";
import { generateFunctionScriptHeader } from "../catalog_function_sql_generator.js";

const demo_schema_url = new URL('../../../static/examples/demo/schema.sql', import.meta.url);
const demo_functions_url = new URL('../../../static/examples/demo/functions.sql', import.meta.url);

export async function updateDemoSchemaCatalog(
    sessionId: string,
    connectionDispatch: DynamicConnectionDispatch,
    updateId: number,
    catalog: dashql.DashQLCatalog,
    _dql: dashql.DashQL,
    catalogRelationScript: dashql.DashQLScript,
    catalogFunctionScript: dashql.DashQLScript,
): Promise<void> {
    const [schemaResponse, functionsResponse] = await Promise.all([
        fetch(demo_schema_url),
        fetch(demo_functions_url),
    ]);
    const catalogSQL = await schemaResponse.text();
    const functionsSQL = await functionsResponse.text();

    connectionDispatch(sessionId, {
        type: CATALOG_UPDATE_SCHEMA_SCRIPT,
        value: [updateId],
    });

    const schemaHeader = generateCatalogScriptHeader(CatalogSource.DemoScript);
    catalogRelationScript.replaceText(`${schemaHeader}${catalogSQL}`);
    catalogRelationScript.analyze();
    catalog.loadScript(catalogRelationScript, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK);

    if (functionsSQL.trim().length > 0) {
        const fnHeader = generateFunctionScriptHeader(CatalogSource.DemoScript);
        catalogFunctionScript.replaceText(`${fnHeader}${functionsSQL}`);
        catalogFunctionScript.analyze();
        try {
            catalog.dropScript(catalogFunctionScript);
        } catch (e) {
            // Script may not have been loaded yet - ignore error
        }
        catalog.loadScript(catalogFunctionScript, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK);
    }
}
