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
