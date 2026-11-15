//! The wasm-bindgen API of the storage format of workbooks (`dashql_core_runtime::workbook_format`).
//!
//! The format is pure logic, the host keeps the I/O: files, ZIP archives and the Parquet files of the embedded Hyper.
//! Most calls go through `workbookFormat(op, args)`, JSON in and JSON out, the TypeScript of `@ankoh/dashql-core`
//! (`DashQLWorkbookFormat`) gives them types. Workbook tables cross as Arrow IPC (`encodeWorkbookTable`,
//! `decodeWorkbookTable`). The bytes of attachments and results stay with the host, a bundle names them by tokens of
//! the host.

use std::collections::HashMap;

use dashql_core::error::{Error, Result};
use dashql_core_runtime::workbook_format::bundle::{
    assemble_workbook_bundle, catalog_seed_files, describe_workbook_bundle_difference, filter_invalid_workbook_catalogs,
    prepare_workbook_bundle_write, prune_bundle_connections, read_workbook_bundle, read_workbook_bundle_head,
    reconcile_stored_workbook_files, regenerate_connection_ids, rename_bundle_catalogs, workbook_bundles_equal, DataFileData, ScriptData,
    WorkbookBundle, WorkbookBundleCatalog, WorkbookBundleResult, WorkbookBundleWriteOptions,
};
use dashql_core_runtime::workbook_format::catalog::CoreCatalogSql;
use dashql_core_runtime::workbook_format::connection_import::{
    apply_connection_import_plan, connection_refs_changed, plan_connection_import, ConnectionImportChoice, ConnectionImportDecision,
    ConnectionImportPlanItem, ImportedConnectionRef,
};
use dashql_core_runtime::workbook_format::data::{
    ConnectionEntry, WorkbookData, STORAGE_VERSION, WORKBOOK_CATALOG_COPY_FORMAT_VERSION, WORKBOOK_FORMAT_VERSION,
};
use dashql_core_runtime::workbook_format::eviction::{CacheEviction as RuntimeCacheEviction, CacheFileStat};
use dashql_core_runtime::workbook_format::export::{
    connection_link_workbook, shared_export_head, shared_workbook_tables, workbook_archive_entries, workbook_link, ArchiveEntrySource,
    EntryCompression, SharedWorkbookExportOptions,
};
use dashql_core_runtime::workbook_format::files::workbook_attachments;
use dashql_core_runtime::workbook_format::import::{
    plan_archive, read_folder_archive, ArchiveEntry, ArchivePlan, FolderArchiveEntry, FolderArchiveFiles, FolderArchivePlan,
    TableArchiveEntry,
};
use dashql_core_runtime::workbook_format::layout::StorageType;
use dashql_core_runtime::workbook_format::migration::{
    migrate_workbook_folder_to, rename_sidb_connections, FolderChange, MigrationFolder, WorkbookMigrationResult, MIGRATION_FILES,
    WORKBOOK_MIGRATION_STEPS,
};
use dashql_core_runtime::workbook_format::query_results::{plan_result_import, CacheCapacity, ImportedWorkbookQueryResults};
use dashql_core_runtime::workbook_format::script_connections::{
    resolve_workbook_scripts, workbook_scripts_resolution_changed, ConnectionResolver, ResolvedConnection,
};
use dashql_core_runtime::workbook_format::tables::{
    decode_table_ipc, encode_table_ipc, workbook_tables_to_bundle, AttachmentRow, CatalogColumnRow, CatalogFunctionParamRow,
    CatalogFunctionRow, CatalogTableRow, Cell, ColumnType, ConnectionRow, DataTableFile, ResultRow, ScriptRow, WorkbookRow,
    WorkbookTableName, WorkbookTableRow, WorkbookTables,
};
use dashql_core_runtime::workbook_format::validation::{
    is_local_hyper_wasm_params, is_valid_uuid, validate_workbook_json, WorkbookValidationError,
};
use js_sys::{Function, Reflect};
use serde_json::{json, Map, Value};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;

#[wasm_bindgen]
extern "C" {
    /// A fresh UUID of the platform
    #[wasm_bindgen(catch, js_namespace = crypto, js_name = randomUUID)]
    fn random_uuid() -> std::result::Result<String, JsValue>;
}

/// A fresh UUID, the platform has `crypto.randomUUID`
fn new_uuid() -> String {
    random_uuid().unwrap_or_default()
}

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

fn catalog_from_json(value: &Value) -> Option<WorkbookBundleCatalog> {
    Some(WorkbookBundleCatalog {
        connection_id: value.get("connectionId")?.as_str()?.to_string(),
        relations: value.get("relations").and_then(opt_string),
        functions: value.get("functions").and_then(opt_string),
    })
}

fn catalog_to_json(catalog: &WorkbookBundleCatalog) -> Value {
    json!({ "connectionId": catalog.connection_id, "relations": catalog.relations, "functions": catalog.functions })
}

fn catalogs_arg(args: &Value, key: &str) -> Vec<WorkbookBundleCatalog> {
    arg(args, key).as_array().map(|list| list.iter().filter_map(catalog_from_json).collect()).unwrap_or_default()
}

fn catalogs_to_json(catalogs: &[WorkbookBundleCatalog]) -> Value {
    Value::Array(catalogs.iter().map(catalog_to_json).collect())
}

/// A bundle whose bytes are tokens of the host
fn bundle_from_json(value: &Value) -> WorkbookBundle<String> {
    let list = |key: &str| value.get(key).and_then(Value::as_array).cloned().unwrap_or_default();
    WorkbookBundle {
        workbook: WorkbookData::from_json(value.get("workbook").unwrap_or(&Value::Null)),
        catalogs: list("catalogs").iter().filter_map(catalog_from_json).collect(),
        scripts: list("scripts")
            .iter()
            .filter_map(|script| Some(ScriptData::new(script.get("name")?.as_str()?, script.get("sql")?.as_str()?)))
            .collect(),
        data: list("data")
            .iter()
            .filter_map(|file| Some(DataFileData { name: file.get("name")?.as_str()?.to_string(), bytes: file.get("bytes")?.as_str()?.to_string() }))
            .collect(),
        results: list("results")
            .iter()
            .filter_map(|result| {
                Some(WorkbookBundleResult {
                    key: result.get("key")?.as_str()?.to_string(),
                    bytes: result.get("bytes")?.as_str()?.to_string(),
                    crc32: result.get("crc32").and_then(Value::as_u64).and_then(|crc| u32::try_from(crc).ok()),
                })
            })
            .collect(),
    }
}

fn bundle_to_json(bundle: &WorkbookBundle<String>) -> Value {
    let mut out = Map::new();
    out.insert("workbook".into(), bundle.workbook.to_json());
    out.insert("catalogs".into(), catalogs_to_json(&bundle.catalogs));
    out.insert("scripts".into(), Value::Array(bundle.scripts.iter().map(|s| json!({ "name": s.name, "sql": s.sql })).collect()));
    out.insert("data".into(), Value::Array(bundle.data.iter().map(|f| json!({ "name": f.name, "bytes": f.bytes })).collect()));
    if !bundle.results.is_empty() {
        out.insert(
            "results".into(),
            Value::Array(
                bundle
                    .results
                    .iter()
                    .map(|r| {
                        let mut result = Map::new();
                        result.insert("key".into(), json!(r.key));
                        result.insert("bytes".into(), json!(r.bytes));
                        if let Some(crc) = r.crc32 {
                            result.insert("crc32".into(), json!(crc));
                        }
                        Value::Object(result)
                    })
                    .collect(),
            ),
        );
    }
    Value::Object(out)
}

fn rows_to_json<R: WorkbookTableRow>(rows: &[R]) -> Value {
    let columns = R::TABLE.columns();
    Value::Array(
        rows.iter()
            .map(|row| {
                let mut object = Map::new();
                for (column, cell) in columns.iter().zip(row.cells()) {
                    let value = match cell {
                        Cell::Text(text) => json!(text),
                        Cell::Integer(value) => json!(value),
                        Cell::Boolean(value) => json!(value),
                    };
                    object.insert(column.name.to_string(), value);
                }
                Value::Object(object)
            })
            .collect(),
    )
}

fn rows_from_json<R: WorkbookTableRow>(value: &Value) -> Result<Vec<R>> {
    let table = R::TABLE;
    let Some(list) = value.as_array() else {
        return Ok(Vec::new());
    };
    let mut rows = Vec::with_capacity(list.len());
    for row in list {
        let mut cells = Vec::new();
        for column in table.columns() {
            let value = row.get(column.name).unwrap_or(&Value::Null);
            let missing = || invalid(format!("Invalid workbook tables: {}.{} is null", table.name(), column.name));
            let cell = match column.column_type {
                ColumnType::Text => match value.as_str() {
                    Some(text) => Cell::Text(Some(text.to_string())),
                    None if column.nullable => Cell::Text(None),
                    None => return Err(missing()),
                },
                ColumnType::Integer => {
                    let integer = value.as_i64().and_then(|v| i32::try_from(v).ok()).ok_or_else(missing)?;
                    Cell::Integer(integer)
                }
                ColumnType::Boolean => Cell::Boolean(value.as_bool().ok_or_else(missing)?),
            };
            cells.push(cell);
        }
        rows.push(R::from_cells(cells));
    }
    Ok(rows)
}

fn tables_to_json(tables: &WorkbookTables<String>) -> Value {
    let mut out = Map::new();
    out.insert(WorkbookTableName::Workbook.name().into(), rows_to_json(&tables.workbook));
    out.insert(WorkbookTableName::Connections.name().into(), rows_to_json(&tables.connections));
    out.insert(WorkbookTableName::Scripts.name().into(), rows_to_json(&tables.scripts));
    out.insert(WorkbookTableName::CatalogTables.name().into(), rows_to_json(&tables.catalog_tables));
    out.insert(WorkbookTableName::CatalogColumns.name().into(), rows_to_json(&tables.catalog_columns));
    out.insert(WorkbookTableName::CatalogFunctions.name().into(), rows_to_json(&tables.catalog_functions));
    out.insert(WorkbookTableName::CatalogFunctionParams.name().into(), rows_to_json(&tables.catalog_function_params));
    out.insert(WorkbookTableName::Attachments.name().into(), rows_to_json(&tables.attachments));
    out.insert(WorkbookTableName::Results.name().into(), rows_to_json(&tables.results));
    out.insert(
        "data".into(),
        Value::Array(
            tables
                .data
                .iter()
                .map(|(name, file)| {
                    let mut entry = Map::new();
                    entry.insert("tableName".into(), json!(name));
                    entry.insert("bytes".into(), json!(file.bytes));
                    if let Some(crc) = file.crc32 {
                        entry.insert("crc32".into(), json!(crc));
                    }
                    Value::Object(entry)
                })
                .collect(),
        ),
    );
    Value::Object(out)
}

fn tables_from_json(value: &Value) -> Result<WorkbookTables<String>> {
    let rows = |table: WorkbookTableName| value.get(table.name()).unwrap_or(&Value::Null);
    let data = value
        .get("data")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|entry| {
                    Some((
                        entry.get("tableName")?.as_str()?.to_string(),
                        DataTableFile {
                            bytes: entry.get("bytes")?.as_str()?.to_string(),
                            crc32: entry.get("crc32").and_then(Value::as_u64).and_then(|crc| u32::try_from(crc).ok()),
                        },
                    ))
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(WorkbookTables {
        workbook: rows_from_json::<WorkbookRow>(rows(WorkbookTableName::Workbook))?,
        connections: rows_from_json::<ConnectionRow>(rows(WorkbookTableName::Connections))?,
        scripts: rows_from_json::<ScriptRow>(rows(WorkbookTableName::Scripts))?,
        catalog_tables: rows_from_json::<CatalogTableRow>(rows(WorkbookTableName::CatalogTables))?,
        catalog_columns: rows_from_json::<CatalogColumnRow>(rows(WorkbookTableName::CatalogColumns))?,
        catalog_functions: rows_from_json::<CatalogFunctionRow>(rows(WorkbookTableName::CatalogFunctions))?,
        catalog_function_params: rows_from_json::<CatalogFunctionParamRow>(rows(WorkbookTableName::CatalogFunctionParams))?,
        attachments: rows_from_json::<AttachmentRow>(rows(WorkbookTableName::Attachments))?,
        results: rows_from_json::<ResultRow>(rows(WorkbookTableName::Results))?,
        data,
    })
}

fn table_name(name: &str) -> Result<WorkbookTableName> {
    WorkbookTableName::parse(name).ok_or_else(|| invalid(format!("unknown workbook table {name}")))
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

fn plan_item_to_json(item: &ConnectionImportPlanItem) -> Value {
    let mut reference = Map::new();
    reference.insert("connectionId".into(), json!(item.reference.connection_id));
    reference.insert("params".into(), item.reference.params.clone());
    if let Some(name) = &item.reference.name {
        reference.insert("name".into(), json!(name));
    }
    let decision = match &item.decision {
        ConnectionImportDecision::Register => json!({ "kind": "register" }),
        ConnectionImportDecision::Link { connection_id } => json!({ "kind": "link", "connectionId": connection_id }),
        ConnectionImportDecision::Ask { candidates } => {
            json!({ "kind": "ask", "candidates": candidates.iter().map(ConnectionEntry::to_json).collect::<Vec<_>>() })
        }
    };
    json!({ "ref": Value::Object(reference), "decision": decision })
}

fn plan_item_from_json(value: &Value) -> Option<ConnectionImportPlanItem> {
    let reference = value.get("ref")?;
    let decision = value.get("decision")?;
    let decision = match decision.get("kind")?.as_str()? {
        "link" => ConnectionImportDecision::Link { connection_id: decision.get("connectionId")?.as_str()?.to_string() },
        "ask" => ConnectionImportDecision::Ask {
            candidates: decision
                .get("candidates")
                .and_then(Value::as_array)
                .map(|list| list.iter().filter_map(ConnectionEntry::from_json).collect())
                .unwrap_or_default(),
        },
        _ => ConnectionImportDecision::Register,
    };
    Some(ConnectionImportPlanItem {
        reference: ImportedConnectionRef {
            connection_id: reference.get("connectionId")?.as_str()?.to_string(),
            params: reference.get("params").cloned().unwrap_or(Value::Null),
            name: reference.get("name").and_then(opt_string),
        },
        decision,
    })
}

fn entries_arg(args: &Value, key: &str) -> Vec<ConnectionEntry> {
    arg(args, key).as_array().map(|list| list.iter().filter_map(ConnectionEntry::from_json).collect()).unwrap_or_default()
}

fn folder_plan_to_json(plan: &FolderArchivePlan) -> Value {
    let entries: Vec<Value> = plan
        .entries
        .iter()
        .map(|(index, entry)| match entry {
            FolderArchiveEntry::Text { path } => json!({ "index": index, "kind": "text", "path": path }),
            FolderArchiveEntry::Script { name } => json!({ "index": index, "kind": "script", "name": name }),
            FolderArchiveEntry::Attachment { name } => json!({ "index": index, "kind": "attachment", "name": name }),
            FolderArchiveEntry::Result { key } => json!({ "index": index, "kind": "result", "key": key }),
        })
        .collect();
    json!({ "kind": "folder", "entries": entries, "scriptError": plan.script_error })
}

fn folder_plan_from_json(value: &Value) -> FolderArchivePlan {
    let entries = value
        .get("entries")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|entry| {
                    let index = usize::try_from(entry.get("index")?.as_u64()?).ok()?;
                    let text = |key: &str| entry.get(key).and_then(opt_string);
                    let kind = match entry.get("kind")?.as_str()? {
                        "text" => FolderArchiveEntry::Text { path: text("path")? },
                        "script" => FolderArchiveEntry::Script { name: text("name")? },
                        "attachment" => FolderArchiveEntry::Attachment { name: text("name")? },
                        "result" => FolderArchiveEntry::Result { key: text("key")? },
                        _ => return None,
                    };
                    Some((index, kind))
                })
                .collect()
        })
        .unwrap_or_default();
    FolderArchivePlan { entries, script_error: value.get("scriptError").and_then(opt_string) }
}

/// Run an operation of the format on JSON arguments
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
        "workbookAttachments" => {
            json!({ "names": workbook_attachments(&strings(arg(args, "names"))).into_iter().map(|a| a.name).collect::<Vec<_>>() })
        }
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
        "readBundleHead" => {
            let files: Vec<(String, String)> = arg(args, "files")
                .as_array()
                .map(|list| {
                    list.iter()
                        .filter_map(|file| Some((file.get(0)?.as_str()?.to_string(), file.get(1)?.as_str()?.to_string())))
                        .collect()
                })
                .unwrap_or_default();
            let mut folder = MigrationFolder::new(files);
            let head = read_workbook_bundle_head(&mut folder, &string_arg(args, "errorPrefix")?)?;
            json!({ "workbook": head.workbook.to_json(), "catalogs": catalogs_to_json(&head.catalogs), "filesValid": head.files_valid })
        }
        "assembleBundle" => {
            let workbook = workbook_arg(args, "workbook");
            let scripts = strings(arg(args, "scripts")).into_iter().map(|name| ScriptData::new(name, "")).collect();
            let data = strings(arg(args, "data")).into_iter().map(|name| DataFileData { name, bytes: () }).collect();
            json!({ "workbook": assemble_workbook_bundle(workbook, Vec::new(), scripts, data).workbook.to_json() })
        }
        "storedBundle" => {
            let workbook = workbook_arg(args, "workbook");
            let scripts = strings(arg(args, "scripts")).into_iter().map(|name| ScriptData::new(name, "")).collect();
            let data = strings(arg(args, "data")).into_iter().map(|name| DataFileData { name, bytes: () }).collect();
            json!({ "workbook": read_workbook_bundle(&workbook, scripts, Vec::new(), data).workbook.to_json() })
        }
        "reconcileStoredFiles" => {
            let reconciled = reconcile_stored_workbook_files(&workbook_arg(args, "workbook"), &strings(arg(args, "scripts")), &strings(arg(args, "data")));
            json!({ "workbook": reconciled.workbook.to_json(), "write": reconciled.write })
        }
        "regenerateConnectionIds" => {
            let (workbook, catalogs) = regenerate_connection_ids(&workbook_arg(args, "workbook"), &catalogs_arg(args, "catalogs"), &mut new_uuid);
            json!({ "workbook": workbook.to_json(), "catalogs": catalogs_to_json(&catalogs) })
        }
        "pruneConnections" => {
            let (workbook, catalogs) = prune_bundle_connections(&workbook_arg(args, "workbook"), &catalogs_arg(args, "catalogs"));
            json!({ "workbook": workbook.to_json(), "catalogs": catalogs_to_json(&catalogs) })
        }
        "renameCatalogs" => {
            let ids: HashMap<String, String> = arg(args, "ids")
                .as_object()
                .map(|object| object.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string()))).collect())
                .unwrap_or_default();
            json!({ "catalogs": catalogs_to_json(&rename_bundle_catalogs(&catalogs_arg(args, "catalogs"), &ids)) })
        }
        "filterInvalidCatalogs" => {
            let (catalogs, invalid_files) = filter_invalid_workbook_catalogs(&catalogs_arg(args, "catalogs"));
            json!({ "catalogs": catalogs_to_json(&catalogs), "invalidFiles": invalid_files })
        }
        "prepareBundleWrite" => {
            let bundle = bundle_from_json(arg(args, "bundle"));
            let backend = if arg(args, "backend").as_str() == Some("native") { StorageType::Native } else { StorageType::Opfs };
            let options = arg(args, "options");
            let options = WorkbookBundleWriteOptions {
                target_workbook_id: options.get("targetWorkbookId").and_then(opt_string),
                suffix_name_with_copy: options.get("suffixNameWithCopy").and_then(Value::as_bool).unwrap_or(false),
                target_is_fresh: options.get("targetIsFresh").and_then(Value::as_bool).unwrap_or(false),
            };
            let write = prepare_workbook_bundle_write(&bundle, backend, &options)?;
            json!({ "workbookId": write.workbook_id, "workbook": write.workbook.to_json(), "rollbackOnFailure": write.rollback_on_failure })
        }
        "catalogSeedFiles" => {
            let catalog = catalog_from_json(arg(args, "catalog")).ok_or_else(|| invalid("invalid catalog"))?;
            let has_catalog = arg(args, "hasCatalog").as_bool().unwrap_or(false);
            json!({ "files": catalog_seed_files(&catalog, has_catalog).into_iter().map(|(file, text)| json!([file, text])).collect::<Vec<_>>() })
        }
        "bundleDifference" => {
            json!({ "difference": describe_workbook_bundle_difference(&bundle_from_json(arg(args, "expected")), &bundle_from_json(arg(args, "actual"))) })
        }
        "bundlesEqual" => json!({ "equal": workbook_bundles_equal(&bundle_from_json(arg(args, "a")), &bundle_from_json(arg(args, "b"))) }),
        "bundleToTables" => {
            let tables = dashql_core_runtime::workbook_format::tables::workbook_bundle_to_tables(&bundle_from_json(arg(args, "bundle")), &CoreCatalogSql, &mut new_uuid)?;
            json!({ "tables": tables_to_json(&tables) })
        }
        "sharedTables" => {
            let tables = shared_workbook_tables(&bundle_from_json(arg(args, "bundle")), &CoreCatalogSql, &mut new_uuid)?;
            json!({ "tables": tables_to_json(&tables) })
        }
        "tablesToBundle" => {
            let tables = tables_from_json(arg(args, "tables"))?;
            let error_prefix = arg(args, "errorPrefix").as_str().unwrap_or("Invalid workbook tables");
            json!({ "bundle": bundle_to_json(&workbook_tables_to_bundle(&tables, error_prefix, &CoreCatalogSql)?) })
        }
        "archiveEntries" => {
            let tables = tables_from_json(arg(args, "tables"))?;
            let entries: Vec<Value> = workbook_archive_entries(&tables)
                .into_iter()
                .map(|entry| {
                    let (table, data) = match entry.source {
                        ArchiveEntrySource::Table(table) => (Some(table.name()), None),
                        ArchiveEntrySource::Data(name) => (None, Some(name)),
                    };
                    json!({ "fileName": entry.file_name, "table": table, "data": data, "stored": entry.compression == EntryCompression::Stored })
                })
                .collect();
            json!({ "entries": entries })
        }
        "planArchive" => {
            let entries: Vec<ArchiveEntry> = arg(args, "entries")
                .as_array()
                .map(|list| {
                    list.iter()
                        .map(|entry| ArchiveEntry {
                            filename: entry.get("filename").and_then(opt_string).unwrap_or_default(),
                            directory: entry.get("directory").and_then(Value::as_bool).unwrap_or(false),
                        })
                        .collect()
                })
                .unwrap_or_default();
            match plan_archive(&entries)? {
                ArchivePlan::Tables(entries) => json!({
                    "kind": "tables",
                    "entries": entries.iter().map(|(index, entry)| match entry {
                        TableArchiveEntry::Table(table) => json!({ "index": index, "table": table.name() }),
                        TableArchiveEntry::Data { table_name, stored_slice } => json!({ "index": index, "data": table_name, "storedSlice": stored_slice }),
                    }).collect::<Vec<_>>(),
                }),
                ArchivePlan::Folder(plan) => folder_plan_to_json(&plan),
            }
        }
        "readFolderArchive" => {
            let plan = folder_plan_from_json(arg(args, "plan"));
            let files = arg(args, "files");
            let bundle = bundle_from_json(files);
            let texts: Vec<(String, String)> = files
                .get("texts")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(|file| Some((file.get(0)?.as_str()?.to_string(), file.get(1)?.as_str()?.to_string())))
                        .collect()
                })
                .unwrap_or_default();
            let read = read_folder_archive(&plan, FolderArchiveFiles { texts, scripts: bundle.scripts, data: bundle.data, results: bundle.results })?;
            json!({ "bundle": bundle_to_json(&read) })
        }
        "sharedExportHead" => {
            let live_params: HashMap<String, Value> =
                arg(args, "liveParams").as_object().map(|object| object.iter().map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default();
            let options = arg(args, "options");
            let options = SharedWorkbookExportOptions {
                with_login_hint: options.get("withLoginHint").and_then(Value::as_bool),
                with_catalog: options.get("withCatalog").and_then(Value::as_bool),
                preserve_uuids: options.get("preserveUUIDs").and_then(Value::as_bool).unwrap_or(false),
                connection_names: options
                    .get("connectionNames")
                    .and_then(Value::as_object)
                    .map(|object| object.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string()))).collect())
                    .unwrap_or_default(),
            };
            let (workbook, catalogs) = shared_export_head(&workbook_arg(args, "workbook"), &catalogs_arg(args, "catalogs"), &live_params, &options, &mut new_uuid);
            json!({ "workbook": workbook.to_json(), "catalogs": catalogs_to_json(&catalogs) })
        }
        "connectionLinkWorkbook" => {
            let name = arg(args, "name").as_str();
            let with_login_hint = arg(args, "withLoginHint").as_bool().unwrap_or(true);
            let created_at = string_arg(args, "createdAt")?;
            json!({ "workbook": connection_link_workbook(arg(args, "params"), name, with_login_hint, &created_at, &mut new_uuid).to_json() })
        }
        "planConnectionImport" => {
            let plan = plan_connection_import(&workbook_arg(args, "workbook"), &entries_arg(args, "entries"));
            json!({ "plan": plan.iter().map(plan_item_to_json).collect::<Vec<_>>() })
        }
        "applyConnectionImportPlan" => {
            let plan: Vec<ConnectionImportPlanItem> =
                arg(args, "plan").as_array().map(|list| list.iter().filter_map(plan_item_from_json).collect()).unwrap_or_default();
            let choices: HashMap<String, ConnectionImportChoice> = arg(args, "choices")
                .as_object()
                .map(|object| {
                    object
                        .iter()
                        .map(|(id, choice)| {
                            let choice = match (choice.get("kind").and_then(Value::as_str), choice.get("connectionId").and_then(opt_string)) {
                                (Some("link"), Some(connection_id)) => ConnectionImportChoice::Link { connection_id },
                                _ => ConnectionImportChoice::Separate,
                            };
                            (id.clone(), choice)
                        })
                        .collect()
                })
                .unwrap_or_default();
            let import = apply_connection_import_plan(&workbook_arg(args, "workbook"), &plan, &choices, &entries_arg(args, "entries"), &mut new_uuid);
            json!({ "workbook": import.workbook.to_json(), "connectionIds": import.connection_ids.iter().map(|(a, b)| json!([a, b])).collect::<Vec<_>>() })
        }
        "connectionRefsChanged" => json!({ "result": connection_refs_changed(&workbook_arg(args, "before"), &workbook_arg(args, "after")) }),
        "resolutionChanged" => json!({ "result": workbook_scripts_resolution_changed(&workbook_arg(args, "stored"), &workbook_arg(args, "resolved")) }),
        "planResultImport" => {
            let sizes: Vec<u64> = arg(args, "sizes")
                .as_array()
                .map(|list| list.iter().map(|size| size.as_f64().filter(|v| v.is_finite() && *v >= 0.0).map_or(u64::MAX, |v| v as u64)).collect())
                .unwrap_or_default();
            // An unlimited cache crosses as null, JSON has no infinity
            let limit = |value: &Value| value.as_f64().filter(|v| v.is_finite() && *v >= 0.0).map_or(u64::MAX, |v| v as u64);
            let capacity = CacheCapacity { max_bytes: limit(arg(args, "maxBytes")), max_files: limit(arg(args, "maxFiles")) };
            let mut outcome = ImportedWorkbookQueryResults::default();
            let add = plan_result_import(&sizes, capacity, &mut outcome);
            json!({ "add": add, "dropped": outcome.dropped })
        }
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

/// The rows of a workbook table as an Arrow IPC stream, from their JSON
#[wasm_bindgen(js_name = encodeWorkbookTable)]
pub fn encode_workbook_table(name: &str, rows: &str) -> std::result::Result<Vec<u8>, JsError> {
    let rows: Value = serde_json::from_str(rows).map_err(|e| JsError::new(&format!("invalid rows: {e}")))?;
    let encode = || -> Result<Vec<u8>> {
        Ok(match table_name(name)? {
            WorkbookTableName::Workbook => encode_table_ipc(&rows_from_json::<WorkbookRow>(&rows)?)?,
            WorkbookTableName::Connections => encode_table_ipc(&rows_from_json::<ConnectionRow>(&rows)?)?,
            WorkbookTableName::Scripts => encode_table_ipc(&rows_from_json::<ScriptRow>(&rows)?)?,
            WorkbookTableName::CatalogTables => encode_table_ipc(&rows_from_json::<CatalogTableRow>(&rows)?)?,
            WorkbookTableName::CatalogColumns => encode_table_ipc(&rows_from_json::<CatalogColumnRow>(&rows)?)?,
            WorkbookTableName::CatalogFunctions => encode_table_ipc(&rows_from_json::<CatalogFunctionRow>(&rows)?)?,
            WorkbookTableName::CatalogFunctionParams => encode_table_ipc(&rows_from_json::<CatalogFunctionParamRow>(&rows)?)?,
            WorkbookTableName::Attachments => encode_table_ipc(&rows_from_json::<AttachmentRow>(&rows)?)?,
            WorkbookTableName::Results => encode_table_ipc(&rows_from_json::<ResultRow>(&rows)?)?,
        })
    };
    encode().map_err(|error| JsError::new(&error.message))
}

/// The rows of a workbook table of an Arrow IPC stream as JSON, e.g. of the scan of its Parquet file. Missing columns
/// of nullable fields read as null, other missing columns fail.
#[wasm_bindgen(js_name = decodeWorkbookTable)]
pub fn decode_workbook_table(name: &str, ipc: &[u8]) -> std::result::Result<String, JsError> {
    let decode = || -> Result<Value> {
        Ok(match table_name(name)? {
            WorkbookTableName::Workbook => rows_to_json(&decode_table_ipc::<WorkbookRow>(ipc)?),
            WorkbookTableName::Connections => rows_to_json(&decode_table_ipc::<ConnectionRow>(ipc)?),
            WorkbookTableName::Scripts => rows_to_json(&decode_table_ipc::<ScriptRow>(ipc)?),
            WorkbookTableName::CatalogTables => rows_to_json(&decode_table_ipc::<CatalogTableRow>(ipc)?),
            WorkbookTableName::CatalogColumns => rows_to_json(&decode_table_ipc::<CatalogColumnRow>(ipc)?),
            WorkbookTableName::CatalogFunctions => rows_to_json(&decode_table_ipc::<CatalogFunctionRow>(ipc)?),
            WorkbookTableName::CatalogFunctionParams => rows_to_json(&decode_table_ipc::<CatalogFunctionParamRow>(ipc)?),
            WorkbookTableName::Attachments => rows_to_json(&decode_table_ipc::<AttachmentRow>(ipc)?),
            WorkbookTableName::Results => rows_to_json(&decode_table_ipc::<ResultRow>(ipc)?),
        })
    };
    decode().map(|rows| rows.to_string()).map_err(|error| JsError::new(&error.message))
}

/// A link that carries an archive inline, base64url-encoded once in the `zip` parameter
#[wasm_bindgen(js_name = workbookLink)]
pub fn workbook_link_of(archive: &[u8], link_base: &str) -> String {
    workbook_link(archive, link_base)
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
