import * as core from '@ankoh/dashql-core';

import type { Logger } from '../../platform/logger/logger.js';
import type { ConnectionState } from '../connections/connection_state.js';
import type { SessionScripts } from '../session/scripts/session_scripts.js';
import { quoteIdentifier } from '../connections/catalog_sql_generator.js';
import { isSystemSchema } from '../connections/system_schemas.js';

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

/// Pick the statements of a connection script that define or drop relations of user schemas.
/// The text is parsed in a scratch catalog, the shared relation script stays untouched.
function describeConnectionRelations(instance: core.DashQL, relationScript: string): ConnectionRelations {
    const relations: ConnectionRelations = { statements: [], systemRelations: 0 };
    const catalog = instance.createCatalog();
    const script = instance.createScript(catalog);
    let parsed: core.FlatBufferPtr<core.buffers.parser.ParsedScript> | null = null;
    try {
        script.replaceText(relationScript);
        script.parse();
        parsed = script.getParsed();
        const reader = parsed.read();
        const statement = new core.buffers.parser.Statement();
        for (let i = 0; i < reader.statementsLength(); ++i) {
            reader.statements(i, statement);
            const schemaName = statement.target()?.schemaName() ?? '';
            if (isSystemSchema(schemaName)) {
                relations.systemRelations += 1;
                continue;
            }
            const span = statement.statementSpan();
            if (span != null) {
                relations.statements.push(`${script.toString(span.offset(), span.length())};`);
            }
        }
    } finally {
        script.destroy();
        catalog.destroy();
    }
    return relations;
}

/// Render the tables that the session scripts on a connection define as CREATE TABLE statements without types.
/// Queries only see the tables of scripts on their own connection.
function describeSessionTables(sessionScripts: SessionScripts, connectionId: string): string[] {
    const statements: string[] = [];
    for (const script of Object.values(sessionScripts.scripts)) {
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

/// Build the schema that the model may query on a connection: the user relations of the connection, the catalog
/// changes of executed statements and the tables of the session scripts on it.
/// The schema is cut off at a statement boundary once it exceeds the budget.
export function buildSchemaContext(connectionId: string, conn: ConnectionState | null, sessionScripts: SessionScripts, logger: Logger): string {
    const describe = (text: string): ConnectionRelations => text.trim().length > 0
        ? describeConnectionRelations(sessionScripts.instance, text)
        : { statements: [], systemRelations: 0 };
    const relations = describe(conn?.catalogRelationScript.toString() ?? '');
    const changes = describe(conn?.catalogChangesSql ?? '');
    const sessionTables = describeSessionTables(sessionScripts, connectionId);

    const statements = [...relations.statements];
    if (changes.statements.length > 0) {
        statements.push('-- Changes of executed statements since the last catalog refresh, column types are unknown', ...changes.statements);
    }
    if (sessionTables.length > 0) {
        statements.push('-- Tables defined by the session, column types are unknown', ...sessionTables);
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
        catalogChanges: String(changes.statements.length),
        skippedSystemRelations: String(relations.systemRelations + changes.systemRelations),
        sessionTables: String(sessionTables.length),
        characters: String(schema.length),
        truncated: String(truncated),
    }, LOG_CTX);
    return schema;
}
