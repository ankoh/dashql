//! The table parameters of a session.
//!
//! A table parameter `:foo` in table position reads a table of the session by name: the result of the script
//! `foo.sql` or the attachment `foo.parquet`. Scripts and attachments share one namespace. The planner, the check of
//! the script references, the analyzer and completion find a name the same way.
//!
//! The analyzer reads a table parameter like a table: `TableParameters` holds the output columns of the scripts of a
//! session that are a single SELECT, the result columns of the scripts that are a single call of a client function
//! that reads, and the columns of the attachments, as table declarations of the reserved catalog entry
//! `TABLE_PARAMETERS_ENTRY_ID`. Every script session of the session holds the same `TableParameters`,
//! an analysis is current only with the table parameters it was analyzed with.

use crate::analyzer::{AnalyzedScript, ParameterKind};
use crate::catalog::{CatalogEntryId, CatalogTableId, Name, QualifiedCatalogObjectId, QualifiedTableName, TableColumn, TableDeclaration, TableLoc};
use crate::hash::HashMap;
use dashql_buffers::parser::StatementType;
use std::sync::Arc;

/// The catalog entry of the table parameters, the table `i` is the table parameter `i` of the session
pub const TABLE_PARAMETERS_ENTRY_ID: CatalogEntryId = u32::MAX - 1;

/// What a name of a table parameter finds, the indexes are those of the names that were searched
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TableParameterLookup {
    /// The index of the name
    Found(usize),
    /// No name matches
    Unknown,
    /// Several names match: several have the exact name, or none has it and several differ in case only
    Ambiguous(Vec<usize>),
}

/// Find the name of a table parameter: the only exact name, or the only name that differs in ASCII case. Empty
/// names are never found.
pub fn find_table_parameter<'a>(names: impl Iterator<Item = &'a str> + Clone, name: &str) -> TableParameterLookup {
    let pick = |matches: Vec<usize>| match matches.len() {
        0 => None,
        1 => Some(TableParameterLookup::Found(matches[0])),
        _ => Some(TableParameterLookup::Ambiguous(matches)),
    };
    let exact = names.clone().enumerate().filter(|(_, n)| !n.is_empty() && *n == name).map(|(i, _)| i).collect();
    if let Some(found) = pick(exact) {
        return found;
    }
    let folded = names.enumerate().filter(|(_, n)| !n.is_empty() && n.eq_ignore_ascii_case(name)).map(|(i, _)| i).collect();
    pick(folded).unwrap_or(TableParameterLookup::Unknown)
}

/// The names that collide: groups of the indexes of names that are equal in ASCII case, in the order of their first
/// name. A table parameter with one of these names is ambiguous at least in case.
pub fn colliding_names<'a>(names: impl Iterator<Item = &'a str>) -> Vec<Vec<usize>> {
    let mut groups: Vec<(String, Vec<usize>)> = Vec::new();
    let mut by_name: HashMap<String, usize> = HashMap::default();
    for (i, name) in names.enumerate().filter(|(_, n)| !n.is_empty()) {
        let key = name.to_ascii_lowercase();
        match by_name.get(&key) {
            Some(&group) => groups[group].1.push(i),
            None => {
                by_name.insert(key.clone(), groups.len());
                groups.push((key, vec![i]));
            }
        }
    }
    groups.into_iter().map(|(_, g)| g).filter(|g| g.len() > 1).collect()
}

/// What a table parameter reads
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum TableParameterSource {
    /// The result of the script with the index in session order
    Script(u32),
    /// The attachment with the index
    Attachment(u32),
}

/// An attachment of a session that table parameters read
#[derive(Clone, Copy, Debug)]
pub struct TableParameterAttachment<'a> {
    /// The name, `foo` for `foo.parquet`
    pub name: &'a str,
    /// The columns of the file, absent if the host didn't read them
    pub columns: Option<&'a [Arc<str>]>,
}

/// A table parameter of a session
#[derive(Clone, Debug)]
pub struct TableParameter {
    /// The name, `foo` for `foo.sql` or `foo.parquet`
    pub name: Arc<str>,
    /// What the table parameter reads
    pub source: TableParameterSource,
    /// The columns as a table, absent if a script is no single SELECT or call that reads or references itself, or if
    /// the columns of an attachment are unknown
    pub table: Option<TableDeclaration>,
}

/// The table parameters of a session: the scripts in session order, then the attachments
#[derive(Clone, Debug, Default)]
pub struct TableParameters {
    pub entries: Vec<TableParameter>,
}

impl TableParameters {
    /// Find the table parameter of a name, the index of its entry
    pub fn find(&self, name: &str) -> TableParameterLookup {
        find_table_parameter(self.entries.iter().map(|s| &*s.name), name)
    }

    /// The table of a table parameter
    pub fn table(&self, loc: TableLoc) -> Option<&TableDeclaration> {
        if loc.entry != TABLE_PARAMETERS_ENTRY_ID {
            return None;
        }
        self.entries.get(loc.index as usize)?.table.as_ref()
    }

    /// What the table parameter of a table reads
    pub fn source(&self, loc: TableLoc) -> Option<TableParameterSource> {
        if loc.entry != TABLE_PARAMETERS_ENTRY_ID {
            return None;
        }
        Some(self.entries.get(loc.index as usize)?.source)
    }

    /// Do two registries have the same names, sources and columns?
    pub fn same_as(&self, other: &TableParameters) -> bool {
        let columns = |t: &Option<TableDeclaration>| t.as_ref().map(|t| t.table_columns.iter().map(|c| c.column_name.text.clone()).collect::<Vec<_>>());
        self.entries.len() == other.entries.len()
            && self
                .entries
                .iter()
                .zip(&other.entries)
                .all(|(l, r)| l.name == r.name && l.source == r.source && columns(&l.table) == columns(&r.table))
    }

    /// Derive the table parameters of a session from the analyses of its scripts and the columns of its attachments. A
    /// script without an analysis keeps the columns of the script with the same name in `previous`. Scripts on a cycle
    /// of references have no result: the columns of one would grow with every analysis of the other.
    pub fn derive(scripts: &[(&str, Option<&AnalyzedScript>)], attachments: &[TableParameterAttachment], previous: Option<&TableParameters>) -> TableParameters {
        let names = || scripts.iter().map(|(n, _)| *n).chain(attachments.iter().map(|a| a.name));
        // The scripts that the terminal query of a script references, attachments reference nothing
        let edges: Vec<Vec<usize>> = scripts
            .iter()
            .map(|(_, analyzed)| {
                let Some(analyzed) = analyzed else { return Vec::new() };
                analyzed
                    .parameters
                    .iter()
                    .filter(|p| p.kind == ParameterKind::Table)
                    .filter_map(|p| match find_table_parameter(names(), p.name.as_deref()?) {
                        TableParameterLookup::Found(i) if i < scripts.len() => Some(i),
                        _ => None,
                    })
                    .collect()
            })
            .collect();
        let cyclic = on_cycle(&edges);
        let mut out = Vec::with_capacity(scripts.len() + attachments.len());
        for (i, (name, analyzed)) in scripts.iter().enumerate() {
            let columns = match analyzed {
                Some(analyzed) => query_columns(analyzed),
                None => previous
                    .and_then(|p| p.entries.iter().find(|s| matches!(s.source, TableParameterSource::Script(_)) && &*s.name == *name))
                    .and_then(|s| s.table.as_ref())
                    .map(|t| t.table_columns.iter().map(|c| c.column_name.text.clone()).collect()),
            };
            let table = match columns {
                Some(columns) if !cyclic[i] => Some(result_table(i as u32, name, columns)),
                _ => None,
            };
            out.push(TableParameter { name: Arc::from(*name), source: TableParameterSource::Script(i as u32), table });
        }
        for (i, attachment) in attachments.iter().enumerate() {
            let index = (scripts.len() + i) as u32;
            let table = attachment.columns.map(|columns| result_table(index, attachment.name, columns.to_vec()));
            out.push(TableParameter { name: Arc::from(attachment.name), source: TableParameterSource::Attachment(i as u32), table });
        }
        TableParameters { entries: out }
    }
}

/// The output columns of a script that is a single SELECT, or the result columns of a script that is a single call of
/// a client function that reads
fn query_columns(analyzed: &AnalyzedScript) -> Option<Vec<Arc<str>>> {
    match &analyzed.parsed.statements[..] {
        [statement] if statement.statement_type == StatementType::SELECT => Some(crate::analyzer::statement_output_columns(analyzed, 0)),
        [_] => {
            let call = analyzed.single_client_function_call().filter(|c| c.readable())?;
            analyzed.client_function_result_columns(call)
        }
        _ => None,
    }
}

/// The table of the table parameter `index`
fn result_table(index: u32, name: &str, columns: Vec<Arc<str>>) -> TableDeclaration {
    let table_id = CatalogTableId::new(TABLE_PARAMETERS_ENTRY_ID, index);
    let name_of = |text: Arc<str>| Name { entry: TABLE_PARAMETERS_ENTRY_ID, id: 0, text };
    let table_name = QualifiedTableName {
        ast_node_id: None,
        database_name: name_of(Arc::from("")),
        schema_name: name_of(Arc::from("")),
        table_name: name_of(Arc::from(name)),
    };
    /* A table parameter belongs to no database and schema of the catalog */
    let mut table = TableDeclaration::new(QualifiedCatalogObjectId::schema(0, 0), table_id, table_name);
    let mut by_name = HashMap::default();
    for (i, column) in columns.into_iter().enumerate() {
        by_name.entry(column.clone()).or_insert(i);
        table.table_columns.push(TableColumn {
            object_id: QualifiedCatalogObjectId::table_column(table_id, i as u32),
            table: Some(table_id),
            ast_node_id: None,
            column_name: name_of(column),
            location: None,
        });
    }
    table.table_columns_by_name = by_name;
    table
}

/// Which nodes of a graph lie on a cycle
fn on_cycle(edges: &[Vec<usize>]) -> Vec<bool> {
    let n = edges.len();
    // A node lies on a cycle if it reaches itself
    (0..n)
        .map(|start| {
            let mut seen = vec![false; n];
            let mut pending: Vec<usize> = edges[start].clone();
            while let Some(i) = pending.pop() {
                if i == start {
                    return true;
                }
                if i < n && !std::mem::replace(&mut seen[i], true) {
                    pending.extend(&edges[i]);
                }
            }
            false
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_then_folded() {
        let names = ["Foo", "foo", "Bar", ""];
        assert_eq!(find_table_parameter(names.iter().copied(), "foo"), TableParameterLookup::Found(1));
        assert_eq!(find_table_parameter(names.iter().copied(), "FOO"), TableParameterLookup::Ambiguous(vec![0, 1]));
        assert_eq!(find_table_parameter(names.iter().copied(), "bar"), TableParameterLookup::Found(2));
        assert_eq!(find_table_parameter(names.iter().copied(), "baz"), TableParameterLookup::Unknown);
        assert_eq!(find_table_parameter(names.iter().copied(), ""), TableParameterLookup::Unknown);
    }

    #[test]
    fn exact_duplicates_are_ambiguous() {
        let names = ["sales", "orders", "sales"];
        assert_eq!(find_table_parameter(names.iter().copied(), "sales"), TableParameterLookup::Ambiguous(vec![0, 2]));
        assert_eq!(find_table_parameter(names.iter().copied(), "Orders"), TableParameterLookup::Found(1));
    }

    #[test]
    fn collisions_fold_case() {
        let names = ["Sales", "orders", "", "sales", "", "ORDERS", "x"];
        assert_eq!(colliding_names(names.iter().copied()), vec![vec![0, 3], vec![1, 5]]);
    }
}
