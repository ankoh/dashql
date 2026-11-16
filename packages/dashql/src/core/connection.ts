/// The views of the connections of the runtime, declared by the module (`packages/dashql-core-wasm/src/connection/view.rs`):
/// a connection is a slice `connection` of the `Runtime`, the list of the connections the slice `connectionList`. The
/// actions of a connection are the ones of the runtime (`RuntimeAction`), see docs/wip/runtime_api.md.
export type {
    ConnectionCatalogUpdates,
    ConnectionCatalogUpdateTask,
    ConnectionConnectorDetails,
    ConnectionDetailsView,
    ConnectionError,
    ConnectionListEntry,
    ConnectionListView,
    ConnectionNameDefaults,
    ConnectionRelationName,
    ConnectionSalesforceOAuthParams,
    ConnectionSalesforceOAuthState,
    ConnectionSaveView,
    ConnectionSecrets,
    ConnectionTableName,
    ConnectionTokenSummary,
    ConnectionTrinoOAuthState,
    ConnectionView,
    JsonParams,
} from '@ankoh/dashql-wasm/dashql_core.js';
/// The views of the saves of connections (`packages/dashql-core-wasm/src/connection_persistence/view.rs`)
export type { ConnectionCopyOutcome, ConnectionSaveOutcome } from '@ankoh/dashql-wasm/dashql_core.js';
/// The connector, the status, the health and the catalog updates of a connection, numeric enums of the module
export { CatalogUpdateTaskStatus, CatalogUpdateVariant, ConnectionHealth, ConnectionStatus, ConnectorType } from '@ankoh/dashql-wasm/dashql_core.js';
