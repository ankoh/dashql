//! The health check of a new channel: the probe query of the connector through the query executor of the host, so it
//! shows up in the query viewer like any other query. The check reports its start and its end as actions of the
//! connection.

use std::rc::Rc;

use super::{cancellable, ProbeResult, SetupFailure, SetupHost};
use crate::connections::{ConnectionAction, ConnectorType, DetailedError};
use crate::http::CancellationToken;
use crate::query::{QueryMetadata, QueryType};

/// The message of a check whose query returned no table
pub const HEALTH_CHECK_FAILED_MESSAGE: &str = "health check failed";

/// The metadata of the probe query
pub fn health_check_metadata() -> QueryMetadata {
    QueryMetadata {
        title: Some("Health Check".to_string()),
        issuer: Some("Connection Setup".to_string()),
        user_provided: false,
        ..QueryMetadata::new(QueryType::HealthCheck)
    }
}

/// Check the health of the channel of a connection of a connector. A failed probe fails the check with the error of the
/// query, a probe without a table fails it as well, a cancellation cancels it whatever the probe did.
pub async fn check_health<H: SetupHost>(
    host: Rc<H>,
    connector: ConnectorType,
    cancellation: CancellationToken,
) -> Result<(), SetupFailure> {
    host.dispatch(&ConnectionAction::HealthCheckStarted);
    let metadata = health_check_metadata();
    // A check that is cancelled before its probe doesn't run it
    let probe = if cancellation.is_cancelled() {
        None
    } else {
        let call = host.run_probe(connector.connector().health_probe(), &metadata, &cancellation);
        cancellable(&cancellation, call).await
    };
    if cancellation.is_cancelled() {
        host.dispatch(&ConnectionAction::HealthCheckCancelled);
        return Err(SetupFailure::cancelled());
    }
    let (error, value) = match probe {
        Some(Ok(ProbeResult::Finished { has_table: true })) => {
            host.dispatch(&ConnectionAction::HealthCheckSucceeded);
            return Ok(());
        }
        None | Some(Ok(ProbeResult::Finished { has_table: false })) => (DetailedError::new(HEALTH_CHECK_FAILED_MESSAGE), None),
        Some(Ok(ProbeResult::Failed(error))) => (error, None),
        Some(Err(error)) => (DetailedError::new(error.message()), error.value().cloned()),
    };
    host.dispatch(&ConnectionAction::HealthCheckFailed(error.clone()));
    let mut failure = SetupFailure::failed(error.message).with_value(value);
    failure.data = error.data;
    Err(failure)
}
