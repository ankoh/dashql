//! Whether the catalog of a connection can be refreshed.

use super::{ConnectionHealth, ConnectionState};

/// Can the catalog of a connection be refreshed? It must be online, without a full refresh that runs.
pub fn can_refresh_connection(connection: &ConnectionState) -> bool {
    connection.health() == ConnectionHealth::Online && !connection.catalog_updates().is_refresh_running()
}
