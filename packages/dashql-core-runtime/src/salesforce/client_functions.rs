//! The Data 360 API on Salesforce connections, see `extensions/d360-api/clfn/docs/overview.md`: the extension of the
//! spec, the variables of its base paths and the hosts with their tokens.
//!
//! The sources conflict on `connect`. It takes the core host and token, as the metadata calls of the connection do,
//! until a check on an org settles it.
//!
//! Ported from `connections/salesforce/salesforce_client_functions.ts` of `packages/dashql-runtime`.

use crate::clfn::request::{ClientFunctionHostTarget, ClientFunctionVariables};
use crate::clfn::time::parse_iso_ms;
use crate::http::Url;
use crate::clfn::ClientFunctionError;

use super::types::SalesforceTokens;

/// The folder of the extension in `extensions/`
pub const DATA_360_EXTENSION: &str = "d360-api";
/// The API version of the Data 360 spec
pub const DATA_360_API_VERSION: &str = "68.0";

/// The values of the variables in the base paths of the spec. They need no login, `EXPLAIN` prints them.
pub fn salesforce_client_function_variables() -> ClientFunctionVariables {
    ClientFunctionVariables::from([("api_version".to_string(), DATA_360_API_VERSION.to_string())])
}

/// The host and the token of a request
fn target(instance_url: Option<&str>, token: Option<&str>, host: &str) -> Result<ClientFunctionHostTarget, ClientFunctionError> {
    let (Some(instance_url), Some(token)) = (instance_url.filter(|u| !u.is_empty()), token.filter(|t| !t.is_empty())) else {
        return Err(ClientFunctionError::new(format!("the Salesforce connection has no URL or token for the host {host}")));
    };
    Ok(ClientFunctionHostTarget {
        base_url: Url::parse(instance_url).map_err(|e| ClientFunctionError::new(e.to_string()))?,
        headers: vec![
            ("Authorization".to_string(), format!("Bearer {token}")),
            ("Accept".to_string(), "application/json".to_string()),
        ],
    })
}

/// Where a host of the spec is on a connection, with its token. A connection without a channel has no tokens.
pub fn resolve_salesforce_client_function_host(
    tokens: Option<&SalesforceTokens>,
    host: &str,
    now: f64,
) -> Result<ClientFunctionHostTarget, ClientFunctionError> {
    let Some(SalesforceTokens { core, data_cloud }) = tokens else {
        return Err(ClientFunctionError::new("Salesforce channel is not set up"));
    };
    match host {
        "core" | "connect" => target(core.instance_url.as_deref(), Some(&core.access_token), host),
        "tenant" => {
            // The service would only answer with a 401
            if parse_iso_ms(&data_cloud.expires_at).is_some_and(|expires_at| expires_at as f64 <= now) {
                return Err(ClientFunctionError::new(
                    "the Data 360 token of the Salesforce connection has expired, connect again",
                ));
            }
            target(Some(&data_cloud.instance_url), Some(&data_cloud.jwt.raw), host)
        }
        _ => Err(ClientFunctionError::new(format!("Salesforce connections have no host {host}"))),
    }
}
