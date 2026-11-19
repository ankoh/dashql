//! The REST protocol of Trino: the requests of a channel with their auth headers, the responses and their errors, the
//! retries of result pages and the OAuth tokens.
//!
//! A statement is posted to `/v1/statement`, its results follow the `nextUri` of every response until there is none,
//! deleting the `nextUri` cancels the query and `/v1/query/{id}` returns the QueryInfo with the plans and statistics
//! of the stages.

use serde_json::Value;

use super::error::{TrinoError, TrinoErrorKind, TrinoResult};
use crate::http::base64::{base64_decode, base64_encode};
use crate::salesforce::api::redact_token_diagnostics;
use crate::http::url::{encode_uri_component, form_encode, set_query_param, url_path};
use crate::http::{FetchOutcome, HttpMethod, HttpRequest, HttpResponse};
use crate::time::{iso_timestamp, parse_iso_timestamp, Millis};
use crate::connections::{trino_session_defaults, JsonObject, TrinoSessionDefaults};

/// The size of the result pages that we ask Trino for. Trino returns pages of 1 MB by default and caps the size at
/// 128 MB. A page also ends early when the coordinator has no more rows buffered, its exchange buffer holds 32 MB by
/// default.
pub const TARGET_RESULT_SIZE: &str = "32MB";

/// Refresh access tokens a minute before they expire
pub const ACCESS_TOKEN_REFRESH_MARGIN_MS: i64 = 60 * 1000;

/// The status codes of requests that are retried: too many requests, bad gateway, service unavailable, gateway timeout
pub const RETRIED_STATUS_CODES: [u16; 4] = [429, 502, 503, 504];

/// The retries of failed requests of query results
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrinoRetryPolicy {
    /// The number of attempts, including the first one
    pub attempts: u32,
    /// The delay before the first retry, it doubles with every retry
    pub initial_delay_ms: u64,
    /// The maximum delay between retries
    pub max_delay_ms: u64,
}

/// Retry for about 20 seconds before failing a query
pub const DEFAULT_TRINO_RETRY_POLICY: TrinoRetryPolicy =
    TrinoRetryPolicy { attempts: 10, initial_delay_ms: 100, max_delay_ms: 3000 };

impl Default for TrinoRetryPolicy {
    fn default() -> Self {
        DEFAULT_TRINO_RETRY_POLICY
    }
}

impl TrinoRetryPolicy {
    /// The delay after a failed attempt, the first attempt is 1
    pub fn delay_ms(&self, attempt: u32) -> u64 {
        let doublings = attempt.saturating_sub(1).min(63);
        self.initial_delay_ms.saturating_mul(1u64 << doublings).min(self.max_delay_ms)
    }
}

/// How a channel authenticates
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum TrinoAuthType {
    /// A user name and a password, the default
    #[default]
    Basic,
    /// An OAuth access token
    OAuth,
}

/// The settings of the OAuth flow of a Trino connection
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TrinoOAuthParams {
    /// The authorization endpoint
    pub authorization_url: String,
    /// The token endpoint
    pub token_url: String,
    /// The client id
    pub client_id: String,
    /// The redirect URL, empty for the default loopback URL
    pub callback_url: String,
    /// The scopes, empty for the default scopes
    pub scopes: Vec<String>,
}

/// The auth params of a Trino connection
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TrinoAuthParams {
    /// How the channel authenticates
    pub auth_type: TrinoAuthType,
    /// The user of basic auth, empty without
    pub username: String,
    /// The password of basic auth
    pub secret: String,
    /// The OAuth settings, none without
    pub oauth: Option<TrinoOAuthParams>,
}

/// A string field of a JSON object, empty if it is missing or no string
fn str_field(object: &JsonObject, key: &str) -> String {
    object.get(key).and_then(Value::as_str).unwrap_or("").to_string()
}

impl TrinoAuthParams {
    /// Read the `auth` of Trino params. Without it a channel authenticates with basic auth of no user.
    pub fn from_json(auth: Option<&Value>) -> Self {
        let Some(auth) = auth.and_then(Value::as_object) else {
            return Self::default();
        };
        let auth_type = match auth.get("authType").and_then(Value::as_str) {
            Some("AUTH_OAUTH") => TrinoAuthType::OAuth,
            _ => TrinoAuthType::Basic,
        };
        let basic = auth.get("basic").and_then(Value::as_object);
        let oauth = auth.get("oauth").and_then(Value::as_object).map(|oauth| TrinoOAuthParams {
            authorization_url: str_field(oauth, "authorizationUrl"),
            token_url: str_field(oauth, "tokenUrl"),
            client_id: str_field(oauth, "clientId"),
            callback_url: str_field(oauth, "callbackUrl"),
            scopes: oauth
                .get("scopes")
                .and_then(Value::as_array)
                .map(|scopes| scopes.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default(),
        });
        Self {
            auth_type,
            username: basic.map(|basic| str_field(basic, "username")).unwrap_or_default(),
            secret: basic.map(|basic| str_field(basic, "secret")).unwrap_or_default(),
            oauth,
        }
    }

    /// The `auth` of Trino params, the inverse of `from_json`
    pub fn to_json(&self) -> Value {
        let auth_type = match self.auth_type {
            TrinoAuthType::Basic => "AUTH_BASIC",
            TrinoAuthType::OAuth => "AUTH_OAUTH",
        };
        let mut auth = serde_json::json!({
            "authType": auth_type,
            "basic": { "username": self.username, "secret": self.secret },
        });
        if let (Some(oauth), Some(fields)) = (&self.oauth, auth.as_object_mut()) {
            fields.insert(
                "oauth".to_string(),
                serde_json::json!({
                    "authorizationUrl": oauth.authorization_url,
                    "tokenUrl": oauth.token_url,
                    "clientId": oauth.client_id,
                    "callbackUrl": oauth.callback_url,
                    "scopes": oauth.scopes,
                }),
            );
        }
        auth
    }
}

/// An OAuth access token
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrinoAccessToken {
    /// When the token arrived
    pub created_at: Millis,
    /// The token
    pub access_token: String,
    /// The type of the token, usually `Bearer`
    pub token_type: String,
    /// The token that refreshes the access token, if the server sent one
    pub refresh_token: Option<String>,
    /// When the token expires, if the server said
    pub expires_at: Option<Millis>,
    /// The granted scopes, if the server said
    pub scope: Option<String>,
    /// The account that logged in: the `sub` of the response or of its OpenID Connect id token, none if the server
    /// named none
    pub principal: Option<String>,
}

impl TrinoAccessToken {
    /// The token as JSON in the shape of `TrinoAccessToken` of the connection schema, with ISO timestamps
    pub fn to_json(&self) -> Value {
        let mut token = JsonObject::new();
        token.insert("createdAt".into(), Value::String(iso_timestamp(self.created_at)));
        token.insert("accessToken".into(), Value::String(self.access_token.clone()));
        token.insert("tokenType".into(), Value::String(self.token_type.clone()));
        if let Some(refresh_token) = &self.refresh_token {
            token.insert("refreshToken".into(), Value::String(refresh_token.clone()));
        }
        if let Some(expires_at) = self.expires_at {
            token.insert("expiresAt".into(), Value::String(iso_timestamp(expires_at)));
        }
        if let Some(scope) = &self.scope {
            token.insert("scope".into(), Value::String(scope.clone()));
        }
        if let Some(principal) = &self.principal {
            token.insert("principal".into(), Value::String(principal.clone()));
        }
        Value::Object(token)
    }

    /// Read a token in the shape of `to_json`, none if it has no access token
    pub fn from_json(token: &Value) -> Option<Self> {
        let token = token.as_object()?;
        let access_token = token.get("accessToken")?.as_str()?.to_string();
        let optional = |key: &str| token.get(key).and_then(Value::as_str).map(str::to_string);
        Some(Self {
            created_at: optional("createdAt").as_deref().and_then(parse_iso_timestamp).unwrap_or(0),
            access_token,
            token_type: optional("tokenType").unwrap_or_else(|| "Bearer".into()),
            refresh_token: optional("refreshToken"),
            expires_at: optional("expiresAt").as_deref().and_then(parse_iso_timestamp),
            scope: optional("scope"),
            principal: optional("principal"),
        })
    }
}

/// The `sub` of the payload of a JWT, none for a token that doesn't read
fn jwt_subject(jwt: &str) -> Option<String> {
    let payload = jwt.split('.').nth(1)?;
    let standard: String = payload.chars().map(|c| match c {
        '-' => '+',
        '_' => '/',
        c => c,
    }).collect();
    let bytes = base64_decode(&standard)?;
    let payload: Value = serde_json::from_slice(&bytes).ok()?;
    payload.get("sub").and_then(Value::as_str).filter(|sub| !sub.is_empty()).map(str::to_string)
}

/// A request for a token at an OAuth token endpoint, the fields of the form in order. Its body and its response carry
/// credentials.
pub fn token_request(token_url: &str, fields: &[(&str, &str)]) -> HttpRequest {
    let mut request = HttpRequest::new(HttpMethod::Post, token_url).sensitive();
    request.set_header("Content-Type", "application/x-www-form-urlencoded");
    request.body = Some(form_encode(fields.iter().copied()));
    request
}

/// Read the answer of a token endpoint that arrived at a time
pub fn read_token_response(outcome: &FetchOutcome, now: Millis) -> TrinoResult<TrinoAccessToken> {
    let response = match outcome {
        FetchOutcome::Response(response) => response,
        FetchOutcome::NetworkError(message) => {
            return Err(TrinoError::new(TrinoErrorKind::Network, format!("Token request failed: {message}")))
        }
    };
    if !response.is_success() {
        // The body may echo credentials: a JSON body is redacted, any other body left out
        let body = serde_json::from_slice::<Value>(&response.body).ok().filter(Value::is_object);
        let message = match body {
            Some(body) => format!("Token request failed: {} {}", response.status, redact_token_diagnostics(&body)),
            None => format!("Token request failed: {}", response.status),
        };
        let mut error = TrinoError::new(TrinoErrorKind::Http { status: response.status }, message);
        error.data.insert("status".into(), response.status.to_string());
        return Err(error);
    }
    let token = parse_trino_json(&response.body)?;
    let token = token.as_object().ok_or_else(|| TrinoError::protocol("The token response is no object"))?;
    let access_token = token
        .get("access_token")
        .and_then(Value::as_str)
        .filter(|token| !token.is_empty())
        .ok_or_else(|| TrinoError::protocol("The token response has no access token"))?;
    let optional = |key: &str| token.get(key).and_then(Value::as_str).filter(|value| !value.is_empty()).map(str::to_string);
    // A lifetime of 0 counts as none
    let expires_in = token.get("expires_in").and_then(Value::as_f64).filter(|seconds| *seconds != 0.0 && seconds.is_finite());
    Ok(TrinoAccessToken {
        created_at: now,
        access_token: access_token.to_string(),
        token_type: optional("token_type").unwrap_or_else(|| "Bearer".into()),
        refresh_token: optional("refresh_token"),
        expires_at: expires_in.map(|seconds| now.saturating_add((seconds * 1000.0) as i64)),
        scope: optional("scope"),
        principal: optional("sub").or_else(|| optional("id_token").as_deref().and_then(jwt_subject)),
    })
}

/// A request of the Trino protocol, the channel adds the URL and the headers
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrinoRequest {
    /// Post a statement to `/v1/statement` with the default catalog and schema
    SubmitStatement { text: String },
    /// Get the next page of the results of a query
    FetchResults { next_uri: String },
    /// Get the QueryInfo of a query: the stages with their plans and statistics
    FetchQueryInfo { query_id: String },
    /// Cancel a query by deleting its next URI, Trino answers with 204 No Content
    CancelQuery { next_uri: String },
}

/// What a channel needs before it sends a request
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TokenRefresh {
    /// The access token is fresh, or the channel doesn't refresh tokens
    NotNeeded,
    /// Send this request and pass the outcome to `finish_token_refresh` before sending anything else
    Started(HttpRequest),
    /// A refresh is running already, wait for it
    Pending,
}

/// A channel to a Trino server: the endpoint, the auth with the OAuth token and the catalog and schema of the names
/// that statements leave out. The host keeps a channel under the id of the connection.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrinoChannel {
    /// The URL of the server, e.g. `https://trino.example.com`
    pub endpoint: String,
    /// The auth params
    pub auth: TrinoAuthParams,
    /// The OAuth access token, none for basic auth
    pub access_token: Option<TrinoAccessToken>,
    /// The catalog and schema of the names that statements leave out
    pub defaults: TrinoSessionDefaults,
    /// Is a refresh of the access token running?
    refreshing: bool,
}

impl TrinoChannel {
    /// A channel without an access token
    pub fn new(endpoint: impl Into<String>, auth: TrinoAuthParams, defaults: TrinoSessionDefaults) -> Self {
        Self { endpoint: endpoint.into(), auth, access_token: None, defaults, refreshing: false }
    }

    /// The channel of Trino params, without an access token
    pub fn from_params(params: &JsonObject) -> Self {
        Self::new(str_field(params, "endpoint"), TrinoAuthParams::from_json(params.get("auth")), trino_session_defaults(params))
    }

    /// Does the access token need a refresh at a time? Only an OAuth token with a refresh token and an expiry
    /// refreshes, a minute before it expires.
    pub fn needs_token_refresh(&self, now: Millis) -> bool {
        let Some(token) = &self.access_token else {
            return false;
        };
        self.auth.auth_type == TrinoAuthType::OAuth
            && self.auth.oauth.is_some()
            && token.refresh_token.is_some()
            && token.expires_at.is_some_and(|expires_at| expires_at.saturating_sub(now) <= ACCESS_TOKEN_REFRESH_MARGIN_MS)
    }

    /// Check the access token before a request. A token about to expire is refreshed once, the requests of the
    /// meantime wait for the refresh.
    pub fn begin_token_refresh(&mut self, now: Millis) -> TokenRefresh {
        if !self.needs_token_refresh(now) {
            return TokenRefresh::NotNeeded;
        }
        if self.refreshing {
            return TokenRefresh::Pending;
        }
        let (Some(oauth), Some(token)) = (&self.auth.oauth, &self.access_token) else {
            return TokenRefresh::NotNeeded;
        };
        let Some(refresh_token) = &token.refresh_token else {
            return TokenRefresh::NotNeeded;
        };
        let request = token_request(
            &oauth.token_url,
            &[("grant_type", "refresh_token"), ("client_id", &oauth.client_id), ("refresh_token", refresh_token)],
        );
        self.refreshing = true;
        TokenRefresh::Started(request)
    }

    /// Apply the outcome of a token refresh. The new token keeps the refresh token unless the server sent another. A
    /// failed refresh keeps the old token, the requests that waited for it fail with the error.
    pub fn finish_token_refresh(&mut self, outcome: &FetchOutcome, now: Millis) -> TrinoResult<()> {
        self.refreshing = false;
        let mut refreshed = read_token_response(outcome, now)?;
        let previous = self.access_token.as_ref();
        if refreshed.refresh_token.is_none() {
            refreshed.refresh_token = previous.and_then(|token| token.refresh_token.clone());
        }
        // A refresh without an id token stays the login of the same account
        if refreshed.principal.is_none() {
            refreshed.principal = previous.and_then(|token| token.principal.clone());
        }
        self.access_token = Some(refreshed);
        Ok(())
    }

    /// The auth headers of the channel as they go with a request: the access token of OAuth, the user and the
    /// password of basic auth
    pub fn auth_headers(&self) -> Vec<(&'static str, String)> {
        match self.auth.auth_type {
            TrinoAuthType::OAuth => self
                .access_token
                .as_ref()
                .filter(|token| !token.access_token.is_empty())
                .map(|token| vec![("Authorization", format!("Bearer {}", token.access_token))])
                .unwrap_or_default(),
            TrinoAuthType::Basic if !self.auth.username.is_empty() => {
                let credentials = format!("{}:{}", self.auth.username, self.auth.secret);
                vec![
                    ("Authorization", format!("Basic {}", base64_encode(credentials.as_bytes()))),
                    ("X-Trino-User", self.auth.username.clone()),
                ]
            }
            TrinoAuthType::Basic => Vec::new(),
        }
    }

    /// Add the auth headers of the channel to a request
    fn add_auth_headers(&self, request: &mut HttpRequest) {
        for (name, value) in self.auth_headers() {
            request.set_header(name, value);
        }
    }

    /// The HTTP request of a request of the protocol with the current auth headers. Fails for a next URI that is no
    /// absolute URL.
    pub fn http_request(&self, request: &TrinoRequest) -> TrinoResult<HttpRequest> {
        let invalid_uri = |uri: &str| TrinoError::protocol(format!("Invalid next URI: {uri}"));
        let mut http = match request {
            TrinoRequest::SubmitStatement { text } => {
                let mut http = HttpRequest::new(HttpMethod::Post, format!("{}/v1/statement", self.endpoint));
                http.body = Some(text.clone());
                http
            }
            TrinoRequest::FetchResults { next_uri } => {
                let path = url_path(next_uri).ok_or_else(|| invalid_uri(next_uri))?;
                // Only the URIs of executing queries return rows
                let url = if path.contains("/v1/statement/executing/") {
                    set_query_param(next_uri, "targetResultSize", TARGET_RESULT_SIZE).ok_or_else(|| invalid_uri(next_uri))?
                } else {
                    next_uri.clone()
                };
                HttpRequest::new(HttpMethod::Get, url)
            }
            TrinoRequest::FetchQueryInfo { query_id } => HttpRequest::new(
                HttpMethod::Get,
                format!("{}/v1/query/{}", self.endpoint, encode_uri_component(query_id)),
            ),
            TrinoRequest::CancelQuery { next_uri } => {
                url_path(next_uri).ok_or_else(|| invalid_uri(next_uri))?;
                HttpRequest::new(HttpMethod::Delete, next_uri.clone())
            }
        };
        self.add_auth_headers(&mut http);
        if let TrinoRequest::SubmitStatement { .. } = request {
            // Trino sees every catalog of the server, the defaults only resolve the names that statements leave out
            if let Some(catalog) = &self.defaults.catalog {
                http.set_header("X-Trino-Catalog", catalog.clone());
                if let Some(schema) = &self.defaults.schema {
                    http.set_header("X-Trino-Schema", schema.clone());
                }
            }
        }
        Ok(http)
    }
}

/// Parse a JSON response of Trino. Integers keep all their digits: a bigint is an `i64` of the value.
pub fn parse_trino_json(body: &[u8]) -> TrinoResult<Value> {
    serde_json::from_slice(body).map_err(|e| TrinoError::protocol(format!("Invalid JSON response: {e}")))
}

/// A result column of a query
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrinoColumn {
    /// The name
    pub name: String,
    /// The type, e.g. `decimal(10,2)`
    pub type_name: String,
}

/// The error of a query that Trino reports in a response
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrinoQueryError {
    /// The message
    pub message: String,
    /// The error code
    pub error_code: i64,
    /// The name of the error, e.g. `SYNTAX_ERROR`
    pub error_name: String,
    /// The type of the error, e.g. `USER_ERROR`
    pub error_type: String,
}

impl TrinoQueryError {
    /// The error of a query: Trino returned an error, its fields are the details
    pub fn to_error(&self) -> TrinoError {
        let mut error = TrinoError::new(TrinoErrorKind::Query { code: self.error_code }, "Query returned an error");
        error.data.insert("errorCode".into(), self.error_code.to_string());
        error.data.insert("errorName".into(), self.error_name.clone());
        error.data.insert("errorType".into(), self.error_type.clone());
        error.data.insert("errorMessage".into(), self.message.clone());
        error
    }
}

/// A response of `/v1/statement`: the state of the query with the next page of its results
#[derive(Debug, Clone, PartialEq, Default)]
pub struct TrinoQueryResult {
    /// The id of the query
    pub id: String,
    /// The URI of the page of the query in the web UI
    pub info_uri: Option<String>,
    /// The URI of the next page, none once the query is done
    pub next_uri: Option<String>,
    /// The result columns, once Trino knows them
    pub columns: Option<Vec<TrinoColumn>>,
    /// The rows of the page, each an array of values
    pub data: Option<Vec<Value>>,
    /// The statistics of the query, the progress model reads them
    pub stats: Option<Value>,
    /// The error of a failed query
    pub error: Option<TrinoQueryError>,
}

impl TrinoQueryResult {
    /// Read a response from its JSON. Fields of the wrong type count as missing.
    pub fn from_json(value: Value) -> TrinoResult<Self> {
        let Value::Object(mut fields) = value else {
            return Err(TrinoError::protocol("The query result is no object"));
        };
        let string = |fields: &JsonObject, key: &str| fields.get(key).and_then(Value::as_str).map(str::to_string);
        let columns = fields.get("columns").and_then(Value::as_array).map(|columns| {
            columns
                .iter()
                .map(|column| TrinoColumn {
                    name: column.get("name").and_then(Value::as_str).unwrap_or("").to_string(),
                    type_name: column.get("type").and_then(Value::as_str).unwrap_or("").to_string(),
                })
                .collect()
        });
        let error = fields.get("error").and_then(Value::as_object).map(|error| TrinoQueryError {
            message: string(error, "message").unwrap_or_default(),
            error_code: error.get("errorCode").and_then(Value::as_i64).unwrap_or(0),
            error_name: string(error, "errorName").unwrap_or_default(),
            error_type: string(error, "errorType").unwrap_or_default(),
        });
        let data = match fields.remove("data") {
            Some(Value::Array(rows)) => Some(rows),
            _ => None,
        };
        let stats = fields.remove("stats").filter(Value::is_object);
        Ok(Self {
            id: string(&fields, "id").unwrap_or_default(),
            info_uri: string(&fields, "infoUri"),
            next_uri: string(&fields, "nextUri").filter(|uri| !uri.is_empty()),
            columns,
            data,
            stats,
            error,
        })
    }
}

/// Read the response to a posted statement
pub fn read_statement_response(response: &HttpResponse) -> TrinoResult<TrinoQueryResult> {
    if response.status != 200 {
        return Err(TrinoError::http("Query failed", response.status, &response.status_text));
    }
    TrinoQueryResult::from_json(parse_trino_json(&response.body)?)
}

/// How a request of query results went
#[derive(Debug, Clone, PartialEq)]
pub enum ResultPageOutcome {
    /// The page arrived
    Page(TrinoQueryResult),
    /// The request failed but is retried after a delay. Trino answers a repeated request of a next URI with the same
    /// page.
    Retry { delay_ms: u64 },
    /// The request failed for good
    Failed(TrinoError),
}

/// Read the outcome of an attempt to fetch query results, the first attempt is 1. A busy or restarting coordinator
/// or gateway and failures in the network are retried until the attempts run out.
pub fn read_result_page(outcome: &FetchOutcome, attempt: u32, policy: &TrinoRetryPolicy) -> ResultPageOutcome {
    let retries_left = attempt < policy.attempts;
    match outcome {
        FetchOutcome::NetworkError(message) => {
            if retries_left {
                ResultPageOutcome::Retry { delay_ms: policy.delay_ms(attempt) }
            } else {
                ResultPageOutcome::Failed(TrinoError::new(TrinoErrorKind::Network, message.clone()))
            }
        }
        FetchOutcome::Response(response) if response.status == 200 => {
            match parse_trino_json(&response.body).and_then(TrinoQueryResult::from_json) {
                Ok(page) => ResultPageOutcome::Page(page),
                Err(error) => ResultPageOutcome::Failed(error),
            }
        }
        FetchOutcome::Response(response) if retries_left && RETRIED_STATUS_CODES.contains(&response.status) => {
            ResultPageOutcome::Retry { delay_ms: policy.delay_ms(attempt) }
        }
        FetchOutcome::Response(response) => ResultPageOutcome::Failed(TrinoError::http(
            "Failed to fetch query results",
            response.status,
            &response.status_text,
        )),
    }
}

/// Read the response to a request of a QueryInfo
pub fn read_query_info(response: &HttpResponse) -> TrinoResult<Value> {
    if response.status != 200 {
        return Err(TrinoError::http("Failed to fetch query info", response.status, &response.status_text));
    }
    parse_trino_json(&response.body)
}

/// Read the response to the cancellation of a query
pub fn read_cancel_response(outcome: &FetchOutcome) -> TrinoResult<()> {
    match outcome {
        FetchOutcome::Response(response) if response.is_success() => Ok(()),
        FetchOutcome::Response(response) => {
            Err(TrinoError::http("Cancelling a query failed", response.status, &response.status_text))
        }
        FetchOutcome::NetworkError(message) => Err(TrinoError::new(TrinoErrorKind::Network, message.clone())),
    }
}
