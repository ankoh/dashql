import * as core from '@ankoh/dashql-core';

import type { Logger } from '../../../platform/logger/logger.js';
import type { ConnectionState } from '../../connections/connection_state.js';
import type { SessionScripts } from '../scripts/session_scripts.js';
import { ConnectorType } from '../../connections/connector_info.js';
import { quoteIdentifier } from '../../connections/catalog_sql_generator.js';
import { isSystemSchema } from '../../connections/system_schemas.js';

const LOG_CTX = 'sql_generation';

/// The schema context is cut off after this many characters to keep the output of `dashql agent catalog` readable
const SCHEMA_CONTEXT_BUDGET = 100_000;

/// Describe the SQL dialect of a connector for the agent
export function describeSqlDialect(connectorType: ConnectorType): string {
    switch (connectorType) {
        case ConnectorType.HYPER:
            return 'Tableau Hyper (PostgreSQL-compatible)';
        case ConnectorType.SALESFORCE_DATA_CLOUD:
            return 'Salesforce Data Cloud SQL (PostgreSQL-compatible)';
        case ConnectorType.TRINO:
            return 'Trino';
    }
}

/// The relations of a connection, split by owner
interface ConnectionRelations {
    /// The statements that define relations of user schemas
    statements: string[];
    /// The number of skipped relations of system schemas
    systemRelations: number;
}

/// Pick the statements of the connection relation script that define relations of user schemas.
/// The script is parsed in a scratch catalog, the shared relation script stays untouched.
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
        parsed?.destroy();
        script.destroy();
        catalog.destroy();
    }
    return relations;
}

/// Render the tables that the session scripts define as CREATE TABLE statements without types.
/// Generated SQL runs on the default connection, only the scripts on it are described.
function describeSessionTables(sessionScripts: SessionScripts): string[] {
    const statements: string[] = [];
    for (const script of Object.values(sessionScripts.scripts)) {
        if (script.connection.catalog !== sessionScripts.connectionCatalog) continue;
        let entries: core.FlatBufferPtr<core.buffers.catalog.CatalogEntries>;
        try {
            entries = sessionScripts.connectionCatalog.describeEntriesOf(script.scriptSession.getCatalogEntryId());
        } catch {
            // The script is not loaded into the catalog
            continue;
        }
        try {
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
        } finally {
            entries.destroy();
        }
    }
    return statements;
}

/// Build the schema that the model may query: the user relations of the connection and the tables of the session.
/// The schema is cut off at a statement boundary once it exceeds the budget.
export function buildSchemaContext(conn: ConnectionState | null, sessionScripts: SessionScripts, logger: Logger): string {
    const relationScript = conn?.catalogRelationScript.toString() ?? '';
    const relations = relationScript.trim().length > 0
        ? describeConnectionRelations(sessionScripts.instance, relationScript)
        : { statements: [], systemRelations: 0 };
    const sessionTables = describeSessionTables(sessionScripts);

    const statements = [...relations.statements];
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
        logger.warn('Truncated the schema for SQL generation', {
            budget: String(SCHEMA_CONTEXT_BUDGET),
            included: String(included),
            total: String(statements.length),
        }, LOG_CTX);
    }
    logger.debug('Built the schema for SQL generation', {
        connectionRelations: String(relations.statements.length),
        skippedSystemRelations: String(relations.systemRelations),
        sessionTables: String(sessionTables.length),
        characters: String(schema.length),
        truncated: String(truncated),
    }, LOG_CTX);
    return schema;
}

/// A question that the agent answers in the scripts of a session
export interface AgentPromptInput {
    /// The question in natural language
    question: string;
    /// The SQL dialect of the connection
    dialect: string;
    /// The catalog objects that the question mentions, e.g. "orders (table)"
    mentionedIdentifiers: string[];
}

/// Build the prompt of a question for the agent.
/// The agent reads the schema and writes the SQL itself through the dashql command, it also picks the script.
export function buildAgentPrompt(input: AgentPromptInput): string {
    const lines = [
        'Answer the question below with a SQL query in a DashQL script.',
        `The connection speaks ${input.dialect}.`,
        'Look up the scripts with `dashql agent scripts` and the schema with `dashql agent catalog`.',
        'Write the query with `dashql agent edit <script>`, into a new script with a short snake_case name'
            + ' unless the question is about an existing script.',
        'Check it with `dashql agent lint <script>` and run it with `dashql agent run <script>`.',
        'Prefer read-only queries. End with a one-sentence answer to the question.',
    ];
    if (input.mentionedIdentifiers.length > 0) {
        lines.push(`The question mentions these catalog objects: ${input.mentionedIdentifiers.join(', ')}.`);
    }
    // Harnesses reject NUL characters
    lines.push('', 'Question:', input.question.replace(/\0/g, ''));
    return lines.join('\n');
}
