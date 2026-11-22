//! The catalog loader.

use std::cell::RefCell;
use std::future::Future;
use std::pin::pin;
use std::rc::Rc;
use std::sync::Arc;
use std::task::{Context, Poll, Wake, Waker};

use arrow_array::builder::{ListBuilder, StringBuilder};
use arrow_array::{ArrayRef, BooleanArray, Int32Array, Int64Array, RecordBatch, StringArray};
use dashql_buffers::analyzer::QualifiedTableNameT;
use dashql_core::catalog::{Catalog, CatalogEntryId, CatalogLayer};
use dashql_core::script::Script;
use dashql_core_runtime::catalog_loader::batch::{publish_catalog_batch_sync, CatalogBatch, CatalogBatchEntry};
use dashql_core_runtime::catalog_loader::hyper::{catalog_tables_from_hyper_cloud, hyper_cloud_catalog_query_sql};
use dashql_core_runtime::catalog_loader::information_schema::{
    information_schema_columns_query, InformationSchemaScope,
};
use dashql_core_runtime::catalog_loader::pg_attribute::{
    catalog_tables_from_pg_attribute, pg_attribute_query_sql, PgAttributeScope,
};
use dashql_core_runtime::catalog_loader::pg_proc::{catalog_sql_from_pg_proc, pg_proc_query};
use dashql_core_runtime::catalog_loader::prefetched_hyper_functions::{
    qualify_prefetched_hyper_functions, PREFETCHED_HYPER_FUNCTIONS_SQL,
};
use dashql_core_runtime::catalog_loader::salesforce::catalog_tables_from_salesforce_metadata;
use dashql_core_runtime::catalog_loader::scheduler::TOUCHED_RETRY_DELAY_MS;
use dashql_core_runtime::catalog_loader::sql::{
    qualified_table_name, quote_data_type, quote_identifier, relation_filter,
};
use dashql_core_runtime::catalog_loader::tables::{
    catalog_descriptor_of_sql, catalog_functions_sql, catalog_tables_of_descriptor, catalog_tables_sql,
    create_table_sql, pack_catalog_descriptor_of_tables, parse_catalog_sql, read_catalog_descriptor, relations_file,
    relations_file_of_entry, CatalogStateFile, CatalogTable, ColumnMetadata,
};
use dashql_core_runtime::catalog_loader::trino::{
    parse_trino_catalog_entry, trino_catalog_entries, trino_catalog_scopes, TrinoCatalogEntry, TRINO_CATALOGS_QUERY,
};
use dashql_core_runtime::catalog_loader::{
    CatalogLoadError, CatalogLoader, CatalogLoaderCommand, CatalogLoaderConnection, CatalogQuery, CatalogUpdate,
    CatalogUpdateHost, CatalogUpdateOutcome, QueryAnswer,
};
use dashql_core_runtime::connections::*;
use dashql_core_runtime::http::{HttpRequest, HttpResponse};
use dashql_core_runtime::query::QueryType;
use dashql_core_runtime::workbook::CatalogHandle;
use serde_json::{json, Value};

/// 2026-01-01T00:00:00.000Z
const NOW: Timestamp = 1_767_225_600_000.0;

fn object(value: Value) -> JsonObject {
    value.as_object().cloned().unwrap()
}

fn relation(database: &str, schema: &str, table: &str) -> RelationName {
    RelationName::new(database, schema, table)
}

// ---------------------------------------------------------------------------------------------------------------------
// Arrow fixtures

fn strings(values: &[&str]) -> ArrayRef {
    Arc::new(StringArray::from(values.to_vec()))
}

fn optional_strings(values: &[Option<&str>]) -> ArrayRef {
    Arc::new(StringArray::from(values.to_vec()))
}

fn int32s(values: &[i32]) -> ArrayRef {
    Arc::new(Int32Array::from(values.to_vec()))
}

fn int64s(values: &[i64]) -> ArrayRef {
    Arc::new(Int64Array::from(values.to_vec()))
}

fn bools(values: &[bool]) -> ArrayRef {
    Arc::new(BooleanArray::from(values.to_vec()))
}

/// A list of strings per row, none for a null list
fn string_lists(values: &[Option<Vec<Option<&str>>>]) -> ArrayRef {
    let mut builder = ListBuilder::new(StringBuilder::new());
    for value in values {
        match value {
            Some(items) => {
                for item in items {
                    builder.values().append_option(*item);
                }
                builder.append(true);
            }
            None => builder.append(false),
        }
    }
    Arc::new(builder.finish())
}

fn batch(columns: Vec<(&str, ArrayRef)>) -> RecordBatch {
    RecordBatch::try_from_iter(columns).unwrap()
}

/// The rows of `pg_attribute` of one table
fn pg_rows(table: &str, columns: &[&str]) -> RecordBatch {
    batch(vec![
        ("table_schema", strings(&vec!["public"; columns.len()])),
        ("table_name", strings(&vec![table; columns.len()])),
        ("column_name", strings(columns)),
        ("ordinal_position", int32s(&(1..=columns.len() as i32).collect::<Vec<_>>())),
        ("data_type", strings(&vec!["int8"; columns.len()])),
    ])
}

/// The rows of a Hyper Cloud catalog
fn cloud_rows() -> RecordBatch {
    batch(vec![
        ("database_name", strings(&["Cloud Database", "Cloud Database"])),
        ("schema_name", strings(&["sales", "sales"])),
        ("table_name", strings(&["orders", "orders"])),
        ("column_name", strings(&["name", "id"])),
        ("ordinal_position", int32s(&[1, 0])),
        ("data_type", strings(&["text", "bigint"])),
    ])
}

/// The rows of `pg_proc` with one function
fn function_rows() -> RecordBatch {
    batch(vec![
        ("function_schema", strings(&["pg_catalog"])),
        ("function_name", strings(&["wasm_catalog_function"])),
        ("return_type", strings(&["bigint"])),
        ("returns_set", bools(&[false])),
        ("function_kind", strings(&["f"])),
        ("argument_types", string_lists(&[Some(vec![Some("integer")])])),
        ("argument_names", string_lists(&[Some(vec![])])),
        ("argument_modes", string_lists(&[Some(vec![])])),
    ])
}

/// The answer of a query of a Hyper connection: the functions for its `pg_proc`, the rows otherwise
fn or_functions(query: &CatalogQuery, rows: RecordBatch) -> Vec<RecordBatch> {
    vec![if query.query_type == QueryType::CatalogQueryPgProc { function_rows() } else { rows }]
}

/// An empty result without columns
fn no_rows() -> Vec<RecordBatch> {
    Vec::new()
}

// ---------------------------------------------------------------------------------------------------------------------
// Driving an update

/// The steps of an update answer at once, polling until done is enough
struct NoopWaker;
impl Wake for NoopWaker {
    fn wake(self: Arc<Self>) {}
}

fn block_on<F: Future>(future: F) -> F::Output {
    let waker = Waker::from(Arc::new(NoopWaker));
    let mut context = Context::from_waker(&waker);
    let mut future = pin!(future);
    loop {
        if let Poll::Ready(output) = future.as_mut().poll(&mut context) {
            return output;
        }
    }
}

/// The answers of the fetches of an update
type FetchAnswer<'a> = Box<dyn FnMut(&[HttpRequest]) -> Vec<Result<HttpResponse, String>> + 'a>;

/// How a test answers an update
struct Host<'a> {
    /// Answer a query
    query: RefCell<Box<dyn FnMut(&CatalogQuery) -> QueryAnswer + 'a>>,
    /// Answer the metadata of Salesforce
    metadata: RefCell<Box<dyn FnMut() -> Result<Value, String> + 'a>>,
    /// Answer the requests, by default with the metadata in the first response
    fetch: RefCell<Option<FetchAnswer<'a>>>,
    /// The error of the refresh of the channel
    channel_error: Option<String>,
    /// Why the update was cancelled, a step of the test may set it
    cancel: Rc<RefCell<Option<String>>>,
    /// The queries the update ran
    queries: RefCell<Vec<CatalogQuery>>,
    /// The requests the update sent
    requests: RefCell<Vec<HttpRequest>>,
}

impl<'a> Host<'a> {
    fn new(query: impl FnMut(&CatalogQuery) -> QueryAnswer + 'a) -> Self {
        Self {
            query: RefCell::new(Box::new(query)),
            metadata: RefCell::new(Box::new(|| Err("no metadata".to_string()))),
            fetch: RefCell::new(None),
            channel_error: None,
            cancel: Rc::default(),
            queries: RefCell::default(),
            requests: RefCell::default(),
        }
    }

    fn with_metadata(mut self, metadata: impl FnMut() -> Result<Value, String> + 'a) -> Self {
        self.metadata = RefCell::new(Box::new(metadata));
        self
    }

    /// Run an update to its end, publishing into a catalog
    fn drive(&self, update: CatalogUpdate, catalog: &CatalogHandle) -> CatalogUpdateOutcome {
        block_on(update.run(&Steps { host: self, catalog }))
    }
}

/// The answers of a test host to the steps of an update
struct Steps<'h, 'a> {
    host: &'h Host<'a>,
    catalog: &'h CatalogHandle,
}

impl CatalogUpdateHost for Steps<'_, '_> {
    fn stopped(&self) -> Option<CatalogLoadError> {
        self.host.cancel.borrow().clone().map(CatalogLoadError::cancelled)
    }

    async fn run_queries(&self, queries: &[CatalogQuery]) -> Option<Vec<QueryAnswer>> {
        let answers = queries.iter().map(|query| (self.host.query.borrow_mut())(query)).collect();
        self.host.queries.borrow_mut().extend(queries.iter().cloned());
        Some(answers)
    }

    async fn fresh_channel(&self) -> Option<Result<Option<ConnectionChannel>, String>> {
        Some(match &self.host.channel_error {
            Some(error) => Err(error.clone()),
            None => Ok(Some(ConnectionChannel::Salesforce(salesforce_channel()))),
        })
    }

    async fn fetch(&self, requests: &[HttpRequest]) -> Option<Vec<Result<HttpResponse, String>>> {
        self.host.requests.borrow_mut().extend(requests.iter().cloned());
        let mut fetch = self.host.fetch.borrow_mut();
        Some(match fetch.as_mut() {
            Some(fetch) => fetch(requests),
            None => metadata_responses(requests.len(), (self.host.metadata.borrow_mut())()),
        })
    }

    fn catalog(&self) -> Result<CatalogHandle, CatalogLoadError> {
        Ok(self.catalog.clone())
    }
}

/// A connection and the id of its last update
struct Fixture {
    connection: ConnectionState,
    task_id: u32,
}

impl Fixture {
    fn new(connector: ConnectorType, params: Value) -> Self {
        let connection =
            ConnectionState::from_params("connection", ConnectionParams::new(connector, object(params)), NOW);
        Self { connection, task_id: 0 }
    }

    fn hyper(params: Value) -> Self {
        Self::new(ConnectorType::Hyper, params)
    }

    /// Start an update and register it with the connection
    fn start(&mut self, relations: Option<Vec<RelationName>>) -> CatalogUpdate {
        self.task_id += 1;
        let update = CatalogUpdate::start(&self.connection, self.task_id, relations, NOW).unwrap();
        self.connection.apply(ConnectionAction::UpdateCatalog(update.task.clone()), NOW).unwrap();
        update
    }

    /// Run an update and finish it on the connection, setting the text of the function script
    fn run(&mut self, relations: Option<Vec<RelationName>>, host: &Host) -> (CatalogUpdateOutcome, Option<String>) {
        let update = self.start(relations);
        let catalog = self.connection.catalog().clone();
        let outcome = host.drive(update, &catalog);
        self.connection.apply(outcome.connection_action(self.task_id), NOW).unwrap();
        (outcome.clone(), outcome.function_script_text)
    }

    fn relations_text(&self) -> String {
        relations_file_of_entry(&self.connection.catalog().borrow(), self.connection.relation_entry_id())
            .unwrap_or_default()
    }

    fn function_entry(&self) -> u32 {
        self.connection.function_script().unwrap().catalog_entry_id()
    }

    fn function_count(&self) -> usize {
        let catalog = self.connection.catalog().borrow();
        let Some(bytes) = catalog.descriptor_bytes(self.function_entry()) else {
            return 0;
        };
        read_catalog_descriptor(bytes).unwrap().function_declarations.map_or(0, |functions| functions.len())
    }

    fn version(&self) -> u64 {
        self.connection.catalog().borrow().version() as u64
    }

    /// Let publications into an entry fail: a script takes the id of the entry in place of its descriptor
    fn block_entry(&self, entry_id: u32) {
        let mut catalog = self.connection.catalog().borrow_mut();
        catalog.drop_descriptor(entry_id).unwrap();
        let mut script = Script::with_entry_id(entry_id);
        script.replace_text("create table blocker(id int);");
        script.analyze(&catalog, true).unwrap();
        catalog.load_script(script.analyzed.clone().unwrap(), CatalogLayer::CONNECTION).unwrap();
    }
}

// ---------------------------------------------------------------------------------------------------------------------
// The SQL generator

#[test]
fn quotes_identifiers() {
    assert_eq!(quote_identifier("users"), "\"users\"");
    assert_eq!(quote_identifier("user table"), "\"user table\"");
    assert_eq!(quote_identifier("user\"name"), "\"user\"\"name\"");
    assert_eq!(quote_identifier("test\"with\"quotes"), "\"test\"\"with\"\"quotes\"");
    assert_eq!(quote_identifier("table.name"), "\"table.name\"");
}

#[test]
fn quotes_data_types_and_says_if_a_type_is_unknown() {
    assert_eq!(quote_data_type(Some("bigint")), "\"bigint\"");
    assert_eq!(quote_data_type(Some("numeric(10,2)")), "\"numeric(10,2)\"");
    assert_eq!(quote_data_type(Some("timestamp with time zone")), "\"timestamp with time zone\"");
    assert_eq!(quote_data_type(Some("USER-DEFINED")), "\"USER-DEFINED\"");
    assert_eq!(quote_data_type(Some("\"char\"")), "\"\"\"char\"\"\"");
    assert_eq!(quote_data_type(None), "\"unknown\"");
    assert_eq!(quote_data_type(Some("")), "\"unknown\"");
    assert_eq!(quote_data_type(Some("  ")), "\"unknown\"");
}

#[test]
fn qualifies_table_names_with_hyper_without_a_database() {
    assert_eq!(qualified_table_name(Some("mydb"), "myschema", "mytable"), "\"mydb\".\"myschema\".\"mytable\"");
    assert_eq!(qualified_table_name(None, "myschema", "mytable"), "\"hyper\".\"myschema\".\"mytable\"");
    assert_eq!(qualified_table_name(Some(""), "s", "t"), "\"hyper\".\"s\".\"t\"");
    assert_eq!(qualified_table_name(Some("my db"), "my schema", "my table"), "\"my db\".\"my schema\".\"my table\"");
}

fn column(name: &str, ordinal_position: i64, data_type: Option<&str>) -> ColumnMetadata {
    ColumnMetadata { name: name.to_string(), ordinal_position, data_type: data_type.map(str::to_string) }
}

#[test]
fn creates_tables_with_sorted_and_quoted_columns() {
    let sql = create_table_sql(
        Some("db"),
        Some("schema"),
        "users",
        &[column("name", 1, Some("varchar")), column("id", 0, Some("integer")), column("email", 2, None)],
    );
    assert_eq!(sql, "CREATE TABLE \"db\".\"schema\".\"users\" (\n    \"id\" \"integer\",\n    \"name\" \"varchar\",\n    \"email\" \"unknown\"\n);");
    let sql = create_table_sql(
        Some("db"),
        Some("s"),
        "u",
        &[column("user id", 0, Some("integer")), column("user\"name", 1, Some("varchar"))],
    );
    assert!(sql.contains("\"user id\" \"integer\""));
    assert!(sql.contains("\"user\"\"name\" \"varchar\""));
    assert_eq!(create_table_sql(None, None, "t", &[]), "CREATE TABLE \"t\" (\n\n);");
}

#[test]
fn filters_relations_by_schema_and_name() {
    assert_eq!(
        relation_filter("s", "t", &[relation("db", "o'x", "a"), relation("db", "y", "b")]),
        "((s = 'o''x' AND t = 'a') OR (s = 'y' AND t = 'b'))"
    );
    // A name without a schema in every schema, and a whole schema
    assert_eq!(relation_filter("s", "t", &[relation("db", "", "a")]), "((t = 'a'))");
    assert_eq!(relation_filter("s", "t", &[relation("db", "x", "")]), "((s = 'x'))");
}

fn disk_tables() -> Vec<CatalogTable> {
    vec![
        CatalogTable {
            database_name: "db".into(),
            schema_name: "sales".into(),
            table_name: "Orders".into(),
            columns: vec![
                column("zone", 1, Some("text")),
                column("amount", 2, Some("numeric(10,2)")),
                column("note \"quoted\"", 3, Some("USER-DEFINED")),
                column("plain", 4, None),
            ],
        },
        CatalogTable {
            database_name: "db".into(),
            schema_name: "sales".into(),
            table_name: "tags".into(),
            columns: vec![column("id", 1, Some("int8"))],
        },
    ]
}

/// The tables as `db.schema.table` with their columns and types
fn output(tables: &[CatalogTable]) -> Vec<(String, Vec<(String, Option<String>)>)> {
    tables
        .iter()
        .map(|table| {
            (
                format!("{}.{}.{}", table.database_name, table.schema_name, table.table_name),
                table.columns.iter().map(|column| (column.name.clone(), column.data_type.clone())).collect(),
            )
        })
        .collect()
}

#[test]
fn the_catalog_on_disk_reads_back_what_the_connection_reported() {
    let mut catalog = Catalog::new();
    let entry = catalog.allocate_entry_id();
    catalog
        .replace_descriptor(entry, CatalogLayer::CONNECTION, &pack_catalog_descriptor_of_tables(&disk_tables()))
        .unwrap();
    let before = read_catalog_descriptor(catalog.descriptor_bytes(entry).unwrap()).unwrap();
    assert_eq!(output(&catalog_tables_of_descriptor(Some(&before))), output(&disk_tables()));

    // Save, then restart: the file is parsed once into a descriptor
    let reload = |file: &str| read_catalog_descriptor(&catalog_descriptor_of_sql(file).unwrap()).unwrap();
    let after = reload(&relations_file(Some(&before)));
    // The names and the order stay, the parser normalizes the spelling of types
    let s = |text: &str| Some(text.to_string());
    assert_eq!(
        output(&catalog_tables_of_descriptor(Some(&after))),
        vec![
            (
                "db.sales.Orders".to_string(),
                vec![
                    ("zone".to_string(), s("text")),
                    ("amount".to_string(), s("numeric(10,2)")),
                    ("note \"quoted\"".to_string(), s("user-defined")),
                    ("plain".to_string(), s("unknown")),
                ]
            ),
            ("db.sales.tags".to_string(), vec![("id".to_string(), s("bigint"))]),
        ]
    );
    // From then on the file doesn't change anymore
    let file = relations_file(Some(&after));
    assert_eq!(relations_file(Some(&reload(&file))), file);
}

#[test]
fn the_relations_file_has_a_statement_per_table_and_no_temporary_relations() {
    assert_eq!(catalog_tables_sql(&disk_tables()).matches("CREATE TABLE").count(), 2);
    assert!(relations_file(None).starts_with("-- DashQL Connection Relations.\n"));
    let mut tables = disk_tables();
    tables[1].schema_name = "pg_temp_3".into();
    let descriptor = read_catalog_descriptor(&pack_catalog_descriptor_of_tables(&tables)).unwrap();
    let file = relations_file(Some(&descriptor));
    assert!(file.contains("\"Orders\""));
    assert!(!file.contains("\"tags\""));
}

#[test]
fn reads_and_writes_the_catalog_state_file() {
    let state = CatalogStateFile::parse(Some(
        r#"{"pending":[{"databaseName":"db","schemaName":"","tableName":"t"},{"databaseName":1}],"gone":[{"databaseName":"db","schemaName":"s","tableName":"g"}]}"#,
    ));
    assert_eq!(state.pending, vec![relation("db", "", "t")]);
    assert_eq!(state.gone, vec![relation("db", "s", "g")]);
    assert_eq!(CatalogStateFile::parse(Some(&state.to_json())), state);
    assert_eq!(
        state.to_json(),
        r#"{"pending":[{"databaseName":"db","schemaName":"","tableName":"t"}],"gone":[{"databaseName":"db","schemaName":"s","tableName":"g"}]}"#
    );
    assert_eq!(CatalogStateFile::parse(Some("not json")), CatalogStateFile::default());
    assert_eq!(CatalogStateFile::parse(None), CatalogStateFile::default());
}

// ---------------------------------------------------------------------------------------------------------------------
// The catalog structure

#[test]
fn the_structure_reads_tables_and_columns() {
    let catalog = parse_catalog_sql("CREATE TABLE \"db\".\"public\".\"orders\" (\"id\" integer, \"note\" text);\nCREATE TABLE \"db\".\"public\".\"empty\" ();").unwrap();
    assert!(catalog.functions.is_empty());
    assert_eq!(
        catalog.tables,
        vec![
            CatalogTable {
                database_name: "db".into(),
                schema_name: "public".into(),
                table_name: "orders".into(),
                columns: vec![column("id", 0, Some("integer")), column("note", 1, Some("text"))],
            },
            CatalogTable {
                database_name: "db".into(),
                schema_name: "public".into(),
                table_name: "empty".into(),
                columns: vec![]
            },
        ]
    );
}

#[test]
fn the_structure_reads_functions_and_overloads_stay_apart() {
    let catalog = parse_catalog_sql(
        "CREATE FUNCTION \"db\".\"public\".\"scale\"(value integer, factor integer) RETURNS bigint;
CREATE FUNCTION \"db\".\"public\".\"scale\"(value bigint) RETURNS bigint;
CREATE AGGREGATE \"db\".\"pg_catalog\".\"any_value\"() RETURNS any;",
    )
    .unwrap();
    let functions: Vec<(String, bool, Option<String>, Vec<(Option<String>, Option<String>)>)> = catalog
        .functions
        .iter()
        .map(|f| {
            (
                format!("{}.{}.{}", f.database_name, f.schema_name, f.function_name),
                f.is_aggregate,
                f.return_type.clone(),
                f.params.iter().map(|p| (p.name.clone(), p.param_type.clone())).collect(),
            )
        })
        .collect();
    let s = |text: &str| Some(text.to_string());
    assert_eq!(
        functions,
        vec![
            (
                "db.public.scale".to_string(),
                false,
                s("bigint"),
                vec![(s("value"), s("integer")), (s("factor"), s("integer"))]
            ),
            ("db.public.scale".to_string(), false, s("bigint"), vec![(s("value"), s("bigint"))]),
            ("db.pg_catalog.any_value".to_string(), true, s("any"), vec![]),
        ]
    );
}

#[test]
fn the_structure_renders_files_that_read_back_the_same() {
    let catalog = parse_catalog_sql(
        "CREATE TABLE \"db\".\"public\".\"orders\" (\"id\" integer, \"note\" text);
CREATE FUNCTION \"db\".\"public\".\"scale\"(value integer, factor integer) RETURNS bigint;
CREATE AGGREGATE \"db\".\"pg_catalog\".\"any_value\"() RETURNS any;",
    )
    .unwrap();
    let relations = catalog_tables_sql(&catalog.tables);
    let functions = catalog_functions_sql(&catalog.functions);
    assert_eq!(parse_catalog_sql(&relations).unwrap().tables, catalog.tables);
    assert_eq!(parse_catalog_sql(&functions).unwrap().functions, catalog.functions);
    assert_eq!(catalog_functions_sql(&parse_catalog_sql(&functions).unwrap().functions), functions);
}

/// The number of functions in the bundled catalog of the functions of Hyper
fn bundled_function_count() -> usize {
    parse_catalog_sql(PREFETCHED_HYPER_FUNCTIONS_SQL).unwrap().functions.len()
}

#[test]
fn the_structure_round_trips_the_functions_of_hyper() {
    let functions = parse_catalog_sql(PREFETCHED_HYPER_FUNCTIONS_SQL).unwrap().functions;
    assert!(functions.len() > 100);
    assert_eq!(parse_catalog_sql(&catalog_functions_sql(&functions)).unwrap().functions, functions);
}

#[test]
fn the_structure_refuses_a_file_that_does_not_parse() {
    let error = parse_catalog_sql("CREATE TABLE broken(").unwrap_err();
    assert!(error.message().starts_with("Cannot read a catalog"), "{error}");
}

// ---------------------------------------------------------------------------------------------------------------------
// information_schema

#[test]
fn reads_the_information_schema_of_every_catalog() {
    let scopes = vec![
        InformationSchemaScope {
            catalog: "hive".into(),
            schemas: vec!["sales".into(), "o'neil".into()],
            relations: None,
        },
        InformationSchemaScope::catalog("my\"lake"),
    ];
    let sql = information_schema_columns_query(&scopes);
    // One select per catalog, the names quoted, a catalog with schemas reads only those
    assert!(sql.contains(r#"FROM "hive".information_schema.columns"#), "{sql}");
    assert!(sql.contains("WHERE table_schema IN ('sales', 'o''neil')"), "{sql}");
    assert!(sql.contains(r#"FROM "my""lake".information_schema.columns"#), "{sql}");
    assert_eq!(sql.matches("UNION ALL").count(), 1, "{sql}");
    assert_eq!(sql.matches("WHERE").count(), 1, "{sql}");
}

fn trino(params: Value) -> Fixture {
    let mut params = object(params);
    params.insert("endpoint".into(), json!("https://trino.example.com"));
    params.insert("auth".into(), json!({ "authType": "AUTH_BASIC" }));
    Fixture::new(ConnectorType::Trino, Value::Object(params))
}

fn information_schema_rows(rows: &[(&str, &str, &str, &str, i64, &str)]) -> RecordBatch {
    batch(vec![
        ("table_catalog", strings(&rows.iter().map(|r| r.0).collect::<Vec<_>>())),
        ("table_schema", strings(&rows.iter().map(|r| r.1).collect::<Vec<_>>())),
        ("table_name", strings(&rows.iter().map(|r| r.2).collect::<Vec<_>>())),
        ("column_name", strings(&rows.iter().map(|r| r.3).collect::<Vec<_>>())),
        // Trino types the ordinal position as bigint
        ("ordinal_position", int64s(&rows.iter().map(|r| r.4).collect::<Vec<_>>())),
        ("data_type", strings(&rows.iter().map(|r| r.5).collect::<Vec<_>>())),
    ])
}

#[test]
fn a_trino_refresh_without_catalogs_reads_the_catalogs_of_the_server() {
    let mut trino = trino(json!({ "catalogs": [] }));
    let host = Host::new(|query| {
        assert_eq!(query.sql, TRINO_CATALOGS_QUERY);
        Ok(vec![batch(vec![("catalog_name", strings(&[]))])])
    });
    let (outcome, _) = trino.run(None, &host);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Failed);
    assert_eq!(outcome.error.as_deref(), Some("no catalogs to read the information_schema of"));
    assert_eq!(host.queries.borrow().len(), 1);

    // The catalogs of the server, all schemas of each
    let host = Host::new(|query| {
        if query.sql == TRINO_CATALOGS_QUERY {
            return Ok(vec![batch(vec![("catalog_name", strings(&["hive", "system"]))])]);
        }
        Ok(vec![information_schema_rows(&[("hive", "public", "items", "id", 1, "bigint")])])
    });
    let (outcome, _) = trino.run(None, &host);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Succeeded);
    assert_eq!(host.queries.borrow()[0].title, "Catalogs");
    assert_eq!(host.queries.borrow()[0].query_type, QueryType::CatalogQueryInformationSchema);
    assert!(host.queries.borrow()[1].sql.contains("FROM \"hive\".information_schema.columns\nUNION ALL"));
    assert!(host.queries.borrow()[1].sql.contains("FROM \"system\".information_schema.columns"));
    assert!(trino.connection.catalog_updates().described);
}

#[test]
fn a_trino_refresh_rejects_an_empty_metadata_result() {
    let mut trino = trino(json!({ "catalogs": ["catalog"] }));
    let (outcome, _) = trino.run(None, &mut Host::new(|_| Ok(no_rows())));
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Failed);
    assert_eq!(outcome.error.as_deref(), Some("information_schema returned no catalog relations"));
    assert!(!trino.connection.catalog_updates().described);
}

#[test]
fn a_trino_refresh_orders_the_columns_by_bigint_ordinal_positions() {
    let mut trino = trino(json!({ "defaultCatalog": "db" }));
    let host = Host::new(|_| {
        Ok(vec![information_schema_rows(&[
            ("db", "public", "items", "name", 2, "varchar"),
            ("db", "public", "items", "id", 1, "bigint"),
        ])])
    });
    let (outcome, _) = trino.run(None, &host);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Succeeded);
    assert!(outcome.catalog_changed);
    assert!(host.queries.borrow()[0].sql.contains("FROM \"db\".information_schema.columns"));
    assert!(trino
        .relations_text()
        .contains("CREATE TABLE \"db\".\"public\".\"items\" (\n    \"id\" \"bigint\",\n    \"name\" \"varchar\"\n);"));
}

#[test]
fn a_cancelled_update_publishes_nothing() {
    let mut trino = trino(json!({ "defaultCatalog": "db" }));
    let cancel = Rc::new(RefCell::new(None));
    let mut host = Host::new({
        let cancel = cancel.clone();
        move |_| {
            *cancel.borrow_mut() = Some("Superseded by forced catalog refresh".to_string());
            Ok(vec![information_schema_rows(&[("db", "public", "items", "id", 1, "bigint")])])
        }
    });
    host.cancel = cancel;
    let (outcome, _) = trino.run(None, &host);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Cancelled);
    assert_eq!(outcome.error.as_deref(), Some("Superseded by forced catalog refresh"));
    assert!(matches!(outcome.connection_action(trino.task_id), ConnectionAction::CatalogUpdateCancelled { .. }));
    assert!(trino.relations_text().is_empty());
}

#[test]
fn a_trino_lookup_asks_the_catalogs_of_the_relations_in_lower_case_and_updates_only_them() {
    let mut trino = trino(json!({ "defaultCatalog": "hive" }));
    let host = Host::new(|_| Ok(vec![information_schema_rows(&[("hive", "sales", "other", "id", 1, "bigint")])]));
    trino.run(None, &host);
    let host = Host::new(|_| Ok(vec![information_schema_rows(&[("hive", "sales", "orders", "id", 1, "bigint")])]));
    let (outcome, _) =
        trino.run(Some(vec![relation("Hive", "Sales", "Orders"), relation("hive", "sales", "gone")]), &host);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Succeeded);
    assert!(host.queries.borrow()[0].sql.contains(
        "FROM \"hive\".information_schema.columns
WHERE table_schema <> 'information_schema' AND ((table_schema = 'sales' AND table_name = 'orders') OR (table_schema = 'sales' AND table_name = 'gone'))"
    ));
    let text = trino.relations_text();
    assert!(text.contains("\"hive\".\"sales\".\"other\""));
    assert!(text.contains("\"hive\".\"sales\".\"orders\""));
    let catalog = trino.connection.catalog().borrow();
    let gone: Vec<RelationName> =
        catalog.absent_relations().iter().map(|key| relation(&key.0, &key.1, &key.2)).collect();
    assert_eq!(gone, vec![relation("hive", "sales", "gone")]);
}

// ---------------------------------------------------------------------------------------------------------------------
// pg_attribute and pg_proc

#[test]
fn pg_attribute_qualifies_an_attached_database_safely() {
    let query =
        pg_attribute_query_sql(&PgAttributeScope { query_database_name: Some("db\"name".into()), relations: None });
    assert!(query.contains("FROM \"db\"\"name\".\"pg_catalog\".pg_class c"));
    assert!(query.contains("JOIN \"db\"\"name\".\"pg_catalog\".pg_attribute a"));
    assert!(!query.contains("NOT IN"));
}

#[test]
fn pg_attribute_reads_only_the_relations_it_is_asked_about() {
    let query = pg_attribute_query_sql(&PgAttributeScope {
        query_database_name: None,
        relations: Some(vec![relation("db", "o'x", "a")]),
    });
    assert!(query.contains("AND ((n.nspname = 'o''x' AND c.relname = 'a'))"));
    assert!(query.contains("AND n.nspname NOT IN ('pg_catalog', 'information_schema')"));
    assert!(query.contains("FROM pg_catalog.pg_class c"));
    let query = pg_attribute_query_sql(&PgAttributeScope {
        query_database_name: None,
        relations: Some(vec![relation("db", "", "a")]),
    });
    assert!(query.contains("AND ((c.relname = 'a'))"));
}

#[test]
fn pg_attribute_groups_the_rows_by_table_and_keeps_the_ordinal_positions() {
    let rows = batch(vec![
        ("table_schema", strings(&["public", "public", "other", ""])),
        ("table_name", strings(&["items", "items", "tags", "skipped"])),
        ("column_name", strings(&["name", "id", "tag", "x"])),
        ("ordinal_position", int32s(&[2, 1, 1, 1])),
        ("data_type", optional_strings(&[Some("text"), Some("int8"), None, Some("text")])),
    ]);
    let tables = catalog_tables_from_pg_attribute(&[rows], "db").unwrap();
    let names: Vec<String> =
        tables.iter().map(|t| format!("{}.{}.{}", t.database_name, t.schema_name, t.table_name)).collect();
    assert_eq!(names, ["db.public.items", "db.other.tags"]);
    assert_eq!(tables[0].columns, vec![column("name", 2, Some("text")), column("id", 1, Some("int8"))]);
    assert_eq!(tables[1].columns, vec![column("tag", 1, None)]);
    // A result without rows needs no columns, one with rows does
    assert_eq!(catalog_tables_from_pg_attribute(&[batch(vec![("x", strings(&[]))])], "db").unwrap(), vec![]);
    assert!(catalog_tables_from_pg_attribute(&[batch(vec![("x", strings(&["a"]))])], "db").is_err());
}

#[test]
fn pg_proc_queries_structured_parameters() {
    let pg_proc = pg_proc_query(None).sql;
    assert!(pg_proc.contains("p.proallargtypes IS NOT NULL"));
    assert!(pg_proc.contains("unnest(p.proallargtypes) WITH ORDINALITY"));
    assert!(pg_proc.contains("unnest(p.proargtypes) WITH ORDINALITY"));
    assert!(pg_proc.contains("p.proargnames AS argument_names"));
    assert!(pg_proc.contains("p.proargmodes AS argument_modes"));
    assert!(pg_proc.contains("COALESCE(pg_catalog.format_type(p.prorettype, NULL), 'any')"));
    assert!(pg_proc.contains("p.proretset AS returns_set"));
    assert!(!pg_proc.contains("pg_get_function_arguments"));
}

#[test]
fn pg_proc_processes_multi_argument_named_mode_array_and_overload_signatures() {
    let rows = batch(vec![
        ("function_schema", strings(&["public"; 6])),
        ("function_name", strings(&["multi", "named_defaults", "modes", "arrays_decimal", "overloaded", "overloaded"])),
        ("return_type", strings(&["integer", "numeric(12, 3)", "bigint", "integer[]", "integer", "text"])),
        ("returns_set", bools(&[false; 6])),
        ("function_kind", strings(&["f"; 6])),
        (
            "argument_types",
            string_lists(&[
                Some(vec![Some("integer"), Some("integer")]),
                Some(vec![Some("integer"), Some("text"), Some("numeric(12, 3)")]),
                Some(vec![Some("integer"), Some("bigint"), Some("text"), Some("integer[]")]),
                Some(vec![
                    Some("integer[]"),
                    Some("numeric(18, 4)"),
                    Some("character varying(40)"),
                    Some("timestamp with time zone"),
                ]),
                Some(vec![Some("integer")]),
                Some(vec![Some("text")]),
            ]),
        ),
        (
            "argument_names",
            string_lists(&[
                None,
                Some(vec![Some("input"), Some("name, with quotes\""), Some("amount")]),
                Some(vec![Some("first"), Some("output"), Some("in_out"), Some("variadic_input")]),
                Some(vec![]),
                Some(vec![]),
                Some(vec![]),
            ]),
        ),
        (
            "argument_modes",
            string_lists(&[
                None,
                Some(vec![]),
                Some(vec![Some("i"), Some("o"), Some("b"), Some("v")]),
                Some(vec![]),
                Some(vec![]),
                Some(vec![]),
            ]),
        ),
    ]);
    let functions = catalog_sql_from_pg_proc(&[rows], Some("db")).unwrap();
    assert!(functions.skipped.is_empty());
    let sql = functions.sql;
    assert!(sql.contains("\"multi\"(\"arg1\" integer, \"arg2\" integer)"), "{sql}");
    assert!(sql.contains("\"name, with quotes\"\"\" text"));
    assert!(sql.contains("\"modes\"(\"first\" integer, \"in_out\" text, \"variadic_input\" integer[])"));
    assert!(!sql.contains("DEFAULT"));
    let descriptor = read_catalog_descriptor(&catalog_descriptor_of_sql(&sql).unwrap()).unwrap();
    let declarations = descriptor.function_declarations.unwrap();
    assert_eq!(declarations.len(), 6);
    let find = |name: &str| {
        declarations
            .iter()
            .filter(|f| f.function_name.as_ref().and_then(|n| n.function_name.as_deref()) == Some(name))
            .collect::<Vec<_>>()
    };
    let params = |f: &dashql_buffers::analyzer::FunctionDeclarationT| -> Vec<(Option<String>, Option<String>)> {
        f.params.iter().flatten().map(|p| (p.param_name.clone(), p.param_type.clone())).collect()
    };
    assert_eq!(params(find("multi")[0]).len(), 2);
    assert_eq!(params(find("multi")[0])[1].1.as_deref(), Some("integer"));
    assert_eq!(params(find("named_defaults")[0])[1].0.as_deref(), Some("name, with quotes\""));
    assert_eq!(params(find("modes")[0]).len(), 3);
    assert_eq!(params(find("modes")[0])[1].0.as_deref(), Some("in_out"));
    assert_eq!(params(find("arrays_decimal")[0])[1].1.as_deref(), Some("numeric(18, 4)"));
    assert_eq!(find("arrays_decimal")[0].return_type.as_deref(), Some("integer[]"));
    let overloaded: Vec<Option<String>> = find("overloaded").iter().map(|f| params(f)[0].1.clone()).collect();
    assert_eq!(overloaded, [Some("integer".to_string()), Some("text".to_string())]);
}

#[test]
fn pg_proc_skips_set_and_table_results_and_qualified_custom_types() {
    let rows = batch(vec![
        ("function_schema", strings(&["public"; 5])),
        ("function_name", strings(&["set_result", "table_result", "custom_type", "supported", "quoted_type"])),
        ("return_type", strings(&["integer", "record", "integer", "integer", "\"my.type\""])),
        ("returns_set", bools(&[true, false, false, false, false])),
        ("function_kind", strings(&["f"; 5])),
        (
            "argument_types",
            string_lists(&[
                Some(vec![Some("integer")]),
                Some(vec![Some("integer"), Some("text")]),
                Some(vec![Some("public.custom_type")]),
                Some(vec![Some("integer")]),
                Some(vec![]),
            ]),
        ),
        ("argument_names", string_lists(&[Some(vec![]), Some(vec![]), Some(vec![]), Some(vec![]), Some(vec![])])),
        (
            "argument_modes",
            string_lists(&[Some(vec![]), Some(vec![Some("i"), Some("t")]), Some(vec![]), Some(vec![]), Some(vec![])]),
        ),
    ]);
    let functions = catalog_sql_from_pg_proc(&[rows], Some("db")).unwrap();
    assert_eq!(functions.skipped, ["public.set_result", "public.table_result", "public.custom_type"]);
    assert!(functions.sql.contains("\"supported\""));
    // A dot of a quoted name is no qualification
    assert!(functions.sql.contains("\"quoted_type\"() RETURNS \"my.type\""));
    let descriptor = read_catalog_descriptor(&catalog_descriptor_of_sql(&functions.sql).unwrap()).unwrap();
    assert_eq!(descriptor.function_declarations.map_or(0, |f| f.len()), 2);
}

#[test]
fn pg_proc_rejects_invalid_argument_metadata() {
    let rows = batch(vec![
        ("function_schema", strings(&["public"])),
        ("function_name", strings(&["f"])),
        ("return_type", strings(&["integer"])),
        ("returns_set", bools(&[false])),
        ("function_kind", strings(&["f"])),
        ("argument_types", string_lists(&[Some(vec![Some("integer"), Some("text")])])),
        ("argument_names", string_lists(&[Some(vec![Some("a")])])),
        ("argument_modes", string_lists(&[Some(vec![])])),
    ]);
    let error = catalog_sql_from_pg_proc(&[rows], Some("db")).unwrap_err();
    assert_eq!(error, CatalogLoadError::failed("pg_proc returned invalid function argument metadata"));
}

// ---------------------------------------------------------------------------------------------------------------------
// The bundled functions of Hyper and the catalog batch

/// Publish function SQL as the descriptor of a function script, the number of functions
fn publish_functions(catalog: &mut Catalog, entry_id: CatalogEntryId, sql: &str) -> Result<usize, CatalogLoadError> {
    let batch = CatalogBatch::new(vec![CatalogBatchEntry { entry_id, text: sql.to_string(), require_functions: true }]);
    let counts = publish_catalog_batch_sync(catalog, &batch)?;
    Ok(counts.first().map_or(0, |counts| counts.functions))
}

#[test]
fn loads_the_bundled_function_catalog_as_a_descriptor() {
    let mut catalog = Catalog::new();
    let entry = catalog.allocate_entry_id();
    let count = publish_functions(&mut catalog, entry, PREFETCHED_HYPER_FUNCTIONS_SQL).unwrap();
    assert_eq!(count, bundled_function_count());
    let entries = catalog.describe_entries().entries.unwrap();
    assert_eq!(entries[0].catalog_entry_type, dashql_buffers::catalog::CatalogEntryType::DESCRIPTOR_POOL);
    assert!(
        PREFETCHED_HYPER_FUNCTIONS_SQL.contains("CREATE FUNCTION \"hyper\".\"pg_catalog\".\"date_add\"() RETURNS any;")
    );
    assert!(
        PREFETCHED_HYPER_FUNCTIONS_SQL.contains("CREATE AGGREGATE \"hyper\".\"pg_catalog\".\"count\"() RETURNS any;")
    );
    assert!(PREFETCHED_HYPER_FUNCTIONS_SQL.contains("CREATE FUNCTION \"hyper\".\"tableau\".\"sqrt\"() RETURNS any;"));
}

#[test]
fn qualifies_the_bundled_functions_for_a_database() {
    // 2026-08-30T12:34:56.789Z
    let sql = qualify_prefetched_hyper_functions("hyper", 1_788_093_296_789.0);
    assert!(sql.starts_with("-- DashQL Connection Functions."));
    assert!(sql.contains("-- Catalog Source: Bundled Hyper function catalog"));
    assert!(sql.contains("-- Last Refresh: 2026-08-30T12:34:56.789Z"));
    assert!(sql.contains("CREATE FUNCTION \"hyper\".\"pg_catalog\".\"abs\"() RETURNS any;"));
    let sql = qualify_prefetched_hyper_functions("my\"db", NOW);
    assert!(sql.contains("CREATE FUNCTION \"my\"\"db\".\"pg_catalog\".\"abs\"() RETURNS any;"));
    assert!(!sql.contains("\"hyper\".\"pg_catalog\""));
}

#[test]
fn rejects_invalid_or_empty_function_sql_without_publishing() {
    let mut catalog = Catalog::new();
    let entry = catalog.allocate_entry_id();
    let error = publish_functions(&mut catalog, entry, "<!doctype html><html></html>").unwrap_err();
    assert!(error.message().contains("contains invalid SQL"), "{error}");
    assert!(catalog.descriptor_bytes(entry).is_none());

    publish_functions(&mut catalog, entry, PREFETCHED_HYPER_FUNCTIONS_SQL).unwrap();
    let version = catalog.version();
    let error = publish_functions(&mut catalog, entry, "-- no functions").unwrap_err();
    assert!(error.message().contains("function catalog is empty"), "{error}");
    assert_eq!(catalog.version(), version);
}

#[test]
fn a_batch_publishes_a_descriptor_per_entry_and_refuses_invalid_sql() {
    let mut catalog = Catalog::new();
    let (a, b) = (catalog.allocate_entry_id(), catalog.allocate_entry_id());
    let entry = |entry_id, text: &str| CatalogBatchEntry { entry_id, text: text.to_string(), require_functions: false };
    let both = CatalogBatch::new(vec![entry(a, "create table a(x int);"), entry(b, "create table b(y int);")]);
    let broken = CatalogBatch::new(vec![entry(a, "create table a(x int);"), entry(b, "create tabel b(y int);")]);
    assert!(broken.prepare().unwrap_err().message().starts_with("Catalog contains invalid SQL"));
    let counts = publish_catalog_batch_sync(&mut catalog, &both).unwrap();
    assert_eq!(counts.iter().map(|c| c.tables).collect::<Vec<_>>(), [1, 1]);
    assert!(catalog.descriptor_bytes(a).is_some() && catalog.descriptor_bytes(b).is_some());
}

// ---------------------------------------------------------------------------------------------------------------------
// Hyper

#[test]
fn hyper_cloud_queries_qualify_the_metadata_tables_without_projecting_ids() {
    let query = hyper_cloud_catalog_query_sql("cloud\"catalog", None);
    let projection = &query[query.find("SELECT").unwrap()..query.find("FROM").unwrap()];
    assert!(query.contains("FROM \"cloud\"\"catalog\".\"_hyper_catalog\".\"databases\" d"));
    assert!(query.contains("s.database_id = d.database_id"));
    for id in ["account_id", "database_id", "schema_id", "object_id", "column_id", "database_name_display"] {
        assert!(!projection.contains(id), "{id}");
    }
    assert!(projection.contains("CAST(c.type_descriptor AS TEXT) AS data_type"));
    let query = hyper_cloud_catalog_query_sql("lakehouse", Some(&[relation("lakehouse", "sales", "orders")]));
    assert!(query.contains("AND ((s.schema_name_display = 'sales' AND o.object_name_display = 'orders'))"));
}

#[test]
fn hyper_cloud_tables_are_named_after_the_attachment_and_declare_a_column_once() {
    let (tables, warning) = catalog_tables_from_hyper_cloud(&[cloud_rows()], "cloud attachment").unwrap();
    let sql = catalog_tables_sql(&tables);
    assert!(sql.contains("CREATE TABLE \"cloud attachment\".\"sales\".\"orders\""));
    assert!(!sql.contains("Cloud Database"));
    assert!(sql.find("\"id\" \"bigint\"").unwrap() < sql.find("\"name\" \"text\"").unwrap());
    assert!(warning.is_none());

    let (tables, warning) = catalog_tables_from_hyper_cloud(&[cloud_rows(), cloud_rows()], "lakehouse").unwrap();
    let sql = catalog_tables_sql(&tables);
    assert_eq!(sql.matches("\"id\" \"bigint\"").count(), 1);
    assert_eq!(sql.matches("\"name\" \"text\"").count(), 1);
    let warning = warning.unwrap();
    assert!(warning.contains("duplicates=2"), "{warning}");
    assert!(warning.contains("column=name"), "{warning}");
}

#[test]
fn hyper_queries_standard_and_cloud_attachments_and_merges_their_catalogs() {
    let mut hyper = Fixture::hyper(json!({
        "protocol": "V3_HTTP",
        "endpoint": "http://hyper.example",
        "attachedDatabases": [
            { "path": "lakehouse:tenant;default", "alias": "lake db" },
            { "path": "hyper.cloud/catalog", "alias": "cloud" },
        ],
    }));
    let host = Host::new(|query| {
        Ok(or_functions(
            query,
            if query.sql.contains("\"_hyper_catalog\".\"databases\"") {
                cloud_rows()
            } else {
                pg_rows("lake_table", &["id"])
            },
        ))
    });
    let (outcome, functions) = hyper.run(None, &host);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Succeeded, "{outcome:?}");
    assert_eq!(host.queries.borrow().len(), 3);
    assert!(host.queries.borrow()[0].sql.contains("FROM \"lake db\".\"pg_catalog\".pg_class c"));
    assert!(host.queries.borrow()[1].sql.contains("FROM \"cloud\".\"_hyper_catalog\".\"databases\" d"));
    assert!(host.queries.borrow()[1].title.contains("(cloud)"));
    assert!(host.queries.borrow().iter().all(|query| query.read_timeout));
    let text = hyper.relations_text();
    assert!(text.contains("CREATE TABLE \"lake db\".\"public\".\"lake_table\""));
    assert!(text.contains("CREATE TABLE \"cloud\".\"sales\".\"orders\""));
    assert!(!text.contains("Cloud Database"));
    // A server reads the functions of its deployment from the pg_proc of its first database, a session with several
    // resolves no unqualified name
    assert_eq!(host.queries.borrow()[2].query_type, QueryType::CatalogQueryPgProc);
    assert!(host.queries.borrow()[2].sql.contains("FROM \"lake db\".\"pg_catalog\".pg_proc p"));
    assert!(host.queries.borrow()[2].sql.contains("JOIN \"lake db\".\"pg_catalog\".pg_namespace n"));
    let functions = functions.unwrap();
    assert!(functions.contains("-- Catalog Source: Hyper pg_proc"));
    assert!(functions.contains(
        "CREATE FUNCTION \"hyper\".\"pg_catalog\".\"wasm_catalog_function\"(\"arg1\" integer) RETURNS bigint;"
    ));
    assert_eq!(hyper.function_count(), 1);
    assert!(hyper.connection.catalog_updates().described);
}

#[test]
fn hyper_wasm_reads_the_default_database_and_takes_the_bundled_functions() {
    let mut hyper = Fixture::hyper(json!({ "protocol": "WASM" }));
    let host = Host::new(|_| Ok(vec![pg_rows("default_table", &["id"])]));
    let (outcome, functions) = hyper.run(None, &host);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Succeeded, "{outcome:?}");
    // One query of the relations, the functions of the embedded Hyper are the bundled ones
    assert_eq!(host.queries.borrow().len(), 1);
    assert!(host.queries.borrow()[0].sql.contains("FROM pg_catalog.pg_class c"));
    assert!(!host.queries.borrow()[0].sql.contains("\"hyper\".\"pg_catalog\""));
    assert!(hyper.relations_text().contains("CREATE TABLE \"hyper\".\"public\".\"default_table\""));
    let functions = functions.unwrap();
    assert!(functions.contains("-- Catalog Source: Bundled Hyper function catalog"));
    assert!(functions.contains("CREATE FUNCTION \"hyper\".\"pg_catalog\".\"abs\"() RETURNS any;"));
}

#[test]
fn a_hyper_server_reads_its_functions_from_pg_proc() {
    let mut hyper = Fixture::hyper(json!({ "protocol": "V3_HTTP", "endpoint": "http://hyper.example" }));
    let host = Host::new(|query| Ok(or_functions(query, pg_rows("default_table", &["id"]))));
    let (outcome, functions) = hyper.run(None, &host);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Succeeded, "{outcome:?}");
    let queries = host.queries.borrow();
    assert_eq!(queries.len(), 2);
    assert_eq!(queries[1].query_type, QueryType::CatalogQueryPgProc);
    assert!(queries[1].read_timeout);
    // A session without attached databases resolves the unqualified name
    assert!(queries[1].sql.contains("FROM pg_proc p"));
    let functions = functions.unwrap();
    assert!(functions.contains("-- Catalog Source: Hyper pg_proc"));
    assert!(functions.contains(
        "CREATE FUNCTION \"hyper\".\"pg_catalog\".\"wasm_catalog_function\"(\"arg1\" integer) RETURNS bigint;"
    ));
    assert!(!functions.contains("\"abs\""));
}

#[test]
fn hyper_keeps_the_relations_of_a_failed_database_while_committing_the_others() {
    let mut hyper = Fixture::hyper(json!({
        "protocol": "V3_HTTP",
        "attachedDatabases": [{ "path": "lakehouse:first", "alias": "first" }, { "path": "lakehouse:second", "alias": "second" }],
    }));
    let alias = |query: &CatalogQuery| if query.sql.contains("\"first\".\"pg_catalog\"") { "first" } else { "second" };
    let host = Host::new(|query| Ok(or_functions(query, pg_rows(&format!("{}_v1", alias(query)), &["id"]))));
    hyper.run(None, &host);
    let host = Host::new(|query| match alias(query) {
        "second" => Err("second unavailable".to_string()),
        alias => Ok(or_functions(query, pg_rows(&format!("{alias}_v2"), &["id"]))),
    });
    let (outcome, _) = hyper.run(None, &host);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::PartiallySucceeded);
    assert_eq!(outcome.error.as_deref(), Some("second: second unavailable"));
    assert!(matches!(
        outcome.connection_action(2),
        ConnectionAction::CatalogUpdatePartiallySucceeded { task_id: 2, .. }
    ));
    let text = hyper.relations_text();
    assert!(text.contains("\"first\".\"public\".\"first_v2\""));
    assert!(!text.contains("first_v1"));
    assert!(text.contains("\"second\".\"public\".\"second_v1\""));
    assert!(!text.contains("second_v2"));
}

#[test]
fn hyper_leaves_the_catalog_untouched_when_every_attachment_fails_its_checks() {
    for attached in [
        json!([{ "path": "lakehouse:first", "alias": "" }]),
        json!([{ "path": "a", "alias": "x" }, { "path": "b", "alias": "x" }]),
    ] {
        let mut hyper = Fixture::hyper(json!({ "protocol": "V3_HTTP", "attachedDatabases": attached }));
        let host = Host::new(|_| unreachable!("no query runs"));
        let (outcome, functions) = hyper.run(None, &host);
        assert_eq!(outcome.status, CatalogUpdateTaskStatus::Failed);
        let error = outcome.error.unwrap();
        assert!(error.starts_with("Failed to refresh every attached database"), "{error}");
        assert!(
            error.contains("non-empty alias") || error.contains("Attached database alias \"x\" is not unique"),
            "{error}"
        );
        assert!(functions.is_none());
        assert!(hyper.relations_text().is_empty());
    }
}

#[test]
fn hyper_keeps_the_relations_after_a_failure_of_a_later_step() {
    for failure in ["function publication", "relation publication", "aborted"] {
        let mut hyper = Fixture::hyper(json!({ "protocol": "V3_HTTP" }));
        let revision = std::cell::Cell::new(1);
        let host = Host::new(|query| Ok(or_functions(query, pg_rows(&format!("table_v{}", revision.get()), &["id"]))));
        hyper.run(None, &host);
        let previous = hyper.relations_text();
        assert!(previous.contains("table_v1"));
        revision.set(2);

        let cancel = Rc::new(RefCell::new(None));
        let mut host = Host::new({
            let cancel = cancel.clone();
            let revision = &revision;
            move |query: &CatalogQuery| {
                // The update is aborted once its query answered
                if failure == "aborted" {
                    *cancel.borrow_mut() = Some("aborted".to_string());
                }
                Ok(or_functions(query, pg_rows(&format!("table_v{}", revision.get()), &["id"])))
            }
        });
        host.cancel = cancel;
        match failure {
            "function publication" => hyper.block_entry(hyper.function_entry()),
            "relation publication" => hyper.block_entry(hyper.connection.relation_entry_id()),
            _ => {}
        }
        let (outcome, _) = hyper.run(None, &host);
        assert_ne!(outcome.status, CatalogUpdateTaskStatus::Succeeded, "{failure}");
        if failure != "relation publication" {
            assert_eq!(hyper.relations_text(), previous, "{failure}");
        }
        // The functions are published first, a later failure leaves them published
        assert_eq!(outcome.function_script_text.is_some(), failure == "relation publication", "{failure}");
        // The same functions as before publish nothing new
        assert!(!outcome.catalog_changed, "{failure}");
    }
}

#[test]
fn hyper_publishes_an_empty_function_catalog_to_clear_stale_functions() {
    let mut hyper = Fixture::hyper(json!({ "protocol": "V3_HTTP", "endpoint": "http://hyper.example" }));
    let empty = std::cell::Cell::new(false);
    let host = Host::new(|query| {
        if query.sql.contains("FROM pg_proc p") {
            return Ok(if empty.get() { no_rows() } else { vec![function_rows()] });
        }
        Ok(vec![pg_rows("items", &["id"])])
    });
    let (_, functions) = hyper.run(None, &host);
    assert!(functions.unwrap().contains("wasm_catalog_function"));
    assert_eq!(hyper.function_count(), 1);
    empty.set(true);
    let (outcome, functions) = hyper.run(None, &host);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Succeeded);
    assert!(!functions.unwrap().contains("wasm_catalog_function"));
    assert_eq!(hyper.function_count(), 0);
    assert!(hyper.connection.catalog().borrow().contains(hyper.function_entry()));
}

#[test]
fn hyper_answers_about_relations_without_parsing_and_leaves_the_functions_alone() {
    let mut hyper = Fixture::hyper(json!({ "protocol": "WASM" }));
    let orders = || Some(vec![relation("hyper", "public", "orders")]);
    let columns = std::cell::RefCell::new(vec!["a", "b"]);
    let host = Host::new(|_| {
        let columns = columns.borrow();
        Ok(vec![pg_rows("orders", &columns)])
    });
    let (outcome, functions) = hyper.run(orders(), &host);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Succeeded);
    assert!(functions.is_none());
    assert_eq!(host.queries.borrow().len(), 1);
    assert!(host.queries.borrow()[0].sql.contains("n.nspname = 'public' AND c.relname = 'orders'"));
    assert!(hyper.relations_text().contains("CREATE TABLE \"hyper\".\"public\".\"orders\""));
    assert!(hyper.relations_text().contains("\"b\" \"int8\""));
    assert_eq!(hyper.function_count(), 0);
    // A lookup doesn't describe the connection
    assert!(!hyper.connection.catalog_updates().described);

    // The next answer replaces the table
    *columns.borrow_mut() = vec!["c"];
    hyper.run(orders(), &host);
    let text = hyper.relations_text();
    assert!(text.contains("\"c\" \"int8\"") && !text.contains("\"b\" \"int8\""));
    assert_eq!(text.matches("CREATE TABLE").count(), 1);

    // No rows: the relation is gone, an unchanged answer keeps the version
    *columns.borrow_mut() = vec![];
    let (outcome, _) = hyper.run(orders(), &host);
    assert!(outcome.catalog_changed);
    assert!(!hyper.relations_text().contains("CREATE TABLE"));
    let version = hyper.version();
    let (outcome, _) = hyper.run(orders(), &host);
    assert!(!outcome.catalog_changed);
    assert_eq!(hyper.version(), version);
}

#[test]
fn hyper_asks_only_the_databases_of_the_relations() {
    let mut hyper = Fixture::hyper(json!({
        "protocol": "V3_HTTP",
        "attachedDatabases": [{ "path": "a", "alias": "first" }, { "path": "b", "alias": "second" }],
    }));
    let host = Host::new(|_| Ok(vec![pg_rows("t", &["id"])]));
    let (outcome, _) = hyper.run(Some(vec![relation("second", "", "t")]), &host);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Succeeded);
    assert_eq!(host.queries.borrow().len(), 1);
    assert!(host.queries.borrow()[0].sql.contains("FROM \"second\".\"pg_catalog\".pg_class c"));
    // Relations of no database of the connection ask nothing
    let host = Host::new(|_| unreachable!());
    let (outcome, _) = hyper.run(Some(vec![relation("other", "", "t")]), &host);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Succeeded);
    assert!(!outcome.catalog_changed);
}

#[test]
fn a_database_com_connection_reads_the_hyper_cloud_database_it_attaches() {
    let mut dbcom = Fixture::new(ConnectorType::Dbcom, json!({ "instanceUrl": "", "databaseName": "sales" }));
    let host = Host::new(|query| Ok(or_functions(query, cloud_rows())));
    let (outcome, functions) = dbcom.run(None, &host);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Succeeded, "{outcome:?}");
    assert_eq!(host.queries.borrow().len(), 2);
    assert!(host.queries.borrow()[0].sql.contains("FROM \"lakehouse\".\"_hyper_catalog\".\"databases\" d"));
    assert!(dbcom.relations_text().contains("CREATE TABLE \"lakehouse\".\"sales\".\"orders\""));
    // The functions of the deployment, e.g. vector_search, from pg_proc
    assert_eq!(host.queries.borrow()[1].query_type, QueryType::CatalogQueryPgProc);
    assert!(functions.unwrap().contains("-- Catalog Source: Hyper pg_proc"));
}

// ---------------------------------------------------------------------------------------------------------------------
// Salesforce

/// The channel of a Salesforce login with its tokens, as the setup hands it to the connection
fn salesforce_channel() -> dashql_core_runtime::salesforce::SharedSalesforceChannel {
    use dashql_core_runtime::salesforce::{
        SalesforceConnectionParams, SalesforceCoreAccessToken, SalesforceDataCloudAccessToken, SalesforceTokens,
        SharedSalesforceChannel,
    };
    let core = SalesforceCoreAccessToken {
        access_token: "core-token".into(),
        instance_url: Some("https://example.my.salesforce.com".into()),
        ..Default::default()
    };
    let data_cloud = SalesforceDataCloudAccessToken {
        instance_url: "https://tenant.c360a.salesforce.com/".into(),
        ..Default::default()
    };
    let params = SalesforceConnectionParams::default();
    SharedSalesforceChannel::new(ConnectorType::SalesforceDataCloud, &params, SalesforceTokens { core, data_cloud })
        .unwrap()
}

/// A Salesforce connection with the channel of a login
fn salesforce() -> Fixture {
    let mut salesforce =
        Fixture::new(ConnectorType::SalesforceDataCloud, json!({ "instanceUrl": "https://example.my.salesforce.com" }));
    salesforce
        .connection
        .apply(ConnectionAction::Salesforce(SalesforceAction::ChannelReady(salesforce_channel())), NOW)
        .unwrap();
    salesforce
}

fn metadata(name: &str) -> Value {
    json!({ "metadata": [{ "name": name, "fields": [{ "name": "Id__c", "type": "Text" }] }] })
}

/// The responses of the metadata requests, one per entity type: the first carries the metadata, the others none
fn metadata_responses(count: usize, metadata: Result<Value, String>) -> Vec<Result<HttpResponse, String>> {
    let empty = json!({ "metadata": [] });
    (0..count)
        .map(|index| match &metadata {
            Ok(metadata) => Ok(HttpResponse::new(200, if index == 0 { metadata } else { &empty }.to_string())),
            Err(error) => Err(error.clone()),
        })
        .collect()
}

#[test]
fn salesforce_sends_the_metadata_requests_with_the_tokens_of_the_fresh_channel_and_warns_of_the_ones_that_failed() {
    let mut salesforce = salesforce();
    let host = Host::new(|_| unreachable!());
    *host.fetch.borrow_mut() = Some(Box::new(|requests| {
        let mut responses = metadata_responses(requests.len(), Ok(metadata("Account__dlm")));
        if let Some(last) = responses.last_mut() {
            *last = Err("offline".to_string());
        }
        responses
    }));
    let (outcome, _) = salesforce.run(None, &host);
    let requests = host.requests.borrow();
    assert!(requests.len() > 1);
    assert!(requests.iter().all(|request| request.url.starts_with("https://example.my.salesforce.com/services/data/")));
    assert!(requests
        .iter()
        .all(|request| request.headers.get("authorization").is_some_and(|value| value.contains("core-token"))));
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Succeeded, "{outcome:?}");
    assert_eq!(outcome.warnings.len(), 1, "{:?}", outcome.warnings);
    assert!(outcome.warnings[0].contains("offline"));
    assert!(salesforce.relations_text().contains("Account__dlm"));
}

#[test]
fn salesforce_fails_when_refreshing_the_channel_fails_or_every_metadata_request_failed() {
    for failure in ["refresh", "requests"] {
        let mut salesforce = salesforce();
        let mut host = Host::new(|_| unreachable!()).with_metadata(|| Err("offline".to_string()));
        if failure == "refresh" {
            host.channel_error = Some("token refresh failed".to_string());
        }
        let (outcome, _) = salesforce.run(None, &host);
        assert_eq!(outcome.status, CatalogUpdateTaskStatus::Failed, "{failure}");
        assert_eq!(host.requests.borrow().is_empty(), failure == "refresh", "{failure}");
    }
}

#[test]
fn salesforce_loads_the_metadata_relations_and_the_bundled_functions() {
    let mut salesforce = salesforce();
    let host = Host::new(|_| unreachable!("Salesforce runs no queries")).with_metadata(|| Ok(metadata("Account__dlm")));
    let (outcome, functions) = salesforce.run(None, &host);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Succeeded, "{outcome:?}");
    assert!(salesforce.relations_text().contains("CREATE TABLE \"lakehouse\".\"public\".\"Account__dlm\""));
    assert_eq!(functions.as_deref(), Some(PREFETCHED_HYPER_FUNCTIONS_SQL));
    assert_eq!(salesforce.function_count(), bundled_function_count());
    let catalog = salesforce.connection.catalog().borrow();
    let entries = catalog.describe_entries().entries.unwrap();
    assert!(entries
        .iter()
        .all(|entry| entry.catalog_entry_type == dashql_buffers::catalog::CatalogEntryType::DESCRIPTOR_POOL));
}

#[test]
fn salesforce_keeps_the_relations_whichever_step_fails() {
    for failure in ["publication", "later publication", "aborted"] {
        let mut salesforce = salesforce();
        salesforce.run(None, &Host::new(|_| unreachable!()).with_metadata(|| Ok(metadata("old_table"))));
        let old = salesforce.relations_text();
        let version = salesforce.version();

        let mut host = Host::new(|_| unreachable!()).with_metadata(|| Ok(metadata("new_table")));
        match failure {
            "publication" => salesforce.block_entry(salesforce.function_entry()),
            "later publication" => salesforce.block_entry(salesforce.connection.relation_entry_id()),
            _ => {
                // The update is aborted once its metadata arrived
                let cancel = host.cancel.clone();
                host.fetch = RefCell::new(Some(Box::new(move |requests| {
                    *cancel.borrow_mut() = Some("aborted".to_string());
                    metadata_responses(requests.len(), Ok(metadata("new_table")))
                })));
            }
        }
        let blocked_version = salesforce.version();
        let (outcome, _) = salesforce.run(None, &host);
        assert_ne!(outcome.status, CatalogUpdateTaskStatus::Succeeded, "{failure}");
        if failure != "later publication" {
            assert_eq!(salesforce.relations_text(), old, "{failure}");
            assert!(outcome.function_script_text.is_none(), "{failure}");
            assert_eq!(salesforce.version(), blocked_version, "{failure}");
        }
        if failure == "aborted" {
            assert_eq!(salesforce.version(), version, "{failure}");
        }
    }
}

#[test]
fn salesforce_preserves_the_catalog_when_the_metadata_has_no_usable_relations() {
    for empty in [json!({ "metadata": [] }), json!({ "metadata": [{ "name": "empty", "fields": [] }] })] {
        let mut salesforce = salesforce();
        salesforce.run(None, &Host::new(|_| unreachable!()).with_metadata(|| Ok(metadata("old"))));
        let old = salesforce.relations_text();
        let version = salesforce.version();
        let empty = empty.clone();
        let (outcome, _) =
            salesforce.run(None, &Host::new(|_| unreachable!()).with_metadata(move || Ok(empty.clone())));
        assert_eq!(outcome.status, CatalogUpdateTaskStatus::Failed);
        assert!(outcome.error.unwrap().contains("no usable catalog relations"));
        assert_eq!(salesforce.relations_text(), old);
        assert_eq!(salesforce.version(), version);
    }
}

#[test]
fn salesforce_needs_the_tokens_of_a_login() {
    let mut salesforce = Fixture::new(ConnectorType::SalesforceDataCloud, json!({ "instanceUrl": "" }));
    let (outcome, _) = salesforce.run(None, &mut Host::new(|_| unreachable!()));
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Failed);
    assert_eq!(outcome.error.as_deref(), Some("Salesforce core access token is missing"));
}

#[test]
fn salesforce_metadata_becomes_tables_of_lakehouse_public() {
    let tables = catalog_tables_from_salesforce_metadata(&json!({ "metadata": [
        { "name": "b", "fields": [{ "name": "x", "type": "Number" }, { "name": "y" }] },
        { "name": "a", "fields": [{ "name": "z", "type": "Text" }] },
    ] }))
    .unwrap();
    assert_eq!(
        output(&tables),
        vec![
            ("lakehouse.public.a".to_string(), vec![("z".to_string(), Some("Text".to_string()))]),
            (
                "lakehouse.public.b".to_string(),
                vec![("x".to_string(), Some("Number".to_string())), ("y".to_string(), None)]
            ),
        ]
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Trino catalogs

#[test]
fn trino_splits_a_catalog_entry_at_the_first_dot() {
    let entry = |catalog: &str, schema: Option<&str>| {
        Some(TrinoCatalogEntry { catalog: catalog.into(), schema: schema.map(Into::into) })
    };
    assert_eq!(parse_trino_catalog_entry("hive"), entry("hive", None));
    assert_eq!(parse_trino_catalog_entry(" hive . sales "), entry("hive", Some("sales")));
    assert_eq!(parse_trino_catalog_entry("hive."), entry("hive", None));
    assert_eq!(parse_trino_catalog_entry("hive.a.b"), entry("hive", Some("a.b")));
    assert_eq!(parse_trino_catalog_entry(""), None);
    assert_eq!(parse_trino_catalog_entry(".sales"), None);
}

#[test]
fn trino_reads_the_entries_of_params_that_predate_them() {
    assert_eq!(
        trino_catalog_entries(&object(json!({ "catalogName": "hive", "schemaNames": ["sales", "hr"] }))),
        ["hive.sales", "hive.hr"]
    );
    assert!(trino_catalog_entries(&object(json!({ "catalogName": "hive" }))).is_empty());
    assert!(trino_catalog_entries(&object(json!({ "catalogName": "" }))).is_empty());
    assert_eq!(
        trino_catalog_entries(&object(json!({ "defaultCatalog": "iceberg", "catalogs": ["iceberg"] }))),
        ["iceberg"]
    );
}

#[test]
fn trino_reads_the_default_catalog_without_entries() {
    let scopes = |params: Value| trino_catalog_scopes(&object(params));
    assert_eq!(scopes(json!({ "defaultCatalog": "hive", "catalogs": [] })), [InformationSchemaScope::catalog("hive")]);
    assert_eq!(scopes(json!({ "catalogName": "hive" })), [InformationSchemaScope::catalog("hive")]);
    assert_eq!(
        scopes(json!({ "defaultCatalog": "hive", "catalogs": ["iceberg"] })),
        [InformationSchemaScope::catalog("iceberg")]
    );
    assert_eq!(scopes(json!({ "catalogs": [] })), []);
}

#[test]
fn trino_groups_the_entries_by_catalog_in_the_order_of_their_first_entry() {
    let scopes = trino_catalog_scopes(&object(
        json!({ "catalogs": ["iceberg.sales", "hive", "", "iceberg.hr", "iceberg.sales", "hive.ignored"] }),
    ));
    assert_eq!(
        scopes,
        [
            InformationSchemaScope {
                catalog: "iceberg".into(),
                schemas: vec!["sales".into(), "hr".into()],
                relations: None
            },
            InformationSchemaScope::catalog("hive"),
        ]
    );
}

// ---------------------------------------------------------------------------------------------------------------------
// Durability

#[test]
fn only_the_catalog_of_the_embedded_hyper_does_not_outlive_the_app() {
    let params = |connector, value: Value| ConnectionParams::new(connector, object(value));
    assert!(!ConnectorType::Hyper
        .connector()
        .catalog_is_durable(&params(ConnectorType::Hyper, json!({ "protocol": "WASM" })).params));
    assert!(ConnectorType::Hyper
        .connector()
        .catalog_is_durable(&params(ConnectorType::Hyper, json!({ "protocol": "V3_HTTP" })).params));
    assert!(ConnectorType::Trino.connector().catalog_is_durable(&params(ConnectorType::Trino, json!({})).params));
    assert!(ConnectorType::SalesforceDataCloud
        .connector()
        .catalog_is_durable(&params(ConnectorType::SalesforceDataCloud, json!({})).params));
}

// ---------------------------------------------------------------------------------------------------------------------
// The scheduler

const ORDERS: (&str, &str, &str) = ("hyper", "", "orders");

/// A connection of the scheduler tests and the queries that run on it
struct Registry {
    loader: CatalogLoader,
    connection: ConnectionState,
    active_queries: usize,
    /// The running updates, with the reason of their cancellation
    running: Vec<(CatalogUpdate, Option<String>)>,
    /// The aborted task ids
    aborted: Vec<u32>,
    /// The relations of the updates that started, none for a refresh
    started: Vec<Option<Vec<RelationName>>>,
    now: Timestamp,
}

impl Registry {
    fn new(params: Value) -> Self {
        let connection =
            ConnectionState::from_params("database", ConnectionParams::new(ConnectorType::Hyper, object(params)), NOW);
        Self {
            loader: CatalogLoader::new(),
            connection,
            active_queries: 0,
            running: Vec::new(),
            aborted: Vec::new(),
            started: Vec::new(),
            now: NOW,
        }
    }

    fn durable() -> Self {
        Self::new(json!({ "protocol": "V3_HTTP", "endpoint": "http://hyper.example" }))
    }

    fn apply(&mut self, action: ConnectionAction) {
        self.connection.apply(action, self.now).unwrap();
    }

    fn online(&mut self) {
        self.apply(ConnectionAction::HealthCheckSucceeded);
    }

    fn offline(&mut self) {
        self.apply(ConnectionAction::HealthCheckCancelled);
    }

    fn touch(&mut self) {
        let mut name = QualifiedTableNameT::default();
        name.database_name = Some(ORDERS.0.into());
        name.table_name = Some(ORDERS.2.into());
        self.apply(ConnectionAction::RelationsTouched(vec![name]));
    }

    /// Mark the connection described, as a restored catalog or a refresh that succeeded does
    fn describe(&mut self) {
        self.apply(ConnectionAction::UpdateCatalog(CatalogUpdateTask::new(
            999,
            CatalogUpdateVariant::FullCatalogRefresh,
            self.now,
        )));
        self.apply(ConnectionAction::CatalogUpdateSucceeded { task_id: 999 });
    }

    /// Hand the loader the connection and run the commands of a scheduling pass
    fn schedule(&mut self) -> Option<Timestamp> {
        let view = [CatalogLoaderConnection::of(&self.connection, self.active_queries)];
        self.loader.observe(&view, &[]);
        let schedule = self.loader.schedule(&view, &[], self.now);
        for command in schedule.commands {
            match command {
                CatalogLoaderCommand::Abort { task_id } => {
                    self.aborted.push(task_id);
                    if let Some((_, cancel)) =
                        self.running.iter_mut().find(|(update, _)| update.task.task_id == task_id)
                    {
                        *cancel = Some("Superseded by forced catalog refresh".to_string());
                    }
                }
                CatalogLoaderCommand::Start { task_id, relations, .. } => {
                    let update = CatalogUpdate::start(&self.connection, task_id, relations.clone(), self.now).unwrap();
                    self.apply(ConnectionAction::UpdateCatalog(update.task.clone()));
                    self.started.push(relations);
                    self.running.push((update, None));
                }
            }
        }
        schedule.wake_at
    }

    fn enqueue(&mut self, force: bool) {
        self.loader.enqueue("database", force);
        self.schedule();
    }

    /// Settle the oldest running update: it succeeds unless it was cancelled, or fails
    fn settle(&mut self, succeed: bool) -> CatalogUpdateOutcome {
        let (update, cancel) = self.running.remove(0);
        let task_id = update.task.task_id;
        let catalog = self.connection.catalog().clone();
        let host = Host::new(|query| {
            if succeed {
                Ok(or_functions(query, pg_rows("orders", &["id"])))
            } else {
                Err("down".to_string())
            }
        });
        *host.cancel.borrow_mut() = cancel;
        let outcome = host.drive(update, &catalog);
        self.apply(outcome.connection_action(task_id));
        self.loader.finished("database", self.now);
        self.schedule();
        outcome
    }

    fn touched(&self) -> Vec<RelationName> {
        self.connection.catalog_updates().touched_relations.clone()
    }
}

fn orders() -> Option<Vec<RelationName>> {
    Some(vec![relation(ORDERS.0, ORDERS.1, ORDERS.2)])
}

#[test]
fn a_forced_refresh_aborts_a_running_one_once_and_starts_after_it_settled() {
    let mut registry = Registry::durable();
    registry.schedule();
    // A requested refresh runs once the connection is online
    registry.online();
    registry.enqueue(false);
    assert_eq!(registry.started.len(), 1);
    let first = registry.running[0].0.task.task_id;

    registry.enqueue(true);
    assert_eq!(registry.aborted, [first]);
    assert_eq!(registry.started.len(), 1);
    // An auto request can't downgrade the forced one while the cancellation is pending
    registry.enqueue(false);
    registry.schedule();
    assert_eq!(registry.aborted, [first]);
    assert_eq!(registry.started.len(), 1);

    let outcome = registry.settle(true);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Cancelled);
    assert_eq!(registry.started, [None, None]);
    registry.schedule();
    assert_eq!(registry.started.len(), 2);
    assert_eq!(registry.aborted, [first]);
    let outcome = registry.settle(true);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Succeeded);
    assert!(outcome.announces());
    assert!(registry.connection.catalog_updates().described);
}

#[test]
fn the_relations_of_statements_are_asked_about_once_the_connection_has_room() {
    let mut registry = Registry::durable();
    registry.describe();
    registry.online();
    registry.touch();
    registry.active_queries = 4;
    registry.schedule();
    assert!(registry.started.is_empty());
    registry.active_queries = 0;
    registry.schedule();
    assert_eq!(registry.started, [orders()]);
    assert_eq!(
        registry.connection.catalog_updates().tasks_running.values().next().unwrap().variant,
        CatalogUpdateVariant::RelationRefresh
    );
    registry.settle(true);
    assert!(registry.touched().is_empty());
    // The embedded Hyper runs one query at a time
    let mut embedded = Registry::new(json!({ "protocol": "WASM" }));
    embedded.describe();
    embedded.online();
    embedded.schedule();
    embedded.settle(true);
    embedded.touch();
    embedded.active_queries = 1;
    embedded.schedule();
    assert_eq!(embedded.started, [None]);
}

#[test]
fn the_relations_of_statements_wait_for_a_running_refresh() {
    let mut registry = Registry::durable();
    registry.schedule();
    // A requested refresh runs once the connection is online
    registry.online();
    registry.enqueue(false);
    assert_eq!(registry.started, [None]);
    registry.online();
    registry.touch();
    registry.schedule();
    assert_eq!(registry.started.len(), 1);
    registry.settle(true);
    assert_eq!(registry.started, [None, orders()]);
    registry.settle(true);
}

#[test]
fn the_relations_of_statements_are_asked_about_again_after_a_wait_when_the_update_failed() {
    let mut registry = Registry::durable();
    registry.describe();
    registry.online();
    registry.touch();
    registry.schedule();
    assert_eq!(registry.started.len(), 1);
    registry.settle(false);
    assert_eq!(registry.touched(), orders().unwrap());
    assert_eq!(registry.connection.catalog_updates().touched_failures, 1);
    // Not right away
    let wake_at = registry.schedule();
    assert_eq!(wake_at, Some(NOW + TOUCHED_RETRY_DELAY_MS));
    assert_eq!(registry.started.len(), 1);
    registry.now = NOW + TOUCHED_RETRY_DELAY_MS;
    registry.schedule();
    assert_eq!(registry.started, [orders(), orders()]);
    registry.settle(true);
    assert_eq!(registry.connection.catalog_updates().touched_failures, 0);
}

#[test]
fn the_relations_of_statements_stop_being_asked_about_when_the_attempts_are_used_up() {
    let mut registry = Registry::durable();
    registry.describe();
    registry.online();
    registry.touch();
    for attempt in 1..=MAX_TOUCHED_ATTEMPTS {
        registry.now += 10_000.0;
        registry.schedule();
        assert_eq!(registry.started.len(), attempt as usize);
        registry.settle(false);
    }
    assert!(registry.connection.catalog_updates().is_out_of_date());
    registry.now += 100_000.0;
    assert_eq!(registry.schedule(), None);
    assert_eq!(registry.started.len(), MAX_TOUCHED_ATTEMPTS as usize);
    // The next statement tries again
    registry.touch();
    registry.schedule();
    assert_eq!(registry.started.len(), MAX_TOUCHED_ATTEMPTS as usize + 1);
}

#[test]
fn an_auto_request_runs_once_more_after_a_failure() {
    let mut registry = Registry::durable();
    registry.schedule();
    // A requested refresh runs once the connection is online
    registry.online();
    registry.enqueue(true);
    registry.enqueue(false);
    assert!(registry.aborted.is_empty());
    assert_eq!(registry.started.len(), 1);
    let outcome = registry.settle(false);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Failed);
    assert!(!outcome.announces());
    assert_eq!(registry.started.len(), 2);
    registry.settle(true);
    registry.schedule();
    assert_eq!(registry.started.len(), 2);
}

#[test]
fn a_forced_refresh_runs_ahead_of_a_lookup_that_keeps_coming_back() {
    let mut registry = Registry::durable();
    registry.describe();
    registry.online();
    registry.touch();
    registry.schedule();
    assert_eq!(registry.started, [orders()]);

    // The forced refresh cancels the lookup, which gives its relation back
    registry.enqueue(true);
    assert_eq!(registry.aborted.len(), 1);
    let outcome = registry.settle(true);
    assert_eq!(outcome.status, CatalogUpdateTaskStatus::Cancelled);
    assert_eq!(registry.started, [orders(), None]);

    // The lookup follows the refresh
    registry.settle(true);
    assert_eq!(registry.started, [orders(), None, orders()]);
    registry.settle(true);
    assert!(registry.touched().is_empty());
}

#[test]
fn a_queued_auto_request_is_consumed_by_a_successful_refresh() {
    let mut registry = Registry::durable();
    registry.schedule();
    // A requested refresh runs once the connection is online
    registry.online();
    registry.enqueue(true);
    registry.enqueue(false);
    registry.settle(true);
    assert_eq!(registry.started.len(), 1);
    registry.schedule();
    assert_eq!(registry.started.len(), 1);

    registry.enqueue(true);
    assert_eq!(registry.started.len(), 2);
    assert!(registry.aborted.is_empty());
    registry.settle(true);
}

#[test]
fn the_catalog_of_an_embedded_database_is_refreshed_whenever_it_comes_online() {
    let mut registry = Registry::new(json!({ "protocol": "WASM" }));
    registry.online();
    registry.schedule();
    assert_eq!(registry.started, [None]);
    registry.settle(true);
    registry.schedule();
    assert_eq!(registry.started.len(), 1);

    // A reconnect describes the database again
    registry.offline();
    registry.schedule();
    registry.online();
    registry.schedule();
    assert_eq!(registry.started.len(), 2);
}

#[test]
fn the_restored_catalog_of_a_durable_connection_is_kept_when_it_comes_online() {
    let mut registry = Registry::durable();
    registry.describe();
    registry.online();
    registry.schedule();
    registry.schedule();
    assert!(registry.started.is_empty());
}

#[test]
fn a_restored_catalog_is_asked_only_about_what_it_has_not_answered_once_online() {
    let mut registry = Registry::durable();
    registry.describe();
    registry.touch();
    registry.schedule();
    assert!(registry.started.is_empty());
    registry.online();
    registry.schedule();
    assert_eq!(registry.started, [orders()]);
    registry.settle(true);
}

#[test]
fn a_durable_connection_without_a_catalog_is_described_when_it_comes_online() {
    let mut registry = Registry::durable();
    registry.schedule();
    assert!(registry.started.is_empty());
    registry.online();
    registry.schedule();
    assert_eq!(registry.started, [None]);
}

#[test]
fn a_request_for_a_connection_that_is_gone_is_dropped() {
    let mut loader = CatalogLoader::new();
    loader.enqueue("gone", true);
    assert!(loader.is_queued("gone"));
    let schedule = loader.schedule(&[], &[], NOW);
    assert!(schedule.commands.is_empty());
    assert!(!loader.is_queued("gone"));
}

#[test]
fn a_requested_refresh_waits_until_the_connection_is_online() {
    let mut registry = Registry::durable();
    registry.describe();
    registry.enqueue(true);
    assert!(registry.started.is_empty(), "no refresh of a connection that is not online");
    assert!(registry.loader.is_queued("database"));
    registry.online();
    registry.schedule();
    assert_eq!(registry.started, [None]);
    assert!(!registry.loader.is_queued("database"));
}
