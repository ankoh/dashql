import type * as connection from '@ankoh/dashql-jsonschema/connection.js';
import type { InformationSchemaScope } from '../catalog/catalog_query_information_schema.js';

/// The fields of the Trino params that name catalogs
type TrinoCatalogParams = Pick<connection.TrinoConnectionParams, 'catalogs' | 'catalogName' | 'schemaNames'>;

/// A catalog entry `catalog` or `catalog.schema`, split at the first dot. Null if the entry names no catalog.
export function parseTrinoCatalogEntry(entry: string): { catalog: string; schema: string | null } | null {
    const dot = entry.indexOf('.');
    const catalog = (dot < 0 ? entry : entry.substring(0, dot)).trim();
    const schema = dot < 0 ? '' : entry.substring(dot + 1).trim();
    return catalog.length === 0 ? null : { catalog, schema: schema.length === 0 ? null : schema };
}

/// The catalog entries of the params.
/// Params that predate the entries name one catalog and schemas of it, they read as one entry per schema.
export function trinoCatalogEntries(params: TrinoCatalogParams): string[] {
    if (params.catalogs != null) {
        return params.catalogs;
    }
    const catalog = params.catalogName ?? '';
    if (catalog.length === 0) {
        return [];
    }
    const schemas = params.schemaNames ?? [];
    return schemas.length === 0 ? [catalog] : schemas.map(schema => `${catalog}.${schema}`);
}

/// The catalogs that the catalog loader reads, in the order of their first entry.
/// An entry without a schema reads all schemas of its catalog.
export function trinoCatalogScopes(params: TrinoCatalogParams): InformationSchemaScope[] {
    const scopes = new Map<string, { schemas: Set<string>; all: boolean }>();
    for (const entry of trinoCatalogEntries(params)) {
        const parsed = parseTrinoCatalogEntry(entry);
        if (parsed == null) {
            continue;
        }
        let scope = scopes.get(parsed.catalog);
        if (scope == null) {
            scope = { schemas: new Set(), all: false };
            scopes.set(parsed.catalog, scope);
        }
        if (parsed.schema == null) {
            scope.all = true;
        } else {
            scope.schemas.add(parsed.schema);
        }
    }
    return [...scopes].map(([catalog, scope]) => ({ catalog, schemas: scope.all ? [] : [...scope.schemas] }));
}

