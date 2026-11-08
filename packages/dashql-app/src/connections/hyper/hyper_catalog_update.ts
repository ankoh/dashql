import * as arrow from 'apache-arrow';
import * as dashql from '@ankoh/dashql-core';

import { CATALOG_UPDATE_SCHEMA_SCRIPT, CATALOG_UPDATE_REGISTER_QUERY } from '../connection_state.js';
import { DynamicConnectionDispatch } from '../connection_registry.js';
import { catalogTablesOfSchema, DEFAULT_DATABASE_NAME, packCatalogDescriptor, packCatalogTable, packRelationName, quoteIdentifier, relationFilter, type CatalogTable, type ColumnMetadata, type RelationName } from '../catalog/catalog_sql_generator.js';
import { CATALOG_QUERY_READ_TIMEOUT_MS, queryPgAttribute, catalogTablesFromPgAttribute } from '../catalog/catalog_query_pg_attribute.js';
import { QueryExecutionArgs } from '../query_execution_args.js';
import { QueryExecutor } from '../query_executor.js';
import { QueryType } from '../../query/query_execution_state.js';
import type { LoggerLike } from '../../platform/logger/logger.js';
import type { AttachedDatabase } from './hyperdb_grpc_client.js';
import { qualifyPrefetchedHyperFunctions } from '../catalog/prefetched_hyper_functions.js';
import { beginCatalogBatch, publishCatalogBatch, type CatalogBatchOptions } from '../catalog/catalog_batch.js';
import { generateFunctionScriptHeaderForSource } from '../catalog/catalog_function_sql_generator.js';
import { generateCatalogSQLFromPgProc, queryPgProc } from '../catalog/catalog_query_pg_proc.js';

const LOG_CTX = 'hyper_catalog';

export type HyperCloudCatalogTable = arrow.Table<{
    schema_name: arrow.Utf8;
    table_name: arrow.Utf8;
    column_name: arrow.Utf8;
    ordinal_position: arrow.Int32;
    data_type: arrow.Utf8;
}>;

export interface HyperCatalogUpdateFailure {
    database: string;
    error: Error;
}

export interface HyperCatalogUpdateResult {
    updatedDatabases: string[];
    failures: HyperCatalogUpdateFailure[];
}

interface CatalogTarget {
    key: string;
    databaseName: string;
    queryDatabaseName: string | null;
    path: string;
}

function toError(value: unknown): Error {
    return value instanceof Error ? value : new Error(String(value));
}

function summarizeFailures(message: string, failures: HyperCatalogUpdateFailure[]): Error {
    return new Error(`${message}: ${failures.map(failure => `${failure.database}: ${failure.error.message}`).join('; ')}`);
}

function buildCatalogTargets(attachedDatabases: AttachedDatabase[]): CatalogTarget[] {
    if (attachedDatabases.length === 0) {
        return [{ key: DEFAULT_DATABASE_NAME, databaseName: DEFAULT_DATABASE_NAME, queryDatabaseName: null, path: '' }];
    }
    return attachedDatabases.map(database => ({
        key: database.alias ?? '',
        databaseName: database.alias ?? '',
        queryDatabaseName: database.alias || null,
        path: database.path,
    }));
}

export function buildHyperCloudCatalogQuery(databaseAlias: string, relations: RelationName[] | null = null): string {
    const database = quoteIdentifier(databaseAlias);
    const table = (name: string) => `${database}.${quoteIdentifier('_hyper_catalog')}.${quoteIdentifier(name)}`;
    return `
        SELECT
            s.schema_name_display AS schema_name,
            o.object_name_display AS table_name,
            c.column_name_display AS column_name,
            c.ordinal_position AS ordinal_position,
            CAST(c.type_descriptor AS TEXT) AS data_type
        FROM ${table('databases')} d
        JOIN ${table('schemas')} s
          ON s.account_id = d.account_id
         AND s.database_id = d.database_id
        JOIN ${table('objects')} o
          ON o.account_id = s.account_id
         AND o.schema_id = s.schema_id
        JOIN ${table('columns')} c
          ON c.account_id = o.account_id
         AND c.object_id = o.object_id
        WHERE o.object_type IN ('ICEBERG_TABLE', 'VIEW')
        ${relations == null ? '' : `AND ${relationFilter('s.schema_name_display', 'o.object_name_display', relations)}`}
        ORDER BY
            s.schema_name_display,
            o.object_name_display,
            c.ordinal_position
    `;
}

export function catalogTablesFromHyperCloud(result: HyperCloudCatalogTable, connectionName: string, logger?: LoggerLike): CatalogTable[] {
    const schemas = new Map<string, Map<string, ColumnMetadata[]>>();
    const seenColumns = new Set<string>();
    let duplicateColumns = 0;
    let firstDuplicate: Record<string, string> | null = null;
    for (const batch of result.batches) {
        const schemaNames = batch.getChild('schema_name')!;
        const tableNames = batch.getChild('table_name')!;
        const columnNames = batch.getChild('column_name')!;
        const ordinalPositions = batch.getChild('ordinal_position')!;
        const dataTypes = batch.getChild('data_type')!;

        for (let i = 0; i < batch.numRows; ++i) {
            const schemaName = schemaNames.at(i);
            const tableName = tableNames.at(i);
            const columnName = columnNames.at(i);
            if (!schemaName || !tableName || !columnName) continue;

            let tables = schemas.get(schemaName);
            if (!tables) schemas.set(schemaName, tables = new Map());
            let columns = tables.get(tableName);
            if (!columns) tables.set(tableName, columns = []);
            // The catalog can list a column more than once, a table declares it once
            const columnKey = JSON.stringify([schemaName, tableName, columnName]);
            if (seenColumns.has(columnKey)) {
                firstDuplicate ??= {
                    schema: schemaName, table: tableName, column: columnName,
                    ordinalPosition: String(ordinalPositions.at(i)), dataType: String(dataTypes.at(i)),
                };
                ++duplicateColumns;
                continue;
            }
            seenColumns.add(columnKey);
            columns.push({
                name: columnName,
                ordinalPosition: ordinalPositions.at(i) ?? columns.length,
                dataType: dataTypes.at(i) ?? null,
            });
        }
    }
    if (firstDuplicate != null) {
        logger?.warn('Skipping duplicate Hyper Cloud catalog columns', {
            database: connectionName, duplicates: duplicateColumns.toString(), ...firstDuplicate,
        }, LOG_CTX);
    }

    return [...schemas.keys()].sort().flatMap(schemaName => catalogTablesOfSchema(connectionName, schemaName, schemas.get(schemaName)!));
}

async function queryHyperCloudCatalog(
    connectionId: string,
    connectionDispatch: DynamicConnectionDispatch,
    updateId: number,
    databaseAlias: string,
    executor: QueryExecutor,
    abortSignal: AbortSignal,
    relations: RelationName[] | null,
): Promise<HyperCloudCatalogTable> {
    const args: QueryExecutionArgs = {
        query: buildHyperCloudCatalogQuery(databaseAlias, relations),
        abortSignal,
        readTimeoutMs: CATALOG_QUERY_READ_TIMEOUT_MS,
        throwOnError: true,
        metadata: {
            queryType: QueryType.CATALOG_QUERY_HYPER_CLOUD,
            title: `Query Hyper Cloud Catalog (${databaseAlias})`,
            description: null,
            issuer: 'Catalog Update',
            userProvided: false,
        },
    };
    const [queryId, queryExecution] = executor(connectionId, args);
    connectionDispatch(connectionId, {
        type: CATALOG_UPDATE_REGISTER_QUERY,
        value: [updateId, queryId],
    });
    const result = await queryExecution as HyperCloudCatalogTable | null;
    if (result == null || (relations == null && result.numRows === 0)) {
        throw new Error(`Hyper Cloud catalog for ${databaseAlias} returned no relations`);
    }
    return result;
}

export async function updateHyperCatalog(
    logger: LoggerLike,
    connectionId: string,
    connectionDispatch: DynamicConnectionDispatch,
    updateId: number,
    attachedDatabases: AttachedDatabase[],
    executor: QueryExecutor,
    catalog: dashql.DashQLCatalog,
    dql: dashql.DashQL,
    relationEntryId: number,
    catalogFunctionScript: dashql.DashQLScript,
    resolveLiveFunctionCatalog: boolean,
    abortSignal: AbortSignal,
    options: CatalogBatchOptions = {},
    /// The relations to ask about, all relations and the functions if absent
    relations: RelationName[] | null = null,
): Promise<HyperCatalogUpdateResult> {
    options = { ...options, abortSignal };
    const validate = beginCatalogBatch(catalog, options);
    const targets = buildCatalogTargets(attachedDatabases);
    const aliasCounts = new Map<string, number>();
    for (const target of targets) aliasCounts.set(target.key, (aliasCounts.get(target.key) ?? 0) + 1);

    const relationsOf = (target: CatalogTarget) => relations?.filter(relation => relation.databaseName === target.databaseName) ?? null;
    const queriedTargets = relations == null ? targets : targets.filter(target => relationsOf(target)!.length > 0);
    const results = await Promise.all(queriedTargets.map(async target => {
        try {
            abortSignal.throwIfAborted();
            if (attachedDatabases.length > 0 && !target.key.trim()) {
                throw new Error('Attached databases require a non-empty alias for catalog refresh');
            }
            if ((aliasCounts.get(target.key) ?? 0) > 1) {
                throw new Error(`Attached database alias ${JSON.stringify(target.key)} is not unique`);
            }

            let tables: CatalogTable[];
            if (target.path.startsWith('hyper.cloud')) {
                const result = await queryHyperCloudCatalog(
                    connectionId,
                    connectionDispatch,
                    updateId,
                    target.databaseName,
                    executor,
                    abortSignal,
                    relationsOf(target),
                );
                tables = catalogTablesFromHyperCloud(result, target.databaseName, logger);
            } else {
                const result = await queryPgAttribute(
                    connectionId,
                    connectionDispatch,
                    updateId,
                    target.databaseName,
                    [],
                    executor,
                    target.queryDatabaseName,
                    abortSignal,
                    relationsOf(target),
                );
                if (result == null || (relations == null && result.numRows === 0)) {
                    throw new Error(`pg_attribute for ${target.databaseName} returned no relations`);
                }
                tables = catalogTablesFromPgAttribute(result, target.databaseName);
            }
            if (relations == null && tables.length === 0) throw new Error(`Catalog for ${target.databaseName} returned no usable relations`);
            return { target, tables, error: null };
        } catch (error) {
            return { target, tables: null, error: toError(error) };
        }
    }));

    validate();
    const successful = results.filter(result => result.tables != null);
    const failures = results
        .filter(result => result.error != null)
        .map(result => ({ database: result.target.key || result.target.path, error: result.error! }));
    if (successful.length === 0 && (relations == null || failures.length > 0)) {
        throw summarizeFailures('Failed to refresh every attached database', failures);
    }
    const updatedDatabases = successful.map(result => result.target.key);
    const tables = successful.flatMap(result => result.tables!);
    const layer = dashql.buffers.catalog.CatalogLayer.CONNECTION;

    // The answer about relations updates them, the rest of the catalog stays
    if (relations != null) {
        const answered = successful.flatMap(result => relationsOf(result.target)!);
        if (answered.length > 0) {
            connectionDispatch(connectionId, { type: CATALOG_UPDATE_SCHEMA_SCRIPT, value: [updateId] });
            catalog.replaceTables(relationEntryId, layer, { relations: answered.map(packRelationName), tables: tables.map(packCatalogTable) });
        }
        return { updatedDatabases, failures };
    }

    let functionSQL: string;
    if (resolveLiveFunctionCatalog) {
        const functionResult = await queryPgProc(
            connectionId,
            connectionDispatch,
            updateId,
            executor,
            abortSignal,
        );
        validate();
        if (functionResult == null) {
            throw new Error('pg_proc returned no Hyper function metadata result');
        }
        const functions = generateCatalogSQLFromPgProc(functionResult, DEFAULT_DATABASE_NAME, logger);
        functionSQL = `${generateFunctionScriptHeaderForSource('HyperDB WASM pg_proc')}${functions}`;
    } else {
        functionSQL = qualifyPrefetchedHyperFunctions(DEFAULT_DATABASE_NAME);
    }

    validate();
    connectionDispatch(connectionId, {
        type: CATALOG_UPDATE_SCHEMA_SCRIPT,
        value: [updateId],
    });
    const [functions] = await publishCatalogBatch(dql, catalog, [
        { script: catalogFunctionScript, text: functionSQL, requireFunctions: !resolveLiveFunctionCatalog },
    ], options, validate);
    validate();
    // A database that failed keeps the relations it had
    if (failures.length === 0) {
        catalog.replaceDescriptor(relationEntryId, layer, packCatalogDescriptor(tables));
    } else {
        catalog.replaceTables(relationEntryId, layer, { databases: successful.map(result => result.target.databaseName), tables: tables.map(packCatalogTable) });
    }
    logger.info('Updated Hyper catalog relations', {
        updateId: updateId.toString(),
        databasesUpdated: successful.length.toString(),
        databasesFailed: failures.length.toString(),
        tables: tables.length.toString(),
        functions: functions.functions.toString(),
    }, LOG_CTX);
    return { updatedDatabases, failures };
}
