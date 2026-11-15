//! The health check of a new channel: the probe query of the connector through the query executor of the host, so it
//! shows up in the query viewer like any other query. The check reports its start and its end as actions of the
//! connection.
//!
//! Ported from `performHealthCheck` of `packages/dashql-runtime/src/connections/health_check.ts`.

use std::rc::Rc;

use super::{cancellable, ProbeResult, SetupFailure, SetupHost};
use crate::connections::health_check::{health_check_metadata, health_check_outcome, health_check_query, HealthCheckResult};
use crate::connections::{ChannelId, ConnectionAction, ConnectorType};
use crate::http::CancellationToken;

/// Check the health of a channel of a connector. A failed probe fails the check with the error of the query, a probe
/// without a table fails it as well, a cancellation cancels it.
pub async fn check_health<H: SetupHost>(
    host: Rc<H>,
    connector: ConnectorType,
    channel: ChannelId,
    cancellation: CancellationToken,
) -> Result<(), SetupFailure> {
    host.dispatch(&ConnectionAction::HealthCheckStarted);
    let metadata = health_check_metadata();
    // A check that is cancelled before its probe doesn't run it
    let probe = if cancellation.is_cancelled() {
        None
    } else {
        let call = host.run_probe(channel, health_check_query(connector), &metadata, &cancellation);
        cancellable(&cancellation, call).await
    };
    let (result, value) = match probe {
        None => (HealthCheckResult::Finished { has_table: false }, None),
        Some(Ok(ProbeResult::Finished { has_table })) => (HealthCheckResult::Finished { has_table }, None),
        Some(Ok(ProbeResult::Failed(error))) => (HealthCheckResult::Failed(error), None),
        Some(Err(error)) => {
            let detailed = crate::connections::DetailedError::new(error.message());
            (HealthCheckResult::Failed(detailed), error.value().cloned())
        }
    };
    let action = health_check_outcome(result, cancellation.is_cancelled());
    host.dispatch(&action);
    match action {
        ConnectionAction::HealthCheckSucceeded => Ok(()),
        ConnectionAction::HealthCheckFailed(error) => {
            let mut failure = SetupFailure::failed(error.message).with_value(value);
            failure.data = error.data;
            Err(failure)
        }
        _ => Err(SetupFailure::cancelled()),
    }
}
