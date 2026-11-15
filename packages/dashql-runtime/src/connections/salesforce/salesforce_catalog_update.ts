import * as connection from '@ankoh/dashql-jsonschema/connection.js';

import type { AttachedDatabase } from '../hyper/hyperdb_grpc_client.js';

// The catalog of a Salesforce connection is loaded by the catalog loader of the Rust runtime
// (`packages/dashql-core-runtime/src/catalog_loader/salesforce.rs`), these are the names it uses.

export const SALESFORCE_CATALOG_DATABASE = 'lakehouse';
export const SALESFORCE_CATALOG_SCHEMA = 'public';
/// The Hyper Cloud database of Database.com connections that don't name one
export const HYPER_CLOUD_DEFAULT_DATABASE_NAME = 'default';

/// The Hyper Cloud database that Database.com connections attach as the catalog database
export function getHyperCloudAttachedDatabase(params: connection.SalesforceConnectionParams | undefined): AttachedDatabase {
    const databaseName = params?.databaseName || HYPER_CLOUD_DEFAULT_DATABASE_NAME;
    return { path: `hyper.cloud:${databaseName}`, alias: SALESFORCE_CATALOG_DATABASE };
}
