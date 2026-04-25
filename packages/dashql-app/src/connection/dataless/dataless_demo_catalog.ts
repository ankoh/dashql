import * as dashql from '../../core/index.js';

import { DynamicConnectionDispatch } from "../connection_registry.js";
import { CATALOG_UPDATE_SCHEMA_SCRIPT } from "../connection_state.js";
import { CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK } from "../catalog_update_state.js";
import { generateCatalogScriptHeader, CatalogSource } from "../catalog_sql_generator.js";

const demo_schema_url = new URL('../../../static/examples/demo/schema.sql', import.meta.url);

export async function updateDemoSchemaCatalog(
    sessionId: string,
    connectionDispatch: DynamicConnectionDispatch,
    updateId: number,
    catalog: dashql.DashQLCatalog,
    _dql: dashql.DashQL,
    catalogScript: dashql.DashQLScript,
): Promise<void> {
    const response = await fetch(demo_schema_url);
    const catalogSQL = await response.text();

    connectionDispatch(sessionId, {
        type: CATALOG_UPDATE_SCHEMA_SCRIPT,
        value: [updateId],
    });

    const header = generateCatalogScriptHeader(CatalogSource.DemoScript);
    catalogScript.replaceText(`${header}${catalogSQL}`);
    catalogScript.analyze();
    catalog.loadScript(catalogScript, CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK);
}
