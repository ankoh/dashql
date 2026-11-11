import * as flatbuffers from 'flatbuffers';
import * as buffers from '@ankoh/dashql-core/buffers';
import type { DashQL } from '@ankoh/dashql-core';

import { catalogTablesOfDescriptor, generateCatalogTablesSQL, quoteIdentifier, type CatalogTable } from './catalog_sql_generator.js';

// The catalog files of a connection as structure: the tables with their columns and the functions with their parameters.
// The core parses the SQL of the files into a catalog descriptor, the structure is read from the descriptor and renders
// the files again. See docs/design/workbook_tables.md.

/// A parameter of a function of a catalog
export interface CatalogFunctionParam {
    /// The name, null if the declaration names none
    name: string | null;
    /// The type, null if the declaration names none
    type: string | null;
}

/// A function of a catalog
export interface CatalogFunction {
    /// The database, empty if the declaration names none
    databaseName: string;
    /// The schema, empty if the declaration names none
    schemaName: string;
    /// The name of the function
    functionName: string;
    /// Is it an aggregate?
    isAggregate: boolean;
    /// The return type, null if the declaration names none
    returnType: string | null;
    /// The parameters in their order
    params: CatalogFunctionParam[];
}

/// The tables and the functions of a catalog file
export interface CatalogStructure {
    tables: CatalogTable[];
    functions: CatalogFunction[];
}

/// The text of an optional name of a descriptor, null if it is empty
function optionalText(value: string | Uint8Array | null | undefined): string | null {
    const text = value == null ? '' : String(value);
    return text.length === 0 ? null : text;
}

/// The functions of a catalog descriptor
export function catalogFunctionsOfDescriptor(descriptor: buffers.catalog.CatalogDescriptorT | null): CatalogFunction[] {
    return (descriptor?.functionDeclarations ?? []).map(declaration => ({
        databaseName: String(declaration.functionName?.databaseName ?? ''),
        schemaName: String(declaration.functionName?.schemaName ?? ''),
        functionName: String(declaration.functionName?.functionName ?? ''),
        isAggregate: declaration.isAggregate,
        returnType: optionalText(declaration.returnType),
        params: declaration.params.map(param => ({ name: optionalText(param.paramName), type: optionalText(param.paramType) })),
    }));
}

/// Parse the SQL of a catalog file into its tables and functions.
/// Throws if the core cannot read the file.
export function parseCatalogSql(core: DashQL, sql: string): CatalogStructure {
    const [script] = core.processBatch({ scripts: [{ id: 'catalog', text: sql, outputs: ['catalogDescriptor'] }] }).scripts;
    if (script == null || script.failure != null || script.catalogDescriptor == null) {
        throw new Error(`Cannot read a catalog: ${script?.failure ?? 'no descriptor'}`);
    }
    const error = script.diagnostics.find(diagnostic => diagnostic.severity === 'error');
    if (error != null) {
        throw new Error(`Cannot read a catalog: ${error.message}`);
    }
    const descriptor = buffers.catalog.CatalogDescriptor.getRootAsCatalogDescriptor(new flatbuffers.ByteBuffer(script.catalogDescriptor)).unpack();
    return { tables: catalogTablesOfDescriptor(descriptor), functions: catalogFunctionsOfDescriptor(descriptor) };
}

/// The qualified name of a function, the parts that it names
function qualifiedFunctionName(fn: CatalogFunction): string {
    return [fn.databaseName, fn.schemaName, fn.functionName].filter(part => part.length > 0).map(quoteIdentifier).join('.');
}

/// A CREATE FUNCTION or CREATE AGGREGATE statement of a function
export function generateCatalogFunctionSQL(fn: CatalogFunction): string {
    const params = fn.params.map(param => [param.name == null ? null : quoteIdentifier(param.name), param.type].filter(part => part != null).join(' '));
    const keyword = fn.isAggregate ? 'AGGREGATE' : 'FUNCTION';
    return `CREATE ${keyword} ${qualifiedFunctionName(fn)}(${params.join(', ')}) RETURNS ${fn.returnType ?? 'any'};`;
}

/// The functions file of a catalog
export function generateCatalogFunctionsSQL(functions: readonly CatalogFunction[]): string {
    return functions.map(generateCatalogFunctionSQL).join('\n');
}

/// The relations file of a catalog
export function generateCatalogRelationsSQL(tables: readonly CatalogTable[]): string {
    return generateCatalogTablesSQL([...tables]);
}
