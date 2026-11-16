//! The wasm-bindgen API of the parts of the storage format of workbooks (`dashql_core_runtime::workbook_format`) that the
//! storage of the platform calls itself: the validation of workbook files, the migrations of workbook folders and of the
//! stored connections, the scripts of a workbook folder that changed outside the app and the eviction of the query
//! result cache. The imports and exports are commands of the runtime (`runtime/imports.rs`, `runtime/exports.rs`).
//!
//! Most calls go through `workbookFormat(op, args)`, JSON in and JSON out, the TypeScript of `@ankoh/dashql-core`
//! (`DashQLWorkbookFormat`) gives them types.

use dashql_core::error::{Error, Result};
use dashql_core_runtime::workbook_format::data::{WorkbookData, STORAGE_VERSION, WORKBOOK_CATALOG_COPY_FORMAT_VERSION, WORKBOOK_FORMAT_VERSION};
use dashql_core_runtime::workbook_format::eviction::{CacheEviction as RuntimeCacheEviction, CacheFileStat};
use dashql_core_runtime::workbook_format::migration::{
    migrate_workbook_folder_to, rename_sidb_connections, FolderChange, MigrationFolder, WorkbookMigrationResult, MIGRATION_FILES,
    WORKBOOK_MIGRATION_STEPS,
};
use dashql_core_runtime::workbook_format::script_connections::{
    resolve_workbook_scripts, workbook_scripts_resolution_changed, ConnectionResolver, ResolvedConnection,
};
use dashql_core_runtime::workbook_format::tables::{ColumnType, WorkbookTableName};
use dashql_core_runtime::workbook_format::validation::{is_local_hyper_wasm_params, is_valid_uuid, validate_workbook_json, WorkbookValidationError};
use js_sys::{Function, Reflect};
use serde_json::{json, Value};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

fn invalid(message: impl Into<String>) -> Error {
    Error::invalid_argument(message.into())
}

/// A field of the arguments
fn arg<'a>(args: &'a Value, key: &str) -> &'a Value {
    args.get(key).unwrap_or(&Value::Null)
}

fn string_arg(args: &Value, key: &str) -> Result<String> {
    arg(args, key).as_str().map(str::to_string).ok_or_else(|| invalid(format!("{key} must be a string")))
}

fn strings(value: &Value) -> Vec<String> {
    value.as_array().map(|list| list.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default()
}

fn opt_string(value: &Value) -> Option<String> {
    value.as_str().map(str::to_string)
}

fn workbook_arg(args: &Value, key: &str) -> WorkbookData {
    WorkbookData::from_json(arg(args, key))
}

fn column_type_name(column_type: ColumnType) -> &'static str {
    match column_type {
        ColumnType::Text => "text",
        ColumnType::Integer => "integer",
        ColumnType::Boolean => "boolean",
    }
}

fn migration_result(result: WorkbookMigrationResult) -> &'static str {
    match result {
        WorkbookMigrationResult::Current => "current",
        WorkbookMigrationResult::Migrated => "migrated",
        WorkbookMigrationResult::Missing => "missing",
        WorkbookMigrationResult::Unsupported => "unsupported",
        WorkbookMigrationResult::Newer => "newer",
    }
}

fn validation_error(code: &str) -> Option<WorkbookValidationError> {
    WorkbookValidationError::ALL.into_iter().find(|error| error.code() == code)
}

fn run(op: &str, args: &Value) -> Result<Value> {
    Ok(match op {
        "constants" => json!({
            "formatVersion": WORKBOOK_FORMAT_VERSION,
            "catalogCopyFormatVersion": WORKBOOK_CATALOG_COPY_FORMAT_VERSION,
            "storageVersion": STORAGE_VERSION,
            "migrationFiles": MIGRATION_FILES,
            "tables": WorkbookTableName::ALL.iter().map(|table| json!({
                "name": table.name(),
                "columns": table.columns().iter().map(|column| json!({
                    "name": column.name,
                    "type": column_type_name(column.column_type),
                    "nullable": column.nullable,
                })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
        }),
        "validate" => json!({ "error": validate_workbook_json(arg(args, "workbook")).err().map(WorkbookValidationError::code) }),
        "describeValidationError" => {
            let code = string_arg(args, "error")?;
            json!({ "description": validation_error(&code).map(WorkbookValidationError::describe).unwrap_or("Invalid workbook") })
        }
        "isLocalHyperWasmParams" => json!({ "result": is_local_hyper_wasm_params(arg(args, "params")) }),
        "isValidUuid" => json!({ "result": arg(args, "value").as_str().is_some_and(is_valid_uuid) }),
        "migrate" => {
            let files: Vec<(String, String)> = arg(args, "files")
                .as_array()
                .map(|list| {
                    list.iter()
                        .filter_map(|file| Some((file.get(0)?.as_str()?.to_string(), file.get(1)?.as_str()?.to_string())))
                        .collect()
                })
                .unwrap_or_default();
            let mut folder = MigrationFolder::new(files);
            let target = arg(args, "targetVersion").as_i64().unwrap_or(WORKBOOK_FORMAT_VERSION);
            let result = migrate_workbook_folder_to(&mut folder, target, &WORKBOOK_MIGRATION_STEPS)?;
            let changes: Vec<Value> = folder
                .changes()
                .into_iter()
                .map(|change| match change {
                    FolderChange::Write { name, text } => json!({ "kind": "write", "name": name, "text": text }),
                    FolderChange::Remove { name } => json!({ "kind": "remove", "name": name }),
                })
                .collect();
            json!({ "result": migration_result(result), "changes": changes })
        }
        "renameSidbConnections" => {
            let connections = arg(args, "connections").as_array().cloned().unwrap_or_default();
            json!({ "connections": rename_sidb_connections(&connections) })
        }
        "resolutionChanged" => json!({ "result": workbook_scripts_resolution_changed(&workbook_arg(args, "stored"), &workbook_arg(args, "resolved")) }),
        _ => return Err(invalid(format!("unknown operation of the workbook format: {op}"))),
    })
}

/// Run an operation of the workbook format on JSON arguments, returns its JSON result
#[wasm_bindgen(js_name = workbookFormat)]
pub fn workbook_format(op: &str, args: &str) -> std::result::Result<String, JsError> {
    let args: Value = serde_json::from_str(args).map_err(|e| JsError::new(&format!("invalid arguments of {op}: {e}")))?;
    let result = run(op, &args).map_err(|error| JsError::new(&error.message))?;
    Ok(result.to_string())
}

/// Resolves the connections of a workbook over a JS object: `resolve(connectionId, copy)` returns the JSON of the
/// connection of the app or null, `fallback()` the JSON of the connection of unknown ones, `unresolved(connectionId)`
/// learns of a reference that couldn't be resolved
struct JsResolver<'a> {
    resolver: &'a JsValue,
}

impl JsResolver<'_> {
    fn call(&self, method: &str, args: &[JsValue]) -> Result<JsValue> {
        let function = Reflect::get(self.resolver, &JsValue::from_str(method))
            .ok()
            .and_then(|f| f.dyn_into::<Function>().ok())
            .ok_or_else(|| invalid(format!("the resolver has no function {method}")))?;
        let result = match args {
            [] => function.call0(self.resolver),
            [a] => function.call1(self.resolver, a),
            [a, b, ..] => function.call2(self.resolver, a, b),
        };
        result.map_err(|error| invalid(error.as_string().unwrap_or_else(|| format!("{method} of the resolver failed"))))
    }

    fn connection(value: JsValue) -> Result<Option<ResolvedConnection>> {
        let Some(text) = value.as_string() else {
            return Ok(None);
        };
        let parsed: Value = serde_json::from_str(&text).map_err(|e| invalid(format!("invalid resolved connection: {e}")))?;
        let connection_id = parsed.get("connectionId").and_then(opt_string).ok_or_else(|| invalid("resolved connection without an id"))?;
        Ok(Some(ResolvedConnection { connection_id, params: parsed.get("params").cloned().unwrap_or(Value::Null) }))
    }
}

impl ConnectionResolver for JsResolver<'_> {
    fn resolve(
        &mut self,
        connection_id: &str,
        copy: Option<&dashql_core_runtime::workbook_format::data::WorkbookConnection>,
    ) -> Result<Option<ResolvedConnection>> {
        let copy = copy.map(|copy| JsValue::from_str(&copy.to_json().to_string())).unwrap_or(JsValue::NULL);
        Self::connection(self.call("resolve", &[JsValue::from_str(connection_id), copy])?)
    }

    fn fallback(&mut self) -> Result<ResolvedConnection> {
        Self::connection(self.call("fallback", &[])?)?.ok_or_else(|| invalid("the resolver has no fallback connection"))
    }

    fn unresolved(&mut self, connection_id: &str) {
        let _ = self.call("unresolved", &[JsValue::from_str(connection_id)]);
    }
}

/// Resolve the scripts of a workbook file to the connections of the app, see `resolve_workbook_scripts`. Returns the
/// scripts with the ids of their connections, the pending connection and the resolved workbook file as JSON.
#[wasm_bindgen(js_name = resolveWorkbookScripts)]
pub fn resolve_workbook_scripts_of(workbook: &str, file_names: &str, resolver: &JsValue) -> std::result::Result<String, JsError> {
    let workbook: Value = serde_json::from_str(workbook).map_err(|e| JsError::new(&format!("invalid workbook: {e}")))?;
    let file_names: Value = serde_json::from_str(file_names).map_err(|e| JsError::new(&format!("invalid file names: {e}")))?;
    let mut resolver = JsResolver { resolver };
    let resolved = resolve_workbook_scripts(&WorkbookData::from_json(&workbook), &strings(&file_names), &mut resolver)
        .map_err(|error| JsError::new(&error.message))?;
    let scripts: Vec<Value> = resolved
        .scripts
        .iter()
        .map(|script| json!({ "name": script.name, "connectionId": script.connection.connection_id, "unresolvedConnectionId": script.unresolved_connection_id }))
        .collect();
    Ok(json!({
        "scripts": scripts,
        "pendingConnectionId": resolved.pending_connection.map(|connection| connection.connection_id),
        "workbook": resolved.workbook.to_json(),
    })
    .to_string())
}

/// The eviction of the query result cache, least recently used first. The host lists the files, deletes the ones that
/// `nextCandidate` names and reports with `deleted` or `kept` before it asks again.
#[wasm_bindgen]
pub struct CacheEviction {
    inner: RuntimeCacheEviction,
}

#[wasm_bindgen]
impl CacheEviction {
    /// Start an eviction over the files of the cache, as JSON `[{name, size, mtimeMs, lastAccessMs}]`
    #[wasm_bindgen(constructor)]
    pub fn new(files: &str, max_bytes: f64, max_files: f64) -> std::result::Result<CacheEviction, JsError> {
        let files: Value = serde_json::from_str(files).map_err(|e| JsError::new(&format!("invalid cache files: {e}")))?;
        let number = |file: &Value, key: &str| file.get(key).and_then(Value::as_f64).filter(|v| v.is_finite() && *v >= 0.0).unwrap_or(0.0) as u64;
        let files = files
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(|file| {
                        Some(CacheFileStat {
                            name: file.get("name")?.as_str()?.to_string(),
                            size: number(file, "size"),
                            mtime_ms: number(file, "mtimeMs"),
                            last_access_ms: number(file, "lastAccessMs"),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        let limit = |value: f64| if value.is_finite() && value >= 0.0 { value as u64 } else { u64::MAX };
        Ok(CacheEviction { inner: RuntimeCacheEviction::new(files, limit(max_bytes), limit(max_files)) })
    }

    /// The name of the next file to delete, undefined once the cache fits or no file is left
    #[wasm_bindgen(js_name = nextCandidate)]
    pub fn next_candidate(&self) -> Option<String> {
        self.inner.next_candidate().map(|file| file.name.clone())
    }

    /// The candidate was deleted, or was gone already
    pub fn deleted(&mut self) {
        self.inner.deleted();
    }

    /// The candidate is read and stays, the next one goes instead
    pub fn kept(&mut self) {
        self.inner.kept();
    }
}
