//! The catalog of a Trino connection: the columns of the `information_schema` of its catalogs. The params name the
//! catalogs to read, without them the update reads every catalog of the server. Trino has no functions in the catalog.

use dashql_core::catalog::{Catalog, CatalogLayer};
use serde_json::Value;

use super::columns::{batches_with_rows, row_count, Strings};
use super::information_schema::{
    catalog_tables_from_information_schema, information_schema_query, relation_scopes, InformationSchemaScope,
};
use super::tables::{pack_catalog_descriptor_of_tables, pack_catalog_table_update, CatalogTable, Groups};
use super::{ConnectorCatalogUpdate, CatalogEntries, CatalogLoadError, CatalogQuery, ConnectorStep, Publication, QueryAnswer};
use crate::connections::{trino_session_defaults, JsonObject, RelationName};
use crate::query::QueryType;

/// The query of the catalogs of the server
pub const TRINO_CATALOGS_QUERY: &str = "SELECT catalog_name FROM system.metadata.catalogs ORDER BY catalog_name";

/// The query of the catalogs of the server
pub fn trino_catalogs_query() -> CatalogQuery {
    CatalogQuery {
        sql: TRINO_CATALOGS_QUERY.to_string(),
        query_type: QueryType::CatalogQueryInformationSchema,
        title: "Catalogs".to_string(),
        read_timeout: false,
    }
}

/// A catalog entry of the params, `catalog` or `catalog.schema`
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TrinoCatalogEntry {
    pub catalog: String,
    /// The schema, none for all schemas of the catalog
    pub schema: Option<String>,
}

/// A catalog entry `catalog` or `catalog.schema`, split at the first dot. None if the entry names no catalog.
pub fn parse_trino_catalog_entry(entry: &str) -> Option<TrinoCatalogEntry> {
    let (catalog, schema) = entry.split_once('.').unwrap_or((entry, ""));
    let (catalog, schema) = (catalog.trim(), schema.trim());
    if catalog.is_empty() {
        return None;
    }
    Some(TrinoCatalogEntry { catalog: catalog.to_string(), schema: (!schema.is_empty()).then(|| schema.to_string()) })
}

/// The catalog entries of Trino params. Params that predate the entries name a catalog (`catalogName`) and schemas of
/// it (`schemaNames`).
pub fn trino_catalog_entries(params: &JsonObject) -> Vec<String> {
    let strings = |value: &Value| -> Vec<String> {
        value.as_array().into_iter().flatten().filter_map(Value::as_str).map(str::to_string).collect()
    };
    if let Some(catalogs) = params.get("catalogs").filter(|catalogs| !catalogs.is_null()) {
        return strings(catalogs);
    }
    let catalog = params.get("catalogName").and_then(Value::as_str).unwrap_or("");
    if catalog.is_empty() {
        return Vec::new();
    }
    let schemas = params.get("schemaNames").map(strings).unwrap_or_default();
    schemas.into_iter().map(|schema| format!("{catalog}.{schema}")).collect()
}

/// The catalogs that the catalog loader reads, in the order of their first entry. An entry without a schema reads all
/// schemas of its catalog. Without entries it reads the default catalog.
pub fn trino_catalog_scopes(params: &JsonObject) -> Vec<InformationSchemaScope> {
    // The schemas of a catalog and whether it is read in full
    let mut scopes: Groups<String, (Vec<String>, bool)> = Groups::new();
    for entry in trino_catalog_entries(params) {
        let Some(entry) = parse_trino_catalog_entry(&entry) else {
            continue;
        };
        let (schemas, all) = scopes.entry(&entry.catalog);
        match entry.schema {
            None => *all = true,
            Some(schema) => {
                if !schemas.contains(&schema) {
                    schemas.push(schema);
                }
            }
        }
    }
    let scopes = scopes.into_entries();
    if scopes.is_empty() {
        return trino_session_defaults(params).catalog.map(|catalog| InformationSchemaScope::catalog(&catalog)).into_iter().collect();
    }
    scopes
        .into_iter()
        .map(|(catalog, (schemas, all))| InformationSchemaScope {
            catalog,
            schemas: if all { Vec::new() } else { schemas },
            relations: None,
        })
        .collect()
}

/// The catalogs of the result of the catalogs query, all schemas of each
pub fn trino_catalog_scopes_of_result(batches: &[arrow_array::RecordBatch]) -> Result<Vec<InformationSchemaScope>, CatalogLoadError> {
    let mut scopes = Vec::new();
    for batch in batches_with_rows(batches) {
        let names = Strings::of(batch, "catalog_name")?;
        for row in 0..batch.num_rows() {
            if let Some(name) = names.get(row).filter(|name| !name.is_empty()) {
                scopes.push(InformationSchemaScope::catalog(name));
            }
        }
    }
    Ok(scopes)
}

/// How far a Trino update got
#[derive(Debug, Clone, PartialEq)]
enum Phase {
    /// Reading the catalogs of the server
    Catalogs,
    /// Reading the columns of the scopes
    Columns(Vec<InformationSchemaScope>),
    /// Publishing the tables
    Publish(Vec<CatalogTable>),
    /// Published, or nothing to ask
    Done,
}

/// An update of the catalog of a Trino connection
#[derive(Debug)]
pub struct TrinoCatalogUpdate {
    /// The relations to ask about, folded to lower case, the whole catalog if none
    relations: Option<Vec<RelationName>>,
    /// The entries to publish into
    entries: CatalogEntries,
    /// How far the update got
    phase: Phase,
}

impl TrinoCatalogUpdate {
    pub(crate) fn new(setup_params: &JsonObject, entries: CatalogEntries, relations: Option<Vec<RelationName>>) -> Self {
        // Trino folds the names of relations to lower case
        let relations = relations.map(|relations| {
            relations
                .iter()
                .map(|relation| {
                    RelationName::new(
                        &relation.database_name.to_lowercase(),
                        &relation.schema_name.to_lowercase(),
                        &relation.table_name.to_lowercase(),
                    )
                })
                .collect::<Vec<_>>()
        });
        let phase = match &relations {
            Some(relations) if relations.is_empty() => Phase::Done,
            Some(relations) => Phase::Columns(relation_scopes(relations)),
            None => {
                let scopes = trino_catalog_scopes(setup_params);
                // Without configured catalogs, read all catalogs of the server
                if scopes.is_empty() {
                    Phase::Catalogs
                } else {
                    Phase::Columns(scopes)
                }
            }
        };
        Self { relations, entries, phase }
    }

}

impl ConnectorCatalogUpdate for TrinoCatalogUpdate {
    fn step(&mut self) -> Result<ConnectorStep, CatalogLoadError> {
        match &self.phase {
            Phase::Catalogs => Ok(ConnectorStep::Query(vec![trino_catalogs_query()])),
            Phase::Columns(scopes) => {
                // Every information_schema belongs to a catalog, without one there is nothing to read
                if scopes.is_empty() {
                    return Err(CatalogLoadError::failed("no catalogs to read the information_schema of"));
                }
                Ok(ConnectorStep::Query(vec![information_schema_query(scopes)]))
            }
            Phase::Publish(_) => Ok(ConnectorStep::Publish),
            Phase::Done => Ok(ConnectorStep::Done { partial: None }),
        }
    }

    fn answer_queries(&mut self, answers: Vec<QueryAnswer>) -> Result<(), CatalogLoadError> {
        let answer = answers.into_iter().next().unwrap_or_else(|| Err("the query was not answered".to_string()));
        let batches = answer.map_err(CatalogLoadError::Failed)?;
        match &self.phase {
            Phase::Catalogs => {
                self.phase = Phase::Columns(trino_catalog_scopes_of_result(&batches)?);
                Ok(())
            }
            Phase::Columns(_) => {
                if self.relations.is_none() && row_count(&batches) == 0 {
                    return Err(CatalogLoadError::failed("information_schema returned no catalog relations"));
                }
                let tables = catalog_tables_from_information_schema(&batches)?;
                // An empty result after the rows were filtered doesn't clobber a restored catalog
                if self.relations.is_none() && tables.is_empty() {
                    return Err(CatalogLoadError::failed("information_schema returned no usable catalog relations"));
                }
                self.phase = Phase::Publish(tables);
                Ok(())
            }
            _ => Err(CatalogLoadError::failed("the Trino catalog update didn't ask for queries")),
        }
    }

    fn publish(&mut self, catalog: &mut Catalog) -> Publication {
        let Phase::Publish(tables) = std::mem::replace(&mut self.phase, Phase::Done) else {
            return Publication::of(Err(CatalogLoadError::failed("the Trino catalog update didn't ask to publish")));
        };
        let layer = CatalogLayer::CONNECTION;
        let result = match &self.relations {
            Some(relations) => {
                catalog.replace_tables(self.entries.relations, layer, &pack_catalog_table_update(&[], relations, &tables))
            }
            None => catalog.replace_descriptor(self.entries.relations, layer, &pack_catalog_descriptor_of_tables(&tables)),
        };
        Publication::of(result.map(|()| None).map_err(CatalogLoadError::from))
    }
}
