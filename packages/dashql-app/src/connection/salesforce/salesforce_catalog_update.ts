import * as dashql from '../../core/index.js';

import { SalesforceApiClientInterface } from './salesforce_api_client.js';
import { SalesforceConnectionStateDetails } from './salesforce_connection_state.js';
import { generateSchemaSQL, type ColumnMetadata } from '../catalog_sql_generator.js';

const SALESFORCE_CATALOG_RANK = 100;

export async function updateSalesforceCatalog(
    conn: SalesforceConnectionStateDetails,
    catalog: dashql.DashQLCatalog,
    dql: dashql.DashQL,
    catalogScript: dashql.DashQLScript,
    api: SalesforceApiClientInterface,
    abortController: AbortController
): Promise<dashql.DashQLScript> {
    // Missing the data cloud access token
    if (!conn.proto.oauthState?.dataCloudAccessToken) {
        throw new Error(`salesforce data cloud access token is missing`);
    }
    // Get the Data Cloud metadata
    const metadata = await api.getDataCloudMetadata(
        conn.proto.oauthState?.dataCloudAccessToken!,
        abortController.signal,
    );

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
    const catalogSQL = generateSchemaSQL('salesforce', 'datacloud', tables);

    // Update script content
    catalogScript.replaceText(catalogSQL);
    catalogScript.analyze();

    // Drop old script from catalog if loaded, then reload with Salesforce rank
    try {
        catalog.dropScript(catalogScript);
    } catch (e) {
        // Script may not have been loaded yet - ignore error
    }
    catalog.loadScript(catalogScript, SALESFORCE_CATALOG_RANK);

    return catalogScript;
}
