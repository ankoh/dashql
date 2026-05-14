import { quoteIdentifier, CatalogSource } from './catalog_sql_generator.js';

export interface FunctionMetadata {
    schemaName: string | null;
    functionName: string;
    arguments: string | null;
    returnType: string | null;
    isAggregate: boolean;
}

export function generateCreateFunctionSQL(databaseName: string | null | undefined, fn: FunctionMetadata): string {
    const db = databaseName || 'default';
    let qualifiedName: string;
    if (fn.schemaName != null) {
        qualifiedName = `${quoteIdentifier(db)}.${quoteIdentifier(fn.schemaName)}.${quoteIdentifier(fn.functionName)}`;
    } else {
        qualifiedName = `${quoteIdentifier(db)}.${quoteIdentifier(fn.functionName)}`;
    }
    const keyword = fn.isAggregate ? 'AGGREGATE' : 'FUNCTION';
    return `CREATE ${keyword} ${qualifiedName}(${fn.arguments}) RETURNS ${fn.returnType ?? "any"}`;
}

export function generateFunctionsSQL(databaseName: string | null | undefined, functions: FunctionMetadata[]): string {
    const sorted = [...functions].sort((a, b) => {
        const schemaCmp = (a.schemaName ?? '').localeCompare(b.schemaName ?? '');
        if (schemaCmp !== 0) return schemaCmp;
        return a.functionName.localeCompare(b.functionName);
    });
    return sorted.map(fn => generateCreateFunctionSQL(databaseName, fn) + ';').join('\n');
}

export function generateFunctionScriptHeader(method: CatalogSource, updatedAt: Date = new Date()): string {
    let methodStr: string;
    switch (method) {
        case CatalogSource.InformationSchema: methodStr = 'SQL information_schema'; break;
        case CatalogSource.PgClass: methodStr = 'SQL pg_proc'; break;
        case CatalogSource.SalesforceMetadataApi: methodStr = 'Salesforce metadata api'; break;
        case CatalogSource.DemoScript: methodStr = 'Demo script'; break;
        default: methodStr = '-'; break;
    }
    return `-- DashQL Connection Functions.
-- This file is auto-generated and can only be updated through a catalog refresh.
--
-- Catalog Source: ${methodStr}
-- Last Refresh: ${updatedAt.toISOString()}

`;
}
