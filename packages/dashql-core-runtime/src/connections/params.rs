//! The connectors and the params of a connection.
//!
//! The params are the settings a connector connects with, as JSON in the shape of the workbook file: an object with
//! one field named after the connector, e.g. `{"trino": {...}}`. The reducer reads only a few fields of them, the rest
//! passes through untouched.
//!
//! Ported from `connector_info.ts`, `connection_params.ts` and the connector descriptors of
//! `packages/dashql-runtime/src/connections/`.

use serde_json::{json, Map, Value};

use dashql_core::error::{Error, Result};

/// A JSON object
pub type JsonObject = Map<String, Value>;

/// The connectors
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum ConnectorType {
    /// Direct-to-Hyper connections, the embedded Hyper or a Hyper server
    Hyper,
    /// Salesforce Data Cloud connections
    SalesforceDataCloud,
    /// Trino connections
    Trino,
    /// Database.com connections, they behave like Salesforce Data Cloud connections for now
    Dbcom,
}

/// The connectors in the order that params are matched against them
pub const CONNECTOR_TYPES: [ConnectorType; 4] =
    [ConnectorType::Hyper, ConnectorType::SalesforceDataCloud, ConnectorType::Trino, ConnectorType::Dbcom];

/// What a connector supports
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ConnectorFeatures {
    /// Do new connections cache query results?
    pub query_result_caching: bool,
    /// Do connections only run queries, no DDL or DML?
    pub read_only: bool,
}

/// The database of the relations of a Hyper connection without attached databases
pub const DEFAULT_DATABASE_NAME: &str = "hyper";
/// The default schema of Hyper
pub const HYPER_DEFAULT_SCHEMA: &str = "public";
/// The database that the catalog of a Salesforce connection names its relations with
pub const SALESFORCE_CATALOG_DATABASE: &str = "lakehouse";
/// The schema that the catalog of a Salesforce connection names its relations with
pub const SALESFORCE_CATALOG_SCHEMA: &str = "public";
/// The database of a new Database.com connection
pub const HYPER_CLOUD_DEFAULT_DATABASE_NAME: &str = "default";

/// A JSON value as an object, empty for any other value
fn object(value: Value) -> JsonObject {
    match value {
        Value::Object(map) => map,
        _ => JsonObject::new(),
    }
}

/// A field of a JSON object if it is a string
pub(crate) fn string_field<'a>(object: &'a JsonObject, key: &str) -> Option<&'a str> {
    object.get(key).and_then(Value::as_str)
}

impl ConnectorType {
    /// The field of the connection params that holds the params of the connector
    pub fn params_key(self) -> &'static str {
        match self {
            ConnectorType::Hyper => "hyper",
            ConnectorType::SalesforceDataCloud => "salesforce",
            ConnectorType::Trino => "trino",
            ConnectorType::Dbcom => "dbcom",
        }
    }

    /// The features of the connector
    pub fn features(self) -> ConnectorFeatures {
        match self {
            ConnectorType::Hyper => ConnectorFeatures { query_result_caching: false, read_only: false },
            ConnectorType::SalesforceDataCloud => ConnectorFeatures { query_result_caching: true, read_only: true },
            ConnectorType::Trino => ConnectorFeatures { query_result_caching: true, read_only: true },
            ConnectorType::Dbcom => ConnectorFeatures { query_result_caching: true, read_only: false },
        }
    }

    /// Does the connector share the connection state of Salesforce?
    pub fn is_salesforce(self) -> bool {
        matches!(self, ConnectorType::SalesforceDataCloud | ConnectorType::Dbcom)
    }

    /// The params of a new connection of the connector
    pub fn default_params(self) -> JsonObject {
        let salesforce = || object(json!({ "instanceUrl": "", "appConsumerKey": "", "appConsumerSecret": "", "login": "" }));
        match self {
            ConnectorType::Hyper => object(json!({
                "protocol": "WASM",
                "endpoint": "",
                "tls": { "clientKeyPath": "", "clientCertPath": "", "caCertsPath": "" },
            })),
            ConnectorType::SalesforceDataCloud => salesforce(),
            ConnectorType::Trino => object(json!({ "endpoint": "", "catalogs": [], "auth": { "authType": "AUTH_BASIC" } })),
            ConnectorType::Dbcom => {
                let mut params = salesforce();
                params.insert("databaseName".to_string(), json!(HYPER_CLOUD_DEFAULT_DATABASE_NAME));
                params
            }
        }
    }
}

/// The params of a connection: the params of its connector
#[derive(Debug, Clone, PartialEq)]
pub struct ConnectionParams {
    /// The connector
    pub connector: ConnectorType,
    /// The params of the connector, the value of its field in the JSON. Two params are equal regardless of the order
    /// of their keys.
    pub params: JsonObject,
}

impl ConnectionParams {
    /// The params of a connector
    pub fn new(connector: ConnectorType, params: JsonObject) -> Self {
        Self { connector, params }
    }

    /// The params of a new connection of a connector
    pub fn default_for(connector: ConnectorType) -> Self {
        Self::new(connector, connector.default_params())
    }

    /// Read params from JSON, e.g. `{"trino": {...}}`. The first connector with a field wins.
    pub fn from_json(text: &str) -> Result<Self> {
        let value: Value =
            serde_json::from_str(text).map_err(|e| Error::invalid_argument(format!("invalid connection params: {e}")))?;
        let Value::Object(fields) = value else {
            return Err(Error::invalid_argument("connection params must be an object"));
        };
        for connector in CONNECTOR_TYPES {
            if let Some(params) = fields.get(connector.params_key()) {
                let Value::Object(params) = params else {
                    return Err(Error::invalid_argument(format!(
                        "the params of the connector {} must be an object",
                        connector.params_key()
                    )));
                };
                return Ok(Self::new(connector, params.clone()));
            }
        }
        let keys: Vec<&str> = fields.keys().map(String::as_str).collect();
        Err(Error::invalid_argument(format!(
            "unknown connector of the connection params with the keys [{}]",
            keys.join(", ")
        )))
    }

    /// The params as JSON, e.g. `{"trino": {...}}`
    pub fn to_json(&self) -> String {
        let mut fields = JsonObject::new();
        fields.insert(self.connector.params_key().to_string(), Value::Object(self.params.clone()));
        Value::Object(fields).to_string()
    }

    /// The params without the raw form rows, they belong only to the local draft
    pub fn without_draft_rows(&self) -> Self {
        let mut params = self.params.clone();
        match self.connector {
            ConnectorType::Hyper | ConnectorType::Trino => {
                params.remove("draftRows");
            }
            ConnectorType::SalesforceDataCloud | ConnectorType::Dbcom => {}
        }
        Self::new(self.connector, params)
    }
}

/// The catalog and schema of the names that Trino statements leave out
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TrinoSessionDefaults {
    /// The default catalog, none if there is none
    pub catalog: Option<String>,
    /// The default schema, none if there is none. Trino takes a default schema only with a default catalog.
    pub schema: Option<String>,
}

/// The default catalog and schema of Trino params. `defaultCatalog` replaced `catalogName`, which is read without it.
pub fn trino_session_defaults(params: &JsonObject) -> TrinoSessionDefaults {
    let catalog = string_field(params, "defaultCatalog").or_else(|| string_field(params, "catalogName")).unwrap_or("").trim();
    let schema = string_field(params, "defaultSchema").unwrap_or("").trim();
    if catalog.is_empty() {
        return TrinoSessionDefaults::default();
    }
    TrinoSessionDefaults {
        catalog: Some(catalog.to_string()),
        schema: (!schema.is_empty()).then(|| schema.to_string()),
    }
}
