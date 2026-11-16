// The catalog of a Salesforce connection is loaded by the catalog loader of the Rust runtime
// (`packages/dashql-core-runtime/src/catalog_loader/salesforce.rs`), these are the names it uses.

export const SALESFORCE_CATALOG_DATABASE = 'lakehouse';
/// The Hyper Cloud database of Database.com connections that don't name one
export const HYPER_CLOUD_DEFAULT_DATABASE_NAME = 'default';
