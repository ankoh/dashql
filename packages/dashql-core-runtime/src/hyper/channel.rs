//! The channels of a Hyper connection.
//!
//! A Hyper connection speaks one of four protocols. The HTTP API (`V3_HTTP`, and `V3_HTTP_LINK` with the token of a
//! link) is a protocol of the module: `HyperHttpChannel` builds the query request and reads the result with a
//! `HyperResultReader`. The gRPC API of the desktop app (`V3_GRPC`, through its native proxy) and the embedded Hyper
//! (`WASM`) stay channels of the host: the host runs the query and hands the Arrow IPC of the result to the module.
//! Both kinds take the same input, the SQL text with the attached databases, the settings and the client context of
//! the connection, like `HyperDatabaseChannel` of the TypeScript.

use serde_json::{Map, Value};

use super::client::{AttachedDatabase, ExecuteQueryRequest, HyperHttpClient, HyperRequestHeaders};
use super::error::HyperError;
use super::result_reader::{HyperResultReader, DEFAULT_PARALLEL_CHUNKS};
use crate::connections::JsonObject;
use crate::http::{Headers, HttpRequest, HttpResponse};
use crate::query::Timestamp;

/// The protocol of a Hyper connection
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HyperProtocol {
    /// The embedded Hyper of the app
    Wasm,
    /// The gRPC API through the native proxy of the desktop app
    V3Grpc,
    /// The HTTP API
    V3Http,
    /// The HTTP API of the Hyper of a link, with the token of the link
    V3HttpLink,
}

impl HyperProtocol {
    /// The protocol of its name, none for an unknown one
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "WASM" => Some(HyperProtocol::Wasm),
            "V3_GRPC" => Some(HyperProtocol::V3Grpc),
            "V3_HTTP" => Some(HyperProtocol::V3Http),
            "V3_HTTP_LINK" => Some(HyperProtocol::V3HttpLink),
            _ => None,
        }
    }

    /// The protocol of the params of a Hyper connection, the embedded Hyper without one
    pub fn of_params(params: Option<&JsonObject>) -> Option<Self> {
        match params.and_then(|params| params.get("protocol")) {
            None | Some(Value::Null) => Some(HyperProtocol::Wasm),
            Some(Value::String(name)) => Self::from_name(name),
            Some(_) => None,
        }
    }

    /// The name of the protocol
    pub fn name(self) -> &'static str {
        match self {
            HyperProtocol::Wasm => "WASM",
            HyperProtocol::V3Grpc => "V3_GRPC",
            HyperProtocol::V3Http => "V3_HTTP",
            HyperProtocol::V3HttpLink => "V3_HTTP_LINK",
        }
    }

    /// Does the module speak the protocol, or does a channel of the host?
    pub fn is_http(self) -> bool {
        matches!(self, HyperProtocol::V3Http | HyperProtocol::V3HttpLink)
    }
}

/// The databases that the params of a Hyper connection attach (`attachedDatabases`), an entry without a path attaches
/// nothing
pub fn attached_databases(params: &JsonObject) -> Vec<AttachedDatabase> {
    params
        .get("attachedDatabases")
        .and_then(Value::as_array)
        .map(|databases| {
            databases
                .iter()
                .filter_map(Value::as_object)
                .filter_map(|database| {
                    Some(AttachedDatabase {
                        path: database.get("path")?.as_str()?.to_string(),
                        alias: database.get("alias").and_then(Value::as_str).map(str::to_string),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The context of the channels of a Hyper connection
#[derive(Debug, Clone, Default, PartialEq)]
pub struct HyperChannelContext {
    /// The databases that every query attaches
    pub attached_databases: Vec<AttachedDatabase>,
    /// The query parameters that every query sets
    pub query_parameters: Map<String, Value>,
    /// The client context of every query, which Hyper logs as `ctx.client` of the query events
    pub client_context: Option<Value>,
    /// The metadata of the params, the headers of every request. A Salesforce connection sends its token instead.
    pub metadata: Headers,
}

impl HyperChannelContext {
    /// The context of a remote Hyper connection with params
    pub fn from_params(params: &JsonObject, client_context: Option<Value>) -> Self {
        let attached_databases = attached_databases(params);
        let query_parameters = params.get("queryParameters").and_then(Value::as_object).cloned().unwrap_or_default();
        let metadata = params
            .get("metadata")
            .and_then(Value::as_object)
            .map(|metadata| {
                Headers::from_pairs(
                    metadata.iter().filter_map(|(name, value)| value.as_str().map(|value| (name.as_str(), value))),
                )
            })
            .unwrap_or_default();
        Self { attached_databases, query_parameters, client_context, metadata }
    }
}

/// The channel of a Hyper connection over the HTTP API
#[derive(Debug, Clone, PartialEq)]
pub struct HyperHttpChannel {
    client: HyperHttpClient,
    context: HyperChannelContext,
    parallel_chunks: usize,
}

impl HyperHttpChannel {
    /// Connect to the endpoint of the params of a Hyper connection. The chunks that a result fetches in parallel are
    /// at least one, four by default.
    pub fn connect(
        params: &JsonObject,
        context: HyperChannelContext,
        parallel_chunks: Option<usize>,
    ) -> Result<Self, HyperError> {
        let endpoint = params.get("endpoint").and_then(Value::as_str).unwrap_or_default();
        Ok(Self {
            client: HyperHttpClient::new(endpoint)?,
            context,
            parallel_chunks: parallel_chunks.unwrap_or(DEFAULT_PARALLEL_CHUNKS).max(1),
        })
    }

    /// The client of the endpoint
    pub fn client(&self) -> &HyperHttpClient {
        &self.client
    }

    /// The context
    pub fn context(&self) -> &HyperChannelContext {
        &self.context
    }

    /// The chunks that a result fetches in parallel
    pub fn parallel_chunks(&self) -> usize {
        self.parallel_chunks
    }

    /// The body of the query request: the SQL text, the query parameters as settings and the attached databases. Empty
    /// settings and databases are left out.
    pub fn query_request(&self, sql: &str) -> ExecuteQueryRequest {
        let settings = (!self.context.query_parameters.is_empty()).then(|| self.context.query_parameters.clone());
        let databases = (!self.context.attached_databases.is_empty()).then(|| {
            self.context
                .attached_databases
                .iter()
                .map(|database| AttachedDatabase {
                    path: database.path.clone(),
                    alias: database.alias.clone().filter(|alias| !alias.is_empty()),
                })
                .collect()
        });
        ExecuteQueryRequest { settings, databases, ..ExecuteQueryRequest::new(sql) }
    }

    /// The request that submits a query, with the auth headers of the connection
    pub fn execute_query(&self, sql: &str, auth: &Headers) -> HttpRequest {
        let headers = self.context.client_context.as_ref().map(|context| HyperRequestHeaders {
            external_client_context: Some(context.to_string()),
            ..Default::default()
        });
        self.client.execute_query(&self.query_request(sql), headers.as_ref(), auth)
    }

    /// Read the response of a query request, the reader then reads the result
    pub fn open_result(&self, response: HttpResponse, now: Timestamp) -> Result<HyperResultReader, HyperError> {
        HyperResultReader::new(self.client.clone(), response, self.parallel_chunks, now)
    }
}
