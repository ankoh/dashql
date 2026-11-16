//! The tokens of a Salesforce login for a process that sends the requests of the connection for another one, the relay
//! of `dashql connect` (docs/wip/agent_session.md, "Logins go through the page"). The process that logged in keeps the
//! tokens. A run of another process sets the connection up with stand-ins: its token requests are answered with the
//! responses of `salesforce_stand_ins`, whose tokens authorize nothing, and the relay puts the auth of
//! `salesforce_relay_endpoints` into its requests.

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use super::types::{SalesforceConnectionParams, SalesforceTokens};
use crate::http::{Headers, Url};

/// The origin of a URL, none for no URL
fn origin_of(url: &str) -> Option<String> {
    Url::parse(url).ok().map(|url| url.origin())
}

/// The auth headers of the requests of a login by the origin of their endpoint: the core token for the instance of the
/// core login, the Data Cloud token with its audience (`tenant`, the headers of the channel) for the tenant
pub fn salesforce_relay_endpoints(tokens: &SalesforceTokens, tenant: &Headers) -> BTreeMap<String, Vec<(String, String)>> {
    let mut endpoints = BTreeMap::new();
    if let Some(origin) = tokens.core.instance_url.as_deref().and_then(origin_of) {
        endpoints.insert(origin, vec![("Authorization".to_string(), format!("Bearer {}", tokens.core.access_token))]);
    }
    if let Some(origin) = origin_of(&tokens.data_cloud.instance_url) {
        endpoints.insert(origin, tenant.iter().map(|(name, value)| (name.to_string(), value.to_string())).collect());
    }
    endpoints
}

/// Put the text fields that are some into a JSON object
fn insert_texts(object: &mut Map<String, Value>, fields: &[(&str, &Option<String>)]) {
    for (key, value) in fields {
        if let Some(value) = value {
            object.insert((*key).to_string(), Value::String(value.clone()));
        }
    }
}

/// The responses of the token requests of a login with the stand-in token, by the URL of the request: the exchange of
/// the code for the core token and the exchange of the core token for the Data Cloud token. The core token has no
/// refresh token, the Data Cloud token keeps the header and the claims of the real one with the stand-in as its
/// signature: the run reads the tenant, the data space and the expiry from it, and the token authorizes nothing.
pub fn salesforce_stand_ins(params: &SalesforceConnectionParams, tokens: &SalesforceTokens, stand_in: &str) -> BTreeMap<String, Value> {
    let core = &tokens.core;
    let mut core_response = Map::new();
    core_response.insert("access_token".to_string(), Value::String(stand_in.to_string()));
    insert_texts(
        &mut core_response,
        &[
            ("api_instance_url", &core.api_instance_url),
            ("id", &core.id),
            ("instance_url", &core.instance_url),
            ("issued_at", &core.issued_at),
            ("scope", &core.scope),
            ("token_type", &core.token_type),
        ],
    );

    let data_cloud = &tokens.data_cloud;
    let mut parts = data_cloud.jwt.raw.split('.');
    let header = parts.next().unwrap_or_default();
    let claims = parts.next().unwrap_or_default();
    let mut data_cloud_response = Map::new();
    data_cloud_response.insert("access_token".to_string(), Value::String(format!("{header}.{claims}.{stand_in}")));
    data_cloud_response.insert("instance_url".to_string(), Value::String(data_cloud.instance_url.clone()));
    insert_texts(
        &mut data_cloud_response,
        &[("token_type", &data_cloud.token_type), ("issued_token_type", &data_cloud.issued_token_type)],
    );

    let mut stand_ins = BTreeMap::new();
    stand_ins.insert(format!("{}/services/oauth2/token", params.instance_url), Value::Object(core_response));
    stand_ins.insert(
        format!("{}/services/a360/token", core.instance_url.as_deref().unwrap_or_default()),
        Value::Object(data_cloud_response),
    );
    stand_ins
}
