import { CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK } from '../catalog.js';
import * as core from '../core/index.js';
import type { DashQLScript } from '../core/api.js';

import type { DashQLShell } from './api.js';

const SESSION_RELATION_CATALOG_RANK = CATALOG_DEFAULT_DESCRIPTOR_POOL_RANK - 1;
const SESSION_SCHEMA = 'public';

interface SessionRelation {
    databaseName: string;
    schemaName: string;
    relationName: string;
    columns: string[];
}

interface StatementTarget {
    databaseName: string;
    schemaName: string;
    relationName: string;
}

function quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, '""')}"`;
}

function readIdentifier(identifier: string | null): string {
    return identifier?.replace(/""/g, '"') ?? '';
}

function canonicalizeTarget(target: StatementTarget): StatementTarget {
    return {
        databaseName: target.databaseName,
        schemaName: target.schemaName || SESSION_SCHEMA,
        relationName: target.relationName,
    };
}

function targetKey(target: StatementTarget): string {
    return `${target.databaseName}\0${target.schemaName}\0${target.relationName}`;
}

function readTarget(statement: core.buffers.parser.Statement): StatementTarget | null {
    const target = statement.target();
    const relationName = target?.relationName();
    if (target == null || !relationName) return null;
    return canonicalizeTarget({
        databaseName: readIdentifier(target.databaseName()),
        schemaName: readIdentifier(target.schemaName()),
        relationName: readIdentifier(relationName),
    });
}

function readCreatedRelation(
    analyzed: core.buffers.analyzer.AnalyzedScript,
    target: StatementTarget,
): SessionRelation {
    for (let i = 0; i < analyzed.tablesLength(); ++i) {
        const table = analyzed.tables(i);
        const name = table?.tableName();
        if (table == null || name == null) continue;
        const candidate = canonicalizeTarget({
            databaseName: readIdentifier(name.databaseName()),
            schemaName: readIdentifier(name.schemaName()),
            relationName: readIdentifier(name.tableName()),
        });
        if (targetKey(candidate) !== targetKey(target)) continue;

        const columns: string[] = [];
        for (let j = 0; j < table.tableColumnsLength(); ++j) {
            const columnName = table.tableColumns(j)?.columnName();
            if (columnName) columns.push(readIdentifier(columnName));
        }
        return { ...target, columns };
    }
    return { ...target, columns: [] };
}

function renderCatalog(relations: Iterable<SessionRelation>): string {
    const sorted = [...relations].sort((left, right) => targetKey(left).localeCompare(targetKey(right)));
    const statements = sorted.map(relation => {
        const name = [relation.databaseName, relation.schemaName, relation.relationName]
            .filter(part => part.length !== 0)
            .map(quoteIdentifier)
            .join('.');
        const columns = relation.columns
            .map(column => `    ${quoteIdentifier(column)} VARCHAR`)
            .join(',\n');
        return `CREATE TABLE ${name} (\n${columns}\n);`;
    });
    return ['-- Relations created during this shell session.', ...statements].join('\n\n');
}

export class ShellSessionRelationCatalog {
    private readonly parserScript: DashQLScript;
    private readonly catalogScript: DashQLScript;
    private readonly relations = new Map<string, SessionRelation>();

    constructor(private readonly shell: DashQLShell) {
        this.parserScript = shell.core.createScript(shell.catalog);
        this.catalogScript = shell.loadCatalogScript(renderCatalog([]), SESSION_RELATION_CATALOG_RANK);
    }

    /** Exposes the generated descriptor SQL for focused catalog tests. */
    getScriptText(): string {
        return this.catalogScript.toString();
    }

    applySuccessfulQuery(query: string): void {
        this.parserScript.replaceText(query);
        this.parserScript.analyze();
        const parsedBuffer = this.parserScript.getParsed();
        const analyzedBuffer = this.parserScript.getAnalyzed();
        try {
            const parsed = parsedBuffer.read();
            if (parsed.parserErrorsLength() !== 0 || parsed.scannerErrorsLength() !== 0 || parsed.statementsLength() !== 1) {
                return;
            }
            const statement = parsed.statements(0);
            if (statement == null) return;
            const target = readTarget(statement);
            if (target == null) return;

            switch (statement.statementType()) {
                case core.buffers.parser.StatementType.CREATE_TABLE:
                case core.buffers.parser.StatementType.CREATE_TABLE_AS:
                case core.buffers.parser.StatementType.CREATE_VIEW:
                case core.buffers.parser.StatementType.SELECT_INTO:
                    this.relations.set(targetKey(target), readCreatedRelation(analyzedBuffer.read(), target));
                    break;
                case core.buffers.parser.StatementType.DROP_TABLE:
                case core.buffers.parser.StatementType.DROP_VIEW:
                    this.relations.delete(targetKey(target));
                    break;
                default:
                    return;
            }
            this.reloadCatalogScript();
        } finally {
            analyzedBuffer.destroy();
            parsedBuffer.destroy();
        }
    }

    destroy(): void {
        this.shell.catalog.dropScript(this.catalogScript);
        this.parserScript.destroy();
    }

    private reloadCatalogScript(): void {
        this.catalogScript.replaceText(renderCatalog(this.relations.values()));
        this.catalogScript.analyze();
        this.shell.catalog.dropScript(this.catalogScript);
        this.shell.catalog.loadScript(this.catalogScript, SESSION_RELATION_CATALOG_RANK);
    }
}
