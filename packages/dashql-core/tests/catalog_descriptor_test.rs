//! Catalog entries backed by descriptor bytes: validation, import, name resolution against the
//! declarations, replacement, ranking, description and removal.

use dashql_buffers::analyzer::{
    FunctionDeclarationT, FunctionParamT, QualifiedFunctionNameT, QualifiedTableNameT, TableColumnT, TableT,
};
use dashql_buffers::catalog::{CatalogDescriptorT, CatalogEntryType};
use dashql_core::analyzer::ColumnResolution;
use dashql_core::catalog::descriptor::validate_descriptor;
use dashql_core::catalog::{Catalog, CatalogEntryId, CatalogLayer};
use dashql_core::pack::pack_catalog_descriptor;
use dashql_core::script::Script;

fn table(database: &str, schema: &str, name: &str, columns: &[&str]) -> TableT {
    let mut table = TableT::default();
    let mut table_name = QualifiedTableNameT::default();
    table_name.database_name = Some(database.to_string());
    table_name.schema_name = Some(schema.to_string());
    table_name.table_name = Some(name.to_string());
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

fn function(schema: &str, name: &str, params: &[(&str, &str)], return_type: &str, aggregate: bool) -> FunctionDeclarationT {
    let mut function = FunctionDeclarationT::default();
    let mut function_name = QualifiedFunctionNameT::default();
    function_name.database_name = Some(String::new());
    function_name.schema_name = Some(schema.to_string());
    function_name.function_name = Some(name.to_string());
    function.function_name = Some(Box::new(function_name));
    function.params = Some(
        params
            .iter()
            .map(|(n, t)| {
                let mut param = FunctionParamT::default();
                param.param_name = Some(n.to_string());
                param.param_type = Some(t.to_string());
                param
            })
            .collect(),
    );
    function.return_type = Some(return_type.to_string());
    function.is_aggregate = aggregate;
    function
}

fn encode(tables: Vec<TableT>, functions: Vec<FunctionDeclarationT>) -> Vec<u8> {
    let mut descriptor = CatalogDescriptorT::default();
    descriptor.tables = Some(tables);
    descriptor.function_declarations = Some(functions);
    let mut builder = flatbuffers::FlatBufferBuilder::new();
    let packed = descriptor.pack(&mut builder);
    builder.finish(packed, None);
    builder.finished_data().to_vec()
}

fn tables_only(tables: Vec<TableT>) -> Vec<u8> {
    encode(tables, vec![])
}

fn add(catalog: &mut Catalog, layer: CatalogLayer, bytes: &[u8]) -> CatalogEntryId {
    let id = catalog.allocate_entry_id();
    catalog.replace_descriptor(id, layer, bytes).unwrap();
    id
}

/// The messages of the validation failure of a descriptor
fn validation_error(bytes: &[u8]) -> String {
    validate_descriptor(bytes).unwrap_err().message
}

/// Describe the column refs of a query as `spelled -> table.column` or `?`
fn resolve(catalog: &Catalog, sql: &str) -> Vec<String> {
    let mut script = Script::new(catalog);
    script.insert_text_at(0, sql);
    script.analyze(catalog, true).unwrap();
    let analyzed = script.analyzed.clone().unwrap();
    let mut expressions: Vec<_> = analyzed.expressions.iter().collect();
    expressions.sort_by_key(|e| analyzed.parsed.nodes[e.ast_node_id as usize].symbol_span().offset());
    expressions
        .into_iter()
        .filter_map(|e| e.column_ref())
        .map(|column_ref| {
            let spelled = column_ref.column_name.column_name.text().to_string();
            match (column_ref.resolved, &column_ref.resolved_ids) {
                (ColumnResolution::Unresolved, _) | (_, None) => format!("{spelled} -> ?"),
                (_, Some(ids)) => {
                    let (table_id, column) = ids.catalog_table_column_id.unpack_table_column_id();
                    let table = catalog.table_by_id(table_id).expect("catalog table");
                    format!("{spelled} -> {}.{}", table.table_name.table_name.text(), table.column_by_id(column).expect("column").column_name.text())
                }
            }
        })
        .collect()
}

#[test]
fn validation_accepts_empty_and_well_formed_descriptors() {
    assert!(validate_descriptor(&encode(vec![], vec![])).is_ok());
    let bytes = encode(
        vec![table("", "main", "t", &["a", "b"]), table("db", "main", "t", &["a"])],
        vec![function("main", "f", &[("x", "int"), ("", "int")], "int", false)],
    );
    let descriptor = validate_descriptor(&bytes).unwrap();
    assert_eq!(descriptor.tables().unwrap().len(), 2);
    assert_eq!(descriptor.function_declarations().unwrap().len(), 1);
}

#[test]
fn validation_rejects_malformed_bytes() {
    assert_eq!(validation_error(&[]), "invalid CatalogDescriptor FlatBuffer");
    assert_eq!(validation_error(&[1, 2, 3]), "invalid CatalogDescriptor FlatBuffer");
}

#[test]
fn validation_rejects_bad_tables() {
    assert_eq!(validation_error(&tables_only(vec![table("", "", "", &[])])), "invalid catalog descriptor name or type");
    assert_eq!(validation_error(&tables_only(vec![table("", "", "a\0b", &[])])), "invalid catalog descriptor name or type");
    assert_eq!(validation_error(&tables_only(vec![table("d\0", "", "t", &[])])), "invalid catalog descriptor name or type");
    assert_eq!(validation_error(&tables_only(vec![table("", "s\0", "t", &[])])), "invalid catalog descriptor name or type");
    assert_eq!(
        validation_error(&tables_only(vec![table("", "s", "t", &[]), table("", "s", "t", &[])])),
        "duplicate descriptor table name s.t"
    );
    assert_eq!(validation_error(&tables_only(vec![table("", "s", "t", &["a", "a"])])), "duplicate descriptor column name a in table s.t");
    assert_eq!(
        validation_error(&tables_only(vec![table("db", "S", "t", &["Id", "x", "Id"])])),
        "duplicate descriptor column name \"Id\" in table db.\"S\".t"
    );
    assert_eq!(validation_error(&tables_only(vec![table("", "s", "t", &[""])])), "invalid catalog descriptor name or type");
    let mut nameless = table("", "", "t", &[]);
    nameless.table_name = None;
    assert_eq!(validation_error(&tables_only(vec![nameless])), "missing descriptor table name");
    // Equal table names in different schemas are fine
    assert!(validate_descriptor(&tables_only(vec![table("", "s", "t", &[]), table("", "u", "t", &[])])).is_ok());
}

#[test]
fn validation_rejects_bad_functions() {
    let functions = |f: FunctionDeclarationT| validation_error(&encode(vec![], vec![f]));
    assert_eq!(functions(function("s", "", &[], "int", false)), "invalid catalog descriptor name or type");
    assert_eq!(functions(function("s", "f", &[], "", false)), "invalid catalog descriptor name or type");
    assert_eq!(functions(function("s", "f", &[("x", "")], "int", false)), "invalid catalog descriptor name or type");
    assert_eq!(functions(function("s", "f", &[("x", "int"), ("x", "int")], "int", false)), "duplicate descriptor parameter name x in function s.f");
    let mut nameless = function("s", "f", &[], "int", false);
    nameless.function_name = None;
    assert_eq!(functions(nameless), "missing descriptor function name");
}

#[test]
fn import_resolves_scripts_against_descriptor_tables() {
    let mut catalog = Catalog::new();
    let version = catalog.version();
    let id = add(&mut catalog, CatalogLayer::CONNECTION, &tables_only(vec![table("db", "main", "orders", &["id", "total"])]));
    assert!(catalog.version() > version);
    assert!(catalog.contains(id));

    let data = catalog.entry(id).unwrap().data();
    assert_eq!(data.table_declarations.len(), 1);
    let declaration = &data.table_declarations[0];
    assert_eq!(declaration.table_name.table_name.text(), "orders");
    assert_eq!(declaration.table_columns.len(), 2);
    assert_eq!(declaration.table_columns[1].column_id(), 1);
    assert_eq!(declaration.column_by_name("total").unwrap().column_id(), 1);
    assert!(declaration.column_by_name("missing").is_none());
    assert!(catalog.databases().contains_key("db"));
    assert!(catalog.schemas().contains_key(&("db".into(), "main".into())));

    assert_eq!(resolve(&catalog, "select id, total, nope from db.main.orders"), vec!["id -> orders.id", "total -> orders.total", "nope -> ?"]);
    // The unqualified name resolves everywhere
    assert_eq!(resolve(&catalog, "select total from orders"), vec!["total -> orders.total"]);
}

#[test]
fn columns_of_descriptor_tables_are_ambiguous_across_tables() {
    let mut catalog = Catalog::new();
    add(&mut catalog, CatalogLayer::CONNECTION, &tables_only(vec![table("", "main", "a", &["id"]), table("", "main", "b", &["id", "x"])]));
    assert_eq!(resolve(&catalog, "select x from a, b"), vec!["x -> b.x"]);
    assert_eq!(resolve(&catalog, "select a.id, b.id from a, b"), vec!["id -> a.id", "id -> b.id"]);
}

#[test]
fn import_registers_functions() {
    let mut catalog = Catalog::new();
    let id = add(
        &mut catalog,
        CatalogLayer::CONNECTION,
        &encode(vec![], vec![function("main", "twice", &[("x", "int")], "int", false), function("main", "total", &[("x", "int")], "int", true)]),
    );
    let data = catalog.entry(id).unwrap().data();
    assert_eq!(data.function_declarations.len(), 2);
    let twice = &data.function_declarations[0];
    assert_eq!(twice.function_name.function_name.text(), "twice");
    assert_eq!(&*twice.return_type, "int");
    assert_eq!(twice.params.len(), 1);
    assert_eq!(&*twice.params[0].param_type, "int");
    assert!(!twice.is_aggregate);
    assert!(data.function_declarations[1].is_aggregate);
}

#[test]
fn descriptor_round_trips_through_pack() {
    let mut catalog = Catalog::new();
    let bytes = encode(
        vec![table("db", "main", "t", &["a", "b"])],
        vec![function("main", "f", &[("x", "text")], "int", true)],
    );
    let id = add(&mut catalog, CatalogLayer::CONNECTION, &bytes);
    let packed = pack_catalog_descriptor(catalog.entry(id).unwrap().data()).unwrap();
    let descriptor = validate_descriptor(&packed).unwrap();
    let tables = descriptor.tables().unwrap();
    assert_eq!(tables.len(), 1);
    assert_eq!(tables.get(0).table_name().unwrap().table_name(), Some("t"));
    assert_eq!(tables.get(0).table_columns().unwrap().len(), 2);
    let functions = descriptor.function_declarations().unwrap();
    assert_eq!(functions.get(0).function_name().unwrap().function_name(), Some("f"));
    assert!(functions.get(0).is_aggregate());
    assert_eq!(functions.get(0).return_type(), Some("int"));
    assert_eq!(functions.get(0).params().unwrap().get(0).param_type(), Some("text"));
}

#[test]
fn replace_swaps_the_declarations_of_an_entry() {
    let mut catalog = Catalog::new();
    let id = add(&mut catalog, CatalogLayer::CONNECTION, &tables_only(vec![table("", "main", "old", &["a"])]));
    let version = catalog.version();
    catalog.replace_descriptor(id, CatalogLayer::CONNECTION, &tables_only(vec![table("", "main", "new", &["a"])])).unwrap();
    assert!(catalog.version() > version);
    let data = catalog.entry(id).unwrap().data();
    assert_eq!(data.table_declarations.len(), 1);
    assert_eq!(data.table_declarations[0].table_name.table_name.text(), "new");
    assert_eq!(resolve(&catalog, "select a from old"), vec!["a -> ?"]);
    assert_eq!(resolve(&catalog, "select a from new"), vec!["a -> new.a"]);
}

#[test]
fn replace_with_identical_bytes_keeps_the_version() {
    let mut catalog = Catalog::new();
    let bytes = tables_only(vec![table("", "main", "t", &["a"])]);
    let id = add(&mut catalog, CatalogLayer::CONNECTION, &bytes);
    let version = catalog.version();
    catalog.replace_descriptor(id, CatalogLayer::CONNECTION, &bytes).unwrap();
    assert_eq!(catalog.version(), version);
    assert_eq!(resolve(&catalog, "select a from t"), vec!["a -> t.a"]);
    // Another layer is a change
    catalog.replace_descriptor(id, CatalogLayer::SESSION, &bytes).unwrap();
    assert!(catalog.version() > version);
}

#[test]
fn replace_rejects_unknown_and_colliding_ids() {
    let mut catalog = Catalog::new();
    let bytes = tables_only(vec![table("", "main", "t", &["a"])]);
    // Never allocated
    assert!(catalog.replace_descriptor(1, CatalogLayer::CONNECTION, &bytes).is_err());
    assert!(catalog.replace_descriptor(0, CatalogLayer::CONNECTION, &bytes).is_err());
    let error = catalog.replace_descriptor(catalog.allocate_entry_id() + 100, CatalogLayer::CONNECTION, &bytes).unwrap_err();
    assert_eq!(error.message, "invalid or colliding receiver catalog entry ID");

    // An entry of a script cannot be replaced by a descriptor
    let mut script = Script::new(&catalog);
    script.insert_text_at(0, "create table s (a int)");
    script.analyze(&catalog, true).unwrap();
    catalog.load_script(script.analyzed.clone().unwrap(), CatalogLayer::SESSION).unwrap();
    let error = catalog.replace_descriptor(script.catalog_entry_id(), CatalogLayer::CONNECTION, &bytes).unwrap_err();
    assert_eq!(error.message, "invalid or colliding receiver catalog entry ID");
}

#[test]
fn invalid_replacement_keeps_the_catalog() {
    let mut catalog = Catalog::new();
    let id = add(&mut catalog, CatalogLayer::CONNECTION, &tables_only(vec![table("", "main", "keep", &["a"])]));
    let version = catalog.version();
    assert!(catalog.replace_descriptor(id, CatalogLayer::CONNECTION, &tables_only(vec![table("", "main", "", &[])])).is_err());
    assert_eq!(catalog.version(), version);
    assert_eq!(catalog.entry(id).unwrap().data().table_declarations[0].table_name.table_name.text(), "keep");
}

#[test]
fn the_connection_shadows_session_scripts_whatever_their_entry_ids() {
    let mut catalog = Catalog::new();
    add(&mut catalog, CatalogLayer::CONNECTION, &tables_only(vec![table("db", "main", "t", &["connection_column"])]));
    // Every script of a module allocates an entry id, ids pass any number that a rank could reserve
    for _ in 0..10_000 {
        catalog.allocate_entry_id();
    }
    let mut session = Script::new(&catalog);
    session.insert_text_at(0, "create table t (session_column integer)");
    session.analyze(&catalog, true).unwrap();
    catalog.load_script(session.analyzed.clone().unwrap(), CatalogLayer::SESSION).unwrap();
    assert_eq!(resolve(&catalog, "select connection_column from t"), vec!["connection_column -> t.connection_column"]);
    let layers: Vec<_> = catalog.entries_ranked().map(|(layer, _)| layer).collect();
    assert_eq!(layers, vec![CatalogLayer::CONNECTION, CatalogLayer::SESSION]);
}

#[test]
fn session_scripts_fill_in_the_relations_the_connection_does_not_have() {
    let mut catalog = Catalog::new();
    add(&mut catalog, CatalogLayer::CONNECTION, &tables_only(vec![table("db", "main", "other", &["x"])]));
    let mut session = Script::new(&catalog);
    session.insert_text_at(0, "create table t (session_column integer)");
    session.analyze(&catalog, true).unwrap();
    catalog.load_script(session.analyzed.clone().unwrap(), CatalogLayer::SESSION).unwrap();
    assert_eq!(resolve(&catalog, "select session_column from t"), vec!["session_column -> t.session_column"]);
}

#[test]
fn a_script_resolves_its_own_declarations_first() {
    let mut catalog = Catalog::new();
    add(&mut catalog, CatalogLayer::CONNECTION, &tables_only(vec![table("db", "main", "t", &["connection_column"])]));
    let mut script = Script::new(&catalog);
    script.insert_text_at(0, "create table t (own_column integer); select own_column from t");
    script.analyze(&catalog, true).unwrap();
    let analyzed = script.analyzed.clone().unwrap();
    let column_ref = analyzed.expressions.iter().find_map(|e| e.column_ref()).unwrap();
    let ColumnResolution::TableColumn(column) = column_ref.resolved else { panic!("the column is unresolved") };
    assert_eq!(column.table.entry, script.catalog_entry_id());
}

#[test]
fn the_connection_makes_no_ambiguity_with_session_scripts() {
    let mut catalog = Catalog::new();
    add(&mut catalog, CatalogLayer::CONNECTION, &tables_only(vec![table("db", "main", "t", &["connection_column"])]));
    let mut session = Script::new(&catalog);
    session.insert_text_at(0, "create table t (session_column integer)");
    session.analyze(&catalog, true).unwrap();
    catalog.load_script(session.analyzed.clone().unwrap(), CatalogLayer::SESSION).unwrap();
    let mut reader = Script::new(&catalog);
    reader.insert_text_at(0, "select connection_column from t");
    reader.analyze(&catalog, true).unwrap();
    let analyzed = reader.analyzed.clone().unwrap();
    assert_eq!(analyzed.table_references[0].inner.as_ref().unwrap().resolved_alternatives.len(), 0);
    assert!(analyzed.errors.is_empty());
}

#[test]
fn older_entries_win_name_conflicts_within_a_layer() {
    let mut catalog = Catalog::new();
    add(&mut catalog, CatalogLayer::CONNECTION, &tables_only(vec![table("", "main", "t", &["first"])]));
    add(&mut catalog, CatalogLayer::CONNECTION, &tables_only(vec![table("", "main", "t", &["second"])]));
    assert_eq!(resolve(&catalog, "select first from t"), vec!["first -> t.first"]);
}

#[test]
fn rejects_unknown_layers() {
    let mut catalog = Catalog::new();
    let id = catalog.allocate_entry_id();
    let bytes = tables_only(vec![table("", "main", "t", &["a"])]);
    assert!(catalog.replace_descriptor(id, CatalogLayer(7), &bytes).is_err());
    assert!(!catalog.contains(id));
}

#[test]
fn drop_removes_the_entry() {
    let mut catalog = Catalog::new();
    let id = add(&mut catalog, CatalogLayer::CONNECTION, &tables_only(vec![table("db", "main", "t", &["a"])]));
    let version = catalog.version();
    catalog.drop_descriptor(id).unwrap();
    assert!(!catalog.contains(id));
    assert!(catalog.version() > version);
    assert_eq!(resolve(&catalog, "select a from t"), vec!["a -> ?"]);

    // Dropping an unknown id is a no-op
    let version = catalog.version();
    catalog.drop_descriptor(id).unwrap();
    catalog.drop_descriptor(12345).unwrap();
    assert_eq!(catalog.version(), version);
}

#[test]
fn name_search_index_finds_substrings() {
    let mut catalog = Catalog::new();
    let id = add(&mut catalog, CatalogLayer::CONNECTION, &tables_only(vec![table("", "main", "customer_orders", &["order_id", "customer"])]));
    let entry = catalog.entry(id).unwrap();
    let index = entry.name_search_index();
    let found = |prefix: &str| -> Vec<String> {
        let mut names: Vec<_> = index.search(prefix.as_bytes()).map(|n| n.text.to_string()).collect();
        names.sort();
        names.dedup();
        names
    };
    assert_eq!(found("order"), vec!["customer_orders", "order_id"]);
    assert_eq!(found("CUST"), vec!["customer", "customer_orders"]);
    assert!(found("zzz").is_empty());
    // The index is built once
    assert!(std::ptr::eq(entry.name_search_index(), index));
    // customer occurs as a table prefix and as a column
    assert!(index.search(b"customer").all(|n| n.text.starts_with("customer")));
    assert!(!index.is_empty());
    assert_eq!(index.byte_size(), index.len() * 8);
}

#[test]
fn descriptors_are_described_with_their_schemas() {
    let mut catalog = Catalog::new();
    let id = add(&mut catalog, CatalogLayer::CONNECTION, &tables_only(vec![table("db", "main", "t", &["a", "b"]), table("db", "other", "u", &["c"])]));
    let described = catalog.describe_entries_of(id).unwrap().entries.unwrap();
    assert_eq!(described.len(), 1);
    let entry = &described[0];
    assert_eq!(entry.catalog_entry_id, id);
    assert_eq!(entry.catalog_entry_type, CatalogEntryType::DESCRIPTOR_POOL);
    assert_eq!(entry.layer, CatalogLayer::CONNECTION);
    let mut schemas: Vec<_> = entry.schemas.as_ref().unwrap().iter().collect();
    schemas.sort_by_key(|s| s.schema_name.clone());
    assert_eq!(schemas.len(), 2);
    assert_eq!(schemas[0].database_name.as_deref(), Some("db"));
    assert_eq!(schemas[0].schema_name.as_deref(), Some("main"));
    let tables = schemas[0].tables.as_ref().unwrap();
    assert_eq!(tables.len(), 1);
    assert_eq!(tables[0].table_name.as_deref(), Some("t"));
    let columns = tables[0].columns.as_ref().unwrap();
    assert_eq!(columns.iter().map(|c| c.column_name.clone().unwrap()).collect::<Vec<_>>(), vec!["a", "b"]);
    assert_eq!(columns.iter().map(|c| c.ordinal_position).collect::<Vec<_>>(), vec![0, 1]);
    assert_eq!(schemas[1].tables.as_ref().unwrap()[0].table_name.as_deref(), Some("u"));
}

#[test]
fn statistics_count_content_of_all_entries() {
    let mut catalog = Catalog::new();
    let empty = catalog.statistics().content.unwrap();
    assert_eq!((empty.database_count, empty.schema_count, empty.table_count, empty.table_column_count), (0, 0, 0, 0));

    add(&mut catalog, CatalogLayer::CONNECTION, &tables_only(vec![table("db", "main", "t", &["a", "b"]), table("db", "other", "u", &["c"])]));
    let mut script = Script::new(&catalog);
    script.insert_text_at(0, "create table db.main.s (x int, y int, z int)");
    script.analyze(&catalog, true).unwrap();
    catalog.load_script(script.analyzed.clone().unwrap(), CatalogLayer::SESSION).unwrap();

    let content = catalog.statistics().content.unwrap();
    assert_eq!(content.database_count, 1);
    assert_eq!(content.schema_count, 2);
    assert_eq!(content.table_count, 3);
    assert_eq!(content.table_column_count, 6);
}

#[test]
fn replaced_descriptors_keep_the_ids_of_their_tables() {
    let mut catalog = Catalog::new();
    let id = add(&mut catalog, CatalogLayer::CONNECTION, &tables_only(vec![table("", "main", "orders", &["id"])]));
    let orders = catalog.entry(id).unwrap().data().table_declarations[0].object_id;

    // A refresh of the connection catalog that lists a new table first
    catalog
        .replace_descriptor(
            id,
            CatalogLayer::CONNECTION,
            &tables_only(vec![table("", "main", "customers", &["id"]), table("", "main", "orders", &["total", "id"])]),
        )
        .unwrap();
    let data = catalog.entry(id).unwrap().data();
    let refreshed = data.table_declarations.iter().find(|t| t.table_name.table_name.text() == "orders").unwrap();
    assert_eq!(refreshed.object_id, orders);
    assert_eq!(refreshed.column_by_name("id").unwrap().column_id(), 0);
    assert_eq!(refreshed.column_by_name("total").unwrap().column_id(), 1);
    assert_eq!(resolve(&catalog, "select total from orders"), vec!["total -> orders.total"]);
}

#[test]
fn dropping_a_script_keeps_the_ids_of_a_descriptor_under_its_id() {
    // The app publishes the connection descriptor under the entry id of the script that holds its text
    let mut catalog = Catalog::new();
    let id = add(&mut catalog, CatalogLayer::CONNECTION, &tables_only(vec![table("", "main", "orders", &["id"])]));
    let orders = catalog.entry(id).unwrap().data().table_declarations[0].object_id;
    catalog.drop_script(id);
    assert!(catalog.entry(id).is_some());

    // A refresh that lists a new table first keeps the id of orders
    catalog
        .replace_descriptor(
            id,
            CatalogLayer::CONNECTION,
            &tables_only(vec![table("", "main", "customers", &["id"]), table("", "main", "orders", &["id"])]),
        )
        .unwrap();
    let data = catalog.entry(id).unwrap().data();
    let refreshed = data.table_declarations.iter().find(|t| t.table_name.table_name.text() == "orders").unwrap();
    assert_eq!(refreshed.object_id, orders);
}

/// Pack an update of the tables of a descriptor
fn table_update(databases: &[&str], relations: &[(&str, &str, &str)], tables: Vec<TableT>) -> Vec<u8> {
    let mut update = dashql_buffers::catalog::CatalogTableUpdateT::default();
    update.databases = Some(databases.iter().map(|d| d.to_string()).collect());
    update.relations = Some(relations.iter().map(|(database, schema, name)| *table(database, schema, name, &[]).table_name.unwrap()).collect());
    update.tables = Some(tables);
    let mut builder = flatbuffers::FlatBufferBuilder::new();
    let packed = update.pack(&mut builder);
    builder.finish(packed, None);
    builder.finished_data().to_vec()
}

/// The tables of a descriptor as `schema.table(a, b)`
fn tables_of(catalog: &Catalog, id: CatalogEntryId) -> Vec<String> {
    catalog.entry(id).unwrap().data().table_declarations.iter().map(|t| {
        let columns: Vec<&str> = t.table_columns.iter().map(|c| c.column_name.text()).collect();
        format!("{}.{}({})", t.table_name.schema_name.text(), t.table_name.table_name.text(), columns.join(", "))
    }).collect()
}

#[test]
fn replace_tables_adds_replaces_and_removes_tables() {
    let mut catalog = Catalog::new();
    let id = catalog.allocate_entry_id();
    // An unknown entry is created
    catalog.replace_tables(id, CatalogLayer::CONNECTION, &table_update(&[], &[("db", "s", "a")], vec![table("db", "s", "a", &["x"])])).unwrap();
    catalog.replace_tables(id, CatalogLayer::CONNECTION, &table_update(&[], &[("db", "s", "b")], vec![table("db", "s", "b", &["y"])])).unwrap();
    assert_eq!(tables_of(&catalog, id), ["s.a(x)", "s.b(y)"]);
    // A table keeps its position, also its id
    let table_id = catalog.entry(id).unwrap().data().table_declarations[0].object_id;
    catalog.replace_tables(id, CatalogLayer::CONNECTION, &table_update(&[], &[("db", "s", "a")], vec![table("db", "s", "a", &["z"])])).unwrap();
    assert_eq!(tables_of(&catalog, id), ["s.a(z)", "s.b(y)"]);
    assert_eq!(catalog.entry(id).unwrap().data().table_declarations[0].object_id, table_id);
    // A relation without a table is gone
    catalog.replace_tables(id, CatalogLayer::CONNECTION, &table_update(&[], &[("db", "s", "a")], vec![])).unwrap();
    assert_eq!(tables_of(&catalog, id), ["s.b(y)"]);
}

#[test]
fn replace_tables_keeps_the_version_when_nothing_changes() {
    let mut catalog = Catalog::new();
    let id = catalog.allocate_entry_id();
    catalog.replace_tables(id, CatalogLayer::CONNECTION, &table_update(&[], &[], vec![table("db", "s", "a", &["x"])])).unwrap();
    let version = catalog.version();
    catalog.replace_tables(id, CatalogLayer::CONNECTION, &table_update(&[], &[("db", "s", "a")], vec![table("db", "s", "a", &["x"])])).unwrap();
    catalog.replace_tables(id, CatalogLayer::CONNECTION, &table_update(&[], &[("db", "s", "other")], vec![])).unwrap();
    assert_eq!(catalog.version(), version);
}

#[test]
fn replace_tables_replaces_the_tables_of_a_database() {
    let mut catalog = Catalog::new();
    let id = catalog.allocate_entry_id();
    catalog.replace_tables(id, CatalogLayer::CONNECTION, &table_update(&[], &[], vec![table("one", "s", "a", &["x"]), table("two", "s", "b", &["y"])])).unwrap();
    catalog.replace_tables(id, CatalogLayer::CONNECTION, &table_update(&["one"], &[], vec![table("one", "s", "c", &["z"])])).unwrap();
    assert_eq!(tables_of(&catalog, id), ["s.b(y)", "s.c(z)"]);
}

#[test]
fn replace_tables_leaves_the_catalog_when_it_fails() {
    let mut catalog = Catalog::new();
    let id = catalog.allocate_entry_id();
    catalog.replace_tables(id, CatalogLayer::CONNECTION, &table_update(&[], &[], vec![table("db", "s", "a", &["x"])])).unwrap();
    let version = catalog.version();
    assert!(catalog.replace_tables(id, CatalogLayer::CONNECTION, &table_update(&[], &[], vec![table("db", "s", "b", &["x", "x"])])).is_err());
    assert!(catalog.replace_tables(id, CatalogLayer::CONNECTION, &[1, 2, 3]).is_err());
    assert_eq!(tables_of(&catalog, id), ["s.a(x)"]);
    assert_eq!(catalog.version(), version);
}

#[test]
fn an_older_analysis_keeps_reading_the_table_it_resolved() {
    let mut catalog = Catalog::new();
    let id = catalog.allocate_entry_id();
    catalog.replace_tables(id, CatalogLayer::CONNECTION, &table_update(&[], &[], vec![table("db", "s", "a", &["x"]), table("db", "s", "b", &["y"])])).unwrap();
    let mut reader = Script::new(&catalog);
    reader.insert_text_at(0, "select y from b");
    reader.analyze(&catalog, true).unwrap();
    let analyzed = reader.analyzed.clone().unwrap();
    // The table moves in the new version of the entry, the snapshot of the analysis still holds the old one
    catalog.replace_tables(id, CatalogLayer::CONNECTION, &table_update(&[], &[("db", "s", "a")], vec![])).unwrap();
    assert!(!catalog.is_current(&analyzed.snapshot));
    let column_ref = analyzed.expressions.iter().find_map(|e| e.column_ref()).unwrap();
    let ColumnResolution::TableColumn(column) = column_ref.resolved else { panic!("the column is unresolved") };
    assert_eq!(analyzed.table(column.table).unwrap().table_name.table_name.text(), "b");
}

#[test]
fn a_descriptor_of_a_script_has_the_declaration_order_and_no_locations() {
    let source = Catalog::new();
    let mut script = Script::new(&source);
    script.insert_text_at(0, "create table main.items (name text, id integer);");
    script.analyze(&source, true).unwrap();
    let bytes = pack_catalog_descriptor(&script.analyzed.as_ref().unwrap().entry).unwrap();

    let mut catalog = Catalog::new();
    let id = add(&mut catalog, CatalogLayer::CONNECTION, &bytes);
    assert_eq!(tables_of(&catalog, id), ["main.items(name, id)"]);
    let table = &catalog.entry(id).unwrap().data().table_declarations[0];
    assert!(table.location.is_none());
    assert!(table.table_columns.iter().all(|c| c.location.is_none()));
}
