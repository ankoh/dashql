//! The storage format of workbooks: the files of a workbook, their validation, bundles, the workbook tables, the
//! migrations of workbooks and their persistence.

use std::collections::HashMap;

use serde_json::{json, Value};

use dashql_core::error::Result;
use dashql_core_runtime::connections::ConnectorType;
use dashql_core_storage::storage::workbook_file::{properties_patch, upsert_connection_entry};
use dashql_core_storage::workbook_format::bundle::*;
use dashql_core_storage::workbook_format::catalog::*;
use dashql_core_storage::workbook_format::connection_import::*;
use dashql_core_storage::workbook_format::data::*;
use dashql_core_storage::workbook_format::export::*;
use dashql_core_storage::workbook_format::files::*;
use dashql_core_storage::workbook_format::import::*;
use dashql_core_storage::workbook_format::layout::StorageType;
use dashql_core_storage::workbook_format::migration::*;
use dashql_core_storage::workbook_format::restore::*;
use dashql_core_runtime::connections::sharing::sanitize_connection_params_for_sharing;
use dashql_core_storage::workbook_format::tables::*;
use dashql_core_storage::workbook_format::validation::*;

const TEST_WORKBOOK_ID: &str = "11111111-2222-4333-8444-555555555555";
const TEST_CONNECTION_ID: &str = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_CONNECTION_ID: &str = "ffffffff-eeee-4ddd-8ccc-bbbbbbbbbbbb";

/// The JSON of a test workbook with fields replaced
fn test_workbook_json(overrides: Value) -> Value {
    let mut workbook = json!({
        "formatVersion": 11,
        "workbookId": TEST_WORKBOOK_ID,
        "name": "V2 Workbook",
        "connections": [{ "connectionId": TEST_CONNECTION_ID, "params": { "hyper": {} } }],
        "scripts": [],
        "attachments": [],
        "metadata": {},
    });
    if let (Some(target), Some(fields)) = (workbook.as_object_mut(), overrides.as_object()) {
        for (key, value) in fields {
            target.insert(key.clone(), value.clone());
        }
    }
    workbook
}

fn test_workbook(overrides: Value) -> WorkbookData {
    WorkbookData::from_json(&test_workbook_json(overrides))
}

fn script(name: &str, connection_id: &str) -> WorkbookScript {
    WorkbookScript::new(name, connection_id)
}

fn names(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

/// UUIDs counting up
fn uuids() -> impl FnMut() -> String {
    let mut n = 0u32;
    move || {
        n += 1;
        format!("00000000-0000-4000-8000-{n:012}")
    }
}

// ---- workbook_files.test.ts ---------------------------------------------------------------------

#[test]
fn keeps_the_order_of_the_listed_scripts_and_appends_unlisted_files_in_natural_order() {
    let result = reconcile_workbook_scripts(
        &[script("10_b.sql", OTHER_CONNECTION_ID), script("missing.sql", TEST_CONNECTION_ID), script("2_a.sql", TEST_CONNECTION_ID)],
        &names(&["2_a.sql", "10_b.sql", "3_new.sql", "20_new.sql"]),
        TEST_CONNECTION_ID,
    );
    assert_eq!(
        result,
        ReconciledWorkbookScripts {
            scripts: vec![
                script("10_b.sql", OTHER_CONNECTION_ID),
                script("2_a.sql", TEST_CONNECTION_ID),
                script("3_new.sql", TEST_CONNECTION_ID),
                script("20_new.sql", TEST_CONNECTION_ID),
            ],
            changed: true,
        }
    );
}

#[test]
fn reports_an_unchanged_list_and_follows_the_case_of_the_files() {
    let scripts = vec![script("a.sql", TEST_CONNECTION_ID)];
    assert_eq!(
        reconcile_workbook_scripts(&scripts, &names(&["a.sql"]), TEST_CONNECTION_ID),
        ReconciledWorkbookScripts { scripts: scripts.clone(), changed: false }
    );
    let mut both = scripts.clone();
    both.push(script("A.SQL", OTHER_CONNECTION_ID));
    assert_eq!(
        reconcile_workbook_scripts(&both, &names(&["A.sql"]), TEST_CONNECTION_ID),
        ReconciledWorkbookScripts { scripts: vec![script("A.sql", TEST_CONNECTION_ID)], changed: true }
    );
}

#[test]
fn drops_unusable_entries_of_a_hand_edited_workbook_file() {
    let files = sanitize_workbook_files(&test_workbook(json!({
        "scripts": [
            { "name": "../escape.sql", "connectionId": TEST_CONNECTION_ID },
            { "name": "dashql-draft.sql", "connectionId": TEST_CONNECTION_ID },
            { "name": "notes.txt", "connectionId": TEST_CONNECTION_ID },
            { "name": "a.sql", "connectionId": "not-a-uuid" },
            { "name": "b.sql", "connectionId": TEST_CONNECTION_ID },
            { "name": "B.sql", "connectionId": TEST_CONNECTION_ID },
        ],
        "attachments": [{ "name": "10.parquet" }, { "name": "2.parquet" }, { "name": "a/b.parquet" }, { "name": "notes.csv" }],
    })));
    // A workbook attaches Parquet files only
    assert_eq!(files.scripts, vec![script("b.sql", TEST_CONNECTION_ID)]);
    assert_eq!(files.attachments, vec![WorkbookAttachment { name: "2.parquet".into() }, WorkbookAttachment { name: "10.parquet".into() }]);
    assert!(!files.valid);
    assert!(sanitize_workbook_files(&test_workbook(json!({}))).valid);
    let mut without_scripts = test_workbook_json(json!({}));
    without_scripts.as_object_mut().unwrap().shift_remove("scripts");
    let files = sanitize_workbook_files(&WorkbookData::from_json(&without_scripts));
    assert!(files.scripts.is_empty());
    assert!(!files.valid);
    // Entries that aren't objects with names are unusable as well
    let files = sanitize_workbook_files(&test_workbook(json!({ "scripts": [5, { "name": 1 }], "attachments": "x" })));
    assert!(files.scripts.is_empty() && !files.valid);
}

#[test]
fn sorts_attachments_and_remaps_the_connections_of_scripts() {
    assert_eq!(
        workbook_attachments(&names(&["10.parquet", "2.parquet"])),
        vec![WorkbookAttachment { name: "2.parquet".into() }, WorkbookAttachment { name: "10.parquet".into() }]
    );
    let map = HashMap::from([(TEST_CONNECTION_ID.to_string(), "new".to_string())]);
    assert_eq!(
        remap_workbook_scripts(&[script("a.sql", TEST_CONNECTION_ID), script("b.sql", OTHER_CONNECTION_ID)], &map),
        vec![script("a.sql", "new"), script("b.sql", OTHER_CONNECTION_ID)]
    );
}

fn trino_copy() -> WorkbookConnection {
    WorkbookConnection::new(OTHER_CONNECTION_ID, json!({ "trino": { "endpoint": "https://trino.example" } }))
}

#[test]
fn holds_the_connections_of_the_scripts_in_the_order_the_scripts_first_use_them() {
    let scripts = vec![script("a.sql", OTHER_CONNECTION_ID), script("b.sql", TEST_CONNECTION_ID), script("c.sql", OTHER_CONNECTION_ID)];
    let next = with_workbook_scripts(&test_workbook(json!({})), scripts, &[trino_copy()]);
    assert_eq!(next.connections.iter().map(|c| c.connection_id.as_str()).collect::<Vec<_>>(), [OTHER_CONNECTION_ID, TEST_CONNECTION_ID]);
}

#[test]
fn drops_a_connection_that_no_script_uses() {
    let mut workbook = test_workbook(json!({}));
    workbook.connections.push(trino_copy());
    let next = with_workbook_scripts(&workbook, vec![script("a.sql", OTHER_CONNECTION_ID)], &[]);
    assert_eq!(next.connections, vec![trino_copy()]);
}

#[test]
fn keeps_the_connection_of_the_next_script_in_a_workbook_without_scripts() {
    let workbook = test_workbook(json!({}));
    assert_eq!(with_workbook_scripts(&workbook, vec![], &[]).connections, workbook.connections);
    assert_eq!(with_workbook_scripts(&workbook, vec![], &[trino_copy()]).connections, vec![trino_copy()]);
}

#[test]
fn appends_script_files_without_an_entry_on_the_connection_of_the_script_before_them() {
    let reconciled = reconcile_workbook_scripts(&[script("a.sql", OTHER_CONNECTION_ID)], &names(&["a.sql", "b.sql"]), TEST_CONNECTION_ID);
    assert_eq!(reconciled.scripts, vec![script("a.sql", OTHER_CONNECTION_ID), script("b.sql", OTHER_CONNECTION_ID)]);
    assert_eq!(reconcile_workbook_scripts(&[], &names(&["a.sql"]), TEST_CONNECTION_ID).scripts, vec![script("a.sql", TEST_CONNECTION_ID)]);
}

// ---- workbook_validation.test.ts ----------------------------------------------------------------

const UUID: &str = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const CONNECTION_ID: &str = "11111111-2222-3333-4444-555555555555";
const REMOTE_CONNECTION_ID: &str = "66666666-7777-8888-9999-aaaaaaaaaaaa";

fn validation_workbook(overrides: Value) -> Value {
    let mut workbook = json!({
        "formatVersion": 11,
        "workbookId": UUID,
        "connections": [{ "connectionId": CONNECTION_ID, "params": { "hyper": {} } }],
        "scripts": [],
        "attachments": [],
        "metadata": {},
    });
    for (key, value) in overrides.as_object().unwrap() {
        workbook.as_object_mut().unwrap().insert(key.clone(), value.clone());
    }
    workbook
}

fn with_connection(connection: Value) -> Value {
    validation_workbook(json!({ "connections": [connection] }))
}

#[test]
fn validates_workbook_files() {
    use WorkbookValidationError::*;
    assert_eq!(validate_workbook_json(&validation_workbook(json!({}))), Ok(()));
    // Each known remote connector after the local database
    let local = json!({ "connectionId": CONNECTION_ID, "params": { "hyper": { "protocol": "WASM" } } });
    for params in [json!({ "hyper": { "protocol": "V3_HTTP" } }), json!({ "salesforce": {} }), json!({ "trino": {} })] {
        let workbook = validation_workbook(json!({ "connections": [{ "connectionId": REMOTE_CONNECTION_ID, "params": params }, local] }));
        assert_eq!(validate_workbook_json(&workbook), Ok(()));
    }
    // Removed connectors
    assert_eq!(validate_workbook_json(&with_connection(json!({ "connectionId": CONNECTION_ID, "params": { "duckdb": {} } }))), Err(UnknownConnector));
    assert_eq!(validate_workbook_json(&with_connection(json!({ "connectionId": CONNECTION_ID, "params": { "dataless": {} } }))), Err(UnknownConnector));
    assert_eq!(validate_workbook_json(&validation_workbook(json!({ "workbookId": "" }))), Err(MissingWorkbookId));
    for bad in ["imported-1700000000000".to_string(), format!("opfs://workbooks/{UUID}"), "not-a-uuid".to_string(), format!("{UUID}-extra")] {
        assert_eq!(validate_workbook_json(&validation_workbook(json!({ "workbookId": bad }))), Err(InvalidWorkbookId));
    }
    assert_eq!(validate_workbook_json(&validation_workbook(json!({ "workbookId": UUID.to_uppercase() }))), Ok(()));
    for version in [json!(null), json!(1), json!(2), json!(5), json!(10), json!(12), json!("11")] {
        assert_eq!(validate_workbook_json(&validation_workbook(json!({ "formatVersion": version }))), Err(UnsupportedFormatVersion));
    }
    let mut without = validation_workbook(json!({}));
    without.as_object_mut().unwrap().shift_remove("connections");
    assert_eq!(validate_workbook_json(&without), Err(InvalidConnections));
    assert_eq!(validate_workbook_json(&validation_workbook(json!({ "connections": [] }))), Err(InvalidConnections));
    assert_eq!(
        validate_workbook_json(&validation_workbook(json!({ "connections": [
            { "connectionId": CONNECTION_ID, "params": { "hyper": {} } },
            { "connectionId": REMOTE_CONNECTION_ID, "params": { "trino": {} } },
            { "connectionId": "bbbbbbbb-cccc-dddd-eeee-ffffffffffff", "params": { "salesforce": {} } },
        ] }))),
        Ok(())
    );
    for id in ["", "not-a-uuid", CONNECTION_ID] {
        let workbook = validation_workbook(json!({ "connections": [
            { "connectionId": CONNECTION_ID, "params": { "hyper": {} } },
            { "connectionId": id, "params": { "trino": {} } },
        ] }));
        assert_eq!(validate_workbook_json(&workbook), Err(InvalidConnectionId));
    }
    assert_eq!(validate_workbook_json(&with_connection(json!({ "connectionId": CONNECTION_ID }))), Err(MissingConnectionParams));
    assert_eq!(validate_workbook_json(&with_connection(json!({ "connectionId": CONNECTION_ID, "params": { "garbage": "data" } }))), Err(UnknownConnector));
    // A draft of another connector
    assert_eq!(
        validate_workbook_json(&with_connection(json!({ "connectionId": CONNECTION_ID, "params": { "hyper": {} }, "paramsDraft": { "trino": {} } }))),
        Err(UnknownConnector)
    );
    // Untrusted files never panic
    for value in [json!(null), json!([]), json!("x"), json!({ "formatVersion": 11, "workbookId": 5 }), json!({ "formatVersion": 11, "workbookId": UUID, "connections": [5] })] {
        assert!(validate_workbook_json(&value).is_err());
    }
}

#[test]
fn describes_validation_errors_and_invalid_workbooks() {
    for error in WorkbookValidationError::ALL {
        assert!(!error.describe().is_empty());
    }
    assert_eq!(WorkbookValidationError::WorkbookUnreadable.describe(), "Workbook files missing");
    let data = WorkbookData::from_json(&validation_workbook(json!({ "name": "My Workbook" })));
    let invalid = describe_invalid_workbook(UUID, WorkbookValidationError::UnknownConnector, Some(&data));
    assert_eq!(invalid, InvalidWorkbook { workbook_id: UUID.into(), title: "My Workbook".into(), connector_type: Some(ConnectorType::Hyper), error: WorkbookValidationError::UnknownConnector });
    // The entry path is the key, even when the workbook data has a different id
    let data = WorkbookData::from_json(&validation_workbook(json!({ "workbookId": "imported-123" })));
    assert_eq!(describe_invalid_workbook(UUID, WorkbookValidationError::InvalidWorkbookId, Some(&data)).workbook_id, UUID);
    let invalid = describe_invalid_workbook(UUID, WorkbookValidationError::MissingWorkbookId, None);
    assert_eq!((invalid.title.as_str(), invalid.connector_type), (UUID, None));
    let data = WorkbookData::from_json(&with_connection(json!({ "connectionId": CONNECTION_ID, "params": { "garbage": "data" } })));
    assert_eq!(describe_invalid_workbook(UUID, WorkbookValidationError::UnknownConnector, Some(&data)).connector_type, None);
}

#[test]
fn recognizes_the_embedded_database() {
    assert!(is_local_hyper_wasm_params(&json!({ "hyper": {} })));
    assert!(is_local_hyper_wasm_params(&json!({ "hyper": { "protocol": "WASM", "attachedDatabases": [{ "path": "tpch.hyper", "alias": "tpch" }] } })));
    assert!(!is_local_hyper_wasm_params(&json!({ "hyper": { "protocol": "WASM", "attachedDatabases": [{ "path": "clouds/local.hyper", "alias": "dashql" }] } })));
    assert!(!is_local_hyper_wasm_params(&json!({ "hyper": { "protocol": "V3_HTTP" } })));
    assert!(!is_local_hyper_wasm_params(&json!({ "trino": {} })));
}

#[test]
fn round_trips_the_workbook_file() {
    let json = test_workbook_json(json!({
        "storageType": "native",
        "metadata": { "createdAt": "2026-01-01T00:00:00Z", "ephemeral": true, "cloud": { "workbookId": "w", "versionId": "v", "connectionId": "c" }, "future": 1 },
        "connections": [{ "connectionId": TEST_CONNECTION_ID, "params": { "hyper": {} }, "paramsDraft": { "hyper": { "endpoint": "x" } }, "other": true }],
        "unknown": [1, 2],
    }));
    let data = WorkbookData::from_json(&json);
    assert!(!data.malformed_lists);
    assert_eq!(data.storage_type, Some(StorageType::Native));
    assert!(data.metadata.is_ephemeral());
    assert_eq!(data.to_json(), json);
    assert_eq!(WorkbookData::from_text(&data.to_text()), Some(data));
}

// ---- workbook migrations ------------------------------------------------------------------------

const SESSION_ID: &str = "11111111-2222-4333-8444-555555555555";
const LAST_SESSION_FORMAT_VERSION: i64 = 10;

fn notebook_folder() -> MigrationFolder {
    MigrationFolder::new([
        ("dashql-notebook.json", json!({ "formatVersion": 2, "notebookId": SESSION_ID, "notebookPath": "opfs://notebooks/x", "name": "n" }).to_string()),
        ("dashql-notebook-index.json", r#"{"scripts":[]}"#.to_string()),
        ("dashql-relations.sql", "relations".to_string()),
        ("dashql-functions.sql", "functions".to_string()),
    ])
}

fn metadata(folder: &MigrationFolder, name: &str) -> Value {
    serde_json::from_str(folder.read(name).unwrap()).unwrap()
}

fn keys(value: &Value) -> Vec<&str> {
    value.as_object().unwrap().keys().map(String::as_str).collect()
}

#[test]
fn ends_with_the_current_format_version() {
    let versions: Vec<i64> = WORKBOOK_MIGRATION_STEPS.iter().map(|step| step.version).collect();
    assert_eq!(versions, (3..=WORKBOOK_FORMAT_VERSION).collect::<Vec<_>>());
}

#[test]
fn brings_a_notebook_folder_to_the_current_format() {
    let mut folder = notebook_folder();
    assert_eq!(migrate_workbook_folder(&mut folder).unwrap(), WorkbookMigrationResult::Migrated);
    // The catalog copies are gone, the catalog belongs to the connection
    assert_eq!(folder.names(), ["dashql-workbook.json"]);
    let data = metadata(&folder, "dashql-workbook.json");
    assert_eq!(
        data,
        json!({ "formatVersion": 11, "workbookId": SESSION_ID, "workbookPath": "opfs://notebooks/x", "name": "n", "scripts": [], "attachments": [], "connections": [] })
    );
    assert_eq!(keys(&data), ["formatVersion", "workbookId", "workbookPath", "name", "scripts", "attachments", "connections"]);
    // The host writes the new file and removes the old ones
    let changes = folder.changes();
    assert!(matches!(changes.first(), Some(FolderChange::Write { name, .. }) if name == "dashql-workbook.json"));
    assert_eq!(changes.iter().filter(|c| matches!(c, FolderChange::Remove { .. })).count(), 4);

    // A migrated folder stays as it is
    let mut current = MigrationFolder::new(folder.files().to_vec());
    assert_eq!(migrate_workbook_folder(&mut current).unwrap(), WorkbookMigrationResult::Current);
    assert!(current.changes().is_empty());
}

#[test]
fn stops_at_a_target_version() {
    let mut folder = notebook_folder();
    assert_eq!(migrate_workbook_folder_to(&mut folder, 3, &WORKBOOK_MIGRATION_STEPS).unwrap(), WorkbookMigrationResult::Migrated);
    assert_eq!(metadata(&folder, "dashql-notebook.json")["formatVersion"], json!(3));
    assert!(folder.exists("dashql-catalog-relations.sql"));
    assert!(!folder.exists("dashql-session.json"));
}

#[test]
fn leaves_unusable_folders_untouched() {
    let cases: Vec<(Vec<(&str, String)>, WorkbookMigrationResult)> = vec![
        (vec![], WorkbookMigrationResult::Missing),
        (vec![("dashql-session.json", "{}".into())], WorkbookMigrationResult::Unsupported),
        (vec![("dashql-notebook.json", r#"{"formatVersion":1}"#.into())], WorkbookMigrationResult::Unsupported),
        (vec![("dashql-session.json", "{".into())], WorkbookMigrationResult::Unsupported),
        (vec![("dashql-session.json", format!(r#"{{"formatVersion":{}}}"#, WORKBOOK_FORMAT_VERSION + 1))], WorkbookMigrationResult::Newer),
    ];
    for (mut files, result) in cases {
        files.push(("dashql-relations.sql", "relations".into()));
        let mut folder = MigrationFolder::new(files);
        assert_eq!(migrate_workbook_folder(&mut folder).unwrap(), result);
        assert!(folder.changes().is_empty());
    }
}

fn failing_step(_: &mut MigrationFolder) -> Result<()> {
    Err(dashql_core::error::Error::invalid_argument("interrupted"))
}
fn first_step(folder: &mut MigrationFolder) -> Result<()> {
    folder.write("a", "a");
    Ok(())
}
fn second_step(folder: &mut MigrationFolder) -> Result<()> {
    folder.write("b", "b");
    Ok(())
}

#[test]
fn repeats_an_interrupted_step() {
    let interrupted = [
        WorkbookMigrationStep { version: 3, description: "first", migrate: first_step },
        WorkbookMigrationStep { version: 4, description: "second", migrate: failing_step },
    ];
    let mut folder = MigrationFolder::new([("dashql-session.json", r#"{"formatVersion":2}"#)]);
    assert_eq!(migrate_workbook_folder_to(&mut folder, 4, &interrupted).unwrap_err().message, "interrupted");
    assert_eq!(metadata(&folder, "dashql-session.json")["formatVersion"], json!(3));
    // The host applied the finished step, the next migration repeats the second one
    let mut folder = MigrationFolder::new(folder.files().to_vec());
    let steps = [interrupted[0], WorkbookMigrationStep { version: 4, description: "second", migrate: second_step }];
    assert_eq!(migrate_workbook_folder_to(&mut folder, 4, &steps).unwrap(), WorkbookMigrationResult::Migrated);
    assert_eq!(metadata(&folder, "dashql-session.json")["formatVersion"], json!(4));
    assert_eq!(folder.read("b"), Some("b"));
}

#[test]
fn lists_the_main_and_the_attached_databases_as_connections_in_place_of_the_main_database() {
    let main = json!({ "databaseId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "params": { "hyper": {} } });
    let attached = json!({ "databaseId": "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", "params": { "trino": {} }, "paramsDraft": { "trino": { "endpoint": "x" } } });
    let mut folder = MigrationFolder::new([(
        "dashql-session.json",
        json!({ "formatVersion": 4, "sessionId": SESSION_ID, "name": "n", "mainDatabase": main, "attachedDatabases": [attached], "metadata": {} }).to_string(),
    )]);
    assert_eq!(migrate_workbook_folder_to(&mut folder, LAST_SESSION_FORMAT_VERSION, &WORKBOOK_MIGRATION_STEPS).unwrap(), WorkbookMigrationResult::Migrated);
    let data = metadata(&folder, "dashql-session.json");
    // A session without scripts keeps the main database, its first script runs on it
    assert_eq!(
        data,
        json!({
            "formatVersion": 10, "sessionId": SESSION_ID, "name": "n",
            "connections": [{ "connectionId": main["databaseId"], "params": main["params"] }],
            "metadata": {}, "scripts": [], "attachments": [],
        })
    );
    assert_eq!(keys(&data), ["formatVersion", "sessionId", "name", "connections", "metadata", "scripts", "attachments"]);
}

#[test]
fn turns_the_databases_of_a_version_5_session_into_connections() {
    let main = json!({ "databaseId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "params": { "hyper": {} } });
    let attached = json!({ "databaseId": "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", "params": { "trino": {} } });
    let mut folder = MigrationFolder::new([(
        "dashql-session.json",
        json!({
            "formatVersion": 5, "sessionId": SESSION_ID, "mainDatabase": main, "attachedDatabases": [attached],
            "scripts": [{ "name": "b.sql", "databaseId": attached["databaseId"] }, { "name": "a.sql", "databaseId": main["databaseId"] }],
            "attachments": [], "metadata": {},
        })
        .to_string(),
    )]);
    assert_eq!(migrate_workbook_folder_to(&mut folder, LAST_SESSION_FORMAT_VERSION, &WORKBOOK_MIGRATION_STEPS).unwrap(), WorkbookMigrationResult::Migrated);
    assert_eq!(
        metadata(&folder, "dashql-session.json"),
        json!({
            "formatVersion": 10, "sessionId": SESSION_ID,
            "connections": [
                { "connectionId": attached["databaseId"], "params": attached["params"] },
                { "connectionId": main["databaseId"], "params": main["params"] },
            ],
            "scripts": [{ "name": "b.sql", "connectionId": attached["databaseId"] }, { "name": "a.sql", "connectionId": main["databaseId"] }],
            "attachments": [], "metadata": {},
        })
    );
    // Repeating the steps changes nothing
    let before = folder.read("dashql-session.json").unwrap().to_string();
    for version in [6, 8] {
        let step = WORKBOOK_MIGRATION_STEPS.iter().find(|step| step.version == version).unwrap();
        (step.migrate)(&mut folder).unwrap();
    }
    assert_eq!(folder.read("dashql-session.json"), Some(before.as_str()));
}

#[test]
fn drops_the_default_connection_and_the_connections_that_no_script_uses() {
    let wasm = json!({ "connectionId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "params": { "hyper": { "protocol": "WASM" } } });
    let trino = json!({ "connectionId": "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", "params": { "trino": {} } });
    let mut folder = MigrationFolder::new([(
        "dashql-session.json",
        json!({
            "formatVersion": 7, "sessionId": SESSION_ID, "defaultConnectionId": wasm["connectionId"], "connections": [wasm, trino],
            "scripts": [{ "name": "a.sql", "connectionId": trino["connectionId"] }], "attachments": [], "metadata": {},
        })
        .to_string(),
    )]);
    migrate_workbook_folder_to(&mut folder, LAST_SESSION_FORMAT_VERSION, &WORKBOOK_MIGRATION_STEPS).unwrap();
    assert_eq!(
        metadata(&folder, "dashql-session.json"),
        json!({
            "formatVersion": 10, "sessionId": SESSION_ID, "connections": [trino],
            "scripts": [{ "name": "a.sql", "connectionId": trino["connectionId"] }], "attachments": [], "metadata": {},
        })
    );
}

#[test]
fn moves_the_params_of_sidb_connections_to_the_key_dbcom() {
    let params = json!({ "instanceUrl": "https://example.my.salesforce.com", "databaseName": "sales" });
    let draft = json!({ "instanceUrl": "https://example.my.salesforce.com", "databaseName": "draft" });
    let trino = json!({ "connectionId": "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff", "params": { "trino": { "endpoint": "http://localhost:8080" } } });
    let mut folder = MigrationFolder::new([(
        "dashql-session.json",
        json!({
            "formatVersion": 9, "sessionId": SESSION_ID, "scripts": [], "attachments": [], "metadata": {},
            "connections": [{ "connectionId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "params": { "sidb": params }, "paramsDraft": { "sidb": draft } }, trino],
        })
        .to_string(),
    )]);
    migrate_workbook_folder_to(&mut folder, LAST_SESSION_FORMAT_VERSION, &WORKBOOK_MIGRATION_STEPS).unwrap();
    let data = metadata(&folder, "dashql-session.json");
    let expected = json!([{ "connectionId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "params": { "dbcom": params }, "paramsDraft": { "dbcom": draft } }, trino]);
    assert_eq!(data["connections"], expected);
    // The connections are valid ones of a workbook
    let mut workbook = data.clone();
    let object = workbook.as_object_mut().unwrap();
    object.shift_remove("sessionId");
    object.insert("workbookId".into(), json!(SESSION_ID));
    object.insert("formatVersion".into(), json!(11));
    assert_eq!(validate_workbook_json(&workbook), Ok(()));
    // Repeating the step changes nothing
    let step = WORKBOOK_MIGRATION_STEPS.iter().find(|step| step.version == 10).unwrap();
    (step.migrate)(&mut folder).unwrap();
    assert_eq!(metadata(&folder, "dashql-session.json")["connections"], expected);
}

#[test]
fn moves_the_index_into_the_session_metadata_with_the_default_connection() {
    let connection_id = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    let mut folder = MigrationFolder::new([
        ("dashql-session.json", json!({ "formatVersion": 4, "sessionId": SESSION_ID, "mainDatabase": { "databaseId": connection_id } }).to_string()),
        ("dashql-session-index.json", json!({ "scripts": [{ "name": "10_b.sql" }, { "name": "2_a.sql" }], "data": [{ "name": "x.csv" }] }).to_string()),
    ]);
    migrate_workbook_folder_to(&mut folder, LAST_SESSION_FORMAT_VERSION, &WORKBOOK_MIGRATION_STEPS).unwrap();
    assert!(!folder.exists("dashql-session-index.json"));
    let data = metadata(&folder, "dashql-session.json");
    assert_eq!(data["formatVersion"], json!(10));
    assert_eq!(data["scripts"], json!([{ "name": "10_b.sql", "connectionId": connection_id }, { "name": "2_a.sql", "connectionId": connection_id }]));
    assert_eq!(data["attachments"], json!([{ "name": "x.csv" }]));
    // Repeating the step keeps the moved list and only removes the index
    folder.write("dashql-session-index.json", r#"{"scripts":[]}"#);
    let step = WORKBOOK_MIGRATION_STEPS.iter().find(|step| step.version == 5).unwrap();
    (step.migrate)(&mut folder).unwrap();
    assert!(!folder.exists("dashql-session-index.json"));
    assert_eq!(metadata(&folder, "dashql-session.json")["scripts"], data["scripts"]);
}

#[test]
fn lists_no_scripts_of_a_folder_without_a_readable_index() {
    for index in [None, Some("{")] {
        let mut files = vec![("dashql-session.json", json!({ "formatVersion": 4, "sessionId": SESSION_ID, "mainDatabase": { "databaseId": "x" } }).to_string())];
        if let Some(index) = index {
            files.push(("dashql-session-index.json", index.to_string()));
        }
        let mut folder = MigrationFolder::new(files);
        migrate_workbook_folder_to(&mut folder, LAST_SESSION_FORMAT_VERSION, &WORKBOOK_MIGRATION_STEPS).unwrap();
        assert!(!folder.exists("dashql-session-index.json"));
        let data = metadata(&folder, "dashql-session.json");
        assert_eq!((&data["scripts"], &data["attachments"]), (&json!([]), &json!([])));
    }
}

#[test]
fn removes_the_catalog_copies_and_the_settings() {
    let mut folder = MigrationFolder::new([
        ("dashql-session.json", json!({ "formatVersion": 6, "sessionId": SESSION_ID, "defaultConnectionId": "x", "connections": [] }).to_string()),
        ("dashql-catalog-relations.sql", "relations".into()),
        ("dashql-catalog-functions.sql", "functions".into()),
        ("dashql-catalog-changes.sql", "changes".into()),
    ]);
    migrate_workbook_folder_to(&mut folder, 7, &WORKBOOK_MIGRATION_STEPS).unwrap();
    assert_eq!(folder.names(), ["dashql-session.json"]);
    assert_eq!(metadata(&folder, "dashql-session.json")["formatVersion"], json!(7));

    let session = json!({ "sessionId": SESSION_ID, "connections": [], "scripts": [{ "name": "a.sql", "connectionId": "x" }], "attachments": [], "metadata": {} });
    let mut stored = json!({ "formatVersion": 8 });
    for (key, value) in session.as_object().unwrap() {
        stored.as_object_mut().unwrap().insert(key.clone(), value.clone());
    }
    stored.as_object_mut().unwrap().insert("settings".into(), json!({ "cacheQueryResults": true }));
    let mut folder = MigrationFolder::new([("dashql-session.json", stored.to_string())]);
    migrate_workbook_folder_to(&mut folder, LAST_SESSION_FORMAT_VERSION, &WORKBOOK_MIGRATION_STEPS).unwrap();
    let mut expected = json!({ "formatVersion": 10 });
    for (key, value) in session.as_object().unwrap() {
        expected.as_object_mut().unwrap().insert(key.clone(), value.clone());
    }
    assert_eq!(metadata(&folder, "dashql-session.json"), expected);
}

#[test]
fn renames_a_session_as_workbook() {
    let mut folder = MigrationFolder::new([
        (
            "dashql-session.json",
            json!({
                "formatVersion": 10, "sessionId": SESSION_ID, "sessionPath": "opfs://sessions/x",
                "connections": [{ "connectionId": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", "params": { "hyper": {} } }],
                "scripts": [], "attachments": [], "metadata": {}, "name": "n",
            })
            .to_string(),
        ),
        ("dashql-catalog-relations.sql", "relations".into()),
    ]);
    assert_eq!(migrate_workbook_folder(&mut folder).unwrap(), WorkbookMigrationResult::Migrated);
    let mut names = folder.names();
    names.sort();
    assert_eq!(names, ["dashql-catalog-relations.sql", "dashql-workbook.json"]);
    let data = metadata(&folder, "dashql-workbook.json");
    assert_eq!(keys(&data)[..3], ["formatVersion", "workbookId", "workbookPath"]);
    assert_eq!(validate_workbook_json(&data), Ok(()));
}

// ---- workbook_bundle.test.ts --------------------------------------------------------------------

#[test]
fn drops_the_catalog_files_that_do_not_parse() {
    let catalog = |id: &str, relations: Option<&str>, functions: Option<&str>| WorkbookBundleCatalog {
        connection_id: id.into(),
        relations: relations.map(str::to_string),
        functions: functions.map(str::to_string),
    };
    let valid = vec![catalog("c1", Some("create table t (a int);"), None)];
    assert_eq!(filter_invalid_workbook_catalogs(&valid), (valid.clone(), vec![]));
    let (filtered, invalid) = filter_invalid_workbook_catalogs(&[
        catalog("c1", Some("create table t (a int);"), Some("create function (")),
        catalog("c2", Some("create tabel t;"), None),
    ]);
    assert_eq!(filtered, vec![catalog("c1", Some("create table t (a int);"), None), catalog("c2", None, None)]);
    assert_eq!(invalid, ["connections/c1/dashql-catalog-functions.sql", "connections/c2/dashql-catalog-relations.sql"]);
}

#[test]
fn renames_the_connections_and_keeps_the_first_catalog_of_merged_connections() {
    let catalog = |id: &str, relations: &str| WorkbookBundleCatalog { connection_id: id.into(), relations: Some(relations.into()), functions: None };
    let ids = HashMap::from([("a".to_string(), "x".to_string()), ("b".to_string(), "x".to_string())]);
    assert_eq!(rename_bundle_catalogs(&[catalog("a", "A"), catalog("b", "B"), catalog("c", "C")], &ids), vec![catalog("x", "A"), catalog("c", "C")]);
}

#[test]
fn reconciles_the_stored_files_and_writes_only_when_they_changed() {
    let stored = test_workbook(json!({}));
    let reconciled = reconcile_stored_workbook_files(&stored, &names(&["a.sql"]), &names(&["d.parquet"]));
    assert!(reconciled.write);
    assert_eq!(reconciled.workbook.scripts, vec![script("a.sql", TEST_CONNECTION_ID)]);
    assert_eq!(reconciled.workbook.attachments, vec![WorkbookAttachment { name: "d.parquet".into() }]);
    let again = reconcile_stored_workbook_files(&reconciled.workbook, &names(&["a.sql"]), &names(&["d.parquet"]));
    assert!(!again.write);
}

#[test]
fn prepares_the_write_of_a_bundle() {
    let bundle: WorkbookBundle<Vec<u8>> = assemble_workbook_bundle(
        test_workbook(json!({ "workbookPath": "opfs://x", "name": " Sales " })),
        vec![],
        vec![ScriptData::new("01_query.sql", "SELECT 1")],
        vec![DataFileData { name: "d.parquet".into(), bytes: vec![1] }],
    );
    let target = "99999999-8888-4777-8666-555555555555";
    let options = WorkbookBundleWriteOptions { target_workbook_id: Some(target.into()), suffix_name_with_copy: true, target_is_fresh: true };
    let write = prepare_workbook_bundle_write(&bundle, StorageType::Opfs, &options).unwrap();
    assert_eq!(write.workbook_id, target);
    assert_eq!(write.workbook.workbook_id, target);
    assert_eq!(write.workbook.name.as_deref(), Some("Sales (copy)"));
    assert_eq!(write.workbook.workbook_path, None);
    assert!(write.rollback_on_failure);
    assert_eq!(write.workbook.scripts, vec![script("01_query.sql", TEST_CONNECTION_ID)]);
    let fresh_without_target = WorkbookBundleWriteOptions { target_is_fresh: true, ..Default::default() };
    assert!(prepare_workbook_bundle_write(&bundle, StorageType::Opfs, &fresh_without_target).unwrap_err().message.contains("targetIsFresh"));
    let mut v1 = bundle.clone();
    v1.workbook.format_version = 1;
    assert!(prepare_workbook_bundle_write(&v1, StorageType::Opfs, &options).unwrap_err().message.contains("Unsupported workbook format version"));
    let mut csv = bundle.clone();
    csv.data[0].name = "x.csv".into();
    assert!(prepare_workbook_bundle_write(&csv, StorageType::Opfs, &options).is_err());
}

#[test]
fn seeds_only_connections_without_a_catalog() {
    let catalog = WorkbookBundleCatalog { connection_id: TEST_CONNECTION_ID.into(), relations: Some("schema".into()), functions: None };
    assert_eq!(catalog_seed_files(&catalog, false), vec![("dashql-catalog-relations.sql", "schema".to_string())]);
    assert!(catalog_seed_files(&catalog, true).is_empty());
}

#[test]
fn describes_the_difference_of_bundles() {
    let bundle: WorkbookBundle<Vec<u8>> = assemble_workbook_bundle(
        test_workbook(json!({})),
        vec![],
        vec![ScriptData::new("a.sql", "SELECT 1")],
        vec![DataFileData { name: "d.parquet".into(), bytes: vec![1, 2] }],
    );
    assert_eq!(describe_workbook_bundle_difference(&bundle, &bundle.clone()), None);
    let mut other = bundle.clone();
    other.data[0].bytes = vec![1, 3];
    assert_eq!(describe_workbook_bundle_difference(&bundle, &other).as_deref(), Some("the bytes of the attachment d.parquet differ"));
    let mut other = bundle.clone();
    other.workbook.connections[0].params = json!({ "hyper": { "endpoint": "secret" } });
    assert_eq!(describe_workbook_bundle_difference(&bundle, &other).as_deref(), Some("workbook.connections[0].params.hyper.endpoint differs"));
    let mut other = bundle.clone();
    other.scripts[0].sql = "SELECT 2".into();
    assert_eq!(describe_workbook_bundle_difference(&bundle, &other).as_deref(), Some("the text of the script a.sql differs"));
    assert!(!workbook_bundles_equal(&bundle, &other));
}

// ---- workbook_import.test.ts (archives of older versions) ---------------------------------------

/// Read an archive of a workbook folder from its files, the way the host reads the plan
fn read_folder_zip(files: &[(&str, &str)]) -> Result<WorkbookBundle<Vec<u8>>> {
    let entries: Vec<ArchiveEntry> = files.iter().map(|(name, _)| ArchiveEntry { filename: name.to_string(), directory: false }).collect();
    let ArchivePlan::Folder(plan) = plan_archive(&entries)? else {
        panic!("expected an archive of a workbook folder");
    };
    let mut read = FolderArchiveFiles { texts: vec![], scripts: vec![], data: vec![], results: vec![] };
    for (index, entry) in &plan.entries {
        let content = files[*index].1.to_string();
        match entry {
            FolderArchiveEntry::Text { path } => read.texts.push((path.clone(), content)),
            FolderArchiveEntry::Script { name } => read.scripts.push(ScriptData::new(name.clone(), content)),
            FolderArchiveEntry::Attachment { name } => read.data.push(DataFileData { name: name.clone(), bytes: content.into_bytes() }),
            FolderArchiveEntry::Result { key } => read.results.push(WorkbookBundleResult { key: key.clone(), bytes: content.into_bytes(), crc32: None }),
        }
    }
    read_folder_archive(&plan, read)
}

#[test]
fn appends_unlisted_scripts_in_natural_order_and_ignores_derived_files() {
    let workbook = test_workbook_json(json!({})).to_string();
    let relations = format!("connections/{TEST_CONNECTION_ID}/dashql-catalog-relations.sql");
    let functions = format!("connections/{TEST_CONNECTION_ID}/dashql-catalog-functions.sql");
    let bundle = read_folder_zip(&[
        ("dashql-workbook.json", &workbook),
        (&relations, "schema"),
        (&functions, "functions"),
        // The catalog copy of older versions is ignored in a current workbook
        ("dashql-catalog-relations.sql", "stale"),
        ("scripts/10_last.sql", "SELECT 10"),
        ("scripts/2_first.sql", "SELECT 2"),
        ("dashql-session-index.json", r#"{"scripts":[]}"#),
        ("cache/result.arrow", "derived"),
    ])
    .unwrap();
    assert_eq!(
        bundle.workbook,
        test_workbook(json!({ "scripts": [{ "name": "2_first.sql", "connectionId": TEST_CONNECTION_ID }, { "name": "10_last.sql", "connectionId": TEST_CONNECTION_ID }] }))
    );
    assert_eq!(bundle.catalogs, vec![WorkbookBundleCatalog { connection_id: TEST_CONNECTION_ID.into(), relations: Some("schema".into()), functions: Some("functions".into()) }]);
    assert!(bundle.data.is_empty());
    assert_eq!(bundle.scripts, vec![ScriptData::new("2_first.sql", "SELECT 2"), ScriptData::new("10_last.sql", "SELECT 10")]);
}

#[test]
fn keeps_the_order_of_the_listed_scripts() {
    let scripts = json!([{ "name": "10_last.sql", "connectionId": TEST_CONNECTION_ID }, { "name": "2_first.sql", "connectionId": TEST_CONNECTION_ID }]);
    let workbook = test_workbook_json(json!({ "scripts": scripts })).to_string();
    let bundle = read_folder_zip(&[("dashql-workbook.json", &workbook), ("scripts/10_last.sql", "SELECT 10"), ("scripts/2_first.sql", "SELECT 2")]).unwrap();
    assert_eq!(bundle.workbook.scripts, vec![script("10_last.sql", TEST_CONNECTION_ID), script("2_first.sql", TEST_CONNECTION_ID)]);
}

#[test]
fn migrates_bundles_exported_by_older_versions() {
    let mut notebook = test_workbook_json(json!({ "formatVersion": 2, "notebookId": TEST_WORKBOOK_ID }));
    notebook.as_object_mut().unwrap().shift_remove("workbookId");
    let notebook = notebook.to_string();
    let bundle = read_folder_zip(&[
        ("dashql-notebook.json", &notebook),
        ("dashql-relations.sql", "schema"),
        ("dashql-functions.sql", "functions"),
        ("scripts/01_query.sql", "SELECT 1"),
    ])
    .unwrap();
    assert_eq!(bundle.workbook.workbook_id, TEST_WORKBOOK_ID);
    assert_eq!(bundle.workbook.scripts, vec![script("01_query.sql", TEST_CONNECTION_ID)]);
    assert_eq!(bundle.workbook.connections, test_workbook(json!({})).connections);
    // The catalog copy of older versions is the catalog of the default connection
    assert_eq!(bundle.catalogs, vec![WorkbookBundleCatalog { connection_id: TEST_CONNECTION_ID.into(), relations: Some("schema".into()), functions: Some("functions".into()) }]);
}

#[test]
fn rejects_misplaced_files_before_anything_is_written() {
    let workbook = test_workbook_json(json!({})).to_string();
    for (path, message) in [
        ("scripts/page/query.sql", "directly inside scripts/"),
        ("scripts/dashql-draft.sql", "draft scripts are not supported"),
        ("attachments/folder/payload.bin", "directly inside attachments/"),
        ("attachments/payload\\name.bin", "basename"),
        ("attachments/payload\0.bin", "basename"),
        ("attachments/payload.csv", "Only Parquet files can be attached"),
        ("../escape.sql", "path traversal"),
        ("/abs.sql", "absolute path"),
    ] {
        let error = read_folder_zip(&[("dashql-workbook.json", &workbook), (path, "SELECT 1")]).unwrap_err();
        assert!(error.message.contains(message), "{path}: {}", error.message);
    }
    let error = read_folder_zip(&[("dashql-workbook.json", &workbook), ("scripts/a.sql", "1"), ("SCRIPTS/A.sql", "2")]).unwrap_err();
    assert!(error.message.contains("duplicate destination"));
    let v1 = test_workbook_json(json!({ "formatVersion": 1 })).to_string();
    assert!(read_folder_zip(&[("dashql-workbook.json", &v1)]).unwrap_err().message.contains("Unsupported workbook format version"));
    assert!(read_folder_zip(&[("scripts/a.sql", "1")]).unwrap_err().message.contains("missing dashql-workbook.json"));
    assert!(read_folder_zip(&[("dashql-workbook.json", "[")]).unwrap_err().message.contains("invalid dashql-workbook.json"));
}

#[test]
fn reads_the_results_of_an_archive_of_an_older_version() {
    let workbook = test_workbook_json(json!({})).to_string();
    let key = "a".repeat(64);
    let path = format!("results/{key}.parquet");
    let bundle = read_folder_zip(&[("dashql-workbook.json", &workbook), (&path, "rows"), ("results/notes.txt", "x")]).unwrap();
    assert_eq!(bundle.results.iter().map(|r| r.key.as_str()).collect::<Vec<_>>(), [key.as_str()]);
}

// ---- workbook_tables.test.ts --------------------------------------------------------------------

/// Catalog files as JSON, a stand-in for the SQL of the catalog of a connection
struct JsonCatalogSql;

impl CatalogSql for JsonCatalogSql {
    fn parse(&self, sql: &str) -> Result<CatalogStructure> {
        let value: Value = serde_json::from_str(sql).map_err(|e| dashql_core::error::Error::invalid_argument(e.to_string()))?;
        let text = |v: &Value| v.as_str().map(str::to_string);
        let tables = value["tables"].as_array().cloned().unwrap_or_default().iter().map(|t| CatalogTable {
            database_name: t["db"].as_str().unwrap_or("").into(),
            schema_name: t["schema"].as_str().unwrap_or("").into(),
            table_name: t["name"].as_str().unwrap_or("").into(),
            columns: t["columns"].as_array().cloned().unwrap_or_default().iter().enumerate().map(|(i, c)| CatalogColumn {
                name: c["name"].as_str().unwrap_or("").into(),
                ordinal_position: i as u32,
                data_type: text(&c["type"]),
            }).collect(),
        }).collect();
        let functions = value["functions"].as_array().cloned().unwrap_or_default().iter().map(|f| CatalogFunction {
            database_name: f["db"].as_str().unwrap_or("").into(),
            schema_name: f["schema"].as_str().unwrap_or("").into(),
            function_name: f["name"].as_str().unwrap_or("").into(),
            is_aggregate: f["aggregate"].as_bool().unwrap_or(false),
            return_type: text(&f["returns"]),
            params: f["params"].as_array().cloned().unwrap_or_default().iter().map(|p| CatalogFunctionParam { name: text(&p["name"]), param_type: text(&p["type"]) }).collect(),
        }).collect();
        Ok(CatalogStructure { tables, functions })
    }

    fn relations_sql(&self, tables: &[CatalogTable]) -> String {
        json!({ "tables": tables.iter().map(|t| json!({
            "db": t.database_name, "schema": t.schema_name, "name": t.table_name,
            "columns": t.columns.iter().map(|c| json!({ "name": c.name, "type": c.data_type })).collect::<Vec<_>>(),
        })).collect::<Vec<_>>() }).to_string()
    }

    fn functions_sql(&self, functions: &[CatalogFunction]) -> String {
        json!({ "functions": functions.iter().map(|f| json!({
            "db": f.database_name, "schema": f.schema_name, "name": f.function_name, "aggregate": f.is_aggregate, "returns": f.return_type,
            "params": f.params.iter().map(|p| json!({ "name": p.name, "type": p.param_type })).collect::<Vec<_>>(),
        })).collect::<Vec<_>>() }).to_string()
    }
}

fn column(name: &str, position: u32, data_type: &str) -> CatalogColumn {
    CatalogColumn { name: name.into(), ordinal_position: position, data_type: Some(data_type.into()) }
}

fn table(db: &str, name: &str, columns: Vec<CatalogColumn>) -> CatalogTable {
    CatalogTable { database_name: db.into(), schema_name: "public".into(), table_name: name.into(), columns }
}

fn function(schema: &str, name: &str, is_aggregate: bool, returns: &str, params: &[(&str, &str)]) -> CatalogFunction {
    CatalogFunction {
        database_name: "hyper".into(),
        schema_name: schema.into(),
        function_name: name.into(),
        is_aggregate,
        return_type: Some(returns.into()),
        params: params.iter().map(|(n, t)| CatalogFunctionParam { name: Some(n.to_string()), param_type: Some(t.to_string()) }).collect(),
    }
}

fn relations() -> String {
    JsonCatalogSql.relations_sql(&[
        table("hyper", "orders", vec![column("id", 0, "integer"), column("note", 1, "text")]),
        table("hyper", "empty", vec![]),
    ])
}

fn functions() -> String {
    JsonCatalogSql.functions_sql(&[
        function("pg_catalog", "abs", false, "any", &[]),
        function("public", "scale", false, "bigint", &[("value", "integer"), ("factor", "integer")]),
        function("public", "scale", false, "bigint", &[("value", "bigint")]),
        function("pg_catalog", "any_value", true, "any", &[]),
    ])
}

const TABLES_OTHER_CONNECTION_ID: &str = "bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee";

fn tables_bundle() -> WorkbookBundle<Vec<u8>> {
    WorkbookBundle {
        workbook: test_workbook(json!({
            "name": "Tables",
            "connections": [
                { "connectionId": TEST_CONNECTION_ID, "params": { "hyper": { "protocol": "V3_HTTP", "endpoint": "http://localhost:7484" } }, "name": "Local" },
                { "connectionId": TABLES_OTHER_CONNECTION_ID, "params": { "hyper": {} } },
            ],
            "scripts": [{ "name": "b.sql", "connectionId": TEST_CONNECTION_ID }, { "name": "a.sql", "connectionId": TABLES_OTHER_CONNECTION_ID }],
            "attachments": [{ "name": "d.parquet" }],
            "metadata": { "createdAt": "2026-11-10T10:00:00.000Z" },
        })),
        catalogs: vec![WorkbookBundleCatalog { connection_id: TEST_CONNECTION_ID.into(), relations: Some(relations()), functions: Some(functions()) }],
        scripts: vec![ScriptData::new("b.sql", "select 1"), ScriptData::new("a.sql", "select 'it''s'")],
        data: vec![DataFileData { name: "d.parquet".into(), bytes: vec![1, 2, 3] }],
        results: vec![WorkbookBundleResult { key: "k1".into(), bytes: vec![4, 5], crc32: Some(7) }],
    }
}

#[test]
fn reads_and_renders_catalog_files_with_the_core() {
    let tables = vec![
        table("hyper", "orders", vec![column("id", 0, "integer"), column("note", 1, "text")]),
        table("hyper", "items", vec![column("name", 0, "text")]),
    ];
    let relations = CoreCatalogSql.relations_sql(&tables);
    let parsed = CoreCatalogSql.parse(&relations).unwrap();
    assert_eq!(parsed.tables, tables);
    assert!(parsed.functions.is_empty());
    let functions = vec![
        function("public", "scale", false, "bigint", &[("value", "integer"), ("factor", "integer")]),
        function("public", "total", true, "bigint", &[("value", "bigint")]),
    ];
    let text = CoreCatalogSql.functions_sql(&functions);
    let parsed = CoreCatalogSql.parse(&text).unwrap();
    assert_eq!(CoreCatalogSql.functions_sql(&parsed.functions), text);
    assert_eq!(parsed.functions.iter().map(|f| (f.function_name.as_str(), f.is_aggregate)).collect::<Vec<_>>(), [("scale", false), ("total", true)]);
    assert!(CoreCatalogSql.parse("create tabel t;").is_err());
}

#[test]
fn round_trips_a_bundle_through_the_rows() {
    let bundle = tables_bundle();
    let tables = workbook_bundle_to_tables(&bundle, &JsonCatalogSql, &mut uuids()).unwrap();
    assert_eq!(
        tables.workbook,
        vec![WorkbookRow { workbook_id: TEST_WORKBOOK_ID.into(), format_version: 11, name: Some("Tables".into()), metadata: r#"{"createdAt":"2026-11-10T10:00:00.000Z"}"#.into() }]
    );
    assert_eq!(
        tables.scripts.iter().map(|r| (r.position, r.name.as_str(), r.connection_id.as_str())).collect::<Vec<_>>(),
        [(0, "b.sql", TEST_CONNECTION_ID), (1, "a.sql", TABLES_OTHER_CONNECTION_ID)]
    );
    assert_eq!(
        tables.catalog_tables.iter().map(|r| (r.table_id, r.database_name.as_str(), r.table_name.as_str())).collect::<Vec<_>>(),
        [(0, "hyper", "orders"), (1, "hyper", "empty")]
    );
    assert_eq!(tables.catalog_columns.iter().map(|r| (r.table_id, r.position, r.column_name.as_str())).collect::<Vec<_>>(), [(0, 0, "id"), (0, 1, "note")]);
    // The overloads of a function stay apart by their ids
    assert_eq!(
        tables.catalog_functions.iter().map(|r| (r.function_id, r.function_name.as_str(), r.is_aggregate)).collect::<Vec<_>>(),
        [(0, "abs", false), (1, "scale", false), (2, "scale", false), (3, "any_value", true)]
    );
    assert_eq!(
        tables.catalog_function_params.iter().map(|r| (r.function_id, r.position, r.param_name.as_deref())).collect::<Vec<_>>(),
        [(1, 0, Some("value")), (1, 1, Some("factor")), (2, 0, Some("value"))]
    );
    assert!(is_data_table_name(&tables.attachments[0].table_name));
    assert!(is_data_table_name(&tables.results[0].table_name));
    assert_eq!(tables.data.len(), 2);

    let read = workbook_tables_to_bundle(&tables, "Invalid workbook tables", &JsonCatalogSql).unwrap();
    assert_eq!(read, bundle);
}

#[test]
fn round_trips_a_workbook_that_only_holds_a_connection() {
    let bundle: WorkbookBundle<Vec<u8>> = WorkbookBundle { workbook: test_workbook(json!({})), catalogs: vec![], scripts: vec![], data: vec![], results: vec![] };
    let tables = workbook_bundle_to_tables(&bundle, &JsonCatalogSql, &mut uuids()).unwrap();
    assert_eq!(workbook_tables_to_bundle(&tables, "Invalid", &JsonCatalogSql).unwrap(), bundle);
}

#[test]
fn numbers_the_tables_and_functions_of_all_connections() {
    let mut bundle = tables_bundle();
    let other = JsonCatalogSql.relations_sql(&[table("other", "events", vec![column("at", 0, "text")])]);
    bundle.catalogs.push(WorkbookBundleCatalog { connection_id: TABLES_OTHER_CONNECTION_ID.into(), relations: Some(other), functions: Some(functions()) });
    let tables = workbook_bundle_to_tables(&bundle, &JsonCatalogSql, &mut uuids()).unwrap();
    assert_eq!(
        tables.catalog_tables.iter().map(|r| (r.table_id, r.connection_id.as_str(), r.table_name.as_str())).collect::<Vec<_>>(),
        [(0, TEST_CONNECTION_ID, "orders"), (1, TEST_CONNECTION_ID, "empty"), (2, TABLES_OTHER_CONNECTION_ID, "events")]
    );
    assert_eq!(tables.catalog_functions.iter().map(|r| r.function_id).collect::<Vec<_>>(), (0..8).collect::<Vec<_>>());
    // The order of the rows doesn't matter, the ids and positions give it
    let mut shuffled = tables.clone();
    shuffled.catalog_tables.reverse();
    shuffled.catalog_columns.reverse();
    shuffled.catalog_functions.reverse();
    shuffled.catalog_function_params.reverse();
    assert_eq!(workbook_tables_to_bundle(&shuffled, "Invalid", &JsonCatalogSql).unwrap(), bundle);
}

#[test]
fn rejects_tables_without_exactly_one_workbook_and_invalid_json() {
    let tables = workbook_bundle_to_tables(&tables_bundle(), &JsonCatalogSql, &mut uuids()).unwrap();
    let mut none = tables.clone();
    none.workbook.clear();
    assert!(workbook_tables_to_bundle(&none, "Invalid workbook tables", &JsonCatalogSql).unwrap_err().message.contains("expected one workbook, found 0"));
    let mut two = tables.clone();
    two.workbook.push(two.workbook[0].clone());
    assert!(workbook_tables_to_bundle(&two, "Invalid workbook tables", &JsonCatalogSql).unwrap_err().message.contains("expected one workbook, found 2"));
    let mut broken = tables.clone();
    broken.connections[0].params = "{".into();
    assert!(workbook_tables_to_bundle(&broken, "Invalid workbook tables", &JsonCatalogSql).unwrap_err().message.contains("invalid JSON in workbook_connections"));
}

#[test]
fn leaves_out_attachments_whose_table_is_missing() {
    let mut tables = workbook_bundle_to_tables(&tables_bundle(), &JsonCatalogSql, &mut uuids()).unwrap();
    tables.data.clear();
    let bundle = workbook_tables_to_bundle(&tables, "Invalid", &JsonCatalogSql).unwrap();
    assert!(bundle.data.is_empty());
    assert!(bundle.workbook.attachments.is_empty());
    assert!(bundle.results.is_empty());
}

#[test]
fn rejects_file_names_of_the_rows_that_could_escape_their_folder_or_collide() {
    let tables = workbook_bundle_to_tables(&tables_bundle(), &JsonCatalogSql, &mut uuids()).unwrap();
    for (first, second, message) in [
        ("../x.sql", "a.sql", "invalid script name ../x.sql"),
        ("a/b.sql", "a.sql", "invalid script name a/b.sql"),
        ("x.txt", "a.sql", "invalid script name x.txt"),
        ("dashql-draft.sql", "a.sql", "invalid script name dashql-draft.sql"),
        ("A.sql", "a.sql", "duplicate script a.sql"),
    ] {
        let mut bad = tables.clone();
        bad.scripts[0].name = first.into();
        bad.scripts[1].name = second.into();
        let error = workbook_tables_to_bundle(&bad, "Invalid workbook tables", &JsonCatalogSql).unwrap_err();
        assert!(error.message.starts_with("Invalid workbook tables: "), "{first}: {}", error.message);
        assert!(error.message.contains(message), "{first}: {}", error.message);
    }
    for (name, message) in [("../d.parquet", "basename"), ("d.txt", "Only Parquet files")] {
        let mut bad = tables.clone();
        bad.attachments[0].name = name.into();
        let error = workbook_tables_to_bundle(&bad, "Invalid workbook tables", &JsonCatalogSql).unwrap_err();
        assert!(error.message.contains(message), "{name}: {}", error.message);
    }
    let mut twice = tables.clone();
    let mut copy = twice.attachments[0].clone();
    copy.position = 1;
    copy.name = "D.parquet".into();
    twice.attachments.push(copy);
    assert!(workbook_tables_to_bundle(&twice, "Invalid", &JsonCatalogSql).unwrap_err().message.contains("duplicate attachment"));
}

#[test]
fn checks_the_file_names_of_a_bundle_before_it_is_written() {
    let options = WorkbookBundleWriteOptions::default();
    for name in ["../x.sql", "a/b.sql", "x.txt", "dashql-draft.sql", "/x.sql", "..\\x.sql"] {
        let mut bundle = tables_bundle();
        bundle.scripts[0].name = name.into();
        let error = prepare_workbook_bundle_write(&bundle, StorageType::Opfs, &options).unwrap_err();
        assert!(error.message.contains("invalid script name"), "{name}: {}", error.message);
    }
    let mut bundle = tables_bundle();
    bundle.scripts[0].name = "A.sql".into();
    assert!(prepare_workbook_bundle_write(&bundle, StorageType::Opfs, &options).unwrap_err().message.contains("duplicate script a.sql"));
    let mut bundle = tables_bundle();
    bundle.catalogs[0].connection_id = "../escape".into();
    assert!(prepare_workbook_bundle_write(&bundle, StorageType::Opfs, &options).unwrap_err().message.contains("invalid connection id"));
    assert!(prepare_workbook_bundle_write(&tables_bundle(), StorageType::Opfs, &options).is_ok());
}

#[test]
fn round_trips_the_rows_through_arrow_ipc() {
    let tables = workbook_bundle_to_tables(&tables_bundle(), &JsonCatalogSql, &mut uuids()).unwrap();
    let mut read: WorkbookTables<Vec<u8>> = WorkbookTables::default();
    for table in WorkbookTableName::ALL {
        let ipc = tables.encode_table(table).unwrap();
        read.decode_table(table, &ipc).unwrap();
        assert_eq!(read.row_count(table), tables.row_count(table));
    }
    read.data = tables.data.clone();
    assert_eq!(read, tables);
}

#[test]
fn rejects_arrow_tables_that_miss_a_column_or_hold_a_null() {
    use std::sync::Arc;
    use arrow_array::{Int32Array, RecordBatch, StringArray};
    use arrow_schema::{DataType, Field, Schema};
    let batch = RecordBatch::try_new(
        Arc::new(Schema::new(vec![Field::new("position", DataType::Int32, false)])),
        vec![Arc::new(Int32Array::from(vec![0]))],
    )
    .unwrap();
    assert!(table_from_arrow::<ScriptRow>(&batch).unwrap_err().message.contains("has no column name"));
    // A nullable column may be missing, a column of another type is cast
    let batch = RecordBatch::try_new(
        Arc::new(Schema::new(vec![
            Field::new("position", DataType::Utf8, false),
            Field::new("connection_id", DataType::Utf8, false),
            Field::new("params", DataType::Utf8, true),
        ])),
        vec![Arc::new(StringArray::from(vec!["3"])), Arc::new(StringArray::from(vec!["c"])), Arc::new(StringArray::from(vec![None::<&str>]))],
    )
    .unwrap();
    assert!(table_from_arrow::<ConnectionRow>(&batch).unwrap_err().message.contains("workbook_connections.params is null"));
    assert!(decode_table_ipc::<ScriptRow>(b"not arrow").is_err());
}

#[test]
fn reads_an_archive_of_workbook_tables() {
    let tables = workbook_bundle_to_tables(&tables_bundle(), &JsonCatalogSql, &mut uuids()).unwrap();
    let written = workbook_archive_entries(&tables);
    // The host lists the archive it wrote and reads every entry of the plan
    let mut entries: Vec<ArchiveEntry> = written.iter().map(|entry| ArchiveEntry { filename: entry.file_name.clone(), directory: false }).collect();
    entries.push(ArchiveEntry { filename: "notes.txt".into(), directory: false });
    let ArchivePlan::Tables(plan) = plan_archive(&entries).unwrap() else {
        panic!("expected an archive of workbook tables");
    };
    let mut read: WorkbookTables<Vec<u8>> = WorkbookTables::default();
    for (index, entry) in &plan {
        match (&written[*index].source, entry) {
            (ArchiveEntrySource::Table(table), TableArchiveEntry::Table(planned)) => {
                assert_eq!(table, planned);
                read.decode_table(*table, &tables.encode_table(*table).unwrap()).unwrap();
            }
            (ArchiveEntrySource::Data(name), TableArchiveEntry::Data { table_name, stored_slice }) => {
                assert_eq!(name, table_name);
                assert_eq!(*stored_slice, name.starts_with(RESULT_TABLE_PREFIX));
                let file = tables.data.iter().find(|(n, _)| n == name).unwrap().1.clone();
                read.data.push((name.clone(), file));
            }
            other => panic!("unexpected entry {other:?}"),
        }
    }
    assert_eq!(read_table_archive(&read, &JsonCatalogSql).unwrap(), tables_bundle());
    let duplicate = vec![ArchiveEntry { filename: "workbook.parquet".into(), directory: false }, ArchiveEntry { filename: "WORKBOOK.parquet".into(), directory: false }];
    assert!(plan_archive(&duplicate).unwrap_err().message.contains("duplicate table"));
}

// ---- workbook_export.test.ts --------------------------------------------------------------------

#[test]
fn writes_the_workbook_tables_and_the_data_tables_with_their_compression() {
    let tables = workbook_bundle_to_tables(&tables_bundle(), &JsonCatalogSql, &mut uuids()).unwrap();
    let entries = workbook_archive_entries(&tables);
    let names: Vec<&str> = entries.iter().map(|e| e.file_name.as_str()).collect();
    assert_eq!(names[0], "workbook.parquet");
    // Empty tables are left out
    assert!(names.contains(&"workbook_results.parquet"));
    let mut empty = tables.clone();
    empty.results.clear();
    assert!(!workbook_archive_entries(&empty).iter().any(|e| e.file_name == "workbook_results.parquet"));
    let result = entries.iter().find(|e| e.file_name.starts_with(RESULT_TABLE_PREFIX)).unwrap();
    assert_eq!(result.compression, EntryCompression::Stored);
    let attachment = entries.iter().find(|e| e.file_name.starts_with(ATTACHMENT_TABLE_PREFIX)).unwrap();
    assert_eq!(attachment.compression, EntryCompression::Deflate);
}

#[test]
fn shares_a_workbook_without_secrets_drafts_and_the_draft_script() {
    let mut bundle = tables_bundle();
    bundle.workbook.connections[0].params = json!({ "hyper": { "protocol": "V3_HTTP", "metadata": { "authorization": "secret" }, "queryParameters": { "token": "x" } } });
    bundle.workbook.connections[0].params_draft = Some(json!({ "hyper": { "endpoint": "draft" } }));
    bundle.workbook.metadata.cloud = Some(WorkbookCloudLink { workbook_id: "w".into(), version_id: "v".into(), preview: None, connection_id: "c".into() });
    bundle.scripts.push(ScriptData::new("dashql-draft.sql", "draft"));
    let tables = shared_workbook_tables(&bundle, &JsonCatalogSql, &mut uuids()).unwrap();
    assert!(!tables.connections[0].params.contains("secret"));
    assert!(!tables.connections[0].params.contains("token"));
    assert!(!tables.workbook[0].metadata.contains("cloud"));
    assert_eq!(tables.connections[0].name.as_deref(), Some("Local"));
    assert!(tables.scripts.iter().all(|row| row.name != "dashql-draft.sql"));
}

#[test]
fn exports_only_the_connections_that_the_scripts_use_with_fresh_ids() {
    let mut bundle = tables_bundle();
    bundle.workbook.scripts.pop();
    bundle.scripts.pop();
    let bundle = exported_bundle(bundle, vec![]);
    assert_eq!(bundle.workbook.connections.iter().map(|c| c.connection_id.as_str()).collect::<Vec<_>>(), [TEST_CONNECTION_ID]);
    assert!(bundle.results.is_empty());

    let live = HashMap::from([(TEST_CONNECTION_ID.to_string(), json!({ "trino": { "endpoint": "https://trino", "auth": { "basic": { "username": "me", "secret": "s" } } } }))]);
    let options = SharedWorkbookExportOptions { connection_names: HashMap::from([(TEST_CONNECTION_ID.to_string(), "Prod".to_string())]), ..Default::default() };
    let (workbook, catalogs) = shared_export_head(&bundle.workbook, &bundle.catalogs, &live, &options, &mut uuids());
    assert_eq!(workbook.workbook_id, "00000000-0000-4000-8000-000000000001");
    assert_eq!(workbook.connections[0].connection_id, "00000000-0000-4000-8000-000000000002");
    assert_eq!(workbook.scripts[0].connection_id, workbook.connections[0].connection_id);
    assert_eq!(catalogs[0].connection_id, workbook.connections[0].connection_id);
    assert_eq!(workbook.connections[0].name.as_deref(), Some("Prod"));
    assert_eq!(workbook.connections[0].params["trino"]["auth"]["basic"], json!({ "username": "me", "secret": "" }));
    let preserved = SharedWorkbookExportOptions { preserve_uuids: true, with_login_hint: Some(false), ..Default::default() };
    let (workbook, _) = shared_export_head(&bundle.workbook, &bundle.catalogs, &live, &preserved, &mut uuids());
    assert_eq!(workbook.workbook_id, TEST_WORKBOOK_ID);
    assert_eq!(workbook.connections[0].params["trino"]["auth"]["basic"]["username"], json!(""));
    assert!(options.with_catalog(false) && !options.with_catalog(true));
}

#[test]
fn shares_a_connection_as_an_empty_workbook_in_a_link() {
    let workbook = connection_link_workbook(&json!({ "salesforce": { "instanceUrl": "u", "appConsumerSecret": "s" } }), Some("Org"), true, "2026-11-15T00:00:00.000Z", &mut uuids());
    assert_eq!(validate_workbook_data(&workbook), Ok(()));
    assert!(workbook.scripts.is_empty());
    assert_eq!(workbook.connections[0].params["salesforce"]["appConsumerSecret"], json!(""));
    assert_eq!(workbook.connections[0].name.as_deref(), Some("Org"));
    let link = workbook_link(&[0xfb, 0xff, 0x01], "https://dashql.app");
    assert_eq!(link, "https://dashql.app/?zip=-_8B");
    assert_eq!(workbook_link(&[1], DESKTOP_APP_LINK_BASE), "dashql://localhost?zip=AQ");
}

// ---- workbook_connection_import.test.ts ---------------------------------------------------------

const KNOWN: &str = "aaaaaaaa-0000-4000-8000-00000000000a";
const OTHER: &str = "aaaaaaaa-0000-4000-8000-00000000000b";
const IMPORTED: &str = "bbbbbbbb-0000-4000-8000-00000000000b";
const FRESH: &str = "cccccccc-0000-4000-8000-00000000000c";
const EMBEDDED: &str = "dddddddd-0000-4000-8000-00000000000d";

fn trino(endpoint: &str, secret: &str) -> Value {
    json!({ "trino": { "endpoint": endpoint, "auth": { "authType": "AUTH_BASIC", "basic": { "username": "user", "secret": secret } } } })
}

fn entries() -> Vec<ConnectionEntry> {
    vec![ConnectionEntry::new(KNOWN, trino("https://trino", "secret")), ConnectionEntry::new(OTHER, trino("https://other", "secret"))]
}

fn imported(connection_id: &str, params: Value) -> WorkbookData {
    test_workbook(json!({
        "connections": [{ "connectionId": connection_id, "params": params }],
        "scripts": [{ "name": "query.sql", "connectionId": connection_id }],
    }))
}

fn no_uuid() -> String {
    panic!("no fresh id expected")
}

#[test]
fn links_a_known_connection_silently_when_only_secrets_differ() {
    let workbook = imported(KNOWN, sanitize_connection_params_for_sharing(&trino("https://trino", "secret"), false));
    let plan = plan_connection_import(&workbook, &entries());
    assert_eq!(plan[0].decision, ConnectionImportDecision::Link { connection_id: KNOWN.into() });
    assert!(!matches!(plan[0].decision, ConnectionImportDecision::Ask { .. }));
    let applied = apply_connection_import_plan(&workbook, &plan, &HashMap::new(), &entries(), &mut no_uuid);
    // The copy takes the full params of the connection of the app
    assert_eq!(applied.workbook.connections, vec![WorkbookConnection::new(KNOWN, entries()[0].params.clone())]);
}

#[test]
fn asks_when_a_regenerated_id_describes_a_known_connection() {
    let workbook = imported(IMPORTED, trino("https://trino", ""));
    let plan = plan_connection_import(&workbook, &entries());
    assert_eq!(plan[0].decision, ConnectionImportDecision::Ask { candidates: vec![entries()[0].clone()] });
    let link = HashMap::from([(IMPORTED.to_string(), ConnectionImportChoice::Link { connection_id: KNOWN.into() })]);
    let linked = apply_connection_import_plan(&workbook, &plan, &link, &entries(), &mut no_uuid);
    assert_eq!(linked.connection_ids, vec![(IMPORTED.to_string(), KNOWN.to_string())]);
    assert_eq!(linked.workbook.scripts, vec![script("query.sql", KNOWN)]);
    assert!(connection_refs_changed(&workbook, &linked.workbook));
    let separate = HashMap::from([(IMPORTED.to_string(), ConnectionImportChoice::Separate)]);
    let separate = apply_connection_import_plan(&workbook, &plan, &separate, &entries(), &mut no_uuid).workbook;
    assert_eq!(separate.connections, vec![WorkbookConnection::new(IMPORTED, trino("https://trino", ""))]);
    assert!(!connection_refs_changed(&workbook, &separate));
}

#[test]
fn never_reuses_a_known_id_for_a_separate_connection() {
    let workbook = imported(KNOWN, trino("https://elsewhere", ""));
    let plan = plan_connection_import(&workbook, &entries());
    assert_eq!(plan[0].decision, ConnectionImportDecision::Ask { candidates: vec![entries()[0].clone()] });
    let choices = HashMap::from([(KNOWN.to_string(), ConnectionImportChoice::Separate)]);
    let result = apply_connection_import_plan(&workbook, &plan, &choices, &entries(), &mut || FRESH.to_string());
    assert_eq!(result.connection_ids, vec![(KNOWN.to_string(), FRESH.to_string())]);
    assert_eq!(result.workbook.connections, vec![WorkbookConnection::new(FRESH, trino("https://elsewhere", ""))]);
    assert_eq!(result.workbook.scripts, vec![script("query.sql", FRESH)]);
}

#[test]
fn links_the_embedded_database_silently() {
    let tls = json!({ "clientKeyPath": "", "clientCertPath": "", "caCertsPath": "" });
    let embedded = ConnectionEntry::new(EMBEDDED, json!({ "hyper": { "protocol": "WASM", "endpoint": "", "tls": tls } }));
    let workbook = imported(IMPORTED, json!({ "hyper": { "protocol": "WASM", "endpoint": "", "tls": tls, "attachedDatabases": [], "metadata": {}, "queryParameters": {} } }));
    let mut all = entries();
    all.push(embedded.clone());
    let plan = plan_connection_import(&workbook, &all);
    assert_eq!(plan[0].decision, ConnectionImportDecision::Link { connection_id: EMBEDDED.into() });
    let linked = apply_connection_import_plan(&workbook, &plan, &HashMap::new(), &all, &mut no_uuid).workbook;
    assert_eq!(linked.connections, vec![WorkbookConnection::new(EMBEDDED, embedded.params.clone())]);
    assert_eq!(linked.scripts, vec![script("query.sql", EMBEDDED)]);
    let attached = imported(IMPORTED, json!({ "hyper": { "protocol": "WASM", "attachedDatabases": [{ "path": "tpch.hyper", "alias": "tpch" }] } }));
    assert_eq!(plan_connection_import(&attached, &[embedded.clone()])[0].decision, ConnectionImportDecision::Link { connection_id: EMBEDDED.into() });
    assert_eq!(plan_connection_import(&workbook, &entries())[0].decision, ConnectionImportDecision::Register);
    let local = imported(IMPORTED, json!({ "hyper": { "protocol": "WASM", "attachedDatabases": [{ "path": "clouds/local.hyper", "alias": "dashql" }] } }));
    assert_eq!(plan_connection_import(&local, &[embedded])[0].decision, ConnectionImportDecision::Register);
}

#[test]
fn keeps_the_names_of_new_connections_and_drops_them_for_existing_ones() {
    let workbook = test_workbook(json!({
        "connections": [
            { "connectionId": IMPORTED, "params": trino("https://unknown", ""), "name": "Theirs" },
            { "connectionId": FRESH, "params": trino("https://trino", ""), "name": "Production" },
        ],
        "scripts": [{ "name": "new.sql", "connectionId": IMPORTED }, { "name": "known.sql", "connectionId": FRESH }],
    }));
    let plan = plan_connection_import(&workbook, &entries());
    assert_eq!(plan[0].decision, ConnectionImportDecision::Register);
    let questions = plan.iter().filter(|item| matches!(item.decision, ConnectionImportDecision::Ask { .. }));
    assert_eq!(questions.map(|item| item.reference.name.as_deref()).collect::<Vec<_>>(), [Some("Production")]);
    let link = HashMap::from([(FRESH.to_string(), ConnectionImportChoice::Link { connection_id: KNOWN.into() })]);
    let linked = apply_connection_import_plan(&workbook, &plan, &link, &entries(), &mut no_uuid).workbook;
    assert_eq!(linked.connections[0].name.as_deref(), Some("Theirs"));
    assert_eq!(linked.connections[1], WorkbookConnection::new(KNOWN, trino("https://trino", "secret")));
    let separate = HashMap::from([(FRESH.to_string(), ConnectionImportChoice::Separate)]);
    let separate = apply_connection_import_plan(&workbook, &plan, &separate, &entries(), &mut no_uuid).workbook;
    assert_eq!(separate.connections[1].name.as_deref(), Some("Production"));
}

// ---- The decisions of the restore ------------------------------------------------------------------

fn planner() -> RestorePlanner {
    let mut next = uuids();
    RestorePlanner::new("2026-11-15T00:00:00.000Z", Box::new(move || Some(next())))
}

fn restore(planner: &mut RestorePlanner, workbook: &Value, files: &[&str]) -> RestoredWorkbookPlan {
    let begun = planner.begin_workbook(TEST_WORKBOOK_ID, Some(&workbook.to_string())).unwrap();
    planner.finish_workbook(begun, Some(&names(files))).unwrap()
}

#[test]
fn restores_unlisted_scripts_in_natural_order_and_writes_the_list() {
    let mut planner = planner();
    let begun = planner.begin_workbook(TEST_WORKBOOK_ID, Some(&test_workbook_json(json!({})).to_string())).unwrap();
    // The workbook registered its connection, the host restores its catalog
    assert_eq!(begun.catalogs_to_restore, [TEST_CONNECTION_ID]);
    let plan = planner.finish_workbook(begun, Some(&names(&["10_last.sql", "2_first.sql"]))).unwrap();
    assert_eq!(plan.scripts.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(), ["2_first.sql", "10_last.sql"]);
    assert_eq!(planner.pending().workbook_script_lists[0].scripts, vec![script("2_first.sql", TEST_CONNECTION_ID), script("10_last.sql", TEST_CONNECTION_ID)]);
    assert_eq!(planner.pending().connection_entries.len(), 1);
    assert_eq!(planner.pending().connection_entries[0].created_at.as_deref(), Some("2026-11-15T00:00:00.000Z"));
}

#[test]
fn runs_scripts_of_unknown_connections_on_the_embedded_database_and_keeps_the_reference() {
    let unknown = "99999999-9999-4999-8999-999999999999";
    let workbook = test_workbook_json(json!({
        "connections": [
            { "connectionId": TEST_CONNECTION_ID, "params": { "hyper": {} } },
            { "connectionId": OTHER_CONNECTION_ID, "params": { "trino": { "endpoint": "https://trino.example" } } },
        ],
        "scripts": [{ "name": "10_last.sql", "connectionId": OTHER_CONNECTION_ID }, { "name": "2_first.sql", "connectionId": unknown }],
    }));
    let mut planner = planner();
    let plan = restore(&mut planner, &workbook, &["10_last.sql", "2_first.sql"]);
    assert_eq!(plan.scripts[0].connection.connection_id, OTHER_CONNECTION_ID);
    assert_eq!(plan.scripts[1].connection.connection_id, TEST_CONNECTION_ID);
    assert_eq!(plan.scripts[1].unresolved_connection_id.as_deref(), Some(unknown));
    // The workbook file keeps the reference
    assert!(planner.pending().workbook_script_lists.iter().all(|write| write.scripts.iter().all(|s| s.name != "2_first.sql" || s.connection_id == unknown)));
}

#[test]
fn registers_only_the_connections_that_scripts_use() {
    let workbook = test_workbook_json(json!({
        "connections": [
            { "connectionId": OTHER_CONNECTION_ID, "params": { "trino": { "endpoint": "https://trino.example" } } },
            { "connectionId": TEST_CONNECTION_ID, "params": { "hyper": { "protocol": "WASM" } } },
        ],
        "scripts": [{ "name": "2_first.sql", "connectionId": TEST_CONNECTION_ID }],
    }));
    let mut planner = planner();
    let plan = restore(&mut planner, &workbook, &["2_first.sql"]);
    assert_eq!(planner.connections().iter().map(|c| c.connection_id.as_str()).collect::<Vec<_>>(), [TEST_CONNECTION_ID]);
    assert_eq!(plan.pending_connection, None);
}

#[test]
fn keeps_an_empty_ephemeral_workbook_and_promotes_one_that_holds_scripts() {
    let workbook = test_workbook_json(json!({ "metadata": { "ephemeral": true } }));
    let mut empty = planner();
    let plan = restore(&mut empty, &workbook, &[]);
    assert!(!plan.promoted && plan.metadata.is_ephemeral());
    assert_eq!(plan.pending_connection.map(|c| c.connection_id).as_deref(), Some(TEST_CONNECTION_ID));
    assert!(empty.pending().promoted_workbooks.is_empty() && empty.pending().workbook_script_lists.is_empty());

    let mut crashed = planner();
    let plan = restore(&mut crashed, &workbook, &["1.sql"]);
    assert!(plan.promoted && !plan.metadata.is_ephemeral());
    assert_eq!(crashed.pending().promoted_workbooks, [TEST_WORKBOOK_ID]);
    // The writer promotes the workbook with its properties as the file holds them
    let stored = WorkbookData::from_json(&workbook);
    let promoted = properties_patch(&stored, stored.name.as_deref(), false, stored.metadata.cloud.as_ref());
    assert!(!promoted.to_json()["metadata"].as_object().unwrap().contains_key("ephemeral"));
}

#[test]
fn surfaces_invalid_workbooks() {
    let mut planner = planner();
    assert_eq!(planner.begin_workbook("not-a-uuid", Some("{}")).unwrap_err().error, WorkbookValidationError::InvalidWorkbookId);
    assert_eq!(planner.begin_workbook(TEST_WORKBOOK_ID, None).unwrap_err().error, WorkbookValidationError::WorkbookUnreadable);
    assert_eq!(planner.begin_workbook(TEST_WORKBOOK_ID, Some("{")).unwrap_err().error, WorkbookValidationError::WorkbookUnreadable);
    let v1 = test_workbook_json(json!({ "formatVersion": 1 })).to_string();
    let invalid = planner.begin_workbook(TEST_WORKBOOK_ID, Some(&v1)).unwrap_err();
    assert_eq!((invalid.error, invalid.title.as_str()), (WorkbookValidationError::UnsupportedFormatVersion, "V2 Workbook"));
    assert!(planner.connections().is_empty());
    // A workbook whose scripts can't be listed
    let begun = planner.begin_workbook(TEST_WORKBOOK_ID, Some(&test_workbook_json(json!({})).to_string())).unwrap();
    assert_eq!(planner.finish_workbook(begun, None).unwrap_err().error, WorkbookValidationError::WorkbookNotRestored);
}

/// The copy of a connection as the restore writes it (its id and params, no name or draft), see `PatchWorkbookConnection`
fn copy_patch(stored: &WorkbookData, connection: &RestoreConnection) -> Option<WorkbookData> {
    patch_workbook_connection(stored, &WorkbookConnection::new(connection.connection_id.clone(), connection.params.clone()), &[])
}

#[test]
fn lets_the_app_manifest_win_over_stale_workbook_copies() {
    let saved = json!({ "trino": { "endpoint": "https://saved", "auth": { "authType": "AUTH_BASIC" } } });
    let mut planner = planner();
    planner.restore_manifest_connection(&ConnectionEntry::new(TEST_CONNECTION_ID, saved.clone())).unwrap();
    let stale = test_workbook_json(json!({ "connections": [{ "connectionId": TEST_CONNECTION_ID, "params": { "trino": { "endpoint": "https://stale" } } }] }));
    let begun = planner.begin_workbook(TEST_WORKBOOK_ID, Some(&stale.to_string())).unwrap();
    // The catalog of a connection of the manifest is restored already
    assert!(begun.catalogs_to_restore.is_empty());
    planner.finish_workbook(begun, Some(&[][..])).unwrap();
    assert_eq!(planner.pending().workbook_copies, [(TEST_WORKBOOK_ID.to_string(), TEST_CONNECTION_ID.to_string())]);
    assert!(planner.pending().connection_entries.is_empty());
    let patched = copy_patch(&WorkbookData::from_json(&stale), planner.connection(TEST_CONNECTION_ID).unwrap()).unwrap();
    assert_eq!(patched.connections, vec![WorkbookConnection::new(TEST_CONNECTION_ID, saved)]);
    // Params the app can't use fail, the workbooks register the connection again
    assert!(planner.restore_manifest_connection(&ConnectionEntry::new(OTHER_CONNECTION_ID, json!({ "nope": {} }))).is_err());
}

#[test]
fn moves_the_name_of_an_imported_connection_into_the_app_manifest() {
    let known = json!({ "trino": { "endpoint": "https://known" } });
    let mut planner = planner();
    let mut mine = ConnectionEntry::new(OTHER_CONNECTION_ID, known.clone());
    mine.name = Some("Mine".into());
    planner.restore_manifest_connection(&mine).unwrap();
    let workbook = test_workbook_json(json!({
        "connections": [
            { "connectionId": TEST_CONNECTION_ID, "params": { "trino": { "endpoint": "https://unknown" } }, "name": "Production" },
            { "connectionId": OTHER_CONNECTION_ID, "params": known, "name": "Theirs" },
        ],
        "scripts": [{ "name": "01_new.sql", "connectionId": TEST_CONNECTION_ID }, { "name": "02_known.sql", "connectionId": OTHER_CONNECTION_ID }],
    }));
    restore(&mut planner, &workbook, &["01_new.sql", "02_known.sql"]);
    // A new connection is registered with its name, a known connection keeps its own
    assert_eq!(planner.connection(TEST_CONNECTION_ID).unwrap().name.as_deref(), Some("Production"));
    assert_eq!(planner.connection(OTHER_CONNECTION_ID).unwrap().name.as_deref(), Some("Mine"));
    // The writer upserts the registered connections into the entries of the app manifest
    let mut manifest = vec![mine.to_json()];
    for entry in &planner.pending().connection_entries {
        if let Some(next) = upsert_connection_entry(Some(&manifest), &entry.to_json()) {
            manifest = next;
        }
    }
    let manifest: Vec<ConnectionEntry> = manifest.iter().filter_map(ConnectionEntry::from_json).collect();
    assert_eq!(manifest.iter().map(|e| (e.id.as_str(), e.name.as_deref())).collect::<Vec<_>>(), [(OTHER_CONNECTION_ID, Some("Mine")), (TEST_CONNECTION_ID, Some("Production"))]);
    // The workbook copies drop the names
    let mut stored = WorkbookData::from_json(&workbook);
    for (workbook_id, connection_id) in &planner.pending().workbook_copies {
        assert_eq!(workbook_id, TEST_WORKBOOK_ID);
        if let Some(next) = copy_patch(&stored, planner.connection(connection_id).unwrap()) {
            stored = next;
        }
    }
    assert!(stored.connections.iter().all(|connection| connection.name.is_none()));
}

#[test]
fn restores_an_imported_workbook_against_the_live_connections() {
    let known = json!({ "trino": { "endpoint": "https://known" } });
    let mut planner = planner();
    planner.add_live_connection(RestoreConnection { connection_id: OTHER_CONNECTION_ID.into(), params: known.clone(), params_draft: None, name: None, cache_query_results: None });
    let workbook = test_workbook_json(json!({
        "connections": [
            { "connectionId": OTHER_CONNECTION_ID, "params": known },
            { "connectionId": TEST_CONNECTION_ID, "params": { "trino": { "endpoint": "https://new" } } },
        ],
        "scripts": [{ "name": "01_known.sql", "connectionId": OTHER_CONNECTION_ID }, { "name": "02_new.sql", "connectionId": TEST_CONNECTION_ID }],
    }));
    let begun = planner.begin_workbook(TEST_WORKBOOK_ID, Some(&workbook.to_string())).unwrap();
    assert_eq!(begun.connection_ids, [OTHER_CONNECTION_ID, TEST_CONNECTION_ID]);
    assert_eq!(begun.catalogs_to_restore, [TEST_CONNECTION_ID]);
    planner.finish_workbook(begun, Some(&names(&["01_known.sql", "02_new.sql"]))).unwrap();
    assert_eq!(planner.new_connections().map(|c| c.connection_id.as_str()).collect::<Vec<_>>(), [TEST_CONNECTION_ID]);
    // A workbook without a usable copy of its embedded database registers a new one
    let mut fresh = self::planner();
    let remote_only = test_workbook_json(json!({ "connections": [{ "connectionId": OTHER_CONNECTION_ID, "params": { "trino": {} } }], "scripts": [{ "name": "a.sql", "connectionId": "99999999-9999-4999-8999-999999999999" }] }));
    let plan = restore(&mut fresh, &remote_only, &["a.sql"]);
    assert!(is_local_hyper_wasm_params(&plan.scripts[0].connection.params));
}

#[test]
fn compares_file_names_in_nfc_and_refuses_alternate_data_streams() {
    // "Café.sql" composed and decomposed
    let composed = "Caf\u{e9}.sql";
    let decomposed = "Cafe\u{301}.sql";
    assert_eq!(file_name_key(composed), file_name_key(decomposed));
    assert_eq!(file_name_key(&decomposed.to_uppercase()), file_name_key(composed));
    assert_eq!(nfc(decomposed), composed);
    // A file and its decomposed name are one script of a workbook file
    let workbook = test_workbook(json!({ "scripts": [
        { "name": composed, "connectionId": TEST_CONNECTION_ID },
        { "name": decomposed, "connectionId": TEST_CONNECTION_ID },
    ] }));
    let sanitized = sanitize_workbook_files(&workbook);
    assert_eq!(sanitized.scripts.len(), 1);
    assert!(!sanitized.valid);
    // A colon names an alternate data stream on NTFS
    assert!(!is_safe_file_name("a.sql:stream"));
    assert!(!is_script_file_name("a:b.sql"));
    assert!(is_safe_file_name("a b.sql"));
}
