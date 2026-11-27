//! The settings of the runtime that a host chooses: timings, limits and the extensions of SQL that another product may
//! want different. The defaults are those of DashQL. What the workbook format or the protocol of a connector depends on is no setting, e.g.
//! the most files of a workbook, and neither are the waits of a busy state, which are details of the services.

use crate::catalog_loader::CATALOG_QUERY_READ_TIMEOUT_MS;
use crate::query::INTERNAL_QUERY_HISTORY_LIMIT;
use crate::visible_scripts::BACKGROUND_ANALYSIS_DELAY_MS;
use dashql_core::capabilities::Capabilities;

/// The heartbeat of the catalog loader by default
pub const CATALOG_HEARTBEAT_MS: f64 = 5000.0;

/// The settings of a runtime, `Host::settings`
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RuntimeSettings {
    /// The pause after the last change before the shown scripts that are not selected are analyzed, the derived view
    /// of the workbook moves and the stored results are looked up
    pub background_analysis_delay_ms: f64,
    /// How often the catalog loader looks at the connections without being asked
    pub catalog_heartbeat_ms: f64,
    /// The read timeout of the metadata queries of the catalog loader that have one
    pub catalog_query_timeout_ms: u32,
    /// The finished internal queries that the history of a connection keeps, e.g. the metadata queries
    pub internal_query_history_limit: usize,
    /// The extensions of SQL that the scripts of the connections may use, all of them by default
    pub capabilities: Capabilities,
}

impl Default for RuntimeSettings {
    fn default() -> Self {
        Self {
            background_analysis_delay_ms: BACKGROUND_ANALYSIS_DELAY_MS,
            catalog_heartbeat_ms: CATALOG_HEARTBEAT_MS,
            catalog_query_timeout_ms: CATALOG_QUERY_READ_TIMEOUT_MS,
            internal_query_history_limit: INTERNAL_QUERY_HISTORY_LIMIT,
            capabilities: Capabilities::ALL,
        }
    }
}
