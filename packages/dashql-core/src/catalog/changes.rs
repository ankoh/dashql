//! Catalog changes applied to descriptor entries.
//!
//! A full catalog refresh can be expensive, so the catalog follows the DDL statements that the user runs: their
//! changes (`dashql_core_session::catalog_changes`) are applied to the tables of a descriptor entry.

use super::{Catalog, CatalogEntryId, CatalogLayer};
use crate::error::{Error, Result};
use dashql_buffers::analyzer::{QualifiedTableNameT, TableColumnT, TableT};
use dashql_buffers::catalog::{CatalogChangeT, CatalogChangeType, CatalogDescriptor, CatalogDescriptorT};

/// What a statement did to a relation
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CatalogChangeKind {
    /// The statement created or replaced the relation
    CreateRelation,
    /// The statement dropped the relation
    DropRelation,
}

/// A change of a relation of the catalog, implied by a successful statement
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CatalogChange {
    /// What the statement did
    pub kind: CatalogChangeKind,
    /// The database name, empty if neither the statement nor the defaults name one
    pub database_name: String,
    /// The schema name, empty if neither the statement nor the defaults name one
    pub schema_name: String,
    /// The relation name
    pub relation_name: String,
    /// Is the relation only created if it does not exist yet?
    pub if_not_exists: bool,
    /// The column names of a created relation, in declaration order
    pub column_names: Vec<String>,
}

impl CatalogChange {
    /// The lookup key: (database, schema, relation)
    pub fn key(&self) -> (&str, &str, &str) {
        (&self.database_name, &self.schema_name, &self.relation_name)
    }

    /// Read a change of the boundary, None for a change without effect
    pub fn unpack(change: &CatalogChangeT) -> Option<Self> {
        Some(Self {
            kind: match change.change_type {
                CatalogChangeType::CREATE_RELATION => CatalogChangeKind::CreateRelation,
                CatalogChangeType::DROP_RELATION => CatalogChangeKind::DropRelation,
                _ => return None,
            },
            database_name: change.database_name.clone().unwrap_or_default(),
            schema_name: change.schema_name.clone().unwrap_or_default(),
            relation_name: change.relation_name.clone().unwrap_or_default(),
            if_not_exists: change.if_not_exists,
            column_names: change.column_names.clone().unwrap_or_default(),
        })
    }

    /// Write the change for the boundary
    pub fn pack(&self) -> CatalogChangeT {
        let mut change = CatalogChangeT::default();
        change.change_type = match self.kind {
            CatalogChangeKind::CreateRelation => CatalogChangeType::CREATE_RELATION,
            CatalogChangeKind::DropRelation => CatalogChangeType::DROP_RELATION,
        };
        change.database_name = Some(self.database_name.clone());
        change.schema_name = Some(self.schema_name.clone());
        change.relation_name = Some(self.relation_name.clone());
        change.if_not_exists = self.if_not_exists;
        if self.kind == CatalogChangeKind::CreateRelation {
            change.column_names = Some(self.column_names.clone());
        }
        change
    }
}

/// Apply changes to the tables of a descriptor
fn apply_to_descriptor(descriptor: &mut CatalogDescriptorT, changes: &[CatalogChange]) {
    let tables = descriptor.tables.get_or_insert_with(Vec::new);
    for change in changes {
        let (database, schema, relation) = change.key();
        let position = tables.iter().position(|t| {
            let name = t.table_name.as_deref();
            let part = |f: fn(&QualifiedTableNameT) -> &Option<String>| name.and_then(|n| f(n).as_deref()).unwrap_or("");
            part(|n| &n.database_name) == database && part(|n| &n.schema_name) == schema && part(|n| &n.table_name) == relation
        });
        match change.kind {
            CatalogChangeKind::CreateRelation => {
                if change.if_not_exists && position.is_some() {
                    continue;
                }
                let mut name = QualifiedTableNameT::default();
                name.database_name = Some(database.to_string());
                name.schema_name = Some(schema.to_string());
                name.table_name = Some(relation.to_string());
                let mut table = TableT::default();
                table.table_name = Some(Box::new(name));
                // A descriptor declares every column name once
                let mut seen = std::collections::HashSet::new();
                table.table_columns = Some(
                    change
                        .column_names
                        .iter()
                        .filter(|c| !c.is_empty() && seen.insert(c.as_str()))
                        .map(|c| {
                            let mut column = TableColumnT::default();
                            column.column_name = Some(c.clone());
                            column
                        })
                        .collect(),
                );
                match position {
                    Some(position) => tables[position] = table,
                    None => tables.push(table),
                }
            }
            CatalogChangeKind::DropRelation => {
                if let Some(position) = position {
                    tables.remove(position);
                }
            }
        }
    }
}

impl Catalog {
    /// Apply catalog changes to a descriptor entry.
    /// An unknown entry is created with the given layer, a known entry keeps its layer.
    pub fn apply_catalog_changes(&mut self, id: CatalogEntryId, layer: CatalogLayer, changes: &[CatalogChange]) -> Result<()> {
        let (mut descriptor, layer) = match self.descriptor_entries.get(&id) {
            Some(entry) => {
                let descriptor = flatbuffers::root::<CatalogDescriptor>(&entry.bytes)
                    .map_err(|_| Error::invalid_argument("invalid CatalogDescriptor FlatBuffer"))?
                    .unpack();
                (descriptor, entry.layer)
            }
            None => (CatalogDescriptorT::default(), layer),
        };
        apply_to_descriptor(&mut descriptor, changes);
        let mut builder = flatbuffers::FlatBufferBuilder::new();
        let packed = descriptor.pack(&mut builder);
        builder.finish(packed, None);
        self.replace_descriptor(id, layer, builder.finished_data())
    }
}
