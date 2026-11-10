import * as core from '@ankoh/dashql-core';

import type { Logger } from '../platform/logger/logger.js';
import type { ConnectionState } from '../connections/connection_state.js';
import type { WorkbookScripts } from '../workbook/scripts/workbook_scripts.js';
import { catalogTablesOfDescriptor, generateCatalogTablesSQL, quoteIdentifier } from '../connections/catalog/catalog_sql_generator.js';
import { isSystemSchema } from '../connections/catalog/system_schemas.js';

const LOG_CTX = 'agent_catalog';

/// The schema context is cut off after this many characters to keep the output of `dashql agent catalog` readable
const SCHEMA_CONTEXT_BUDGET = 100_000;

/// The relations of a connection, split by owner
interface ConnectionRelations {
    /// The statements that define relations of user schemas
    statements: string[];
    /// The number of skipped relations of system schemas
    systemRelations: number;
}

/// The statements of the relations of user schemas of a connection
function describeConnectionRelations(descriptor: core.buffers.catalog.CatalogDescriptorT | null): ConnectionRelations {
    const relations: ConnectionRelations = { statements: [], systemRelations: 0 };
    for (const table of catalogTablesOfDescriptor(descriptor)) {
        if (isSystemSchema(table.schemaName)) {
            relations.systemRelations += 1;
            continue;
        }
        relations.statements.push(generateCatalogTablesSQL([table]));
    }
    return relations;
}

/// Render the tables that the workbook scripts on a connection define as CREATE TABLE statements without types.
/// Queries only see the tables of scripts on their own connection.
function describeWorkbookTables(workbookScripts: WorkbookScripts, connectionId: string): string[] {
    const statements: string[] = [];
    for (const script of Object.values(workbookScripts.scripts)) {
        const catalog = script.connection.catalog;
        if (script.connection.connectionId !== connectionId || catalog == null) continue;
        let entries: core.FlatBufferPtr<core.buffers.catalog.CatalogEntries>;
        try {
            entries = catalog.describeEntriesOf(script.scriptSession.getCatalogEntryId());
        } catch {
            // The script is not loaded into the catalog
            continue;
        }
        const reader = entries.read();
        for (let i = 0; i < reader.entriesLength(); ++i) {
            const entry = reader.entries(i)!;
            for (let j = 0; j < entry.schemasLength(); ++j) {
                const schema = entry.schemas(j)!;
                for (let k = 0; k < schema.tablesLength(); ++k) {
                    const table = schema.tables(k)!;
                    const columns: string[] = [];
                    for (let l = 0; l < table.columnsLength(); ++l) {
                        columns.push(quoteIdentifier(table.columns(l)!.columnName() ?? ''));
                    }
                    statements.push(`CREATE TABLE ${quoteIdentifier(table.tableName() ?? '')} (${columns.join(', ')});`);
                }
            }
        }
    }
    return statements;
}

/// Build the schema that the model may query on a connection: the user relations of the connection and the tables of
/// the workbook scripts on it.
/// The schema is cut off at a statement boundary once it exceeds the budget.
export function buildSchemaContext(connectionId: string, conn: ConnectionState | null, workbookScripts: WorkbookScripts, logger: Logger): string {
    const relations = describeConnectionRelations(conn?.catalog.readDescriptor(conn.catalogRelationEntryId) ?? null);
    const workbookTables = describeWorkbookTables(workbookScripts, connectionId);

    const statements = [...relations.statements];
    if (workbookTables.length > 0) {
        statements.push('-- Tables defined by the workbook, column types are unknown', ...workbookTables);
    }
    let schema = '';
    let included = 0;
    for (const statement of statements) {
        if (schema.length + statement.length + 1 > SCHEMA_CONTEXT_BUDGET) {
            break;
        }
        schema += schema.length > 0 ? `\n${statement}` : statement;
        ++included;
    }
    const truncated = included < statements.length;
    if (truncated) {
        schema += '\n-- The schema is truncated';
        logger.warn('Truncated the schema for the agent', {
            budget: String(SCHEMA_CONTEXT_BUDGET),
            included: String(included),
            total: String(statements.length),
        }, LOG_CTX);
    }
    logger.debug('Built the schema for the agent', {
        connectionRelations: String(relations.statements.length),
        skippedSystemRelations: String(relations.systemRelations),
        workbookTables: String(workbookTables.length),
        characters: String(schema.length),
        truncated: String(truncated),
    }, LOG_CTX);
    return schema;
}
