//! The scripts of a session that table parameters reference.
//!
//! A table parameter `:foo` references the script `foo.sql` of the session by name. The planner, the check of the
//! script references, the analyzer and completion find the script the same way.
//!
//! The analyzer reads the result of a referenced script like a table: `ScriptResults` holds the output columns of
//! the scripts of a session that are a single SELECT, as table declarations of the reserved catalog entry
//! `SCRIPT_RESULTS_ENTRY_ID`. Every script session of the session holds the same `ScriptResults`, an analysis is
//! current only with the results it was analyzed with.

use crate::analyzer::{AnalyzedScript, ParameterKind};
use crate::catalog::{CatalogEntryId, CatalogTableId, Name, QualifiedCatalogObjectId, QualifiedTableName, TableColumn, TableDeclaration, TableLoc};
use crate::hash::HashMap;
use dashql_buffers::parser::StatementType;
use std::sync::Arc;

/// The catalog entry of the results of scripts, the table `i` is the result of the script `i` of the session
pub const SCRIPT_RESULTS_ENTRY_ID: CatalogEntryId = u32::MAX - 1;

/// The script that a table parameter names
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScriptLookup {
    /// The index of the script
    Found(usize),
    /// No script has the name
    Unknown,
    /// No script has the exact name and several differ in case only
    Ambiguous,
}

/// Find the script that a table parameter names: the script with the exact name, or the only script whose name
/// differs in ASCII case. Scripts without a name are never found.
pub fn find_script<'a>(names: impl Iterator<Item = &'a str> + Clone, name: &str) -> ScriptLookup {
    if let Some(i) = names.clone().position(|n| !n.is_empty() && n == name) {
        return ScriptLookup::Found(i);
    }
    let mut folded = names.enumerate().filter(|(_, n)| !n.is_empty() && n.eq_ignore_ascii_case(name)).map(|(i, _)| i);
    match (folded.next(), folded.next()) {
        (Some(i), None) => ScriptLookup::Found(i),
        (None, _) => ScriptLookup::Unknown,
        (Some(_), Some(_)) => ScriptLookup::Ambiguous,
    }
}

/// The result of a script of a session
#[derive(Clone, Debug)]
pub struct ScriptResult {
    /// The script name, `foo` for `foo.sql`
    pub name: Arc<str>,
    /// The output columns of the script as a table, absent if the script is no single SELECT or references itself
    pub table: Option<TableDeclaration>,
}

/// The results of the scripts of a session in session order, the tables that table parameters read
#[derive(Clone, Debug, Default)]
pub struct ScriptResults {
    pub scripts: Vec<ScriptResult>,
}

impl ScriptResults {
    /// Find the script that a table parameter names
    pub fn find(&self, name: &str) -> ScriptLookup {
        find_script(self.scripts.iter().map(|s| &*s.name), name)
    }

    /// The table of a result
    pub fn table(&self, loc: TableLoc) -> Option<&TableDeclaration> {
        if loc.entry != SCRIPT_RESULTS_ENTRY_ID {
            return None;
        }
        self.scripts.get(loc.index as usize)?.table.as_ref()
    }

    /// Do two results have the same names and columns?
    pub fn same_as(&self, other: &ScriptResults) -> bool {
        let columns = |t: &Option<TableDeclaration>| t.as_ref().map(|t| t.table_columns.iter().map(|c| c.column_name.text.clone()).collect::<Vec<_>>());
        self.scripts.len() == other.scripts.len()
            && self.scripts.iter().zip(&other.scripts).all(|(l, r)| l.name == r.name && columns(&l.table) == columns(&r.table))
    }

    /// Derive the results of the scripts of a session from their analyses. A script without an analysis keeps the
    /// columns of `previous` with the same name. Scripts on a cycle of references have no result: the columns of
    /// one would grow with every analysis of the other.
    pub fn derive(scripts: &[(&str, Option<&AnalyzedScript>)], previous: Option<&ScriptResults>) -> ScriptResults {
        let names = || scripts.iter().map(|(n, _)| *n);
        // The scripts that the terminal query of a script references
        let edges: Vec<Vec<usize>> = scripts
            .iter()
            .map(|(_, analyzed)| {
                let Some(analyzed) = analyzed else { return Vec::new() };
                analyzed
                    .parameters
                    .iter()
                    .filter(|p| p.kind == ParameterKind::Table)
                    .filter_map(|p| match find_script(names(), p.name.as_deref()?) {
                        ScriptLookup::Found(i) => Some(i),
                        _ => None,
                    })
                    .collect()
            })
            .collect();
        let cyclic = on_cycle(&edges);
        let mut out = Vec::with_capacity(scripts.len());
        for (i, (name, analyzed)) in scripts.iter().enumerate() {
            let columns = match analyzed {
                Some(analyzed) => query_columns(analyzed),
                None => previous
                    .and_then(|p| p.scripts.iter().find(|s| &*s.name == *name))
                    .and_then(|s| s.table.as_ref())
                    .map(|t| t.table_columns.iter().map(|c| c.column_name.text.clone()).collect()),
            };
            let table = match columns {
                Some(columns) if !cyclic[i] => Some(result_table(i as u32, name, columns)),
                _ => None,
            };
            out.push(ScriptResult { name: Arc::from(*name), table });
        }
        ScriptResults { scripts: out }
    }
}

/// The output columns of a script that is a single SELECT
fn query_columns(analyzed: &AnalyzedScript) -> Option<Vec<Arc<str>>> {
    match &analyzed.parsed.statements[..] {
        [statement] if statement.statement_type == StatementType::SELECT => Some(crate::analyzer::statement_output_columns(analyzed, 0)),
        _ => None,
    }
}

/// The table of the result of the script `index`
fn result_table(index: u32, name: &str, columns: Vec<Arc<str>>) -> TableDeclaration {
    let table_id = CatalogTableId::new(SCRIPT_RESULTS_ENTRY_ID, index);
    let name_of = |text: Arc<str>| Name { entry: SCRIPT_RESULTS_ENTRY_ID, id: 0, text };
    let table_name = QualifiedTableName {
        ast_node_id: None,
        database_name: name_of(Arc::from("")),
        schema_name: name_of(Arc::from("")),
        table_name: name_of(Arc::from(name)),
    };
    /* A result belongs to no database and schema of the catalog */
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
        assert_eq!(find_script(names.iter().copied(), "foo"), ScriptLookup::Found(1));
        assert_eq!(find_script(names.iter().copied(), "FOO"), ScriptLookup::Ambiguous);
        assert_eq!(find_script(names.iter().copied(), "bar"), ScriptLookup::Found(2));
        assert_eq!(find_script(names.iter().copied(), "baz"), ScriptLookup::Unknown);
        assert_eq!(find_script(names.iter().copied(), ""), ScriptLookup::Unknown);
    }
}
