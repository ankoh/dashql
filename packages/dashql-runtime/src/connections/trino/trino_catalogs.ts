import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

// The catalogs that the catalog loader reads are decided by the Rust runtime (`catalog_loader/trino.rs`).

/// The fields of the Trino params that name catalogs
type TrinoCatalogParams = Pick<connection.TrinoConnectionParams, 'defaultCatalog' | 'defaultSchema' | 'catalogs' | 'catalogName' | 'schemaNames'>;

/// The catalog and schema of the names that statements leave out, sent as `X-Trino-Catalog` and `X-Trino-Schema`
export interface TrinoSessionDefaults {
    /// The default catalog, null if there is none
    catalog: string | null;
    /// The default schema, null if there is none. Trino takes a default schema only with a default catalog.
    schema: string | null;
}

/// A catalog entry `catalog` or `catalog.schema`, split at the first dot. Null if the entry names no catalog.
export function parseTrinoCatalogEntry(entry: string): { catalog: string; schema: string | null } | null {
    const dot = entry.indexOf('.');
    const catalog = (dot < 0 ? entry : entry.substring(0, dot)).trim();
    const schema = dot < 0 ? '' : entry.substring(dot + 1).trim();
    return catalog.length === 0 ? null : { catalog, schema: schema.length === 0 ? null : schema };
}

/// The params with the fields that replaced `catalogName` and `schemaNames`.
/// The catalog name was the default catalog, the schema names were the schemas of it that the catalog loader reads.
export function withTrinoCatalogFields<P extends TrinoCatalogParams>(params: P): Omit<P, 'catalogName' | 'schemaNames'> {
    const { catalogName, schemaNames, ...rest } = params;
    const catalog = catalogName ?? '';
    return {
        ...rest,
        defaultCatalog: rest.defaultCatalog ?? catalog,
        catalogs: rest.catalogs ?? (catalog.length === 0 ? [] : (schemaNames ?? []).map(schema => `${catalog}.${schema}`)),
    };
}

/// The default catalog and schema of the params
export function trinoSessionDefaults(params: TrinoCatalogParams): TrinoSessionDefaults {
    const fields = withTrinoCatalogFields(params);
    const catalog = fields.defaultCatalog?.trim() ?? '';
    const schema = fields.defaultSchema?.trim() ?? '';
    return catalog.length === 0
        ? { catalog: null, schema: null }
        : { catalog, schema: schema.length === 0 ? null : schema };
}
