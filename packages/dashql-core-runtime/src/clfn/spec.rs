//! The spec of client functions as the runtime reads it, see `docs/design/client_functions.md`. The core reads the
//! signatures of the same document (`dashql_core::catalog::clfn`) and checks it when a binding registers it, the runtime
//! reads what a request needs: hosts, API names, locations, body formats, paging, pending results and errors.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value};

use super::ClientFunctionError;

/// An option of a function or an attribute of a schema
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ClientFunctionAttribute {
    /// The name in a script
    pub name: String,
    /// The spelling of the API, the name if absent
    pub api_name: Option<String>,
    /// Options only: `path`, `query`, `header`, `body` or `body_root`. A path option fills the placeholder of its
    /// `api_name`.
    #[serde(rename = "in")]
    pub location: Option<String>,
    /// The type of a scalar
    #[serde(rename = "type")]
    pub value_type: Option<String>,
    /// The schema of an object
    pub schema: Option<String>,
    /// Is the value a map? Its keys are free, the schema holds for its values.
    pub map: bool,
    /// Is the option required?
    pub required: bool,
    /// Query options with arrays or objects: `repeat` (the default), `csv` or `deep`
    pub style: Option<String>,
    /// Path options whose value may contain `/`
    pub multi_segment: bool,
}

impl ClientFunctionAttribute {
    /// The spelling of the API
    pub fn api_name(&self) -> &str {
        self.api_name.as_deref().unwrap_or(&self.name)
    }
}

/// A named object, or a union of named objects
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ClientFunctionSchema {
    /// The attributes, a union has none
    pub attributes: Vec<ClientFunctionAttribute>,
    /// A union: the schemas that a value can be. A name means the same in all of them.
    pub variants: Vec<String>,
}

/// A result column
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ClientFunctionColumn {
    /// The name in a script
    pub name: String,
    /// The spelling of the API, the name if absent
    pub api_name: Option<String>,
    /// VARCHAR, TIMESTAMPTZ, DATE, INTEGER, BIGINT, DOUBLE, BOOLEAN or JSON
    #[serde(rename = "type")]
    pub column_type: Option<String>,
}

impl ClientFunctionColumn {
    /// The spelling of the API
    pub fn api_name(&self) -> &str {
        self.api_name.as_deref().unwrap_or(&self.name)
    }
}

/// How a function pages
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ClientFunctionPaging {
    /// `url`, `token`, `offset` or `page`
    pub kind: String,
    /// Where the value is: `{ "body": pointer }`, `{ "header": name }`, `{ "link": rel }` or `{ "last_row": pointer }`
    pub from: Option<Value>,
    /// The option that takes the value
    pub option: Option<String>,
    /// The option with the page size
    pub size: Option<String>,
    /// The first offset or page
    pub start: Option<f64>,
    /// When the list ends: `empty_page`, `short_page`, `{ "total": pointer }` or `{ "has_more": pointer }`
    pub end: Option<Value>,
}

impl ClientFunctionPaging {
    /// Does the value of the paging count, an offset or a page number?
    pub fn is_numeric(&self) -> bool {
        self.kind == "offset" || self.kind == "page"
    }
}

/// How a pending result is polled
#[derive(Clone, Debug, PartialEq)]
pub enum ClientFunctionPoll {
    /// The header with the URL to poll
    Header(String),
    /// Repeat the request
    Repeat,
    /// A rule the runtime doesn't know, a call fails on it once it's pending
    Unknown(Value),
}

/// How a function answers before it finishes
#[derive(Clone, Debug, PartialEq)]
pub struct ClientFunctionPending {
    /// The status that means not finished
    pub status: u16,
    /// How to poll
    pub poll: ClientFunctionPoll,
}

impl ClientFunctionPending {
    /// Read a pending rule, none for null or a rule without a status
    fn read(value: &Value) -> Option<Self> {
        let status = u16::try_from(value.get("status")?.as_u64()?).ok()?;
        let poll = value.get("poll").cloned().unwrap_or(Value::Null);
        let poll = match (poll.get("header").and_then(Value::as_str), poll.get("repeat")) {
            (Some(header), _) => ClientFunctionPoll::Header(header.to_string()),
            (None, Some(Value::Bool(true))) => ClientFunctionPoll::Repeat,
            _ => ClientFunctionPoll::Unknown(poll),
        };
        Some(Self { status, poll })
    }
}

/// How a function reports errors
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ClientFunctionErrors {
    /// JSON pointers to try for the error message
    pub message: Option<Vec<String>>,
    /// A pointer that fails the statement when it's present, for a 200 that carries errors
    pub error_if: Option<String>,
    /// The statuses that mean an empty result
    pub empty_on: Option<Vec<u16>>,
    /// Is the message a JSON string?
    pub message_is_json: Option<bool>,
}

/// A client function
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ClientFunction {
    pub name: String,
    /// A grouping for documents and lists
    pub family: Option<String>,
    /// A call that completion shows
    pub example: Option<String>,
    pub method: Option<String>,
    pub host: Option<String>,
    pub path: Option<String>,
    pub options: Vec<ClientFunctionAttribute>,
    /// The format of the body: `json` by default, `form`, or a media type
    pub body: Option<String>,
    pub rows: Option<String>,
    pub columns: Vec<ClientFunctionColumn>,
    pub paging: Option<ClientFunctionPaging>,
    /// Absent takes the default of the spec, null means none
    #[serde(deserialize_with = "present")]
    pub pending: Option<Value>,
    pub errors: Option<ClientFunctionErrors>,
    /// `read` or `write`
    pub effect: Option<String>,
    /// The escape hatch: takes `method`, `path`, `host` and `body`
    pub raw: bool,
}

/// Tell a null value from an absent field
fn present<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(deserializer).map(Some)
}

impl ClientFunction {
    /// The option of a name
    pub fn option(&self, name: &str) -> Option<&ClientFunctionAttribute> {
        self.options.iter().find(|o| o.name == name)
    }
}

/// A host that functions name, the binding of the connection resolves it
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ClientFunctionHost {
    pub base_path: Option<String>,
}

/// The spec of client functions
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default)]
pub struct ClientFunctionSpec {
    pub format: u32,
    pub namespace: String,
    pub hosts: BTreeMap<String, ClientFunctionHost>,
    pub errors: Option<ClientFunctionErrors>,
    pub pending: Option<Value>,
    pub schemas: HashMap<String, ClientFunctionSchema>,
    pub functions: Vec<ClientFunction>,
    /// The functions by name
    #[serde(skip)]
    functions_by_name: HashMap<String, usize>,
}

impl ClientFunctionSpec {
    /// Read a spec. The core checks it when a binding registers it on a catalog, this only reads it.
    pub fn from_json(json: &str) -> Result<Self, ClientFunctionError> {
        let value: Value = serde_json::from_str(json)
            .map_err(|e| ClientFunctionError::new(format!("invalid client function spec: {e}")))?;
        Self::from_value(value)
    }

    /// Read a spec from JSON
    pub fn from_value(value: Value) -> Result<Self, ClientFunctionError> {
        let mut spec: ClientFunctionSpec = serde_json::from_value(value)
            .map_err(|e| ClientFunctionError::new(format!("invalid client function spec: {e}")))?;
        for (i, function) in spec.functions.iter().enumerate() {
            spec.functions_by_name.entry(function.name.clone()).or_insert(i);
        }
        Ok(spec)
    }

    /// The function of a call
    pub fn function(&self, name: &str) -> Result<&ClientFunction, ClientFunctionError> {
        self.functions_by_name
            .get(name)
            .and_then(|&i| self.functions.get(i))
            .ok_or_else(|| ClientFunctionError::new(format!("{} has no function {name}", self.namespace)))
    }

    /// The pending rule of a function
    pub fn pending_of(&self, function: &ClientFunction) -> Option<ClientFunctionPending> {
        match &function.pending {
            Some(pending) => ClientFunctionPending::read(pending),
            None => self.pending.as_ref().and_then(ClientFunctionPending::read),
        }
    }

    /// The pointers to the error message of a function
    pub fn error_pointers<'a>(&'a self, function: &'a ClientFunction) -> &'a [String] {
        function
            .errors
            .as_ref()
            .and_then(|e| e.message.as_deref())
            .or_else(|| self.errors.as_ref().and_then(|e| e.message.as_deref()))
            .unwrap_or(&[])
    }

    /// Is the error message of a function a JSON string?
    pub fn message_is_json(&self, function: &ClientFunction) -> bool {
        function
            .errors
            .as_ref()
            .and_then(|e| e.message_is_json)
            .or_else(|| self.errors.as_ref().and_then(|e| e.message_is_json))
            .unwrap_or(false)
    }
}

/// A value that the runtime fills in
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
pub struct ClientFunctionCallBinding {
    /// A JSON pointer into the options
    pub pointer: String,
    /// The name of the parameter
    pub param: String,
}

/// A call as the core describes it (`AnalyzedScript::describe_client_function_call`)
#[derive(Clone, Debug, Default, PartialEq, Deserialize)]
#[serde(default)]
pub struct ClientFunctionCallDescription {
    pub namespace: String,
    pub function: String,
    /// `read` or `write`
    pub effect: String,
    pub explain: bool,
    pub options: Map<String, Value>,
    pub bindings: Vec<ClientFunctionCallBinding>,
}

impl ClientFunctionCallDescription {
    /// Read the description of the core
    pub fn from_value(value: Value) -> Result<Self, ClientFunctionError> {
        serde_json::from_value(value)
            .map_err(|e| ClientFunctionError::new(format!("invalid client function call: {e}")))
    }

    /// A plan puts the values of its inputs in a description and the shell has none, so a description here has them.
    /// Its options would be sent with a null otherwise.
    pub fn require_values(&self) -> Result<(), ClientFunctionError> {
        match self.bindings.first() {
            Some(binding) => Err(ClientFunctionError::new(format!("the parameter :{} has no value", binding.param))),
            None => Ok(()),
        }
    }
}
