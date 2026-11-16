//! The tables and functions of a catalog as structure: built from the rows of metadata queries, packed into catalog
//! descriptors and table updates for the core, read back from descriptors and rendered as the catalog files.

use std::collections::HashMap;
use std::hash::Hash;

use dashql_buffers::analyzer::{QualifiedTableNameT, TableColumnT, TableT};
use dashql_buffers::batch::DiagnosticSeverity;
use dashql_buffers::catalog::{CatalogDescriptor, CatalogDescriptorT, CatalogTableUpdateT};
use dashql_core::catalog::Catalog;
use dashql_core::catalog::QualifiedKey;
use dashql_core::pack::pack_catalog_descriptor;
use dashql_core_script::batch::{check_script, ProcessingStage};
use serde_json::{json, Value};

use super::sql::{qualified_table_name, quote_data_type, quote_identifier};
use super::CatalogLoadError;
use crate::connections::RelationName;

/// A column that a connection reported
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ColumnMetadata {
    /// The name
    pub name: String,
    /// The position in the table, the columns are ordered by it
    pub ordinal_position: i64,
    /// The type as the connection names it, none if it names none
    pub data_type: Option<String>,
}

/// A table that a connection reported
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogTable {
    pub database_name: String,
    pub schema_name: String,
    pub table_name: String,
    /// The columns, in the order the connection listed them
    pub columns: Vec<ColumnMetadata>,
}

impl CatalogTable {
    /// The name of the table as a relation
    pub fn relation(&self) -> RelationName {
        RelationName::new(&self.database_name, &self.schema_name, &self.table_name)
    }

    /// The columns ordered by their position, columns with the same position keep their order
    pub fn sorted_columns(&self) -> Vec<&ColumnMetadata> {
        let mut columns: Vec<&ColumnMetadata> = self.columns.iter().collect();
        columns.sort_by_key(|column| column.ordinal_position);
        columns
    }
}

/// Values grouped by key in the order of the first appearance of the keys
#[derive(Debug, Clone)]
pub(crate) struct Groups<K, V> {
    /// The keys in the order of their first appearance
    keys: Vec<K>,
    values: HashMap<K, V>,
}

impl<K: Clone + Eq + Hash, V: Default> Groups<K, V> {
    pub(crate) fn new() -> Self {
        Self { keys: Vec::new(), values: HashMap::new() }
    }

    /// The value of a key, a new value for a new key
    pub(crate) fn entry(&mut self, key: &K) -> &mut V {
        let keys = &mut self.keys;
        self.values.entry(key.clone()).or_insert_with(|| {
            keys.push(key.clone());
            V::default()
        })
    }

    pub(crate) fn into_entries(self) -> Vec<(K, V)> {
        let mut values = self.values;
        self.keys.into_iter().filter_map(|key| values.remove(&key).map(|value| (key, value))).collect()
    }
}

impl<K: Clone + Eq + Hash, V: Default> Default for Groups<K, V> {
    fn default() -> Self {
        Self::new()
    }
}

/// The columns of the tables of a schema by table name
pub(crate) type SchemaTables = Groups<String, Vec<ColumnMetadata>>;

/// The tables of a schema, sorted by name
pub fn catalog_tables_of_schema(
    database_name: &str,
    schema_name: &str,
    tables: Vec<(String, Vec<ColumnMetadata>)>,
) -> Vec<CatalogTable> {
    let mut tables = tables;
    tables.sort_by(|a, b| a.0.cmp(&b.0));
    tables
        .into_iter()
        .map(|(table_name, columns)| CatalogTable {
            database_name: database_name.to_string(),
            schema_name: schema_name.to_string(),
            table_name,
            columns,
        })
        .collect()
}

/// The name of a relation for the core
pub fn pack_relation_name(relation: &RelationName) -> QualifiedTableNameT {
    let mut name = QualifiedTableNameT::default();
    name.database_name = Some(relation.database_name.clone());
    name.schema_name = Some(relation.schema_name.clone());
    name.table_name = Some(relation.table_name.clone());
    name
}

/// A table of a catalog descriptor, its columns in the order of the connection
pub fn pack_catalog_table(table: &CatalogTable) -> TableT {
    let mut packed = TableT::default();
    packed.table_name = Some(Box::new(pack_relation_name(&table.relation())));
    packed.table_columns = Some(
        table
            .sorted_columns()
            .into_iter()
            .map(|column| {
                let mut packed = TableColumnT::default();
                packed.column_name = Some(column.name.clone());
                packed.column_type = column.data_type.clone();
                packed
            })
            .collect(),
    );
    packed
}

/// Finish a FlatBuffer of the object API
macro_rules! pack_bytes {
    ($value:expr) => {{
        let mut builder = flatbuffers::FlatBufferBuilder::new();
        let packed = $value.pack(&mut builder);
        builder.finish(packed, None);
        builder.finished_data().to_vec()
    }};
}
pub(crate) use pack_bytes;

/// A catalog descriptor of tables
pub fn pack_catalog_descriptor_of_tables(tables: &[CatalogTable]) -> Vec<u8> {
    let mut descriptor = CatalogDescriptorT::default();
    descriptor.tables = Some(tables.iter().map(pack_catalog_table).collect());
    descriptor.function_declarations = Some(Vec::new());
    pack_bytes!(descriptor)
}

/// An update of the tables of a descriptor for `Catalog::replace_tables`: the tables describe the databases in full
/// and the relations, a relation without a table is gone
pub fn pack_catalog_table_update(databases: &[String], relations: &[RelationName], tables: &[CatalogTable]) -> Vec<u8> {
    let mut update = CatalogTableUpdateT::default();
    update.databases = Some(databases.to_vec());
    update.relations = Some(relations.iter().map(pack_relation_name).collect());
    update.tables = Some(tables.iter().map(pack_catalog_table).collect());
    pack_bytes!(update)
}

/// Read a catalog descriptor
pub fn read_catalog_descriptor(bytes: &[u8]) -> Result<CatalogDescriptorT, CatalogLoadError> {
    flatbuffers::root::<CatalogDescriptor>(bytes)
        .map(|descriptor| descriptor.unpack())
        .map_err(|_| CatalogLoadError::failed("invalid CatalogDescriptor FlatBuffer"))
}

/// The tables of a catalog descriptor
pub fn catalog_tables_of_descriptor(descriptor: Option<&CatalogDescriptorT>) -> Vec<CatalogTable> {
    let tables = descriptor.and_then(|descriptor| descriptor.tables.as_ref());
    tables
        .into_iter()
        .flatten()
        .map(|table| {
            let name = table.table_name.as_deref();
            let part = |part: Option<&String>| part.cloned().unwrap_or_default();
            CatalogTable {
                database_name: part(name.and_then(|name| name.database_name.as_ref())),
                schema_name: part(name.and_then(|name| name.schema_name.as_ref())),
                table_name: part(name.and_then(|name| name.table_name.as_ref())),
                columns: table
                    .table_columns
                    .iter()
                    .flatten()
                    .enumerate()
                    .map(|(position, column)| ColumnMetadata {
                        name: column.column_name.clone().unwrap_or_default(),
                        ordinal_position: position as i64,
                        data_type: column.column_type.clone(),
                    })
                    .collect(),
            }
        })
        .collect()
}

/// A `CREATE TABLE` of a table, a table without a schema is named by its name only
pub fn create_table_sql(database_name: Option<&str>, schema_name: Option<&str>, table_name: &str, columns: &[ColumnMetadata]) -> String {
    let name = match schema_name {
        Some(schema_name) => qualified_table_name(database_name, schema_name, table_name),
        None => quote_identifier(table_name),
    };
    let mut sorted: Vec<&ColumnMetadata> = columns.iter().collect();
    sorted.sort_by_key(|column| column.ordinal_position);
    let columns: Vec<String> = sorted
        .into_iter()
        .map(|column| format!("    {} {}", quote_identifier(&column.name), quote_data_type(column.data_type.as_deref())))
        .collect();
    format!("CREATE TABLE {name} (\n{}\n);", columns.join(",\n"))
}

/// The `CREATE TABLE` statements of tables, the relations file of a catalog
pub fn catalog_tables_sql(tables: &[CatalogTable]) -> String {
    let statements: Vec<String> = tables
        .iter()
        .map(|table| create_table_sql(Some(&table.database_name), Some(&table.schema_name), &table.table_name, &table.columns))
        .collect();
    statements.join("\n\n")
}

/// The file with the relations of a connection. The catalog holds descriptors, this text is only written and read.
/// Temporary relations don't outlive the database session, a restart must not bring them back.
pub fn relations_file(descriptor: Option<&CatalogDescriptorT>) -> String {
    let tables: Vec<CatalogTable> = catalog_tables_of_descriptor(descriptor)
        .into_iter()
        .filter(|table| !table.schema_name.to_lowercase().starts_with("pg_temp"))
        .collect();
    format!(
        "-- DashQL Connection Relations.
-- This file is auto-generated and can only be updated through a catalog refresh.

{}
",
        catalog_tables_sql(&tables)
    )
}

/// The relations file of a descriptor entry of a catalog, none if the catalog has no such entry, e.g. after a reset
pub fn relations_file_of_entry(catalog: &Catalog, entry_id: dashql_core::catalog::CatalogEntryId) -> Option<String> {
    let bytes = catalog.descriptor_bytes(entry_id)?;
    let descriptor = read_catalog_descriptor(bytes).ok()?;
    Some(relations_file(Some(&descriptor)))
}

/// A parameter of a function of a catalog
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogFunctionParam {
    /// The name, none if the declaration names none
    pub name: Option<String>,
    /// The type, none if the declaration names none
    pub param_type: Option<String>,
}

/// A function of a catalog
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogFunction {
    /// The database, empty if the declaration names none
    pub database_name: String,
    /// The schema, empty if the declaration names none
    pub schema_name: String,
    /// The name of the function
    pub function_name: String,
    /// Is it an aggregate?
    pub is_aggregate: bool,
    /// The return type, none if the declaration names none
    pub return_type: Option<String>,
    /// The parameters in their order
    pub params: Vec<CatalogFunctionParam>,
}

/// The tables and the functions of a catalog file
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CatalogStructure {
    pub tables: Vec<CatalogTable>,
    pub functions: Vec<CatalogFunction>,
}

/// An optional text of a descriptor, none if it is empty
fn optional_text(value: Option<&String>) -> Option<String> {
    value.filter(|value| !value.is_empty()).cloned()
}

/// The functions of a catalog descriptor
pub fn catalog_functions_of_descriptor(descriptor: Option<&CatalogDescriptorT>) -> Vec<CatalogFunction> {
    let declarations = descriptor.and_then(|descriptor| descriptor.function_declarations.as_ref());
    declarations
        .into_iter()
        .flatten()
        .map(|declaration| {
            let name = declaration.function_name.as_deref();
            let part = |part: Option<&String>| part.cloned().unwrap_or_default();
            CatalogFunction {
                database_name: part(name.and_then(|name| name.database_name.as_ref())),
                schema_name: part(name.and_then(|name| name.schema_name.as_ref())),
                function_name: part(name.and_then(|name| name.function_name.as_ref())),
                is_aggregate: declaration.is_aggregate,
                return_type: optional_text(declaration.return_type.as_ref()),
                params: declaration
                    .params
                    .iter()
                    .flatten()
                    .map(|param| CatalogFunctionParam {
                        name: optional_text(param.param_name.as_ref()),
                        param_type: optional_text(param.param_type.as_ref()),
                    })
                    .collect(),
            }
        })
        .collect()
}

/// The catalog descriptor of the SQL of a catalog file. Fails if the core can't read the file.
pub fn catalog_descriptor_of_sql(sql: &str) -> Result<Vec<u8>, CatalogLoadError> {
    let catalog = Catalog::new();
    let checked = check_script(&catalog, sql, ProcessingStage::ANALYZE);
    if let Some(failure) = &checked.failure {
        return Err(CatalogLoadError::failed(format!("Cannot read a catalog: {failure}")));
    }
    if let Some(error) = checked.diagnostics.iter().find(|diagnostic| diagnostic.severity == DiagnosticSeverity::ERROR) {
        return Err(CatalogLoadError::failed(format!("Cannot read a catalog: {}", error.message)));
    }
    let analyzed = checked
        .script
        .analyzed
        .as_deref()
        .ok_or_else(|| CatalogLoadError::failed("Cannot read a catalog: no descriptor"))?;
    pack_catalog_descriptor(&analyzed.entry).map_err(|error| CatalogLoadError::failed(format!("Cannot read a catalog: {error}")))
}

/// Parse the SQL of a catalog file into its tables and functions. Fails if the core can't read the file.
pub fn parse_catalog_sql(sql: &str) -> Result<CatalogStructure, CatalogLoadError> {
    let descriptor = read_catalog_descriptor(&catalog_descriptor_of_sql(sql)?)?;
    Ok(CatalogStructure {
        tables: catalog_tables_of_descriptor(Some(&descriptor)),
        functions: catalog_functions_of_descriptor(Some(&descriptor)),
    })
}

/// The qualified name of a function, the parts that it names
fn qualified_function_name(function: &CatalogFunction) -> String {
    let parts: Vec<String> = [&function.database_name, &function.schema_name, &function.function_name]
        .into_iter()
        .filter(|part| !part.is_empty())
        .map(|part| quote_identifier(part))
        .collect();
    parts.join(".")
}

/// A `CREATE FUNCTION` or `CREATE AGGREGATE` statement of a function
pub fn catalog_function_sql(function: &CatalogFunction) -> String {
    let params: Vec<String> = function
        .params
        .iter()
        .map(|param| {
            let parts: Vec<String> =
                [param.name.as_deref().map(quote_identifier), param.param_type.clone()].into_iter().flatten().collect();
            parts.join(" ")
        })
        .collect();
    let keyword = if function.is_aggregate { "AGGREGATE" } else { "FUNCTION" };
    format!(
        "CREATE {keyword} {}({}) RETURNS {};",
        qualified_function_name(function),
        params.join(", "),
        function.return_type.as_deref().unwrap_or("any")
    )
}

/// The functions file of a catalog
pub fn catalog_functions_sql(functions: &[CatalogFunction]) -> String {
    let statements: Vec<String> = functions.iter().map(catalog_function_sql).collect();
    statements.join("\n")
}

/// What the file with the relations of a connection doesn't say, `dashql-catalog-state.json`
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CatalogStateFile {
    /// The relations of executed statements that the connection didn't answer about yet
    pub pending: Vec<RelationName>,
    /// The relations that the connection reported as gone, a declaration in a script doesn't provide them
    pub gone: Vec<RelationName>,
}

impl CatalogStateFile {
    /// The state of a catalog: the pending relations of the connection and the relations that are gone
    pub fn of_catalog(pending: Vec<RelationName>, catalog: &Catalog) -> Self {
        let gone = catalog.absent_relations().iter().map(relation_of_key).collect();
        Self { pending, gone }
    }

    /// Read the file, a file that can't be read holds nothing
    pub fn parse(text: Option<&str>) -> Self {
        let Some(Ok(parsed)) = text.map(serde_json::from_str::<Value>) else {
            return Self::default();
        };
        let relations = |key: &str| -> Vec<RelationName> {
            let Some(relations) = parsed.get(key).and_then(Value::as_array) else {
                return Vec::new();
            };
            relations
                .iter()
                .filter_map(|relation| {
                    let part = |name: &str| relation.get(name).and_then(Value::as_str);
                    Some(RelationName::new(part("databaseName")?, part("schemaName")?, part("tableName")?))
                })
                .collect()
        };
        Self { pending: relations("pending"), gone: relations("gone") }
    }

    /// The text of the file
    pub fn to_json(&self) -> String {
        let relations = |relations: &[RelationName]| -> Vec<Value> {
            relations
                .iter()
                .map(|relation| {
                    json!({
                        "databaseName": relation.database_name,
                        "schemaName": relation.schema_name,
                        "tableName": relation.table_name,
                    })
                })
                .collect()
        };
        // `pending` comes first, like the file of the TypeScript runtime
        format!(
            "{{\"pending\":{},\"gone\":{}}}",
            Value::Array(relations(&self.pending)),
            Value::Array(relations(&self.gone))
        )
    }
}

/// The relation of a key of the core
pub fn relation_of_key(key: &QualifiedKey) -> RelationName {
    RelationName::new(&key.0, &key.1, &key.2)
}
