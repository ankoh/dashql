//! Catalog changes applied to descriptor entries.
//!
//! A full catalog refresh can be expensive, so the catalog follows the DDL statements that the user runs: their
//! changes (`dashql_core_session::catalog_changes`) are applied to the tables of a descriptor entry.

use super::{Catalog, CatalogEntryId, CatalogLayer};
use crate::error::{Error, Result};
use dashql_buffers::analyzer::{QualifiedTableNameT, TableColumnT, TableT};
use dashql_buffers::catalog::{CatalogChangeT, CatalogChangeType, CatalogDescriptor, CatalogDescriptorT};

/// The lookup key of a change: (database, schema, relation)
pub fn change_key(change: &CatalogChangeT) -> (&str, &str, &str) {
    (
        change.database_name.as_deref().unwrap_or(""),
        change.schema_name.as_deref().unwrap_or(""),
        change.relation_name.as_deref().unwrap_or(""),
    )
}

/// Apply changes to the tables of a descriptor
fn apply_to_descriptor(descriptor: &mut CatalogDescriptorT, changes: &[CatalogChangeT]) {
    let tables = descriptor.tables.get_or_insert_with(Vec::new);
    for change in changes {
        let (database, schema, relation) = change_key(change);
        let position = tables.iter().position(|t| {
            let name = t.table_name.as_deref();
            let part = |f: fn(&QualifiedTableNameT) -> &Option<String>| name.and_then(|n| f(n).as_deref()).unwrap_or("");
            part(|n| &n.database_name) == database && part(|n| &n.schema_name) == schema && part(|n| &n.table_name) == relation
        });
        match change.change_type {
            CatalogChangeType::CREATE_RELATION => {
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
                        .flatten()
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
            CatalogChangeType::DROP_RELATION => {
                if let Some(position) = position {
                    tables.remove(position);
                }
            }
            _ => {}
        }
    }
}

impl Catalog {
    /// Apply catalog changes to a descriptor entry.
    /// An unknown entry is created with the given layer, a known entry keeps its layer.
    pub fn apply_catalog_changes(&mut self, id: CatalogEntryId, layer: CatalogLayer, changes: &[CatalogChangeT]) -> Result<()> {
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
