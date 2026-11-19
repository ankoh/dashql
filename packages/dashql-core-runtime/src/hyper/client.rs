//! The V3 HTTP API of Hyper as requests and responses: submit a query, read its status, fetch the chunks or rows of its
//! result, cancel it.
//!
//! The client builds the requests with the auth headers that the caller passes, the host sends them and hands the
//! responses to the readers of the client. The TypeScript client awaited the auth headers of its provider for every
//! request, the caller asks the context of the connection for them instead.

use serde_json::{json, Map, Value};

use super::error::{check_response, HyperError};
use crate::http::{Headers, HttpMethod, HttpRequest, HttpResponse};
use super::status::QueryStatus;
use crate::http::url::encode_uri_component;
use crate::http::Url;

/// The media type of Arrow IPC streams
pub const ARROW_STREAM_CONTENT_TYPE: &str = "application/vnd.apache.arrow.stream";
/// The header with the status of a query
pub const HEADER_HYPERDB_STATUS: &str = "x-hyperdb-status";
/// The header with the workload of a request
pub const HEADER_HYPERDB_WORKLOAD: &str = "x-hyperdb-workload";
/// The header with the client context of a query, which Hyper logs as `ctx.client` of the query events
pub const HEADER_HYPERDB_EXTERNAL_CLIENT_CONTEXT: &str = "x-hyperdb-external-client-context";
/// The header with the adaptive timeout of a request
pub const HEADER_HYPERDB_ADAPTIVE_TIMEOUT: &str = "x-hyperdb-adaptive-timeout";

/// A database that a query attaches
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachedDatabase {
    /// The path of the database
    pub path: String,
    /// The alias that statements name it by, none for the default
    pub alias: Option<String>,
}

/// The range of the result that the query response holds
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResultRange {
    pub row_limit: Option<u64>,
    pub byte_limit: u64,
}

/// The body of `POST /api/v3/query`
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ExecuteQueryRequest {
    /// The SQL text
    pub sql: String,
    /// The transfer mode, e.g. `ADAPTIVE`
    pub transfer_mode: Option<String>,
    /// The settings of the query
    pub settings: Option<Map<String, Value>>,
    /// The range of the result in the query response
    pub result_range: Option<ResultRange>,
    /// The rows of the query
    pub query_row_limit: Option<u64>,
    /// The style of the query parameters, e.g. `NAMED`
    pub param_style: Option<String>,
    /// The attached databases
    pub databases: Option<Vec<AttachedDatabase>>,
}

impl ExecuteQueryRequest {
    /// A request for a SQL text
    pub fn new(sql: &str) -> Self {
        Self { sql: sql.to_string(), ..Default::default() }
    }

    /// The request as JSON, the fields that are none are left out
    pub fn to_json(&self) -> Value {
        let mut body = Map::new();
        body.insert("sql".to_string(), json!(self.sql));
        if let Some(mode) = &self.transfer_mode {
            body.insert("transferMode".to_string(), json!(mode));
        }
        if let Some(settings) = &self.settings {
            body.insert("settings".to_string(), Value::Object(settings.clone()));
        }
        if let Some(range) = &self.result_range {
            let mut value = Map::new();
            if let Some(rows) = range.row_limit {
                value.insert("rowLimit".to_string(), json!(rows));
            }
            value.insert("byteLimit".to_string(), json!(range.byte_limit));
            body.insert("resultRange".to_string(), Value::Object(value));
        }
        if let Some(limit) = self.query_row_limit {
            body.insert("queryRowLimit".to_string(), json!(limit));
        }
        if let Some(style) = &self.param_style {
            body.insert("paramStyle".to_string(), json!(style));
        }
        if let Some(databases) = &self.databases {
            let databases = databases
                .iter()
                .map(|database| {
                    let mut value = Map::new();
                    value.insert("path".to_string(), json!(database.path));
                    if let Some(alias) = &database.alias {
                        value.insert("alias".to_string(), json!(alias));
                    }
                    Value::Object(value)
                })
                .collect();
            body.insert("databases".to_string(), Value::Array(databases));
        }
        Value::Object(body)
    }
}

/// The parameters of `GET /api/v3/query/{queryId}`
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GetQueryStatusParams {
    pub query_id: String,
    /// How long the server may wait for a change of the status
    pub wait_time_ms: Option<u64>,
}

/// The parameters of `GET /api/v3/query/{queryId}/chunk/{chunkId}`
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GetQueryChunkParams {
    pub query_id: String,
    pub chunk_id: u64,
    /// Leave out the schema, an earlier chunk had it
    pub omit_schema: bool,
}

/// The optional headers of a request
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct HyperRequestHeaders {
    pub workload: Option<String>,
    pub external_client_context: Option<String>,
    pub adaptive_timeout: Option<String>,
}

/// A response with the status header and the body, of a query or a chunk
#[derive(Debug, Clone, PartialEq)]
pub struct QueryResponse {
    /// The status of the header, none without one
    pub status: Option<QueryStatus>,
    /// The body, Arrow IPC
    pub body: Vec<u8>,
}

/// The client of the HTTP API of a Hyper endpoint
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HyperHttpClient {
    endpoint: Url,
}

impl HyperHttpClient {
    /// A client of an endpoint, e.g. the instance url of Salesforce Data Cloud
    pub fn new(endpoint: &str) -> Result<Self, HyperError> {
        if endpoint.is_empty() {
            return Err(HyperError::MissingEndpoint);
        }
        let url = Url::parse_with_authority(endpoint).map_err(|_| HyperError::InvalidUrl(endpoint.to_string()))?;
        Ok(Self { endpoint: url })
    }

    /// The endpoint
    pub fn endpoint(&self) -> &Url {
        &self.endpoint
    }

    /// The headers of a request: Arrow, JSON, the auth headers and the optional ones
    fn headers(&self, auth: &Headers, extra: Option<&HyperRequestHeaders>) -> Headers {
        let mut headers =
            Headers::from_pairs([("Accept", ARROW_STREAM_CONTENT_TYPE), ("Content-Type", "application/json")]);
        headers.extend(auth);
        if let Some(extra) = extra {
            let non_empty = |value: &Option<String>| value.clone().filter(|value| !value.is_empty());
            if let Some(workload) = non_empty(&extra.workload) {
                headers.set(HEADER_HYPERDB_WORKLOAD, &workload);
            }
            if let Some(context) = non_empty(&extra.external_client_context) {
                headers.set(HEADER_HYPERDB_EXTERNAL_CLIENT_CONTEXT, &context);
            }
            if let Some(timeout) = non_empty(&extra.adaptive_timeout) {
                headers.set(HEADER_HYPERDB_ADAPTIVE_TIMEOUT, &timeout);
            }
        }
        headers
    }

    /// The path of a query
    fn query_path(query_id: &str) -> String {
        format!("/api/v3/query/{}", encode_uri_component(query_id))
    }

    /// `POST /api/v3/query`
    pub fn execute_query(
        &self,
        request: &ExecuteQueryRequest,
        extra: Option<&HyperRequestHeaders>,
        auth: &Headers,
    ) -> HttpRequest {
        HttpRequest {
            method: HttpMethod::Post,
            url: self.endpoint.origin_url("/api/v3/query", &[]),
            headers: self.headers(auth, extra),
            body: Some(request.to_json().to_string()),
            sensitive: false,
        }
    }

    /// `GET /api/v3/query/{queryId}`
    pub fn get_query_status(&self, params: &GetQueryStatusParams, auth: &Headers) -> HttpRequest {
        let query: Vec<(&str, String)> =
            params.wait_time_ms.map(|wait| ("waitTimeMs", wait.to_string())).into_iter().collect();
        HttpRequest {
            method: HttpMethod::Get,
            url: self.endpoint.origin_url(&Self::query_path(&params.query_id), &query),
            headers: self.headers(auth, None),
            body: None,
            sensitive: false,
        }
    }

    /// `DELETE /api/v3/query/{queryId}`
    pub fn cancel_query(&self, query_id: &str, auth: &Headers) -> HttpRequest {
        HttpRequest {
            method: HttpMethod::Delete,
            url: self.endpoint.origin_url(&Self::query_path(query_id), &[]),
            headers: self.headers(auth, None),
            body: None,
            sensitive: false,
        }
    }

    /// `GET /api/v3/query/{queryId}/chunk/{chunkId}`
    pub fn get_query_chunk(
        &self,
        params: &GetQueryChunkParams,
        extra: Option<&HyperRequestHeaders>,
        auth: &Headers,
    ) -> HttpRequest {
        let path = format!("{}/chunk/{}", Self::query_path(&params.query_id), params.chunk_id);
        let query: Vec<(&str, String)> =
            if params.omit_schema { vec![("omitSchema", "true".to_string())] } else { vec![] };
        HttpRequest {
            method: HttpMethod::Get,
            url: self.endpoint.origin_url(&path, &query),
            headers: self.headers(auth, extra),
            body: None,
            sensitive: false,
        }
    }

}

/// Read the status header of a response, none without one
pub fn read_status_header(response: &HttpResponse) -> Result<Option<QueryStatus>, HyperError> {
    match response.headers.get(HEADER_HYPERDB_STATUS).filter(|raw| !raw.is_empty()) {
        Some(raw) => QueryStatus::parse(raw.as_bytes())
            .map(Some)
            .map_err(|e| HyperError::Protocol(format!("invalid status header: {e}"))),
        None => Ok(None),
    }
}

/// Read the response of a query or a chunk: the status header and the Arrow body
pub fn read_query_response(response: HttpResponse) -> Result<QueryResponse, HyperError> {
    check_response(&response).map_err(HyperError::Http)?;
    let status = read_status_header(&response)?;
    Ok(QueryResponse { status, body: response.body })
}

/// Read the response of a status request
pub fn read_status_response(response: &HttpResponse) -> Result<QueryStatus, HyperError> {
    check_response(response).map_err(HyperError::Http)?;
    QueryStatus::parse(&response.body).map_err(|e| HyperError::Protocol(format!("invalid status response: {e}")))
}

/// Read the response of a cancellation
pub fn read_cancel_response(response: &HttpResponse) -> Result<(), HyperError> {
    check_response(response).map_err(HyperError::Http)
}
