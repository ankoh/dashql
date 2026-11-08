import * as dashql from '@ankoh/dashql-core';
import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import { SalesforceApiClientInterface, type SalesforceMetadataProgress } from './salesforce_api_client.js';
import { getSalesforceDataSpace } from './salesforce_api_client.js';
import { SalesforceConnectionStateDetails } from './salesforce_connection_state.js';
import { catalogTablesOfSchema, packCatalogDescriptor, type ColumnMetadata } from '../catalog/catalog_sql_generator.js';
import { LoggerLike } from '../../platform/logger/logger.js';
import { fetchPrefetchedHyperFunctions } from '../catalog/prefetched_hyper_functions.js';
import { beginCatalogBatch, publishCatalogBatch, type CatalogBatchOptions } from '../catalog/catalog_batch.js';
import type { AttachedDatabase } from '../hyper/hyperdb_grpc_client.js';

export const SALESFORCE_CATALOG_DATABASE = 'lakehouse';
export const SALESFORCE_CATALOG_SCHEMA = 'public';
/// The Hyper Cloud database of Database.com connections that don't name one
export const HYPER_CLOUD_DEFAULT_DATABASE_NAME = 'default';

/// The Hyper Cloud database that Database.com connections attach as the catalog database
export function getHyperCloudAttachedDatabase(params: connection.SalesforceConnectionParams | undefined): AttachedDatabase {
    const databaseName = params?.databaseName || HYPER_CLOUD_DEFAULT_DATABASE_NAME;
    return { path: `hyper.cloud:${databaseName}`, alias: SALESFORCE_CATALOG_DATABASE };
}

export interface ResolvedSalesforceCatalog {
    tables: Map<string, ColumnMetadata[]>;
    functionsSQL: string;
    tableCount: number;
    columnCount: number;
}

export async function resolveSalesforceCatalog(
    logger: LoggerLike,
    coreAccessToken: connection.SalesforceCoreAccessToken,
    dataCloudAccessToken: connection.SalesforceDataCloudAccessToken,
    api: SalesforceApiClientInterface,
    signal: AbortSignal,
    onProgress?: (progress: SalesforceMetadataProgress) => void,
): Promise<ResolvedSalesforceCatalog> {
    if (!coreAccessToken.accessToken || !coreAccessToken.instanceUrl) {
        throw new Error('Salesforce core access token is missing');
    }
    const dataSpace = getSalesforceDataSpace(dataCloudAccessToken);
    logger.info('Resolving Salesforce catalog metadata', { dataSpace }, 'salesforce_catalog');
    const metadataStartedAt = performance.now();
    const [metadata, functionsSQL] = await Promise.all([
        api.getDataCloudMetadata(coreAccessToken, dataSpace, signal, onProgress),
        fetchPrefetchedHyperFunctions(signal),
    ]);
    logger.info('Received Salesforce catalog metadata', {
        dataSpace,
        entities: (metadata.metadata?.length ?? 0).toString(),
        durationMs: (performance.now() - metadataStartedAt).toFixed(2),
    }, 'salesforce_catalog');

    const tables = new Map<string, ColumnMetadata[]>();
    for (const entry of metadata.metadata ?? []) {
        tables.set(entry.name, (entry.fields ?? []).map((field, ordinalPosition) => ({
            name: field.name,
            ordinalPosition,
            dataType: field.type ?? null,
        })));
    }
    const columnCount = Array.from(tables.values()).reduce((total, columns) => total + columns.length, 0);
    if (tables.size === 0 || columnCount === 0) {
        throw new Error('Salesforce metadata returned no usable catalog relations');
    }
    return { tables, functionsSQL, tableCount: tables.size, columnCount };
}

export async function updateSalesforceCatalog(
    logger: LoggerLike,
    conn: SalesforceConnectionStateDetails,
    catalog: dashql.DashQLCatalog,
    dql: dashql.DashQL,
    relationEntryId: number,
    catalogFunctionScript: dashql.DashQLScript,
    api: SalesforceApiClientInterface,
    abortController: AbortController,
    options: CatalogBatchOptions = {},
): Promise<void> {
    options = { ...options, abortSignal: abortController.signal };
    const validate = beginCatalogBatch(catalog, options);
    const coreAccessToken = conn.proto.oauthState?.coreAccessToken;
    if (!coreAccessToken?.accessToken || !coreAccessToken.instanceUrl) {
        throw new Error(`Salesforce core access token is missing`);
    }
    if (!conn.proto.oauthState?.dataCloudAccessToken) {
        throw new Error('Salesforce data cloud access token is missing');
    }
    const dataSpace = getSalesforceDataSpace(conn.proto.oauthState.dataCloudAccessToken);
    const { tables, functionsSQL, columnCount } = await resolveSalesforceCatalog(
        logger,
        coreAccessToken,
        conn.proto.oauthState.dataCloudAccessToken,
        api,
        abortController.signal,
    );
    validate();

    const [functions] = await publishCatalogBatch(dql, catalog, [
        { script: catalogFunctionScript, text: functionsSQL, requireFunctions: true },
    ], options, validate);
    validate();
    catalog.replaceDescriptor(
        relationEntryId,
        dashql.buffers.catalog.CatalogLayer.CONNECTION,
        packCatalogDescriptor(catalogTablesOfSchema(SALESFORCE_CATALOG_DATABASE, SALESFORCE_CATALOG_SCHEMA, tables)),
    );
    logger.info("Loaded Salesforce catalog", {
        dataSpace,
        tables: tables.size.toString(),
        columns: columnCount.toString(),
        functions: functions.functions.toString(),
    }, "salesforce_catalog");
}
