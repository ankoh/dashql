//! Catalog changes of successful statements: derivation, compaction, the changes SQL, and
//! applying the changes to descriptor entries.

use dashql_core::catalog::CatalogLayer;
use dashql_buffers::analyzer::{QualifiedTableNameT, TableColumnT, TableT};
use dashql_buffers::catalog::CatalogDescriptorT;
use dashql_core::catalog::changes::{CatalogChange, CatalogChangeColumn, CatalogChangeKind};
use dashql_buffers::editor::EditorOffsetUnit;
use dashql_core_session::catalog_changes::{
    append_catalog_changes_sql, compact_catalog_changes, derive_catalog_change, parse_catalog_changes_sql, qualify_catalog_changes,
    render_catalog_changes_sql, CatalogChangeOptions, CatalogNameDefaults,
};
use dashql_core::catalog::{Catalog, CatalogEntryId};
use dashql_core::script::Script;
use dashql_core_session::planner::{plan_session, ConnectionKind, PlanScope, PlannerConnection, PlannerScript, SessionPlanRequest};
use dashql_core_session::script_session::ScriptSession;

fn defaults() -> CatalogNameDefaults {
    CatalogNameDefaults {
        database_name: "db".to_string(),
        schema_name: "main".to_string(),
    }
}

/// Describe a change as `create db.schema.relation(a, b)` or `drop db.schema.relation`
fn describe(change: &CatalogChange) -> String {
    let name = format!("{}.{}.{}", change.database_name, change.schema_name, change.relation_name);
    match change.kind {
        CatalogChangeKind::CreateRelation => format!(
            "create{} {}({})",
            if change.if_not_exists { " if not exists" } else { "" },
            name,
            change.columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>().join(", ")
        ),
        CatalogChangeKind::DropRelation => format!("drop {name}"),
    }
}

/// Derive the changes of every statement of a script and qualify them with the defaults
fn derive_all(catalog: &Catalog, text: &str, options: &CatalogChangeOptions) -> Vec<Option<String>> {
    let mut script = Script::new(catalog);
    script.replace_text(text);
    script.analyze(catalog, true).unwrap();
    let analyzed = script.analyzed.clone().unwrap();
    (0..analyzed.parsed.statements.len())
        .map(|id| {
            let mut change = [derive_catalog_change(&analyzed, id, options)?];
            qualify_catalog_changes(&mut change, &defaults());
            Some(describe(&change[0]))
        })
        .collect()
}

fn change(kind: CatalogChangeKind, database: &str, schema: &str, relation: &str, columns: &[&str]) -> CatalogChange {
    CatalogChange {
        kind,
        database_name: database.to_string(),
        schema_name: schema.to_string(),
        relation_name: relation.to_string(),
        if_not_exists: false,
        columns: columns.iter().map(|c| CatalogChangeColumn { name: c.to_string(), column_type: None }).collect(),
    }
}

fn create(database: &str, schema: &str, relation: &str, columns: &[&str]) -> CatalogChange {
    change(CatalogChangeKind::CreateRelation, database, schema, relation, columns)
}

fn create_if_not_exists(database: &str, schema: &str, relation: &str, columns: &[&str]) -> CatalogChange {
    let mut change = create(database, schema, relation, columns);
    change.if_not_exists = true;
    change
}

fn drop(database: &str, schema: &str, relation: &str) -> CatalogChange {
    change(CatalogChangeKind::DropRelation, database, schema, relation, &[])
}

fn table(database: &str, schema: &str, name: &str, columns: &[&str]) -> TableT {
    let mut table_name = QualifiedTableNameT::default();
    table_name.database_name = Some(database.to_string());
    table_name.schema_name = Some(schema.to_string());
    table_name.table_name = Some(name.to_string());
    let mut table = TableT::default();
    table.table_name = Some(Box::new(table_name));
    table.table_columns = Some(
        columns
            .iter()
            .map(|c| {
                let mut column = TableColumnT::default();
                column.column_name = Some(c.to_string());
                column
            })
            .collect(),
    );
    table
}

/// Load a descriptor with the tables into the catalog
fn add_descriptor(catalog: &mut Catalog, layer: CatalogLayer, tables: Vec<TableT>) -> CatalogEntryId {
    let mut descriptor = CatalogDescriptorT::default();
    descriptor.tables = Some(tables);
    let mut builder = flatbuffers::FlatBufferBuilder::new();
    let packed = descriptor.pack(&mut builder);
    builder.finish(packed, None);
    let id = catalog.allocate_entry_id();
    catalog.replace_descriptor(id, layer, builder.finished_data()).unwrap();
    id
}

/// The tables of a catalog entry as `db.schema.table(a, b)`
fn tables_of(catalog: &Catalog, id: CatalogEntryId) -> Vec<String> {
    let mut out = Vec::new();
    let Some(entries) = catalog.describe_entries_of(id) else { return out };
    for entry in entries.entries.unwrap_or_default() {
        for schema in entry.schemas.unwrap_or_default() {
            for table in schema.tables.unwrap_or_default() {
                let columns: Vec<String> =
                    table.columns.unwrap_or_default().into_iter().map(|c| c.column_name.unwrap_or_default()).collect();
                out.push(format!(
                    "{}.{}.{}({})",
                    schema.database_name.as_deref().unwrap_or(""),
                    schema.schema_name.as_deref().unwrap_or(""),
                    table.table_name.unwrap_or_default(),
                    columns.join(", ")
                ));
            }
        }
    }
    out.sort();
    out
}

#[test]
fn derives_created_and_dropped_relations() {
    let catalog = Catalog::new();
    let changes = derive_all(
        &catalog,
        "create table orders (id int, amount double, customer text);
         create table sales.totals as select id, amount as total from orders;
         create view other.reporting.report as select id, amount as total from orders;
         select id as copied_id into copies from orders;
         insert into orders values (1, 2.0, 'a');
         drop table orders;
         drop view other.reporting.report;
         select 1;",
        &CatalogChangeOptions::default(),
    );
    assert_eq!(
        changes,
        vec![
            Some("create db.main.orders(id, amount, customer)".to_string()),
            Some("create db.sales.totals(id, total)".to_string()),
            Some("create other.reporting.report(id, total)".to_string()),
            Some("create db.main.copies(copied_id)".to_string()),
            None,
            Some("drop db.main.orders".to_string()),
            Some("drop other.reporting.report".to_string()),
            None,
        ]
    );
}

#[test]
fn derives_if_not_exists_and_temporary_relations() {
    let catalog = Catalog::new();
    let text = "create table if not exists t (a int);
                create temp table session_only (a int);
                create unlogged table persistent (a int);
                create temporary view v as select 1 as x;
                select 1 as y into temp copies;";
    assert_eq!(
        derive_all(&catalog, text, &CatalogChangeOptions::default()),
        vec![
            Some("create if not exists db.main.t(a)".to_string()),
            None,
            Some("create db.main.persistent(a)".to_string()),
            None,
            None,
        ]
    );
    let with_temporary = CatalogChangeOptions { include_temporary: true };
    assert_eq!(
        derive_all(&catalog, text, &with_temporary),
        vec![
            Some("create if not exists db.main.t(a)".to_string()),
            Some("create db.main.session_only(a)".to_string()),
            Some("create db.main.persistent(a)".to_string()),
            Some("create db.main.v(x)".to_string()),
            Some("create db.main.copies(y)".to_string()),
        ]
    );
}

#[test]
fn derives_relations_as_written() {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.replace_text("create table t (a int); drop table s.u;");
    script.analyze(&catalog, true).unwrap();
    let analyzed = script.analyzed.clone().unwrap();
    let options = CatalogChangeOptions::default();
    let mut changes: Vec<CatalogChange> = (0..2).filter_map(|id| derive_catalog_change(&analyzed, id, &options)).collect();
    assert_eq!(changes.iter().map(describe).collect::<Vec<_>>(), vec!["create ..t(a)", "drop .s.u"]);
    qualify_catalog_changes(&mut changes, &defaults());
    assert_eq!(changes.iter().map(describe).collect::<Vec<_>>(), vec!["create db.main.t(a)", "drop db.s.u"]);
}

#[test]
fn compacts_to_the_last_change_of_every_relation() {
    let compacted = compact_catalog_changes(vec![
        create("db", "main", "a", &["x"]),
        create("db", "main", "b", &["x"]),
        create_if_not_exists("db", "main", "a", &["y"]),
        drop("db", "main", "b"),
        create_if_not_exists("db", "main", "b", &["z"]),
        create_if_not_exists("db", "main", "c", &["w"]),
        drop("db", "main", "d"),
    ]);
    let described: Vec<String> = compacted.iter().map(describe).collect();
    assert_eq!(
        described,
        vec![
            // IF NOT EXISTS keeps a relation that was just created
            "create db.main.a(x)",
            // ... and creates one that was just dropped
            "create db.main.b(z)",
            // ... and stays conditional for relations of the base catalog
            "create if not exists db.main.c(w)",
            "drop db.main.d",
        ]
    );
}

#[test]
fn changes_roundtrip_through_sql() {
    let changes = vec![
        create("db", "main", "orders", &["id", "Mixed Case", "quote\"d"]),
        create_if_not_exists("db", "main", "maybe", &["a"]),
        create("db", "main", "empty", &[]),
        drop("db", "main", "gone"),
    ];
    let changes_sql = render_catalog_changes_sql(&changes);
    assert_eq!(
        changes_sql,
        "-- Catalog changes of executed statements

CREATE TABLE \"db\".\"main\".\"orders\" (
    \"id\" unknown,
    \"Mixed Case\" unknown,
    \"quote\"\"d\" unknown
);

CREATE TABLE IF NOT EXISTS \"db\".\"main\".\"maybe\" (
    \"a\" unknown
);

CREATE TABLE \"db\".\"main\".\"empty\" ();

DROP TABLE \"db\".\"main\".\"gone\";
"
    );
    let parsed: Vec<String> = parse_catalog_changes_sql(&changes_sql).unwrap().iter().map(describe).collect();
    let expected: Vec<String> = changes.iter().map(describe).collect();
    assert_eq!(parsed, expected);
}

/// The columns of a change as (name, type)
fn typed_columns(change: &CatalogChange) -> Vec<(&str, Option<&str>)> {
    change.columns.iter().map(|c| (c.name.as_str(), c.column_type.as_deref())).collect()
}

/// A change with typed columns
fn create_typed(relation: &str, columns: &[(&str, Option<&str>)]) -> CatalogChange {
    let mut change = create("db", "main", relation, &[]);
    change.columns = columns
        .iter()
        .map(|(name, column_type)| CatalogChangeColumn { name: name.to_string(), column_type: column_type.map(str::to_string) })
        .collect();
    change
}

#[test]
fn derives_the_types_of_declared_and_passed_through_columns() {
    let catalog = Catalog::new();
    let mut script = Script::new(&catalog);
    script.replace_text(
        "create table orders (id bigint, amount numeric(10,2), placed timestamp with time zone);
         create table totals as select id, amount as total, amount + 1 as next, 1 as one, id::text as cast_id from orders;
         create view report (a, b) as select id, placed from orders;
         select placed as copied into copies from orders;",
    );
    script.analyze(&catalog, true).unwrap();
    let analyzed = script.analyzed.clone().unwrap();
    let options = CatalogChangeOptions::default();
    let changes: Vec<CatalogChange> = (0..4).map(|id| derive_catalog_change(&analyzed, id, &options).unwrap()).collect();
    assert_eq!(
        typed_columns(&changes[0]),
        vec![("id", Some("bigint")), ("amount", Some("numeric(10,2)")), ("placed", Some("timestamp with time zone"))]
    );
    // An expression has no type in the analyzer
    assert_eq!(
        typed_columns(&changes[1]),
        vec![("id", Some("bigint")), ("total", Some("numeric(10,2)")), ("next", None), ("one", None), ("cast_id", None)]
    );
    assert_eq!(typed_columns(&changes[2]), vec![("a", Some("bigint")), ("b", Some("timestamp with time zone"))]);
    assert_eq!(typed_columns(&changes[3]), vec![("copied", Some("timestamp with time zone"))]);
}

#[test]
fn column_types_roundtrip_through_sql() {
    let changes = vec![create_typed(
        "t",
        &[
            ("a", Some("numeric(10,2)")),
            ("b", Some("timestamp with time zone")),
            ("c", Some("integer[]")),
            ("d", Some("my_type")),
            ("e", None),
        ],
    )];
    let changes_sql = render_catalog_changes_sql(&changes);
    assert!(changes_sql.contains("\"a\" numeric(10,2),"), "{changes_sql}");
    assert!(changes_sql.contains("\"e\" unknown"), "{changes_sql}");
    assert_eq!(parse_catalog_changes_sql(&changes_sql).unwrap(), changes);
    // ... and survive the next append
    let appended = append_catalog_changes_sql(&changes_sql, &[drop("db", "main", "other")]).unwrap();
    assert_eq!(parse_catalog_changes_sql(&appended).unwrap()[0], changes[0]);
}

#[test]
fn a_type_that_does_not_parse_keeps_the_changes_sql_readable() {
    let changes_sql = render_catalog_changes_sql(&[create_typed("t", &[("a", Some("My Type")), ("b", Some("int); drop table u; --")), ("c", Some("text"))])]);
    let parsed = parse_catalog_changes_sql(&changes_sql).unwrap();
    assert_eq!(parsed.len(), 1);
    assert_eq!(typed_columns(&parsed[0]), vec![("a", None), ("b", None), ("c", Some("text"))]);
}

#[test]
fn applying_changes_keeps_the_column_types() {
    let mut catalog = Catalog::new();
    let id = catalog.allocate_entry_id();
    catalog.apply_catalog_changes(id, CatalogLayer::CONNECTION, &[create_typed("t", &[("a", Some("integer")), ("b", None)])]).unwrap();

    // A later statement reads the types from the catalog
    let mut script = Script::new(&catalog);
    script.replace_text("create table copy as select a, b from db.main.t");
    script.analyze(&catalog, true).unwrap();
    let copy = derive_catalog_change(script.analyzed.as_ref().unwrap(), 0, &CatalogChangeOptions::default()).unwrap();
    assert_eq!(typed_columns(&copy), vec![("a", Some("integer")), ("b", None)]);
}

#[test]
fn appends_to_changes_sql() {
    let changes_sql = append_catalog_changes_sql("", &[create("db", "main", "a", &["x"]), create("db", "main", "b", &["y"])]).unwrap();
    let changes_sql = append_catalog_changes_sql(&changes_sql, &[drop("db", "main", "a")]).unwrap();
    let described: Vec<String> = parse_catalog_changes_sql(&changes_sql).unwrap().iter().map(describe).collect();
    assert_eq!(described, vec!["create db.main.b(y)", "drop db.main.a"]);
    assert!(parse_catalog_changes_sql("create table (").is_err());
}

#[test]
fn applies_changes_to_a_descriptor_entry() {
    let mut catalog = Catalog::new();
    let id = add_descriptor(&mut catalog, CatalogLayer::CONNECTION, vec![table("db", "main", "kept", &["a"]), table("db", "main", "gone", &["b"])]);
    catalog
        .apply_catalog_changes(
            id,
            CatalogLayer::CONNECTION,
            &[
                drop("db", "main", "gone"),
                create("db", "main", "added", &["x", "y", "x"]),
                create_if_not_exists("db", "main", "kept", &["replaced"]),
                create("db", "other", "kept", &["c"]),
            ],
        )
        .unwrap();
    assert_eq!(tables_of(&catalog, id), vec!["db.main.added(x, y)", "db.main.kept(a)", "db.other.kept(c)"]);

    // A replacement takes the new columns
    catalog.apply_catalog_changes(id, CatalogLayer::CONNECTION, &[create("db", "main", "kept", &["new"])]).unwrap();
    assert_eq!(tables_of(&catalog, id), vec!["db.main.added(x, y)", "db.main.kept(new)", "db.other.kept(c)"]);
}

#[test]
fn applying_changes_creates_an_unknown_entry() {
    let mut catalog = Catalog::new();
    let id = catalog.allocate_entry_id();
    catalog.apply_catalog_changes(id, CatalogLayer::CONNECTION, &[create("db", "main", "t", &["a"]), drop("db", "main", "u")]).unwrap();
    assert_eq!(tables_of(&catalog, id), vec!["db.main.t(a)"]);

    // Scripts are not descriptor entries
    let mut script = Script::new(&catalog);
    script.replace_text("create table s (a int);");
    script.analyze(&catalog, true).unwrap();
    catalog.load_script(script.analyzed.clone().unwrap(), CatalogLayer::SESSION).unwrap();
    assert!(catalog.apply_catalog_changes(script.catalog_entry_id(), CatalogLayer::CONNECTION, &[drop("db", "main", "s")]).is_err());
}

#[test]
fn a_plan_of_a_script_carries_the_changes_of_its_statements() {
    let catalog = Catalog::new();
    let mut session = ScriptSession::new(&catalog, EditorOffsetUnit::UTF8_BYTES).unwrap();
    session.replace_text(&catalog, 0, "create table t (v int); drop table u; select * from t;");
    session.analyze(&catalog);
    let connections = [PlannerConnection { id: "c", kind: ConnectionKind::Remote, catalog: &catalog, dialect: dashql_buffers::formatting::FormattingDialect::HYPER }];
    let scripts = [PlannerScript { script: session.script(), name: "", connection: 0, materialization_file: None }];
    let graph = plan_session(&SessionPlanRequest { connections: &connections, scripts: &scripts, scope: PlanScope::Targets(&[0]), materialized: &[], mount_prefix: "", attachments: &[], attachment_prefix: "" });
    assert!(graph.valid);
    let changes: Vec<Vec<String>> = graph
        .nodes
        .iter()
        .flatten()
        .map(|node| node.catalog_changes.iter().flatten().filter_map(CatalogChange::unpack).map(|c| describe(&c)).collect())
        .collect();
    assert_eq!(changes, vec![vec!["create ..t(v)".to_string()], vec!["drop ..u".to_string()], vec![]]);
}
