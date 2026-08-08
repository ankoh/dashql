import * as dashql from '../../core/index.js';

import { SalesforceApiClientInterface } from './salesforce_api_client.js';
import { getSalesforceDataSpace } from './salesforce_api_client.js';
import { SalesforceConnectionStateDetails } from './salesforce_connection_state.js';
import { generateUnqualifiedSchemaSQL, generateCatalogScriptHeader, CatalogSource, type ColumnMetadata } from '../catalog_sql_generator.js';
import { LoggerLike } from '../../platform/logger/logger.js';
import { fetchPrefetchedHyperFunctions, loadPrefetchedHyperFunctions } from '../prefetched_hyper_functions.js';

const SALESFORCE_CATALOG_RANK = 100;

export async function updateSalesforceCatalog(
    logger: LoggerLike,
    conn: SalesforceConnectionStateDetails,
    catalog: dashql.DashQLCatalog,
    dql: dashql.DashQL,
    catalogRelationScript: dashql.DashQLScript,
    catalogFunctionScript: dashql.DashQLScript,
    api: SalesforceApiClientInterface,
    abortController: AbortController
): Promise<dashql.DashQLScript> {
    const coreAccessToken = conn.proto.oauthState?.coreAccessToken;
    if (!coreAccessToken?.accessToken || !coreAccessToken.instanceUrl) {
        throw new Error(`Salesforce core access token is missing`);
    }
    // The selected data space is encoded in the Data Cloud token.
    if (!conn.proto.oauthState?.dataCloudAccessToken) {
        throw new Error(`Salesforce data cloud access token is missing`);
    }
    const dataSpace = getSalesforceDataSpace(conn.proto.oauthState.dataCloudAccessToken);
    logger.info("Resolving Salesforce catalog metadata", { dataSpace }, "salesforce_catalog");

    // Get Data Cloud metadata through the Salesforce Connect API.
    const metadataStartedAt = performance.now();
    const [metadata, functionsSQL] = await Promise.all([
        api.getDataCloudMetadata(
            coreAccessToken,
            dataSpace,
            abortController.signal,
        ),
        fetchPrefetchedHyperFunctions(abortController.signal),
    ]);
    logger.info("Received Salesforce catalog metadata", {
        dataSpace,
        entities: (metadata.metadata?.length ?? 0).toString(),
        durationMs: (performance.now() - metadataStartedAt).toFixed(2),
    }, "salesforce_catalog");

    // Build table metadata
    const tables = new Map<string, ColumnMetadata[]>();
    if (metadata.metadata) {
        for (const entry of metadata.metadata) {
            const columns: ColumnMetadata[] = [];
            if (entry.fields) {
                for (let i = 0; i < entry.fields.length; i++) {
                    const field = entry.fields[i];
                    columns.push({
                        name: field.name,
                        ordinalPosition: i,
                        dataType: field.type ?? null,
                    });
                }
            }
            tables.set(entry.name, columns);
        }
    }

    // Generate SQL from metadata
    const header = generateCatalogScriptHeader(CatalogSource.SalesforceMetadataApi);
    const catalogSQL = generateUnqualifiedSchemaSQL(tables);
    const columnCount = Array.from(tables.values()).reduce((total, columns) => total + columns.length, 0);
    logger.info("Generated Salesforce catalog script", {
        dataSpace,
        tables: tables.size.toString(),
        columns: columnCount.toString(),
        scriptBytes: new TextEncoder().encode(catalogSQL).byteLength.toString(),
    }, "salesforce_catalog");

    // Update script content
    catalogRelationScript.replaceText(`${header}${catalogSQL}`);
    catalogRelationScript.analyze();

    // Drop old script from catalog if loaded, then reload with Salesforce rank
    try {
        catalog.dropScript(catalogRelationScript);
    } catch (e) {
        // Script may not have been loaded yet - ignore error
    }
    catalog.loadScript(catalogRelationScript, SALESFORCE_CATALOG_RANK);
    const functionCount = loadPrefetchedHyperFunctions(
        catalog,
        catalogFunctionScript,
        functionsSQL,
        SALESFORCE_CATALOG_RANK,
    );
    logger.info("Loaded Salesforce catalog script", {
        dataSpace,
        tables: tables.size.toString(),
        functions: functionCount.toString(),
        rank: SALESFORCE_CATALOG_RANK.toString(),
    }, "salesforce_catalog");

    return catalogRelationScript;
}
