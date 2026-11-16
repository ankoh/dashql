//! The REST APIs of Salesforce that a connection uses: the OAuth token of the core login, its user info, the exchange
//! for the Data Cloud token and the metadata of a data space. Each call is a function that builds the request and one
//! that reads the response, the host sends the request.
//!
//! Ported from `connections/salesforce/salesforce_api_client.ts` of `packages/dashql/src/runtime`.

use std::collections::BTreeMap;
use std::fmt;

use base64::engine::general_purpose::URL_SAFE_NO_PAD_INDIFFERENT;
use base64::Engine;
use serde_json::Value;

use super::types::*;
use crate::http::{Headers, HttpMethod, HttpRequest, HttpResponse};
use crate::clfn::json::{js_number, js_string, js_truthy, to_json_text};
use crate::http::url::form_encode;
use crate::clfn::time::iso_timestamp;
use crate::http::Url;

/// The API version of the metadata
pub const SALESFORCE_API_VERSION: &str = "v64.0";
/// The data space of a token without one
pub const DEFAULT_SALESFORCE_DATA_SPACE: &str = "default";
/// The entities that the metadata of a data space has, one request each
pub const SALESFORCE_METADATA_ENTITY_TYPES: [&str; 3] = ["DataModelObject", "DataLakeObject", "CalculatedInsight"];
/// The largest instant that JavaScript dates hold
const MAX_DATE_MS: f64 = 8.64e15;

/// What the host logs about a failed call: credentials and identities of the response are redacted
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SalesforceDiagnostics {
    /// The message of the log entry
    pub message: String,
    /// The endpoint
    pub endpoint: Option<String>,
    /// The status of the response
    pub status: Option<u16>,
    /// The response, redacted
    pub oauth_response: String,
}

/// A call to Salesforce that failed
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SalesforceError {
    /// The message
    pub message: String,
    /// What to log
    pub diagnostics: Option<SalesforceDiagnostics>,
}

impl SalesforceError {
    /// An error without anything to log
    pub fn new(message: impl Into<String>) -> Self {
        Self { message: message.into(), diagnostics: None }
    }
}

impl fmt::Display for SalesforceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for SalesforceError {}

/// The auth infos of a Data Cloud connection
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SalesforceAuthInfo {
    /// The core tenant id
    pub core_tenant_id: Option<String>,
    /// The core access token
    pub core_access_token: Option<String>,
    /// The offcore JWT
    pub offcore_raw_jwt: String,
    /// The offcore instance URL
    pub offcore_instance_url: Option<String>,
    /// The offcore tenant id
    pub offcore_tenant_id: Option<String>,
    /// The data space
    pub dataspace: String,
}

/// The data space of a Data Cloud token: the nested attribute, the flat one of older tokens, or the default
pub fn get_salesforce_data_space(access: &SalesforceDataCloudAccessToken) -> String {
    let Some(attributes) = access.jwt.payload.get("customAttributes").and_then(Value::as_object) else {
        return DEFAULT_SALESFORCE_DATA_SPACE.to_string();
    };
    let data_space = match attributes.get("data") {
        Some(nested @ (Value::Object(_) | Value::Array(_))) => nested.get("dataspace"),
        _ => attributes.get("dataspace"),
    };
    match data_space {
        Some(Value::String(space)) if !space.is_empty() => space.clone(),
        _ => DEFAULT_SALESFORCE_DATA_SPACE.to_string(),
    }
}

/// The URL of a Data Cloud instance: an HTTPS origin, `https://` is added if the endpoint has no scheme
pub fn get_salesforce_data_cloud_url(endpoint: Option<&str>) -> Result<String, SalesforceError> {
    let value = endpoint.map(str::trim).filter(|e| !e.is_empty());
    let Some(value) = value else {
        return Err(SalesforceError::new("Data Cloud Instance URL cannot be empty"));
    };
    let has_scheme = value.split_once("://").is_some_and(|(scheme, _)| {
        let mut chars = scheme.chars();
        chars.next().is_some_and(|c| c.is_ascii_alphabetic())
            && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'))
    });
    let normalized = if has_scheme { value.to_string() } else { format!("https://{value}") };
    let invalid = || SalesforceError::new("Data Cloud Instance URL must be an HTTPS origin without credentials, path, query, or fragment");
    let url = Url::parse(&normalized).map_err(|e| SalesforceError::new(e.to_string()))?;
    let authority = normalized.get(..8).filter(|p| p.eq_ignore_ascii_case("https://")).and_then(|_| normalized.get(8..));
    let authority = authority.map(|a| a.strip_suffix('/').unwrap_or(a));
    let plain = authority.is_some_and(|a| !a.is_empty() && !a.contains(|c: char| matches!(c, '/' | '\\' | '@' | '?' | '#') || c.is_whitespace()));
    if !plain || url.scheme() != "https" || url.has_credentials() || url.query().is_some() || url.fragment().is_some() || url.path() != "/" {
        return Err(invalid());
    }
    Ok(url.to_string())
}

/// The auth infos of the tokens, none without a JWT
pub fn collect_salesforce_auth_info(core: &SalesforceCoreAccessToken, offcore: &SalesforceDataCloudAccessToken) -> Option<SalesforceAuthInfo> {
    if offcore.jwt.raw.is_empty() {
        return None;
    }
    let tenant = offcore.jwt.payload.get("audienceTenantId").and_then(Value::as_str).map(str::to_string);
    Some(SalesforceAuthInfo {
        offcore_raw_jwt: offcore.jwt.raw.clone(),
        offcore_instance_url: Some(offcore.instance_url.clone()).filter(|u| !u.is_empty()),
        offcore_tenant_id: tenant.clone(),
        core_tenant_id: tenant,
        core_access_token: Some(core.access_token.clone()).filter(|t| !t.is_empty()),
        dataspace: get_salesforce_data_space(offcore),
    })
}

/// Should a key of a response be redacted? Credentials and identities at every level, not the routing context.
fn is_secret_key(key: &str) -> bool {
    let normalized: String = key.chars().filter(|c| *c != '-' && *c != '_').collect::<String>().to_lowercase();
    let secret_word = ["token", "secret", "password", "signature", "assertion", "authorization", "email", "username"]
        .iter()
        .any(|word| normalized.contains(word));
    let identity = [
        "id", "sub", "jti", "clientid", "userid", "orgid", "sfuid", "sfoid", "sfappid", "tnk", "sfi", "sfapop", "code",
        "codeverifier", "name", "givenname", "familyname", "preferredusername",
    ]
    .contains(&normalized.as_str());
    (secret_word && normalized != "tokentype" && normalized != "tokenformat") || identity
}

/// Redact a value for a log
fn redact(value: &Value) -> Value {
    match value {
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(k, v)| (k.clone(), if is_secret_key(k) { Value::String("<redacted>".into()) } else { redact(v) }))
                .collect(),
        ),
        Value::Array(items) => Value::Array(items.iter().map(redact).collect()),
        _ => value.clone(),
    }
}

/// A response for a log, with credentials and identities redacted
pub fn redact_token_diagnostics(value: &Value) -> String {
    to_json_text(&redact(value))
}

/// A string field of a response
fn text_field(obj: &Value, key: &str) -> Option<String> {
    obj.get(key).and_then(Value::as_str).map(str::to_string)
}

/// Read the token of the core login. Core credentials may be opaque, only the exchanged Data Cloud token is decoded.
pub fn parse_core_access_token(obj: &Value, now: f64) -> Result<SalesforceCoreAccessToken, SalesforceError> {
    let access_token = match obj.get("access_token") {
        Some(Value::String(token)) if !token.is_empty() => token.clone(),
        _ => {
            return Err(SalesforceError {
                message: "Salesforce OAuth response is missing access_token".to_string(),
                diagnostics: Some(SalesforceDiagnostics {
                    message: "Rejected Salesforce OAuth token response".to_string(),
                    endpoint: None,
                    status: None,
                    oauth_response: redact_token_diagnostics(obj),
                }),
            })
        }
    };
    Ok(SalesforceCoreAccessToken {
        created_at: iso_timestamp(now as i64),
        access_token,
        api_instance_url: text_field(obj, "api_instance_url"),
        id: text_field(obj, "id"),
        id_token: text_field(obj, "id_token"),
        instance_url: text_field(obj, "instance_url"),
        issued_at: text_field(obj, "issued_at"),
        refresh_token: text_field(obj, "refresh_token"),
        scope: text_field(obj, "scope"),
        signature: text_field(obj, "signature"),
        token_type: text_field(obj, "token_type"),
    })
}

/// Read the user info of the core login
pub fn parse_core_user_info(obj: &Value) -> SalesforceCoreUserInfo {
    let text = |key: &str| text_field(obj, key);
    let flag = |key: &str| obj.get(key).and_then(Value::as_bool);
    SalesforceCoreUserInfo {
        active: flag("active"),
        email: text("email"),
        email_verified: flag("email_verified"),
        family_name: text("family_name"),
        given_name: text("given_name"),
        is_app_installed: flag("is_app_installed"),
        is_salesforce_integration_user: flag("is_salesforce_integration_user"),
        language: text("language"),
        locale: text("locale"),
        name: text("name"),
        nickname: text("nickname"),
        organization_id: text("organization_id"),
        photos: obj.get("photos").filter(|p| !p.is_null()).cloned(),
        picture: text("picture"),
        preferred_username: text("preferred_username"),
        profile: text("profile"),
        sub: text("sub"),
        updated_at: text("updated_at"),
        user_id: text("user_id"),
        user_type: text("user_type"),
        utc_offset: obj.get("utcOffset").and_then(Value::as_i64),
        zoneinfo: text("zoneinfo"),
    }
}

/// A POST of a token request with a form body that accepts JSON. Its body and its response carry credentials.
pub(crate) fn form_post(url: String, pairs: &[(&str, &str)]) -> HttpRequest {
    HttpRequest {
        method: HttpMethod::Post,
        url,
        headers: Headers::from_pairs([("Accept", "application/json"), ("Content-Type", "application/x-www-form-urlencoded")]),
        body: Some(form_encode(pairs.iter().copied())),
        sensitive: true,
    }
}

/// The request that exchanges the code of the authorization for the token of the core login, with the PKCE verifier
pub fn core_access_token_request(
    config: &SalesforceOAuthConfig,
    params: &SalesforceConnectionParams,
    auth_code: &str,
    pkce_verifier: &str,
) -> HttpRequest {
    let mut pairs = vec![
        ("grant_type", "authorization_code"),
        ("code", auth_code),
        ("redirect_uri", config.oauth_redirect.as_str()),
        ("client_id", params.app_consumer_key.as_str()),
        ("code_verifier", pkce_verifier),
        ("format", "json"),
    ];
    if !params.app_consumer_secret.is_empty() {
        pairs.push(("client_secret", params.app_consumer_secret.as_str()));
    }
    form_post(format!("{}/services/oauth2/token", params.instance_url), &pairs)
}

/// The JSON of a response, an error if it isn't JSON
fn response_json(response: &HttpResponse) -> Result<Value, SalesforceError> {
    serde_json::from_slice(&response.body).map_err(|e| SalesforceError::new(format!("invalid JSON response: {e}")))
}

/// The message of a failed OAuth response, none if it succeeded
fn oauth_failure(response: &HttpResponse, body: &Value, fallback: &str) -> Option<String> {
    if response.ok() && !js_truthy(body.get("error")) {
        return None;
    }
    let field = |key: &str| body.get(key).filter(|v| !v.is_null()).map(js_string);
    Some(field("error_description").or_else(|| field("error")).unwrap_or_else(|| format!("{fallback}: {}", response.status)))
}

/// Read the response of the core token request
pub fn read_core_access_token_response(request: &HttpRequest, response: &HttpResponse, now: f64) -> Result<SalesforceCoreAccessToken, SalesforceError> {
    let body = response_json(response)?;
    if let Some(message) = oauth_failure(response, &body, "OAuth token request failed") {
        return Err(SalesforceError {
            diagnostics: Some(SalesforceDiagnostics {
                message: message.clone(),
                endpoint: Some(request.url.clone()),
                status: Some(response.status),
                oauth_response: redact_token_diagnostics(&body),
            }),
            message,
        });
    }
    parse_core_access_token(&body, now)
}

/// The request that exchanges the core token for a Data Cloud token
pub fn data_cloud_access_token_request(access: &SalesforceCoreAccessToken) -> HttpRequest {
    form_post(
        format!("{}/services/a360/token", access.instance_url.as_deref().unwrap_or("")),
        &[
            ("grant_type", "urn:salesforce:grant-type:external:cdp"),
            ("subject_token", access.access_token.as_str()),
            ("subject_token_type", "urn:ietf:params:oauth:token-type:access_token"),
        ],
    )
}

/// Decode a part of a JWT to a JSON object
fn decode_jwt_part(part: &str) -> Result<Value, SalesforceError> {
    let invalid = || SalesforceError::new("invalid Data Cloud JWT");
    let bytes = URL_SAFE_NO_PAD_INDIFFERENT.decode(part).map_err(|_| invalid())?;
    let value: Value = serde_json::from_str(&String::from_utf8_lossy(&bytes)).map_err(|_| invalid())?;
    if !value.is_object() {
        return Err(invalid());
    }
    Ok(value)
}

/// Read the Data Cloud token of an exchange
fn read_data_cloud_access_token(obj: &Value, now: f64) -> Result<SalesforceDataCloudAccessToken, SalesforceError> {
    let raw = match obj.get("access_token") {
        Some(Value::String(token)) if !token.is_empty() => token.clone(),
        _ => return Err(SalesforceError::new("missing access_token")),
    };
    if !js_truthy(obj.get("instance_url")) {
        return Err(SalesforceError::new("missing instance_url"));
    }
    let parts: Vec<&str> = raw.split('.').collect();
    let [header, payload, _] = parts.as_slice() else {
        return Err(SalesforceError::new(format!("invalid jwt, expected 3 parts, received {}", parts.len())));
    };
    let header = decode_jwt_part(header)?;
    let mut payload = decode_jwt_part(payload)?;
    let exp = payload.get("exp").filter(|e| !e.is_null()).map_or(f64::NAN, js_number) * 1000.0;
    if !exp.is_finite() || exp.abs() > MAX_DATE_MS {
        return Err(SalesforceError::new("invalid Data Cloud JWT expiration"));
    }
    // Older tokens spell the custom attributes in snake case
    if let Some(fields) = payload.as_object_mut() {
        let attributes = fields.get("customAttributes").filter(|v| !v.is_null()).or_else(|| fields.get("custom_attributes")).cloned();
        if let Some(attributes) = attributes.filter(|v| !v.is_null()) {
            fields.insert("customAttributes".to_string(), attributes);
        }
    }
    let instance_url = obj.get("instance_url").and_then(Value::as_str);
    Ok(SalesforceDataCloudAccessToken {
        created_at: iso_timestamp(now as i64),
        token_type: text_field(obj, "token_type"),
        issued_token_type: text_field(obj, "issued_token_type"),
        expires_at: iso_timestamp(exp.trunc() as i64),
        jwt: SalesforceDataCloudJwt { raw, header, payload },
        instance_url: get_salesforce_data_cloud_url(instance_url)?,
    })
}

/// Read the response of the Data Cloud token exchange
pub fn read_data_cloud_access_token_response(request: &HttpRequest, response: &HttpResponse, now: f64) -> Result<SalesforceDataCloudAccessToken, SalesforceError> {
    let body = response_json(response)?;
    if let Some(message) = oauth_failure(response, &body, "Data Cloud token request failed") {
        return Err(SalesforceError {
            message,
            diagnostics: Some(SalesforceDiagnostics {
                message: "Data Cloud token request failed".to_string(),
                endpoint: Some(request.url.clone()),
                status: Some(response.status),
                oauth_response: redact_token_diagnostics(&body),
            }),
        });
    }
    read_data_cloud_access_token(&body, now).map_err(|error| SalesforceError {
        diagnostics: Some(SalesforceDiagnostics {
            message: "Rejected Data Cloud token response".to_string(),
            endpoint: None,
            status: None,
            oauth_response: redact_token_diagnostics(&body),
        }),
        ..error
    })
}

/// The headers of a call with the core token
fn core_headers(access: &SalesforceCoreAccessToken) -> Headers {
    Headers::from_pairs([("authorization", format!("Bearer {}", access.access_token).as_str()), ("accept", "application/json")])
}

/// The request of the user info of the core login, the token goes in the bearer header only
pub fn core_user_info_request(access: &SalesforceCoreAccessToken) -> HttpRequest {
    HttpRequest {
        method: HttpMethod::Get,
        url: format!("{}/services/oauth2/userinfo?format=json", access.instance_url.as_deref().unwrap_or("")),
        headers: core_headers(access),
        body: None,
        sensitive: true,
    }
}

/// Read the user info of the core login
pub fn read_core_user_info_response(response: &HttpResponse) -> Result<SalesforceCoreUserInfo, SalesforceError> {
    Ok(parse_core_user_info(&response_json(response)?))
}

/// How far the request of a metadata collection got
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SalesforceMetadataState {
    Requesting,
    Complete,
    Failed,
}

/// The progress of a metadata collection
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SalesforceMetadataProgress {
    pub collection: String,
    pub page: u32,
    pub loaded: usize,
    pub total: Option<usize>,
    pub state: SalesforceMetadataState,
    pub error: Option<String>,
}

impl SalesforceMetadataProgress {
    fn new(collection: &str, state: SalesforceMetadataState, loaded: Option<usize>, error: Option<String>) -> Self {
        Self { collection: collection.to_string(), page: 1, loaded: loaded.unwrap_or(0), total: loaded, state, error }
    }
}

/// The progress of the metadata requests in one line, such as `Metadata: 1 done, 1 active, 1 failed | DMO 120 | ...`
pub fn format_salesforce_metadata_progress(progress: &BTreeMap<String, SalesforceMetadataProgress>) -> String {
    let (mut completed, mut running, mut failed, mut pending) = (0, 0, 0, 0);
    let mut stages = Vec::new();
    for collection in SALESFORCE_METADATA_ENTITY_TYPES {
        let label = match collection {
            "DataModelObject" => "DMO",
            "DataLakeObject" => "DLO",
            _ => "CI",
        };
        match progress.get(collection).map(|p| (p.state, p.loaded)) {
            Some((SalesforceMetadataState::Complete, loaded)) => {
                completed += 1;
                stages.push(format!("{label} {loaded}"));
            }
            Some((SalesforceMetadataState::Failed, _)) => {
                failed += 1;
                stages.push(format!("{label} failed"));
            }
            Some((SalesforceMetadataState::Requesting, _)) => {
                running += 1;
                stages.push(format!("{label} -"));
            }
            None => {
                pending += 1;
                stages.push(format!("{label} -"));
            }
        }
    }
    let mut counts = vec![format!("{completed} done"), format!("{running} active"), format!("{failed} failed")];
    if pending > 0 {
        counts.push(format!("{pending} pending"));
    }
    format!("Metadata: {} | {}", counts.join(", "), stages.join(" | "))
}

/// A text field of a metadata entity, empty if absent
fn entity_text(obj: &Value, key: &str) -> String {
    obj.get(key).filter(|v| !v.is_null()).map(js_string).unwrap_or_default()
}

/// Read an entity of the metadata
fn read_entity(entity: &Value) -> SalesforceDataCloudMetadataEntity {
    let list = |key: &str| entity.get(key).and_then(Value::as_array).cloned().unwrap_or_default();
    SalesforceDataCloudMetadataEntity {
        name: entity_text(entity, "name"),
        display_name: entity_text(entity, "displayName"),
        category: entity_text(entity, "category"),
        fields: list("fields")
            .iter()
            .map(|f| SalesforceDataCloudMetadataEntityField {
                name: entity_text(f, "name"),
                display_name: entity_text(f, "displayName"),
                field_type: entity_text(f, "type"),
                business_type: entity_text(f, "businessType"),
            })
            .collect(),
        primary_keys: list("primaryKeys")
            .iter()
            .map(|k| SalesforceDataCloudMetadataPrimaryKey {
                index_order: entity_text(k, "indexOrder"),
                name: entity_text(k, "name"),
                display_name: entity_text(k, "displayName"),
            })
            .collect(),
    }
}

/// A failed metadata request, for the log of the host
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SalesforceMetadataFailure {
    pub data_space: String,
    pub entity_type: String,
    pub error: String,
}

/// The metadata of a data space: one request per entity type, all sent at once. The host sends the requests, hands
/// each response or failure back as it arrives and reports the progress, then reads the metadata of the entities that
/// arrived. It fails only if every request failed.
#[derive(Debug, Clone)]
pub struct SalesforceMetadataLoad {
    data_space: String,
    requests: Vec<HttpRequest>,
    results: Vec<Option<Result<Vec<Value>, String>>>,
}

impl SalesforceMetadataLoad {
    /// The requests of the metadata, with the progress that they started
    pub fn new(access: &SalesforceCoreAccessToken, data_space: &str) -> (Self, Vec<SalesforceMetadataProgress>) {
        let base = access.instance_url.as_deref().unwrap_or("").trim_end_matches('/');
        let endpoint = format!("{base}/services/data/{SALESFORCE_API_VERSION}/ssot/metadata");
        let requests = SALESFORCE_METADATA_ENTITY_TYPES
            .iter()
            .map(|entity_type| HttpRequest {
                method: HttpMethod::Get,
                url: format!("{endpoint}?{}", form_encode([("dataspace", data_space), ("entityType", entity_type)])),
                headers: core_headers(access),
                body: None,
                sensitive: false,
            })
            .collect();
        let progress = SALESFORCE_METADATA_ENTITY_TYPES
            .iter()
            .map(|c| SalesforceMetadataProgress::new(c, SalesforceMetadataState::Requesting, None, None))
            .collect();
        let load = Self { data_space: data_space.to_string(), requests, results: vec![None; SALESFORCE_METADATA_ENTITY_TYPES.len()] };
        (load, progress)
    }

    /// The requests, one per entity type in the order of `SALESFORCE_METADATA_ENTITY_TYPES`
    pub fn requests(&self) -> &[HttpRequest] {
        &self.requests
    }

    /// A request failed before it got a response
    pub fn on_failure(&mut self, index: usize, error: &str) -> Option<(SalesforceMetadataProgress, SalesforceMetadataFailure)> {
        let entity_type = *SALESFORCE_METADATA_ENTITY_TYPES.get(index)?;
        *self.results.get_mut(index)? = Some(Err(error.to_string()));
        Some((
            SalesforceMetadataProgress::new(entity_type, SalesforceMetadataState::Failed, None, Some(error.to_string())),
            SalesforceMetadataFailure { data_space: self.data_space.clone(), entity_type: entity_type.to_string(), error: error.to_string() },
        ))
    }

    /// The response of a request: the progress, and the failure to log if it failed
    pub fn on_response(
        &mut self,
        index: usize,
        response: &HttpResponse,
    ) -> Option<(SalesforceMetadataProgress, Option<SalesforceMetadataFailure>)> {
        let entity_type = *SALESFORCE_METADATA_ENTITY_TYPES.get(index)?;
        let entities = if response.ok() {
            response_json(response)
                .map(|body| body.get("metadata").and_then(Value::as_array).cloned().unwrap_or_default())
                .map_err(|e| e.message)
        } else {
            let text: String = response.text().chars().take(200).collect();
            let detail = if text.is_empty() { String::new() } else { format!(" — {text}") };
            Err(format!("{} {}{detail}", response.status, response.status_text))
        };
        match entities {
            Ok(entities) => {
                let loaded = entities.len();
                *self.results.get_mut(index)? = Some(Ok(entities));
                Some((SalesforceMetadataProgress::new(entity_type, SalesforceMetadataState::Complete, Some(loaded), None), None))
            }
            Err(error) => {
                let (progress, failure) = self.on_failure(index, &error)?;
                Some((progress, Some(failure)))
            }
        }
    }

    /// The metadata of the entities that arrived. Every request has to be answered or failed first.
    pub fn finish(&self) -> Result<SalesforceDataCloudMetadata, SalesforceError> {
        let mut progress = BTreeMap::new();
        let mut entities = Vec::new();
        let mut failed = 0;
        for (collection, result) in SALESFORCE_METADATA_ENTITY_TYPES.iter().zip(&self.results) {
            let (state, loaded, error) = match result {
                Some(Ok(items)) => {
                    entities.extend(items.iter().map(read_entity));
                    (SalesforceMetadataState::Complete, Some(items.len()), None)
                }
                Some(Err(error)) => {
                    failed += 1;
                    let message = format!("Salesforce {collection} metadata request failed: {error}");
                    (SalesforceMetadataState::Failed, None, Some(message))
                }
                None => return Err(SalesforceError::new(format!("the {collection} metadata request is still running"))),
            };
            progress.insert(collection.to_string(), SalesforceMetadataProgress::new(collection, state, loaded, error));
        }
        if failed == SALESFORCE_METADATA_ENTITY_TYPES.len() {
            return Err(SalesforceError::new(format_salesforce_metadata_progress(&progress)));
        }
        Ok(SalesforceDataCloudMetadata { metadata: entities })
    }
}
