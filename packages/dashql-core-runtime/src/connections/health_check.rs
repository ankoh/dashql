//! The health check of a connection: a probe query through the query executor, so it shows up in the query viewer
//! like any other query. The host runs the query on the channel that the setup holds and reports how it ended, the
//! check returns the action of the connection.

use super::{ConnectionAction, ConnectorType, DetailedError};
use crate::query::{QueryMetadata, QueryType};

/// The message of a check whose query returned no table
pub const HEALTH_CHECK_FAILED_MESSAGE: &str = "health check failed";
/// The message of the error of a cancelled check
pub const HEALTH_CHECK_CANCELLED_MESSAGE: &str = "health check cancelled";

/// The probe query of a connector
pub fn health_check_query(connector: ConnectorType) -> &'static str {
    match connector {
        ConnectorType::Trino => "select 1",
        ConnectorType::Hyper | ConnectorType::SalesforceDataCloud | ConnectorType::Dbcom => "select 1 as healthy",
    }
}

/// The metadata of the probe query
pub fn health_check_metadata() -> QueryMetadata {
    QueryMetadata {
        title: Some("Health Check".to_string()),
        issuer: Some("Connection Setup".to_string()),
        user_provided: false,
        ..QueryMetadata::new(QueryType::HealthCheck)
    }
}

/// How the probe query ended
#[derive(Debug, Clone, PartialEq)]
pub enum HealthCheckResult {
    /// The query returned a table, or none
    Finished { has_table: bool },
    /// The query failed with an error, e.g. the status of a rejected login
    Failed(DetailedError),
}

/// The action of the connection after the probe query. An aborted check is cancelled whatever the query did, a query
/// without table fails the check.
pub fn health_check_outcome(result: HealthCheckResult, aborted: bool) -> ConnectionAction {
    if aborted {
        return ConnectionAction::HealthCheckCancelled;
    }
    match result {
        HealthCheckResult::Finished { has_table: true } => ConnectionAction::HealthCheckSucceeded,
        HealthCheckResult::Finished { has_table: false } => {
            ConnectionAction::HealthCheckFailed(DetailedError::new(HEALTH_CHECK_FAILED_MESSAGE))
        }
        HealthCheckResult::Failed(error) => ConnectionAction::HealthCheckFailed(error),
    }
}
