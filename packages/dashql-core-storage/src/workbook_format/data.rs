//! The JSON files of the storage as Rust values: the workbook file (`proto/json/dashql/app_workbook.json`), the
//! connections of the manifest (`app_manifest.json`) and the entries of the workbook tree (`app_folder.json`).
//!
//! Files are read leniently, a file is edited by hand: a field of the wrong type reads as absent, an entry of a list
//! that isn't an object with the required fields is left out (and marked, see `WorkbookData::malformed_lists`).
//! Fields the schema doesn't know are kept and written again, after the known ones. Whether a workbook file is usable
//! is decided on its JSON, see `validation::validate_workbook_json`.

use dashql_core::error::{Error, Result};
use dashql_core_runtime::connections::{ConnectionDetails, ConnectionParams, ConnectorType};
use serde_json::{json, Value};

use crate::workbook_format::json::{to_pretty_text, JsonObject};
use crate::workbook_format::layout::StorageType;

/// The format version of the workbook file, `formatVersion`
pub const WORKBOOK_FORMAT_VERSION: i64 = 11;
/// Workbook folders up to this format version hold a copy of the catalog of their default connection
pub const WORKBOOK_CATALOG_COPY_FORMAT_VERSION: i64 = 6;
/// The version of the storage root, `storageVersion` of the manifest
pub const STORAGE_VERSION: i64 = 10;

/// A copy of a connection that a workbook file holds
#[derive(Debug, Clone, PartialEq)]
pub struct WorkbookConnection {
    /// The id of the connection in the connections of the app manifest
    pub connection_id: String,
    /// The params, e.g. `{"trino": {...}}`
    pub params: Value,
    /// The name of the connection, only exports carry it
    pub name: Option<String>,
    /// Unsaved edits of older versions, only read when connections are registered from the copy
    pub params_draft: Option<Value>,
    /// Fields the schema doesn't know
    pub extra: JsonObject,
}

impl WorkbookConnection {
    /// A copy with the params of a connection
    pub fn new(connection_id: impl Into<String>, params: Value) -> Self {
        Self { connection_id: connection_id.into(), params, name: None, params_draft: None, extra: JsonObject::new() }
    }

    /// Read a copy, None if it has no string `connectionId`. Missing params read as null.
    pub fn from_json(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        let connection_id = object.get("connectionId")?.as_str()?.to_string();
        let mut extra = JsonObject::new();
        let (mut params, mut name, mut params_draft) = (Value::Null, None, None);
        for (key, value) in object {
            match key.as_str() {
                "connectionId" => {}
                "params" => params = value.clone(),
                "name" => name = value.as_str().map(str::to_string),
                "paramsDraft" => params_draft = (!value.is_null()).then(|| value.clone()),
                _ => {
                    extra.insert(key.clone(), value.clone());
                }
            }
        }
        Some(Self { connection_id, params, name, params_draft, extra })
    }

    /// The copy as JSON
    pub fn to_json(&self) -> Value {
        let mut object = JsonObject::new();
        object.insert("connectionId".into(), json!(self.connection_id));
        object.insert("params".into(), self.params.clone());
        if let Some(name) = &self.name {
            object.insert("name".into(), json!(name));
        }
        if let Some(draft) = &self.params_draft {
            object.insert("paramsDraft".into(), draft.clone());
        }
        append_extra(&mut object, &self.extra);
        Value::Object(object)
    }
}

/// A script of a workbook file: a file in `scripts/` and the connection it runs on
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct WorkbookScript {
    /// The file name, e.g. `01_extract.sql`
    pub name: String,
    /// The connection the script runs on
    pub connection_id: String,
}

impl WorkbookScript {
    /// A script entry
    pub fn new(name: impl Into<String>, connection_id: impl Into<String>) -> Self {
        Self { name: name.into(), connection_id: connection_id.into() }
    }
}

/// An attachment of a workbook file, a file in `attachments/`
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct WorkbookAttachment {
    /// The file name
    pub name: String,
}

/// A published workbook of a cloud and one of its versions
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkbookCloudLink {
    /// The id of the published workbook
    pub workbook_id: String,
    /// The version that was opened or published last
    pub version_id: String,
    /// Is this a read-only look at the version?
    pub preview: Option<bool>,
    /// The cloud connection that holds the published workbook
    pub connection_id: String,
}

impl WorkbookCloudLink {
    /// Read a link, None without its ids
    pub fn from_json(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        Some(Self {
            workbook_id: object.get("workbookId")?.as_str()?.to_string(),
            version_id: object.get("versionId")?.as_str()?.to_string(),
            preview: object.get("preview").and_then(Value::as_bool),
            connection_id: object.get("connectionId")?.as_str()?.to_string(),
        })
    }

    /// The link as JSON
    pub fn to_json(&self) -> Value {
        let mut object = JsonObject::new();
        object.insert("workbookId".into(), json!(self.workbook_id));
        object.insert("versionId".into(), json!(self.version_id));
        if let Some(preview) = self.preview {
            object.insert("preview".into(), json!(preview));
        }
        object.insert("connectionId".into(), json!(self.connection_id));
        Value::Object(object)
    }
}

/// The metadata of a workbook
#[derive(Debug, Clone, PartialEq, Default)]
pub struct WorkbookMetadata {
    /// `FILE`, `LOCAL` or `HTTP`
    pub origin_type: Option<String>,
    /// The original file name
    pub original_file_name: Option<String>,
    /// The original HTTP URL
    pub original_http_url: Option<String>,
    /// When the workbook was created
    pub created_at: Option<String>,
    /// Is this the workbook of the greeter?
    pub ephemeral: Option<bool>,
    /// The published workbook of the cloud that this workbook came from or was published to
    pub cloud: Option<WorkbookCloudLink>,
    /// Fields the schema doesn't know
    pub extra: JsonObject,
}

impl WorkbookMetadata {
    /// Read the metadata, anything but an object reads as empty metadata
    pub fn from_json(value: &Value) -> Self {
        let mut metadata = Self::default();
        let Some(object) = value.as_object() else {
            return metadata;
        };
        for (key, value) in object {
            match key.as_str() {
                "originType" => metadata.origin_type = value.as_str().map(str::to_string),
                "originalFileName" => metadata.original_file_name = value.as_str().map(str::to_string),
                "originalHttpUrl" => metadata.original_http_url = value.as_str().map(str::to_string),
                "createdAt" => metadata.created_at = value.as_str().map(str::to_string),
                "ephemeral" => metadata.ephemeral = value.as_bool(),
                "cloud" => metadata.cloud = WorkbookCloudLink::from_json(value),
                _ => {
                    metadata.extra.insert(key.clone(), value.clone());
                }
            }
        }
        metadata
    }

    /// The metadata as JSON
    pub fn to_json(&self) -> Value {
        let mut object = JsonObject::new();
        let mut string = |key: &str, value: &Option<String>| {
            if let Some(value) = value {
                object.insert(key.into(), json!(value));
            }
        };
        string("originType", &self.origin_type);
        string("originalFileName", &self.original_file_name);
        string("originalHttpUrl", &self.original_http_url);
        string("createdAt", &self.created_at);
        if let Some(ephemeral) = self.ephemeral {
            object.insert("ephemeral".into(), json!(ephemeral));
        }
        if let Some(cloud) = &self.cloud {
            object.insert("cloud".into(), cloud.to_json());
        }
        append_extra(&mut object, &self.extra);
        Value::Object(object)
    }

    /// Is the workbook the ephemeral workbook of the greeter?
    pub fn is_ephemeral(&self) -> bool {
        self.ephemeral == Some(true)
    }
}

/// The workbook file `dashql-workbook.json`
#[derive(Debug, Clone, PartialEq, Default)]
pub struct WorkbookData {
    /// The format version, 0 if the file has none
    pub format_version: i64,
    /// The workbook id, a UUID, empty if the file has none
    pub workbook_id: String,
    /// A display path of older versions
    pub workbook_path: Option<String>,
    /// Where the files of the workbook live
    pub storage_type: Option<StorageType>,
    /// The folder of a native workbook
    pub native_path: Option<String>,
    /// The name the user gave the workbook
    pub name: Option<String>,
    /// The copies of the connections that the scripts use, in the order the scripts first use them
    pub connections: Vec<WorkbookConnection>,
    /// The scripts in feed order
    pub scripts: Vec<WorkbookScript>,
    /// The attachments in natural order
    pub attachments: Vec<WorkbookAttachment>,
    /// The metadata
    pub metadata: WorkbookMetadata,
    /// When the workbook was modified last
    pub last_modified: Option<String>,
    /// When the workbook was accessed last
    pub last_accessed: Option<String>,
    /// Fields the schema doesn't know
    pub extra: JsonObject,
    /// Did reading leave out entries of the lists of scripts or attachments, or weren't they lists? Never written.
    pub malformed_lists: bool,
}

impl WorkbookData {
    /// Read a workbook file leniently, anything but an object reads as an empty workbook with malformed lists
    pub fn from_json(value: &Value) -> Self {
        let mut data = Self::default();
        let Some(object) = value.as_object() else {
            data.malformed_lists = true;
            return data;
        };
        let mut has_scripts = false;
        let mut has_attachments = false;
        let string = |value: &Value| value.as_str().map(str::to_string);
        for (key, value) in object {
            match key.as_str() {
                "formatVersion" => data.format_version = integer(value).unwrap_or(0),
                "workbookId" => data.workbook_id = value.as_str().unwrap_or("").to_string(),
                "workbookPath" => data.workbook_path = string(value),
                "storageType" => data.storage_type = value.as_str().and_then(StorageType::parse),
                "nativePath" => data.native_path = string(value),
                "name" => data.name = string(value),
                "connections" => {
                    data.connections = value
                        .as_array()
                        .map(|list| list.iter().filter_map(WorkbookConnection::from_json).collect())
                        .unwrap_or_default();
                }
                "scripts" => {
                    has_scripts = true;
                    let Some(list) = value.as_array() else {
                        data.malformed_lists = true;
                        continue;
                    };
                    for entry in list {
                        let script = entry.as_object().and_then(|object| {
                            Some(WorkbookScript::new(
                                object.get("name")?.as_str()?,
                                object.get("connectionId")?.as_str()?,
                            ))
                        });
                        match script {
                            Some(script) => data.scripts.push(script),
                            None => data.malformed_lists = true,
                        }
                    }
                }
                "attachments" => {
                    has_attachments = true;
                    let Some(list) = value.as_array() else {
                        data.malformed_lists = true;
                        continue;
                    };
                    for entry in list {
                        match entry.as_object().and_then(|object| object.get("name")?.as_str()) {
                            Some(name) => data.attachments.push(WorkbookAttachment { name: name.to_string() }),
                            None => data.malformed_lists = true,
                        }
                    }
                }
                "metadata" => data.metadata = WorkbookMetadata::from_json(value),
                "lastModified" => data.last_modified = string(value),
                "lastAccessed" => data.last_accessed = string(value),
                _ => {
                    data.extra.insert(key.clone(), value.clone());
                }
            }
        }
        if !has_scripts || !has_attachments {
            data.malformed_lists = true;
        }
        data
    }

    /// Read a workbook file from its text, None if it isn't JSON
    pub fn from_text(text: &str) -> Option<Self> {
        serde_json::from_str::<Value>(text).ok().map(|value| Self::from_json(&value))
    }

    /// The workbook file as JSON, the fields in the order of the schema
    pub fn to_json(&self) -> Value {
        let mut object = JsonObject::new();
        object.insert("formatVersion".into(), json!(self.format_version));
        object.insert("workbookId".into(), json!(self.workbook_id));
        if let Some(path) = &self.workbook_path {
            object.insert("workbookPath".into(), json!(path));
        }
        if let Some(storage_type) = self.storage_type {
            object.insert("storageType".into(), json!(storage_type.as_str()));
        }
        if let Some(path) = &self.native_path {
            object.insert("nativePath".into(), json!(path));
        }
        if let Some(name) = &self.name {
            object.insert("name".into(), json!(name));
        }
        object.insert(
            "connections".into(),
            Value::Array(self.connections.iter().map(WorkbookConnection::to_json).collect()),
        );
        object.insert(
            "scripts".into(),
            Value::Array(
                self.scripts.iter().map(|s| json!({ "name": s.name, "connectionId": s.connection_id })).collect(),
            ),
        );
        object.insert(
            "attachments".into(),
            Value::Array(self.attachments.iter().map(|a| json!({ "name": a.name })).collect()),
        );
        object.insert("metadata".into(), self.metadata.to_json());
        if let Some(at) = &self.last_modified {
            object.insert("lastModified".into(), json!(at));
        }
        if let Some(at) = &self.last_accessed {
            object.insert("lastAccessed".into(), json!(at));
        }
        append_extra(&mut object, &self.extra);
        Value::Object(object)
    }

    /// The text of the workbook file, as the storage writes it
    pub fn to_text(&self) -> String {
        to_pretty_text(&self.to_json())
    }

    /// The trimmed name, None if it is empty
    pub fn display_name(&self) -> Option<&str> {
        self.name.as_deref().map(str::trim).filter(|name| !name.is_empty())
    }
}

/// A connection of the app manifest
#[derive(Debug, Clone, PartialEq)]
pub struct ConnectionEntry {
    /// The id, workbooks reference the connection with it
    pub id: String,
    /// The saved params
    pub params: Value,
    /// Unsaved edits of the params
    pub params_draft: Option<Value>,
    /// The name the user gave the connection
    pub name: Option<String>,
    /// When the connection was created
    pub created_at: Option<String>,
    /// Fields the schema doesn't know
    pub extra: JsonObject,
}

impl ConnectionEntry {
    /// An entry with params
    pub fn new(id: impl Into<String>, params: Value) -> Self {
        Self { id: id.into(), params, params_draft: None, name: None, created_at: None, extra: JsonObject::new() }
    }

    /// Read an entry, None if it has no string `id`
    pub fn from_json(value: &Value) -> Option<Self> {
        let object = value.as_object()?;
        let mut entry = Self::new(object.get("id")?.as_str()?, Value::Null);
        for (key, value) in object {
            match key.as_str() {
                "id" => {}
                "params" => entry.params = value.clone(),
                "paramsDraft" => entry.params_draft = (!value.is_null()).then(|| value.clone()),
                "name" => entry.name = value.as_str().map(str::to_string),
                "createdAt" => entry.created_at = value.as_str().map(str::to_string),
                // The choice of earlier versions whether to reuse the results, every connection reuses them now
                "cacheQueryResults" => {}
                _ => {
                    entry.extra.insert(key.clone(), value.clone());
                }
            }
        }
        Some(entry)
    }

    /// The entry as JSON
    pub fn to_json(&self) -> Value {
        let mut object = JsonObject::new();
        object.insert("id".into(), json!(self.id));
        object.insert("params".into(), self.params.clone());
        if let Some(draft) = &self.params_draft {
            object.insert("paramsDraft".into(), draft.clone());
        }
        if let Some(name) = &self.name {
            object.insert("name".into(), json!(name));
        }
        if let Some(at) = &self.created_at {
            object.insert("createdAt".into(), json!(at));
        }
        append_extra(&mut object, &self.extra);
        Value::Object(object)
    }
}

/// The connectors in the order that the field of a stored connection is matched against them
const IMPORT_ORDER: [ConnectorType; 4] =
    [ConnectorType::SalesforceDataCloud, ConnectorType::Dbcom, ConnectorType::Hyper, ConnectorType::Trino];

/// Read the details of a connection as a workbook file stores them: an object with one field named after the
/// connector. The field holds the flat params of the connector, or details that carry them as `setupParams`. Only the
/// setup params are read, a restored connection starts its setup anew.
pub fn decode_connection(connection: &Value, workbook_id: &str) -> Result<(ConnectorType, ConnectionDetails)> {
    let unsupported =
        || Error::invalid_argument(format!("unsupported connection details of the workbook {workbook_id}"));
    let fields = connection.as_object().ok_or_else(unsupported)?;
    let (connector, value) = IMPORT_ORDER
        .iter()
        .find_map(|connector| fields.get(connector.connector().params_key()).map(|value| (*connector, value)))
        .ok_or_else(unsupported)?;
    // Details carry their params, storage persists the flat params
    let params: JsonObject = match value.get("setupParams") {
        Some(Value::Object(params)) => params.clone(),
        _ => value.as_object().cloned().unwrap_or_default(),
    };
    Ok((connector, ConnectionDetails::new(&ConnectionParams::new(connector, params))))
}

/// The integer of a JSON number, None for any other value
pub fn integer(value: &Value) -> Option<i64> {
    value.as_i64().or_else(|| value.as_f64().filter(|f| f.fract() == 0.0 && f.abs() < 9.0e15).map(|f| f as i64))
}

/// Fill in the fields the schema doesn't know, after the known ones. A known field is never replaced.
fn append_extra(object: &mut JsonObject, extra: &JsonObject) {
    for (key, value) in extra {
        if !object.contains_key(key) {
            object.insert(key.clone(), value.clone());
        }
    }
}
