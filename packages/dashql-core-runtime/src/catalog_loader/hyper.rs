//! The catalog of a Hyper connection: the relations of its databases from `pg_attribute`, or from the `_hyper_catalog`
//! of an attached Hyper Cloud database, and its functions from `pg_proc` or, for the embedded Hyper, from the bundled
//! function catalog. A Database.com connection reads the Hyper Cloud database that it attaches.
//!
//! The update queries every database at the same time. A database that fails keeps the relations it had, the others
//! are published. An update that asks about relations only asks the databases they belong to and doesn't touch the
//! functions.

use std::collections::{BTreeMap, HashMap, HashSet};

use arrow_array::RecordBatch;
use dashql_core::catalog::{Catalog, CatalogLayer};
use serde_json::Value;

use super::batch::{publish_prepared, CatalogBatch, CatalogBatchEntry, PreparedDescriptor};
use super::columns::{batches_with_rows, row_count, Integers, Strings};
use super::pg_attribute::{catalog_tables_from_pg_attribute, pg_attribute_query, PgAttributeScope};
use super::pg_proc::{catalog_sql_from_pg_proc, pg_proc_query};
use super::prefetched_hyper_functions::qualify_prefetched_hyper_functions;
use super::sql::{function_script_header, quote_identifier, relation_filter, HYPER_PG_PROC_SOURCE};
use super::tables::{
    catalog_tables_of_schema, pack_catalog_descriptor_of_tables, pack_catalog_table_update, CatalogTable,
    ColumnMetadata, SchemaTables,
};
use super::{
    CatalogEntries, CatalogLoadError, CatalogQuery, ConnectorCatalogUpdate, ConnectorStep, Publication, QueryAnswer,
};
use crate::connections::{
    JsonObject, RelationName, Timestamp, DEFAULT_DATABASE_NAME, HYPER_CLOUD_DEFAULT_DATABASE_NAME,
    SALESFORCE_CATALOG_DATABASE,
};
use crate::query::QueryType;

/// A database that a Hyper connection attaches
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachedDatabase {
    /// The path, `hyper.cloud:<database>` for a Hyper Cloud database
    pub path: String,
    /// The alias that names the database in queries
    pub alias: Option<String>,
}

/// The attached databases of the setup params of a Hyper connection
pub fn attached_databases(setup_params: &JsonObject) -> Vec<AttachedDatabase> {
    let Some(databases) = setup_params.get("attachedDatabases").and_then(Value::as_array) else {
        return Vec::new();
    };
    databases
        .iter()
        .map(|database| AttachedDatabase {
            path: database.get("path").and_then(Value::as_str).unwrap_or("").to_string(),
            alias: database.get("alias").and_then(Value::as_str).map(str::to_string),
        })
        .collect()
}

/// The Hyper Cloud database that a Database.com connection attaches as its catalog database
pub fn hyper_cloud_attached_database(setup_params: &JsonObject) -> AttachedDatabase {
    let database_name = setup_params
        .get("databaseName")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .unwrap_or(HYPER_CLOUD_DEFAULT_DATABASE_NAME);
    AttachedDatabase {
        path: format!("hyper.cloud:{database_name}"),
        alias: Some(SALESFORCE_CATALOG_DATABASE.to_string()),
    }
}

/// The query of the relations of a Hyper Cloud database, from its `_hyper_catalog`
pub fn hyper_cloud_catalog_query_sql(database_alias: &str, relations: Option<&[RelationName]>) -> String {
    let database = quote_identifier(database_alias);
    let table = |name: &str| format!("{database}.{}.{}", quote_identifier("_hyper_catalog"), quote_identifier(name));
    let relations = match relations {
        Some(relations) => {
            format!("AND {}", relation_filter("s.schema_name_display", "o.object_name_display", relations))
        }
        None => String::new(),
    };
    format!(
        "
        SELECT
            s.schema_name_display AS schema_name,
            o.object_name_display AS table_name,
            c.column_name_display AS column_name,
            c.ordinal_position AS ordinal_position,
            CAST(c.type_descriptor AS TEXT) AS data_type
        FROM {} d
        JOIN {} s
          ON s.account_id = d.account_id
         AND s.database_id = d.database_id
        JOIN {} o
          ON o.account_id = s.account_id
         AND o.schema_id = s.schema_id
        JOIN {} c
          ON c.account_id = o.account_id
         AND c.object_id = o.object_id
        WHERE o.object_type IN ('ICEBERG_TABLE', 'VIEW')
        {relations}
        ORDER BY
            s.schema_name_display,
            o.object_name_display,
            c.ordinal_position
    ",
        table("databases"),
        table("schemas"),
        table("objects"),
        table("columns"),
    )
}

/// The query of the relations of a Hyper Cloud database
pub fn hyper_cloud_catalog_query(database_alias: &str, relations: Option<&[RelationName]>) -> CatalogQuery {
    CatalogQuery {
        sql: hyper_cloud_catalog_query_sql(database_alias, relations),
        query_type: QueryType::CatalogQueryHyperCloud,
        title: format!("Query Hyper Cloud Catalog ({database_alias})"),
        read_timeout: true,
    }
}

/// The tables of the rows of the `_hyper_catalog` of a database, named after the database. The catalog can list a
/// column more than once, a table declares it once: the duplicates are dropped with a warning.
pub fn catalog_tables_from_hyper_cloud(
    batches: &[RecordBatch],
    database_name: &str,
) -> Result<(Vec<CatalogTable>, Option<String>), CatalogLoadError> {
    let mut schemas: BTreeMap<String, SchemaTables> = BTreeMap::new();
    let mut seen: HashSet<(String, String, String)> = HashSet::new();
    let mut duplicates = 0usize;
    let mut first_duplicate: Option<String> = None;
    for batch in batches_with_rows(batches) {
        let schema_names = Strings::of(batch, "schema_name")?;
        let table_names = Strings::of(batch, "table_name")?;
        let column_names = Strings::of(batch, "column_name")?;
        let ordinal_positions = Integers::of(batch, "ordinal_position")?;
        let data_types = Strings::of(batch, "data_type")?;
        for row in 0..batch.num_rows() {
            let (Some(schema), Some(table), Some(column)) =
                (schema_names.get(row), table_names.get(row), column_names.get(row))
            else {
                continue;
            };
            if schema.is_empty() || table.is_empty() || column.is_empty() {
                continue;
            }
            let columns = schemas.entry(schema.to_string()).or_default().entry(&table.to_string());
            if !seen.insert((schema.to_string(), table.to_string(), column.to_string())) {
                duplicates += 1;
                if first_duplicate.is_none() {
                    first_duplicate = Some(format!(
                        "schema={schema} table={table} column={column} ordinalPosition={} dataType={}",
                        ordinal_positions.get(row).map_or("null".to_string(), |position| position.to_string()),
                        data_types.get(row).unwrap_or("null"),
                    ));
                }
                continue;
            }
            columns.push(ColumnMetadata {
                name: column.to_string(),
                ordinal_position: ordinal_positions.get(row).unwrap_or(columns.len() as i64),
                data_type: data_types.get(row).map(str::to_string),
            });
        }
    }
    let warning = first_duplicate.map(|first| {
        format!(
            "Skipping duplicate Hyper Cloud catalog columns: database={database_name} duplicates={duplicates} {first}"
        )
    });
    let mut tables = Vec::new();
    for (schema, schema_tables) in schemas {
        tables.extend(catalog_tables_of_schema(database_name, &schema, schema_tables.into_entries()));
    }
    Ok((tables, warning))
}

/// A database that an update reads
#[derive(Debug, Clone, PartialEq, Eq)]
struct Target {
    /// The key of the database, its alias
    key: String,
    /// The database that its relations are named with
    database_name: String,
    /// The database to read the catalog of, the default database if none
    query_database_name: Option<String>,
    /// The path
    path: String,
    /// The relations to ask about, all if none
    relations: Option<Vec<RelationName>>,
    /// What came of it
    state: TargetState,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum TargetState {
    /// The query to run
    Query(CatalogQuery),
    /// The tables it reported
    Tables(Vec<CatalogTable>),
    /// Why it failed
    Failed(String),
}

impl Target {
    /// The name of the database in the errors
    fn label(&self) -> &str {
        if self.key.is_empty() {
            &self.path
        } else {
            &self.key
        }
    }

    /// Is the database a Hyper Cloud database?
    fn is_cloud(&self) -> bool {
        self.path.starts_with("hyper.cloud")
    }
}

/// How far a Hyper update got
#[derive(Debug, Clone, PartialEq)]
enum Phase {
    /// Reading the relations of the databases
    Relations,
    /// Reading the functions of `pg_proc`
    Functions,
    /// Publishing
    Publish(Option<PreparedDescriptor>),
    /// Published
    Done,
}

/// An update of the catalog of a Hyper or Database.com connection
#[derive(Debug)]
pub struct HyperCatalogUpdate {
    /// The databases that the update reads
    targets: Vec<Target>,
    /// Is a database attached? Attached databases need an alias.
    attached: bool,
    /// The relations to ask about, the whole catalog if none
    relations: Option<Vec<RelationName>>,
    /// Are the functions read from `pg_proc` instead of the bundled catalog? A Hyper server and Database.com read theirs,
    /// their functions depend on the deployment, e.g. `vector_search`. The embedded Hyper has the bundled ones.
    live_functions: bool,
    /// The database whose `pg_proc` is read, the first of several attached ones
    functions_database: Option<String>,
    /// The entries to publish into
    entries: CatalogEntries,
    /// The time of the refresh in the header of the function script
    updated_at: Timestamp,
    /// The text of the function script
    function_text: Option<String>,
    /// How far the update got
    phase: Phase,
    /// The warnings for the host
    warnings: Vec<String>,
}

impl HyperCatalogUpdate {
    /// An update of a Hyper connection with its setup params
    pub(crate) fn of_hyper(
        setup_params: &JsonObject,
        entries: CatalogEntries,
        relations: Option<Vec<RelationName>>,
        now: Timestamp,
    ) -> Self {
        // Without a protocol the connection is the embedded Hyper
        let live = !matches!(setup_params.get("protocol").and_then(Value::as_str), None | Some("WASM"));
        Self::new(&attached_databases(setup_params), live, entries, relations, now)
    }

    /// An update of a Database.com connection with its setup params: the Hyper Cloud database it attaches
    pub(crate) fn of_dbcom(
        setup_params: &JsonObject,
        entries: CatalogEntries,
        relations: Option<Vec<RelationName>>,
        now: Timestamp,
    ) -> Self {
        Self::new(&[hyper_cloud_attached_database(setup_params)], true, entries, relations, now)
    }

    /// An update of the attached databases, the default database without any
    pub(crate) fn new(
        attached: &[AttachedDatabase],
        live_functions: bool,
        entries: CatalogEntries,
        relations: Option<Vec<RelationName>>,
        now: Timestamp,
    ) -> Self {
        let mut keys: Vec<(String, String, Option<String>, String)> = if attached.is_empty() {
            vec![(DEFAULT_DATABASE_NAME.to_string(), DEFAULT_DATABASE_NAME.to_string(), None, String::new())]
        } else {
            attached
                .iter()
                .map(|database| {
                    let alias = database.alias.clone().unwrap_or_default();
                    let query_database = Some(alias.clone()).filter(|alias| !alias.is_empty());
                    (alias.clone(), alias, query_database, database.path.clone())
                })
                .collect()
        };
        let mut alias_counts: HashMap<String, usize> = HashMap::new();
        for (key, ..) in &keys {
            *alias_counts.entry(key.clone()).or_default() += 1;
        }
        let targets = keys
            .drain(..)
            .filter_map(|(key, database_name, query_database_name, path)| {
                let target_relations = relations.as_ref().map(|relations| {
                    relations
                        .iter()
                        .filter(|relation| relation.database_name == database_name)
                        .cloned()
                        .collect::<Vec<_>>()
                });
                // An update of relations only asks the databases they belong to
                if target_relations.as_ref().is_some_and(Vec::is_empty) {
                    return None;
                }
                let mut target = Target {
                    key,
                    database_name,
                    query_database_name,
                    path,
                    relations: target_relations,
                    state: TargetState::Failed(String::new()),
                };
                target.state = if !attached.is_empty() && target.key.trim().is_empty() {
                    TargetState::Failed("Attached databases require a non-empty alias for catalog refresh".to_string())
                } else if alias_counts.get(&target.key).copied().unwrap_or(0) > 1 {
                    let quoted = serde_json::to_string(&target.key).unwrap_or_default();
                    TargetState::Failed(format!("Attached database alias {quoted} is not unique"))
                } else if target.is_cloud() {
                    TargetState::Query(hyper_cloud_catalog_query(&target.database_name, target.relations.as_deref()))
                } else {
                    TargetState::Query(pg_attribute_query(&PgAttributeScope {
                        query_database_name: target.query_database_name.clone(),
                        relations: target.relations.clone(),
                    }))
                };
                Some(target)
            })
            .collect();
        Self {
            targets,
            attached: !attached.is_empty(),
            relations,
            live_functions,
            functions_database: if attached.len() > 1 {
                attached.first().and_then(|database| database.alias.clone())
            } else {
                None
            },
            entries,
            updated_at: now,
            function_text: None,
            phase: Phase::Relations,
            warnings: Vec::new(),
        }
    }

    /// Is a database attached?
    pub fn attached(&self) -> bool {
        self.attached
    }

    /// The queries of the databases that are still to run
    fn target_queries(&self) -> Vec<CatalogQuery> {
        self.targets
            .iter()
            .filter_map(|target| match &target.state {
                TargetState::Query(query) => Some(query.clone()),
                _ => None,
            })
            .collect()
    }

    /// Settle the relations of the databases: fail if none answered, publish the relations or read the functions
    fn resolve_targets(&mut self) -> Result<(), CatalogLoadError> {
        let full = self.relations.is_none();
        let successful = self.targets.iter().filter(|target| matches!(target.state, TargetState::Tables(_))).count();
        let failures = self.failures();
        if successful == 0 && (full || !failures.is_empty()) {
            return Err(CatalogLoadError::failed(format!(
                "Failed to refresh every attached database: {}",
                failures.join("; ")
            )));
        }
        if !full {
            self.phase = Phase::Publish(None);
            return Ok(());
        }
        if self.live_functions {
            self.phase = Phase::Functions;
            return Ok(());
        }
        let text = qualify_prefetched_hyper_functions(DEFAULT_DATABASE_NAME, self.updated_at);
        self.batch_functions(text, true)
    }

    /// Parse the functions next
    fn batch_functions(&mut self, text: String, require_functions: bool) -> Result<(), CatalogLoadError> {
        let entry_id = self.entries.function_entry()?;
        self.function_text = Some(text.clone());
        let batch = CatalogBatch::new(vec![CatalogBatchEntry { entry_id, text, require_functions }]);
        self.phase = Phase::Publish(batch.prepare()?.into_iter().next());
        Ok(())
    }

    /// The failures of the databases as `database: error`
    fn failures(&self) -> Vec<String> {
        self.targets
            .iter()
            .filter_map(|target| match &target.state {
                TargetState::Failed(error) => Some(format!("{}: {error}", target.label())),
                _ => None,
            })
            .collect()
    }

    /// The error of the databases that failed of an update that published the others
    fn partial_error(&self) -> Option<String> {
        let failures = self.failures();
        (!failures.is_empty()).then(|| failures.join("; "))
    }

    /// The databases that answered, their relations and their tables
    fn successful(&self) -> (Vec<String>, Vec<RelationName>, Vec<CatalogTable>) {
        let mut databases = Vec::new();
        let mut relations = Vec::new();
        let mut tables = Vec::new();
        for target in &self.targets {
            if let TargetState::Tables(target_tables) = &target.state {
                databases.push(target.database_name.clone());
                relations.extend(target.relations.iter().flatten().cloned());
                tables.extend(target_tables.iter().cloned());
            }
        }
        (databases, relations, tables)
    }
}

impl ConnectorCatalogUpdate for HyperCatalogUpdate {
    fn step(&mut self) -> Result<ConnectorStep, CatalogLoadError> {
        match &self.phase {
            Phase::Relations => {
                let queries = self.target_queries();
                if queries.is_empty() {
                    // Nothing to ask, e.g. every database failed its checks
                    self.resolve_targets()?;
                    return self.step();
                }
                Ok(ConnectorStep::Query(queries))
            }
            Phase::Functions => Ok(ConnectorStep::Query(vec![pg_proc_query(self.functions_database.as_deref())])),
            Phase::Publish(_) => Ok(ConnectorStep::Publish),
            Phase::Done => Ok(ConnectorStep::Done { partial: self.partial_error() }),
        }
    }

    fn answer_queries(&mut self, answers: Vec<QueryAnswer>) -> Result<(), CatalogLoadError> {
        match self.phase {
            Phase::Relations => {
                let full = self.relations.is_none();
                let mut answers = answers.into_iter();
                let mut warnings = Vec::new();
                for target in &mut self.targets {
                    if !matches!(target.state, TargetState::Query(_)) {
                        continue;
                    }
                    let answer = answers.next().unwrap_or_else(|| Err("the query was not answered".to_string()));
                    target.state = match read_target(target, answer, full) {
                        Ok((tables, warning)) => {
                            warnings.extend(warning);
                            TargetState::Tables(tables)
                        }
                        Err(error) => TargetState::Failed(error),
                    };
                }
                self.warnings.extend(warnings);
                self.resolve_targets()
            }
            Phase::Functions => {
                let answer =
                    answers.into_iter().next().unwrap_or_else(|| Err("the query was not answered".to_string()));
                let batches = answer.map_err(CatalogLoadError::Failed)?;
                let functions = catalog_sql_from_pg_proc(&batches, Some(DEFAULT_DATABASE_NAME))?;
                for skipped in &functions.skipped {
                    self.warnings.push(format!("Skipping unsupported PostgreSQL function signature: {skipped}"));
                }
                let text =
                    format!("{}{}", function_script_header(HYPER_PG_PROC_SOURCE, self.updated_at), functions.sql);
                self.batch_functions(text, false)
            }
            _ => Err(CatalogLoadError::failed("the Hyper catalog update didn't ask for queries")),
        }
    }

    fn publish(&mut self, catalog: &mut Catalog) -> Publication {
        let Phase::Publish(prepared) = std::mem::replace(&mut self.phase, Phase::Done) else {
            return Publication::of(Err(CatalogLoadError::failed("the Hyper catalog update didn't ask to publish")));
        };
        let (databases, answered, tables) = self.successful();
        let layer = CatalogLayer::CONNECTION;
        // The answer about relations updates them, the rest of the catalog stays
        if self.relations.is_some() {
            let result = if answered.is_empty() {
                Ok(())
            } else {
                catalog.replace_tables(
                    self.entries.relations,
                    layer,
                    &pack_catalog_table_update(&[], &answered, &tables),
                )
            };
            return Publication::of(result.map(|()| self.partial_error()).map_err(CatalogLoadError::from));
        }
        // The functions go first, a failure of the relations leaves them published
        let Some(prepared) = prepared else {
            return Publication::of(Err(CatalogLoadError::failed("the functions of the catalog were not processed")));
        };
        if let Err(error) = publish_prepared(catalog, std::slice::from_ref(&prepared)) {
            return Publication::of(Err(error));
        }
        let function_script_text = self.function_text.take();
        // A database that failed keeps the relations it had
        let result = if self.failures().is_empty() {
            catalog.replace_descriptor(self.entries.relations, layer, &pack_catalog_descriptor_of_tables(&tables))
        } else {
            catalog.replace_tables(self.entries.relations, layer, &pack_catalog_table_update(&databases, &[], &tables))
        };
        Publication {
            function_script_text,
            result: result.map(|()| self.partial_error()).map_err(CatalogLoadError::from),
        }
    }

    fn take_warnings(&mut self) -> Vec<String> {
        std::mem::take(&mut self.warnings)
    }
}

/// The tables of the answer of a database, an error if a full refresh found none
fn read_target(
    target: &Target,
    answer: QueryAnswer,
    full: bool,
) -> Result<(Vec<CatalogTable>, Option<String>), String> {
    let batches = answer?;
    let (tables, warning) = if target.is_cloud() {
        if full && row_count(&batches) == 0 {
            return Err(format!("Hyper Cloud catalog for {} returned no relations", target.database_name));
        }
        catalog_tables_from_hyper_cloud(&batches, &target.database_name).map_err(|error| error.to_string())?
    } else {
        if full && row_count(&batches) == 0 {
            return Err(format!("pg_attribute for {} returned no relations", target.database_name));
        }
        (catalog_tables_from_pg_attribute(&batches, &target.database_name).map_err(|error| error.to_string())?, None)
    };
    if full && tables.is_empty() {
        return Err(format!("Catalog for {} returned no usable relations", target.database_name));
    }
    Ok((tables, warning))
}
