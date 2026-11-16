import type * as connection from '@ankoh/dashql-jsonschema/connection.js';

// The catalogs that the catalog loader reads are decided by the Rust runtime (`catalog_loader/trino.rs`).

/// The fields of the Trino params that name catalogs
type TrinoCatalogParams = Pick<connection.TrinoConnectionParams, 'defaultCatalog' | 'defaultSchema' | 'catalogs' | 'catalogName' | 'schemaNames'>;

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
