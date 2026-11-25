//! Name resolution.
//!
//! The visit collects table references, derived tables, column references, result targets, CTEs and
//! declarations bottom-up and groups them into name scopes. Finish resolves the names of all scopes,
//! populates derived tables, assigns statement ids and runs the schema inference.
//!
//! Column refs resolve against the FROM items of a scope (tables, CTEs, derived tables), each with
//! its ordered columns. Expression subqueries see the FROM items of their parents, derived tables and
//! CTEs only those above their parent, lateral derived tables also the FROM items before them.
//!
//! The node states hold vectors of ids, and merging a child moves its entries to the end.

use super::sql_types::read_sql_type;
use super::state::{quote_identifier, AnalysisState};
use super::types::*;
use crate::catalog::*;
use crate::hash::{HashMap, HashSet};
use crate::table_parameters::{TableParameterLookup, TABLE_PARAMETERS_ENTRY_ID};
use dashql_buffers::analyzer::{AnalyzerErrorSeverity, AnalyzerErrorType, NameTag, SemanticNodeMarkerType};
use dashql_buffers::parser::{
    AttributeKey as K, CopyDirection, JoinType, KnownFunction, MergeMatch, Node, NodeType, StatementType, SymbolSpan,
};
use dashql_parser::attrs;
use std::ops::Range;
use std::sync::Arc;

/// The maximum number of tables a reference may resolve to
const MAX_TABLE_REF_AMBIGUITY: usize = 100;

/// A table column collected from a column definition
#[derive(Clone)]
struct PendingColumn {
    /// The AST node id of the column definition
    ast_node_id: u32,
    /// The column name
    column_name: Name,
    /// The text of the declared type
    column_type: Option<Arc<str>>,
}

/// The state of a node during name resolution
#[derive(Default)]
struct NodeState {
    /// The scopes created in the subtree that have no parent scope yet
    child_scopes: Vec<ScopeId>,
    /// The column definitions of a CREATE TABLE
    table_columns: Vec<PendingColumn>,
    /// The table references not yet attached to a scope
    table_references: Vec<TableRefId>,
    /// The column ref expressions not yet attached to a scope
    column_references: Vec<ExprId>,
    /// The result targets of the enclosing SELECT
    result_targets: Vec<ResultTarget>,
    /// The CTE definitions of the enclosing WITH clause
    ctes: Vec<CteDefinition>,
    /// The derived tables, the FROM items of the next scope
    derived_tables: Vec<ScopeSource>,
    /// The joins with USING or NATURAL of the next scope
    using_joins: Vec<UsingJoin>,
    /// The parenthesized joins with an alias of the next scope
    join_aliases: Vec<ScopeJoin>,
    /// The clauses of the next scope whose column refs see only some of its FROM items, the `ON` conditions of its
    /// joins
    clauses: Vec<ScopeClause>,
}

/// Move the entries of a list to the end of another one. Takes over the buffer if the destination is
/// empty, so states move up the tree without copying.
#[inline]
fn append<T>(dst: &mut Vec<T>, src: &mut Vec<T>) {
    if dst.is_empty() {
        std::mem::swap(dst, src);
    } else {
        dst.append(src);
    }
}

impl NodeState {
    fn merge(&mut self, other: &mut NodeState) {
        append(&mut self.child_scopes, &mut other.child_scopes);
        append(&mut self.table_columns, &mut other.table_columns);
        append(&mut self.table_references, &mut other.table_references);
        append(&mut self.column_references, &mut other.column_references);
        append(&mut self.result_targets, &mut other.result_targets);
        append(&mut self.ctes, &mut other.ctes);
        append(&mut self.derived_tables, &mut other.derived_tables);
        append(&mut self.using_joins, &mut other.using_joins);
        append(&mut self.join_aliases, &mut other.join_aliases);
        append(&mut self.clauses, &mut other.clauses);
    }

    fn clear(&mut self) {
        *self = NodeState::default();
    }
}

/// A join with USING, or NATURAL that uses all common columns. The USING columns of both inputs
/// are one column of the join.
struct UsingJoin {
    /// The AST node id of the joined table
    ast_node_id: u32,
    /// The USING columns, all common columns of a NATURAL join if None
    using: Option<Vec<Name>>,
}

impl UsingJoin {
    fn uses(&self, column_name: &str) -> bool {
        self.using.as_ref().is_none_or(|using| using.iter().any(|c| &*c.text == column_name))
    }
}

/// The result of looking up a column ref in the FROM items of a scope
#[derive(Clone, Copy, PartialEq, Eq)]
enum Lookup {
    Resolved,
    Ambiguous,
    Missing,
    /// The qualifier names a FROM item of the scope that has no such column, the parent scopes are not searched
    Bound,
}

/// A column ref whose lookup ended without a column, the parent scopes are not searched for it
enum FinishedColumnRef {
    /// Reported as ambiguous
    Ambiguous,
    /// The qualifier names a FROM item without the column, with the unresolved table that owns the column
    Bound(Option<InferenceCandidate>),
}

/// A declaration whose columns are derived after its SELECT scope is resolved
struct PendingDerivedTable {
    /// The table declaration (index into the table declarations of the script)
    table: u32,
    /// The AST node id of the SELECT that defines the columns
    select_node_id: u32,
    /// The declared column names, they rename the leading output columns
    column_aliases: Vec<Name>,
}

/// The root scopes.
///
/// The set iterates in insertion order, and erasing moves the last element into the hole (see
/// docs/design/core_quirks.md).
#[derive(Default)]
struct RootScopes {
    /// The root scopes in insertion order
    values: Vec<ScopeId>,
    /// The position of every root scope in the values
    positions: HashMap<ScopeId, usize>,
}

impl RootScopes {
    fn insert(&mut self, scope: ScopeId) {
        if self.positions.contains_key(&scope) {
            return;
        }
        self.positions.insert(scope, self.values.len());
        self.values.push(scope);
    }

    fn erase(&mut self, scope: ScopeId) {
        let Some(pos) = self.positions.remove(&scope) else { return };
        let Some(last) = self.values.pop() else { return };
        if let Some(slot) = self.values.get_mut(pos) {
            *slot = last;
            self.positions.insert(last, pos);
        }
    }
}

/// The pass that groups names into scopes and resolves tables and columns
pub(super) struct NameResolutionPass {
    /// The state of every AST node
    node_states: Vec<NodeState>,
    /// Does the script contain property graph syntax?
    has_graph_syntax: bool,
    /// The scopes without a parent scope
    root_scopes: RootScopes,
    /// The table declarations whose columns are derived after resolution
    pending_derived_tables: Vec<PendingDerivedTable>,
    /// The column actions of `ALTER` statements on tables of `CREATE TABLE AS`: the table and the action
    pending_alters: Vec<(u32, u32)>,
    /// The joins with USING or NATURAL of the scopes
    using_joins: HashMap<ScopeId, Vec<UsingJoin>>,
    /// The column refs whose lookup ended without a column
    finished_column_refs: HashMap<ExprId, FinishedColumnRef>,
    /// The names of the column refs with more than two names, `s.t.a` is the column a of the table s.t, or the
    /// field a of the column t of the table s
    column_paths: HashMap<ExprId, Vec<Name>>,
    /// The columns that UPDATE and MERGE write, the SET targets and the INSERT columns of MERGE, with the AST node of
    /// the target table that they bind to
    assignment_targets: HashMap<ExprId, u32>,
    /// The `excluded` rows of the INSERT scopes with ON CONFLICT DO UPDATE: the ON CONFLICT node and the target
    insert_excluded: HashMap<ScopeId, (u32, u32)>,
    /// The table declarations of the script that a statement drops or renames, with the statement: the statements after
    /// it don't see the name
    removed_tables: Vec<(u32, u32)>,
}

impl NameResolutionPass {
    pub fn new(state: &AnalysisState) -> Self {
        let mut node_states = Vec::with_capacity(state.ast.len());
        node_states.resize_with(state.ast.len(), NodeState::default);
        let has_graph_syntax = state
            .ast
            .iter()
            .any(|n| matches!(n.node_type(), NodeType::OBJECT_SQL_PROPERTY_GRAPH | NodeType::OBJECT_SQL_GRAPH_TABLE));
        Self {
            node_states,
            has_graph_syntax,
            root_scopes: RootScopes::default(),
            pending_derived_tables: Vec::new(),
            pending_alters: Vec::new(),
            using_joins: HashMap::default(),
            finished_column_refs: HashMap::default(),
            column_paths: HashMap::default(),
            assignment_targets: HashMap::default(),
            insert_excluded: HashMap::default(),
            removed_tables: Vec::new(),
        }
    }

    /// Merge the states of all children of a node
    fn merge_child_states(&mut self, dst: &mut NodeState, node: &Node) {
        let begin = node.children_begin_or_value() as usize;
        for child in self.node_states.get_mut(begin..begin + node.children_count() as usize).unwrap_or_default() {
            dst.merge(child);
        }
    }

    /// Create a naming scope
    fn create_scope(&mut self, state: &mut AnalysisState, target: &mut NodeState, scope_root: u32) -> ScopeId {
        let scope_id = state.out.name_scopes.len() as ScopeId;
        state.out.name_scopes_by_root_node.entry(scope_root).or_insert(scope_id);
        for &child in &target.child_scopes {
            if let Some(child) = state.out.scope_mut(child) {
                child.parent_scope = Some(scope_id);
            }
            self.root_scopes.erase(child);
        }
        for &expr in &target.column_references {
            if let Some(column_ref) = state.out.expression_mut(expr).and_then(|e| e.column_ref_mut()) {
                column_ref.ast_scope_root = Some(scope_root);
            }
        }
        for &table_ref in &target.table_references {
            if let Some(table_ref) = state.out.table_ref_mut(table_ref) {
                table_ref.ast_scope_root = Some(scope_root);
            }
        }
        let using_joins = std::mem::take(&mut target.using_joins);
        if !using_joins.is_empty() {
            self.using_joins.insert(scope_id, using_joins);
        }
        state.out.name_scopes.push(NameScope {
            name_scope_id: scope_id,
            ast_node_id: scope_root,
            child_scopes: std::mem::take(&mut target.child_scopes),
            expressions: std::mem::take(&mut target.column_references),
            table_references: std::mem::take(&mut target.table_references),
            // The table refs are added when they are resolved
            sources: std::mem::take(&mut target.derived_tables),
            joins: std::mem::take(&mut target.join_aliases),
            clauses: std::mem::take(&mut target.clauses),
            ..Default::default()
        });
        // Start a new scope
        target.clear();
        target.child_scopes.push(scope_id);
        self.root_scopes.insert(scope_id);
        scope_id
    }

    /// Register a schema and its database
    fn register_schema(
        state: &mut AnalysisState,
        database_name: &Name,
        schema_name: &Name,
    ) -> QualifiedCatalogObjectId {
        let entry = &state.out.entry;
        let db_id = match entry
            .databases_by_name
            .get(&database_name.text)
            .and_then(|&i| entry.database_references.get(i))
            .map(|d| d.object_id)
        {
            Some(db_id) => db_id,
            None => {
                let db_id = state.catalog.reserve_database_id(&database_name.text);
                let index = state.out.entry.database_references.len();
                state.entry_mut().database_references.push(DatabaseReference {
                    object_id: db_id,
                    database_name: database_name.text.clone(),
                    database_alias: Arc::from(""),
                });
                state.entry_mut().databases_by_name.insert(database_name.text.clone(), index);
                state.resolve_name(database_name, CatalogObjectRef::Database(state.loc(index)));
                db_id
            }
        };
        let key = (database_name.text.clone(), schema_name.text.clone());
        let entry = &state.out.entry;
        match entry
            .schemas_by_qualified_name
            .get(&key)
            .and_then(|&i| entry.schema_references.get(i))
            .map(|s| s.object_id)
        {
            Some(schema_id) => schema_id,
            None => {
                let schema_id = state.catalog.reserve_schema_id(&database_name.text, &schema_name.text, db_id);
                let index = state.out.entry.schema_references.len();
                state.entry_mut().schema_references.push(SchemaReference {
                    object_id: schema_id,
                    database_name: database_name.text.clone(),
                    schema_name: schema_name.text.clone(),
                });
                state.entry_mut().schemas_by_qualified_name.insert(key, index);
                state.resolve_name(schema_name, CatalogObjectRef::Schema(state.loc(index)));
                schema_id
            }
        }
    }

    fn is_explain(state: &AnalysisState, statement_id: Option<u32>) -> bool {
        statement_id
            .and_then(|id| state.parsed.statements.get(id as usize))
            .is_some_and(|s| s.statement_type == StatementType::EXPLAIN)
    }

    /// Does an EXPLAIN statement run a `CREATE TABLE AS` declaration, with `analyze`? The same rule as for the relations
    /// that the statement touches (`touched_relations.rs`).
    fn explain_creates(state: &AnalysisState, statement_id: Option<u32>, declaration: &Node) -> bool {
        let root =
            statement_id.and_then(|id| state.parsed.statements.get(id as usize)).and_then(|s| state.node(s.root));
        let Some(root) = root.filter(|_| declaration.node_type() == NodeType::OBJECT_SQL_CREATE_AS) else {
            return false;
        };
        let [options, body] = attrs!(state.children(root), [K::EXT_EXPLAIN_OPTIONS, K::EXT_EXPLAIN_STATEMENT]);
        body.is_some_and(|body| state.node_id(body) == state.node_id(declaration))
            && crate::touched_relations::explain_executes(state.parsed, options)
    }

    /// Apply an `ALTER` to the declaration of the script, later statements read the table as the statement leaves it. A
    /// table that the script doesn't declare stays what the catalog says, the connection answers once the statement ran. A
    /// table of `CREATE TABLE AS` gets its columns later, its actions wait for them.
    fn visit_alter(&mut self, state: &mut AnalysisState, node: &Node, node_id: u32) {
        let [name_node, actions] = attrs!(state.children(node), [K::SQL_ALTER_TABLE_NAME, K::SQL_ALTER_TABLE_ACTIONS]);
        let Some(name) = state.read_qualified_table_name(name_node) else { return };
        let Some(actions) = actions.filter(|n| n.node_type() == NodeType::ARRAY) else { return };
        let Some(mut table) = Self::declared_table(state, &name) else { return };
        for action in state.children(actions) {
            match action.node_type() {
                NodeType::OBJECT_SQL_ALTER_RENAME_TABLE | NodeType::OBJECT_SQL_ALTER_SET_SCHEMA => {
                    let [new_table, new_schema] =
                        attrs!(state.children(action), [K::SQL_ALTER_ACTION_NEW_TABLE, K::SQL_ALTER_ACTION_NEW_NAME]);
                    let Some(source) =
                        state.out.entry.table_declarations.get(table as usize).map(|t| t.table_name.clone())
                    else {
                        continue;
                    };
                    let moved = match new_table {
                        Some(new_table) => state.read_qualified_table_name(Some(new_table)),
                        None => Some(source.clone()),
                    };
                    let Some(mut moved) = moved else { continue };
                    // What a new name leaves out stays as it is
                    if let Some(new_schema) = new_schema.filter(|n| n.node_type() == NodeType::NAME) {
                        moved.schema_name = state.node_name(new_schema);
                    } else if moved.schema_name.text.is_empty() {
                        moved.schema_name = source.schema_name.clone();
                    }
                    if moved.database_name.text.is_empty() {
                        moved.database_name = source.database_name.clone();
                    }
                    // The old name is gone for the statements after the `ALTER`
                    if let Some(statement) = state.find_statement_id(node_id) {
                        self.removed_tables.push((table, statement));
                    }
                    table = self.move_declaration(state, table, &moved, node_id, true);
                }
                _ => {
                    // The statements before the `ALTER` read the table as it was
                    let statement = state.find_statement_id(node_id);
                    let declared = state.out.entry.table_declarations.get(table as usize);
                    if let Some(name) =
                        declared.filter(|t| t.ast_statement_id != statement).map(|t| t.table_name.clone())
                    {
                        table = self.move_declaration(state, table, &name, node_id, false);
                    }
                    match self.pending_derived_tables.iter().find(|p| p.table == table) {
                        Some(_) => self.pending_alters.push((table, state.node_id(action))),
                        None => Self::apply_column_action(state, table, action),
                    }
                }
            }
        }
    }

    /// The last declaration of the script that a name names so far. The parts that a name leaves out match any, as in a
    /// reference to the table.
    fn declared_table(state: &AnalysisState, name: &QualifiedTableName) -> Option<u32> {
        let part = |named: &Name, declared: &Name| named.text.is_empty() || named.text == declared.text;
        let declared = state.out.entry.table_declarations.iter().rposition(|t| {
            t.table_name.table_name.text == name.table_name.text
                && part(&name.schema_name, &t.table_name.schema_name)
                && part(&name.database_name, &t.table_name.database_name)
        });
        declared.map(|index| index as u32)
    }

    /// `DROP TABLE` and `DROP VIEW` of tables that the script declares: the statements after it don't see them. A table
    /// that the script doesn't declare stays what the catalog says, as for an `ALTER`.
    fn visit_drop(&mut self, state: &mut AnalysisState, node: &Node, node_id: u32) {
        let statement = state.find_statement_id(node_id);
        let Some(statement) = statement.filter(|_| !Self::is_explain(state, statement)) else { return };
        let [name, more_names] = attrs!(state.children(node), [K::SQL_DROP_NAME, K::SQL_DROP_MORE_NAMES]);
        let more_names = more_names.map(|n| state.children(n)).unwrap_or_default();
        for name in name.into_iter().chain(more_names) {
            let Some(name) = state.read_qualified_table_name(Some(name)) else { continue };
            if let Some(table) = Self::declared_table(state, &name) {
                self.removed_tables.push((table, statement));
            }
        }
    }

    /// The declaration of a relation under its new name, or a new version under the same name that the `ALTER`
    /// changes. The old one stays for the statements before the `ALTER`. The names of a new version have their
    /// objects already.
    fn move_declaration(
        &mut self,
        state: &mut AnalysisState,
        table: u32,
        name: &QualifiedTableName,
        node_id: u32,
        renamed: bool,
    ) -> u32 {
        let Some(source) = state.out.entry.table_declarations.get(table as usize) else { return table };
        let (is_view, source_columns) = (source.is_view, source.table_columns.clone());
        let schema_id = Self::register_schema(state, &name.database_name, &name.schema_name);
        let table_id = state.reserve_table_id(name);
        let index = state.out.entry.table_declarations.len() as u32;
        let mut moved = TableDeclaration::new(schema_id, table_id, name.clone());
        moved.ast_node_id = Some(node_id);
        moved.ast_statement_id = state.find_statement_id(node_id);
        moved.is_view = is_view;
        let column_ids = state.reserve_column_ids(table_id, source_columns.iter().map(|c| &c.column_name.text));
        for ((column_index, source), column_id) in source_columns.iter().enumerate().zip(column_ids) {
            moved.table_columns_by_name.entry(source.column_name.text.clone()).or_insert(column_index);
            moved.table_columns.push(TableColumn {
                object_id: QualifiedCatalogObjectId::table_column(table_id, column_id),
                table: Some(table_id),
                ..source.clone()
            });
            if renamed {
                state.resolve_name(
                    &source.column_name,
                    CatalogObjectRef::Column(ColumnLoc {
                        table: TableLoc { entry: state.entry_id, index },
                        column: column_index as u32,
                    }),
                );
            }
        }
        state.entry_mut().table_declarations.push(moved);
        if renamed {
            state.resolve_name(&name.table_name, CatalogObjectRef::Table(TableLoc { entry: state.entry_id, index }));
        }
        // A table of `CREATE TABLE AS` gets its columns from the same query
        if let Some(pending) = self.pending_derived_tables.iter().find(|p| p.table == table) {
            let pending = PendingDerivedTable {
                table: index,
                select_node_id: pending.select_node_id,
                column_aliases: pending.column_aliases.clone(),
            };
            self.pending_derived_tables.push(pending);
            let queued: Vec<(u32, u32)> =
                self.pending_alters.iter().filter(|(t, _)| *t == table).map(|(_, action)| (index, *action)).collect();
            self.pending_alters.extend(queued);
        }
        index
    }

    /// Apply an action that changes the columns of a declared table
    fn apply_column_action(state: &mut AnalysisState, table: u32, action: &Node) {
        let Some(table_id) = state.out.entry.table_declarations.get(table as usize).map(|t| t.table_id()) else {
            return;
        };
        let entry_id = state.entry_id;
        let loc = move |column: u32| ColumnLoc { table: TableLoc { entry: entry_id, index: table }, column };
        let [column, new_name, column_type] = attrs!(
            state.children(action),
            [K::SQL_ALTER_ACTION_COLUMN, K::SQL_ALTER_ACTION_NEW_NAME, K::SQL_ALTER_ACTION_TYPE]
        );
        let Some(column) = column else { return };
        match action.node_type() {
            NodeType::OBJECT_SQL_ALTER_ADD_COLUMN => {
                let [name, declared_type] =
                    attrs!(state.children(column), [K::SQL_COLUMN_DEF_NAME, K::SQL_COLUMN_DEF_TYPE]);
                let Some(name) = name.filter(|n| n.node_type() == NodeType::NAME) else { return };
                let name = state.node_name(name);
                state.tag(&name, NameTag::COLUMN_NAME);
                if state
                    .out
                    .entry
                    .table_declarations
                    .get(table as usize)
                    .is_some_and(|t| t.table_columns_by_name.contains_key(&name.text))
                {
                    return;
                }
                let Some(&column_id) = state.reserve_column_ids(table_id, std::iter::once(&name.text)).first() else {
                    return;
                };
                let column_type =
                    declared_type.and_then(|t| read_sql_type(state.parsed, t)).map(|t| Arc::from(t.to_string()));
                let ast_node_id = state.node_id(column);
                let location = state.text_span(*column.symbol_span());
                let Some(table_declaration) = state.entry_mut().table_declarations.get_mut(table as usize) else {
                    return;
                };
                let column_index = table_declaration.table_columns.len();
                table_declaration.table_columns_by_name.insert(name.text.clone(), column_index);
                table_declaration.table_columns.push(TableColumn {
                    object_id: QualifiedCatalogObjectId::table_column(table_id, column_id),
                    table: Some(table_id),
                    ast_node_id: Some(ast_node_id),
                    column_name: name.clone(),
                    column_type,
                    location: Some(location),
                });
                let object = CatalogObjectRef::Column(loc(column_index as u32));
                state.resolve_name(&name, object);
            }
            NodeType::OBJECT_SQL_ALTER_DROP_COLUMN
            | NodeType::OBJECT_SQL_ALTER_RENAME_COLUMN
            | NodeType::OBJECT_SQL_ALTER_COLUMN_TYPE => {
                if column.node_type() != NodeType::NAME {
                    return;
                }
                let name = state.node_name(column);
                let column_index = state
                    .out
                    .entry
                    .table_declarations
                    .get(table as usize)
                    .and_then(|t| t.table_columns_by_name.get(&name.text));
                let Some(&column_index) = column_index else { return };
                match action.node_type() {
                    NodeType::OBJECT_SQL_ALTER_DROP_COLUMN => {
                        let Some(table_declaration) = state.entry_mut().table_declarations.get_mut(table as usize)
                        else {
                            return;
                        };
                        if column_index >= table_declaration.table_columns.len() {
                            return;
                        }
                        table_declaration.table_columns.remove(column_index);
                        table_declaration.table_columns_by_name.clear();
                        for (i, column) in table_declaration.table_columns.iter().enumerate() {
                            let text = column.column_name.text.clone();
                            table_declaration.table_columns_by_name.entry(text).or_insert(i);
                        }
                        // The name index holds positions of columns
                        let entry = state.entry_id;
                        state.out.name_objects.retain_mut(|(_, _, object)| match object {
                            CatalogObjectRef::Column(c) if c.table.entry == entry && c.table.index == table => {
                                if c.column as usize == column_index {
                                    return false;
                                }
                                if c.column as usize > column_index {
                                    c.column -= 1;
                                }
                                true
                            }
                            _ => true,
                        });
                    }
                    NodeType::OBJECT_SQL_ALTER_RENAME_COLUMN => {
                        let Some(new_name) = new_name.filter(|n| n.node_type() == NodeType::NAME) else { return };
                        let new_name = state.node_name(new_name);
                        state.tag(&new_name, NameTag::COLUMN_NAME);
                        let Some(&column_id) =
                            state.reserve_column_ids(table_id, std::iter::once(&new_name.text)).first()
                        else {
                            return;
                        };
                        let Some(table_declaration) = state.entry_mut().table_declarations.get_mut(table as usize)
                        else {
                            return;
                        };
                        let Some(declared) = table_declaration.table_columns.get_mut(column_index) else { return };
                        table_declaration.table_columns_by_name.remove(&name.text);
                        table_declaration.table_columns_by_name.insert(new_name.text.clone(), column_index);
                        declared.object_id = QualifiedCatalogObjectId::table_column(table_id, column_id);
                        declared.column_name = new_name.clone();
                        let (entry, object) = (state.entry_id, CatalogObjectRef::Column(loc(column_index as u32)));
                        state.out.name_objects.retain(|(_, _, o)| !matches!(o, CatalogObjectRef::Column(c) if c.table.entry == entry && c.table.index == table && c.column as usize == column_index));
                        state.resolve_name(&new_name, object);
                    }
                    _ => {
                        let declared_type =
                            column_type.and_then(|t| read_sql_type(state.parsed, t)).map(|t| Arc::from(t.to_string()));
                        let table_declaration = state.entry_mut().table_declarations.get_mut(table as usize);
                        if let Some(declared) = table_declaration.and_then(|t| t.table_columns.get_mut(column_index)) {
                            declared.column_type = declared_type;
                        }
                    }
                }
            }
            _ => {}
        }
    }

    /// Register a table-like declaration backed by a SELECT scope
    fn register_derived_table(
        &mut self,
        state: &mut AnalysisState,
        declaration_node: &Node,
        name_node: Option<&Node>,
        columns_node: Option<&Node>,
        select_node: &Node,
    ) {
        let declaration_id = state.node_id(declaration_node);
        // EXPLAIN describes a declaration, publishing it would create a phantom catalog producer. An EXPLAIN that runs a
        // `CREATE TABLE AS` creates the table, as for the relations that the statement touches.
        let statement_id = state.find_statement_id(declaration_id);
        if Self::is_explain(state, statement_id) && !Self::explain_creates(state, statement_id, declaration_node) {
            return;
        }
        let Some(table_name) = state.read_qualified_table_name(name_node) else { return };
        let schema_id = Self::register_schema(state, &table_name.database_name, &table_name.schema_name);
        let index = state.out.entry.table_declarations.len() as u32;
        let table_id = state.reserve_table_id(&table_name);
        let name = table_name.table_name.clone();
        let mut table = TableDeclaration::new(schema_id, table_id, table_name);
        table.ast_node_id = Some(declaration_id);
        table.ast_statement_id = state.find_statement_id(declaration_id);
        table.ast_scope_root = Some(state.node_id(select_node));
        table.is_view = declaration_node.node_type() == NodeType::OBJECT_SQL_VIEW;
        table.location = name_node.map(|n| state.text_span(*n.symbol_span()));
        state.entry_mut().table_declarations.push(table);
        state.resolve_name(&name, CatalogObjectRef::Table(TableLoc { entry: state.entry_id, index }));

        let mut column_aliases = Vec::new();
        if let Some(columns) = columns_node.filter(|n| n.node_type() == NodeType::ARRAY) {
            for column in state.children(columns) {
                if column.node_type() != NodeType::NAME {
                    continue;
                }
                let name = state.node_name(column);
                state.tag(&name, NameTag::COLUMN_NAME);
                column_aliases.push(name);
            }
        }
        self.pending_derived_tables.push(PendingDerivedTable {
            table: index,
            select_node_id: state.node_id(select_node),
            column_aliases,
        });
    }

    /// Materialize a pending declaration after its SELECT scope has output columns
    fn populate_derived_table(state: &mut AnalysisState, pending: &PendingDerivedTable, scope: ScopeId) {
        let Some(s) = state.out.scope(scope) else { return };
        // A SELECT without result targets that has no output columns wraps the SELECT of its child scope. The other
        // child scopes are subqueries, their columns are not those of the table.
        let output_scope = match (s.output_columns.is_empty() && s.result_targets.is_empty(), s.child_scopes.first()) {
            (true, Some(&child)) => child,
            _ => scope,
        };
        let Some(outputs) = state.out.scope(output_scope).map(|s| &s.output_columns) else { return };
        // The names of the columns with their output columns. Every output column is a column of the table, the
        // declared names rename the leading ones, and an unnamed one is named like Postgres does.
        let columns: Vec<(Name, u32)> = outputs
            .iter()
            .zip(0..)
            .map(|(output, column)| {
                let name = match pending.column_aliases.get(column as usize) {
                    Some(alias) => alias.clone(),
                    None if !output.column_name.text.is_empty() => output.column_name.clone(),
                    None => Name {
                        entry: state.entry_id,
                        id: state.out.empty_name,
                        text: Self::unnamed_column_name(state, output),
                    },
                };
                (name, column)
            })
            .collect();
        let table_index = pending.table;
        let Some(table_id) = state.out.entry.table_declarations.get(table_index as usize).map(|t| t.table_id()) else {
            return;
        };
        let column_ids = state.reserve_column_ids(table_id, columns.iter().map(|(n, _)| &n.text));
        for ((column_index, (column_name, output)), column_id) in columns.into_iter().enumerate().zip(column_ids) {
            // Only a column that is passed through keeps a known type, expressions have no type in the analyzer
            let source = Self::resolved_table_column(
                state,
                ColumnResolution::ScopeColumn { scope: output_scope, column: output },
            );
            let column_type = source
                .and_then(|loc| state.table(loc.table)?.table_columns.get(loc.column as usize)?.column_type.clone());
            let Some(table) = state.entry_mut().table_declarations.get_mut(table_index as usize) else { return };
            table.table_columns_by_name.entry(column_name.text.clone()).or_insert(column_index);
            table.table_columns.push(TableColumn {
                object_id: QualifiedCatalogObjectId::table_column(table_id, column_id),
                table: Some(table_id),
                ast_node_id: None,
                column_name: column_name.clone(),
                column_type,
                location: None,
            });
            let loc = ColumnLoc {
                table: TableLoc { entry: state.entry_id, index: table_index },
                column: column_index as u32,
            };
            // A generated name is no name of the script
            if column_name.id != state.out.empty_name {
                state.tag(&column_name, NameTag::COLUMN_NAME);
                state.resolve_name(&column_name, CatalogObjectRef::Column(loc));
            }
        }
    }

    /// The name of an unnamed output column in a table: the name of a called function, `?column?` otherwise
    fn unnamed_column_name(state: &AnalysisState, column: &ScopeColumn) -> Arc<str> {
        let ScopeColumnSource::Expression(expr) = column.source else { return Arc::from("?column?") };
        let function = match state.out.expression(expr).map(|e| &e.inner) {
            Some(ExpressionInner::FunctionCall(call)) => match &call.function_name {
                FunctionName::Qualified(name) => Some(name.function_name.text.clone()),
                FunctionName::Known(known) => known.variant_name().map(|n| Arc::from(n.to_ascii_lowercase())),
            },
            _ => None,
        };
        function.filter(|name| !name.is_empty()).unwrap_or_else(|| Arc::from("?column?"))
    }

    /// The alias under which a table reference is registered in its scope
    fn table_ref_alias(table_ref: &TableReference, fallback: &Arc<str>) -> Arc<str> {
        match &table_ref.alias {
            Some((alias, _)) => alias.text.clone(),
            None => fallback.clone(),
        }
    }

    /// Read an alias clause, the alias name with its location and the column names
    fn read_alias(state: &mut AnalysisState, alias: Option<&Node>) -> (Option<(Name, SymbolSpan)>, Vec<Name>) {
        let (name, columns) = match alias {
            Some(alias) if alias.node_type() == NodeType::NAME => (Some(alias), None),
            Some(alias) if alias.node_type() == NodeType::OBJECT_SQL_ALIAS => {
                let [name, columns] = attrs!(state.children(alias), [K::SQL_ALIAS_NAME, K::SQL_ALIAS_COLUMN_NAMES]);
                (name.filter(|n| n.node_type() == NodeType::NAME), columns.filter(|n| n.node_type() == NodeType::ARRAY))
            }
            _ => return (None, Vec::new()),
        };
        let name = name.map(|node| {
            let name = state.node_name(node);
            state.tag(&name, NameTag::TABLE_ALIAS);
            (name, *node.symbol_span())
        });
        let mut column_aliases = Vec::new();
        for column in columns.map(|c| state.children(c)).unwrap_or_default() {
            if column.node_type() == NodeType::NAME {
                let column_name = state.node_name(column);
                state.tag(&column_name, NameTag::COLUMN_NAME);
                column_aliases.push(column_name);
            }
        }
        (name, column_aliases)
    }

    /// The FROM item of a table parameter `:foo` that reads the result of the script `foo.sql` or the attachment
    /// `foo.parquet`, None if the parameter is positional, the target of a write, ambiguous, or names no table parameter
    /// with columns
    fn table_parameter_source(
        state: &mut AnalysisState,
        node_id: u32,
        node: &Node,
        table_node: Option<&Node>,
        alias_node: Option<&Node>,
    ) -> Option<(ScopeSource, TableRefId)> {
        let parameter = table_node.filter(|n| n.node_type() == NodeType::OBJECT_SQL_PARAMETER_REF)?;
        if matches!(
            node.attribute_key(),
            K::SQL_INSERT_TARGET | K::SQL_DELETE_TARGET | K::SQL_UPDATE_TARGET | K::SQL_MERGE_TARGET
        ) {
            return None;
        }
        let results = state.out.table_parameters.clone()?;
        let [name] = attrs!(state.children(parameter), [K::SQL_PARAMETER_NAME]);
        let name = name.and_then(|n| state.read_name_path(n).last().map(|&id| state.name(id).text))?;
        let name: Arc<str> = match name.strip_prefix('\'').and_then(|n| n.strip_suffix('\'')) {
            Some(inner) => inner.into(),
            None => name,
        };
        let TableParameterLookup::Found(index) = results.find(&name) else { return None };
        let table = results.entries.get(index)?.table.as_ref()?;
        let (alias, column_aliases) = Self::read_alias(state, alias_node);
        // A table reference that is resolved already, the cursor, the focus and the semantic spans see the parameter
        // like a table. Scope resolution, the planner and the script references skip it.
        let id = state.out.table_references.len() as TableRefId;
        state.out.table_references.push(TableReference {
            table_reference_id: ExternalObjectId::new(state.entry_id, id),
            ast_node_id: node_id,
            location: Some(*node.symbol_span()),
            ast_statement_id: None,
            ast_scope_root: None,
            alias: alias.clone(),
            column_aliases: column_aliases.clone(),
            inner: Some(RelationExpression {
                table_name: table.table_name.clone(),
                resolved_table: Some(ResolvedTableEntry {
                    table_name: table.table_name.clone(),
                    catalog_schema_id: table.catalog_schema_id,
                    catalog_table_id: table.object_id,
                    referenced_catalog_version: table.catalog_version,
                }),
                resolved_alternatives: Vec::new(),
                resolved_cte: None,
            }),
            role: TableRole::Read,
        });
        state.mark(node_id, SemanticNodeMarkerType::TABLE_REFERENCE);
        let source = ScopeSource {
            ast_node_id: node_id,
            name: Some(alias.map(|(alias, _)| alias.text).unwrap_or(name)),
            column_aliases,
            table: ReferencedTable::Table(TableLoc { entry: TABLE_PARAMETERS_ENTRY_ID, index: index as u32 }),
            table_name: None,
        };
        Some((source, id))
    }

    /// Is a FROM item a table parameter?
    fn is_table_parameter(source: &ScopeSource) -> bool {
        matches!(source.table, ReferencedTable::Table(loc) if loc.entry == TABLE_PARAMETERS_ENTRY_ID)
    }

    /// Add a FROM item to a scope, unless its name is taken. Tables without alias of different schemas share their
    /// name, a column ref qualifies them with the schema. An aliased join hides the names inside it, a FROM item
    /// outside of it can take them.
    fn add_source(state: &mut AnalysisState, scope: ScopeId, source: ScopeSource) {
        let Some(s) = state.out.scope(scope) else { return };
        let hides = |node_id: u32, other: &ScopeSource| {
            NameScope::is_hidden(state.ast, other, &s.hiding_joins(state.ast, node_id))
        };
        let collides = |other: &ScopeSource| {
            other.name == source.name
                && match (&other.table_name, &source.table_name) {
                    (Some(l), Some(r)) => l.key() == r.key(),
                    _ => true,
                }
                && !hides(source.ast_node_id, other)
                && !hides(other.ast_node_id, &source)
        };
        if let Some(name) = source.name.as_ref().filter(|_| s.sources.iter().any(collides)) {
            let message = format!("duplicate table alias {}", quote_identifier(name));
            state.add_error(
                AnalyzerErrorType::DUPLICATE_TABLE_ALIAS,
                AnalyzerErrorSeverity::ERROR,
                source.ast_node_id,
                message,
            );
            return;
        }
        if let Some(s) = state.out.scope_mut(scope) {
            s.sources.push(source);
        }
    }

    /// Resolve all table refs in a scope and register the FROM items
    fn resolve_table_refs_in_scope(&self, state: &mut AnalysisState, scope: ScopeId) {
        // The derived tables were added when the scope was created
        let Some(s) = state.out.scope_mut(scope) else { return };
        let mut sources = std::mem::take(&mut s.sources);
        let table_refs = s.table_references.clone();
        let statement = s.ast_statement_id;
        for table_ref_id in table_refs {
            let Some(table_ref) = state.out.table_ref(table_ref_id) else { continue };
            let Some(relation) = &table_ref.inner else { continue };
            // The result of a script is a FROM item already
            if table_ref.reads_table_parameter() {
                continue;
            }
            if relation.resolved_table.is_some() {
                continue;
            }
            let table_name = relation.table_name.clone();
            let ref_name = table_name.table_name.text.clone();
            let role = table_ref.role;
            let Some(reference) = state.node(table_ref.ast_node_id) else { continue };
            let reference_offset = reference.symbol_span().offset();
            // A table without alias can be named with its schema
            let source = |table_ref: &TableReference, name: Arc<str>, table: ReferencedTable, table_name| ScopeSource {
                ast_node_id: table_ref.ast_node_id,
                name: Some(name),
                column_aliases: table_ref.column_aliases.clone(),
                table,
                table_name: if table_ref.alias.is_none() { table_name } else { None },
            };

            // Does the table ref match a CTE definition in this or any parent scope? A CTE has no schema, a
            // qualified name never names one.
            let mut matched_cte = None;
            let unqualified = table_name.schema_name.text.is_empty() && table_name.database_name.text.is_empty();
            let mut s = Some(scope).filter(|_| unqualified);
            while let Some(sid) = s {
                let Some(candidate) = state.out.scope(sid) else { break };
                if let Some(index) = candidate.cte_definitions.get_index(&ref_name) {
                    let mut visible = true;
                    if !candidate.ctes_recursive {
                        let definition =
                            candidate.cte_definitions.at(index).and_then(|d| state.node(d.definition_node_id));
                        visible = definition.is_some_and(|d| {
                            let span = d.symbol_span();
                            reference_offset > span.offset() + span.length()
                        });
                    }
                    if visible {
                        matched_cte = Some(CteLoc { scope: sid, index: index as u32 });
                        break;
                    }
                }
                s = candidate.parent_scope;
            }
            if let (Some(cte), TableRole::Read) = (matched_cte, role) {
                if let Some(relation) = state.out.table_ref_mut(table_ref_id).and_then(|t| t.inner.as_mut()) {
                    relation.resolved_cte = Some(cte);
                }
                let Some(table_ref) = state.out.table_ref(table_ref_id) else { continue };
                let alias = Self::table_ref_alias(table_ref, &ref_name);
                sources.push(source(table_ref, alias, ReferencedTable::Cte(cte), None));
                continue;
            }

            // Resolve as a table of the own script, then through the catalog. A statement of the script reads the
            // declaration of a name that the statements before it leave, a statement before all declarations of the
            // name reads the table of the catalog. A table that the statements before it drop or rename is gone.
            let mut resolved = Vec::new();
            let mut removed = false;
            state.out.entry.resolve_table(&table_name, &mut resolved, MAX_TABLE_REF_AMBIGUITY);
            if let Some(statement) = statement {
                let entry = &state.out.entry;
                let is_removed = |index: usize| {
                    self.removed_tables.iter().any(|&(table, by)| table as usize == index && by < statement)
                };
                resolved.retain_mut(|loc| match entry.table_declared_before(loc.index as usize, statement) {
                    Some(index) if is_removed(index) => {
                        removed = true;
                        false
                    }
                    Some(index) => {
                        loc.index = index as u32;
                        true
                    }
                    None => false,
                });
            }
            if resolved.is_empty() && !removed {
                state.catalog.resolve_table(&table_name, state.entry_id, &mut resolved, MAX_TABLE_REF_AMBIGUITY);
            }
            if let Some(&best_loc) = resolved.first() {
                let entries: Vec<ResolvedTableEntry> = resolved
                    .iter()
                    .filter_map(|&loc| state.table(loc))
                    .map(|t| ResolvedTableEntry {
                        table_name: t.table_name.clone(),
                        catalog_schema_id: t.catalog_schema_id,
                        catalog_table_id: t.object_id,
                        referenced_catalog_version: t.catalog_version,
                    })
                    .collect();
                // A location that the catalog doesn't hold keeps the referenced name
                let best_name =
                    entries.first().map_or_else(|| ref_name.clone(), |e| e.table_name.table_name.text.clone());
                let qualified_name = entries.first().map(|e| e.table_name.clone());
                if let Some(relation) = state.out.table_ref_mut(table_ref_id).and_then(|t| t.inner.as_mut()) {
                    let mut entries = entries.into_iter();
                    relation.resolved_table = entries.next();
                    relation.resolved_alternatives.extend(entries);
                }
                let Some(table_ref) = state.out.table_ref(table_ref_id) else { continue };
                sources.push(source(
                    table_ref,
                    Self::table_ref_alias(table_ref, &best_name),
                    ReferencedTable::Table(best_loc),
                    qualified_name,
                ));
                continue;
            }

            // Neither a CTE nor in the catalog. Register an unresolved relation so that columns used
            // against it can be associated for schema inference.
            let Some(table_ref) = state.out.table_ref(table_ref_id) else { continue };
            let unresolved = ReferencedTable::Unresolved(UnresolvedRelation {
                table_ref: table_ref_id,
                table_name: table_name.clone(),
            });
            sources.push(source(table_ref, Self::table_ref_alias(table_ref, &ref_name), unresolved, Some(table_name)));
        }
        // Register the FROM items in FROM order, table refs follow the nodes of earlier FROM items in
        // the post-order AST
        sources.sort_by_key(|s| s.ast_node_id);
        // The result of a script yields its name to the other FROM items, the planner renames its common table
        // expression as well
        let taken: HashSet<Arc<str>> =
            sources.iter().filter(|s| !Self::is_table_parameter(s)).filter_map(|s| s.name.clone()).collect();
        for source in sources.iter_mut().filter(|s| Self::is_table_parameter(s)) {
            if source.name.as_ref().is_some_and(|n| taken.contains(n)) {
                source.name = None;
            }
        }
        for source in sources {
            Self::add_source(state, scope, source);
        }
    }

    /// Report an aliased join whose alias names another FROM item of the scope
    fn check_join_alias_names(&self, state: &mut AnalysisState, scope: ScopeId) {
        let Some(s) = state.out.scope(scope) else { return };
        // The joins that no other aliased join contains, their FROM items have no names outside of them
        let joins = self.hiding_joins(state, scope, s.ast_node_id);
        let mut duplicates = Vec::new();
        for (i, join) in joins.iter().enumerate() {
            let named = |source: &ScopeSource| {
                source.name.as_deref() == Some(&*join.name) && !Self::is_hidden(state, source, &joins)
            };
            if joins.iter().take(i).any(|other| other.name == join.name) || s.sources.iter().any(named) {
                duplicates.push((join.ast_node_id, format!("duplicate table alias {}", quote_identifier(&join.name))));
            }
        }
        for (node_id, message) in duplicates {
            state.add_error(AnalyzerErrorType::DUPLICATE_TABLE_ALIAS, AnalyzerErrorSeverity::ERROR, node_id, message);
        }
    }

    /// Find a column among the columns of a FROM item, the column aliases rename the leading columns
    fn find_column(aliases: &[Name], column_count: usize, column_name: &str, by_name: Option<usize>) -> Option<usize> {
        match aliases.iter().position(|a| &*a.text == column_name) {
            Some(column) => (column < column_count).then_some(column),
            None => by_name.filter(|&column| column >= aliases.len()),
        }
    }

    /// Resolve a column against the output columns of a scope
    fn resolve_scope_column(
        state: &AnalysisState,
        scope: ScopeId,
        aliases: &[Name],
        column_name: &str,
    ) -> ColumnResolution {
        let Some(s) = state.out.scope(scope) else { return ColumnResolution::Unresolved };
        let by_name = s.output_columns_by_name.get(column_name).copied();
        match Self::find_column(aliases, s.output_columns.len(), column_name, by_name) {
            Some(column) => ColumnResolution::ScopeColumn { scope, column: column as u32 },
            None => ColumnResolution::Unresolved,
        }
    }

    /// Resolve a column against a FROM item
    fn resolve_column(state: &AnalysisState, source: &ScopeSource, column_name: &str) -> ColumnResolution {
        match &source.table {
            ReferencedTable::Table(loc) => {
                let Some(table) = state.table(*loc) else { return ColumnResolution::Unresolved };
                let by_name = table.table_columns_by_name.get(column_name).copied();
                match Self::find_column(&source.column_aliases, table.table_columns.len(), column_name, by_name) {
                    Some(column) => ColumnResolution::TableColumn(ColumnLoc { table: *loc, column: column as u32 }),
                    None => ColumnResolution::Unresolved,
                }
            }
            // An unresolved relation has an unknown schema
            ReferencedTable::Unresolved(_) => ColumnResolution::Unresolved,
            ReferencedTable::Cte(loc) => {
                let cte = state.out.scope(loc.scope).and_then(|s| s.cte_definitions.at(loc.index as usize));
                let Some(cte) = cte else { return ColumnResolution::Unresolved };
                let Some(child) = cte.child_scope else {
                    return ColumnResolution::Unresolved;
                };
                // The column names of the CTE rename the leading columns, the aliases of the FROM item rename them again
                if source.column_aliases.is_empty() {
                    return Self::resolve_scope_column(state, child, &cte.column_aliases, column_name);
                }
                let count = source.column_aliases.len().max(cte.column_aliases.len());
                let aliases: Vec<Name> = (0..count)
                    .filter_map(|i| source.column_aliases.get(i).or_else(|| cte.column_aliases.get(i)).cloned())
                    .collect();
                Self::resolve_scope_column(state, child, &aliases, column_name)
            }
            ReferencedTable::Subquery(child) => {
                Self::resolve_scope_column(state, *child, &source.column_aliases, column_name)
            }
        }
    }

    /// Is a node within the subtree of another one?
    fn is_within(state: &AnalysisState, node_id: u32, ancestor: u32) -> bool {
        is_within(state.ast, node_id, ancestor)
    }

    /// Do the FROM items that have a column all lie within a join that uses it?
    fn is_using_column(&self, state: &AnalysisState, scope: ScopeId, source_nodes: &[u32], column_name: &str) -> bool {
        let Some(joins) = self.using_joins.get(&scope) else { return false };
        joins.iter().any(|join| {
            join.uses(column_name)
                && source_nodes.iter().all(|&node_id| Self::is_within(state, node_id, join.ast_node_id))
        })
    }

    /// The first input of the outermost join that names a column in USING and holds all of some FROM items. A NATURAL
    /// join of tables with unknown columns may not join the column.
    fn using_join_first_input(
        &self,
        state: &AnalysisState,
        scope: ScopeId,
        source_nodes: &[u32],
        column_name: &str,
    ) -> Option<u32> {
        let joins = self.using_joins.get(&scope)?;
        let join = joins.iter().rev().find(|join| {
            join.using.is_some()
                && join.uses(column_name)
                && source_nodes.iter().all(|&node_id| Self::is_within(state, node_id, join.ast_node_id))
        })?;
        let [inputs] = state.node(join.ast_node_id).map_or([None], |n| attrs!(state.children(n), [K::SQL_JOIN_INPUT]));
        inputs.and_then(|inputs| state.children(inputs).first()).map(|first| state.node_id(first))
    }

    /// Report an ambiguous column ref with the FROM items that have the column
    fn report_ambiguous(
        &mut self,
        state: &mut AnalysisState,
        expr: ExprId,
        column_name: &str,
        sources: &[Option<Arc<str>>],
    ) {
        let mut message = String::from("column reference is ambiguous, candidates: ");
        for (i, table_name) in sources.iter().enumerate() {
            if i > 0 {
                message.push_str(", ");
            }
            match table_name {
                Some(table_name) => message.push_str(&quote_identifier(table_name)),
                None => message.push_str("(subquery)"),
            }
            message.push('.');
            message.push_str(&quote_identifier(column_name));
        }
        if let Some(node_id) = state.out.expression(expr).map(|e| e.ast_node_id) {
            state.add_error(AnalyzerErrorType::COLUMN_REF_AMBIGUOUS, AnalyzerErrorSeverity::ERROR, node_id, message);
        }
        self.finished_column_refs.insert(expr, FinishedColumnRef::Ambiguous);
    }

    /// Resolve a qualified column ref against the FROM items that its qualifier names. A FROM item without the
    /// column binds the column ref, it is not searched in the parent scopes.
    fn resolve_qualified_column(
        &mut self,
        state: &mut AnalysisState,
        expr: ExprId,
        sources: &[ScopeSource],
        column_name: &str,
    ) -> Lookup {
        if sources.is_empty() {
            return Lookup::Missing;
        }
        let candidates: Vec<(u32, Option<Arc<str>>, ColumnResolution)> = sources
            .iter()
            .map(|source| (source.ast_node_id, source.name.clone(), Self::resolve_column(state, source, column_name)))
            .filter(|(_, _, resolution)| resolution.is_resolved())
            .collect();
        self.bind_qualified_column(state, expr, candidates, sources, column_name)
    }

    /// Bind a qualified column ref to the one column that its qualifier names. Without a column, the column ref is
    /// bound to the FROM items, its column is inferred for the first unresolved one.
    fn bind_qualified_column(
        &mut self,
        state: &mut AnalysisState,
        expr: ExprId,
        candidates: Vec<(u32, Option<Arc<str>>, ColumnResolution)>,
        sources: &[ScopeSource],
        column_name: &str,
    ) -> Lookup {
        match candidates.as_slice() {
            [] => {
                // The column of an unresolved table is inferred
                let owner = sources.iter().find_map(|source| match &source.table {
                    ReferencedTable::Unresolved(rel) => {
                        Some(InferenceCandidate { table_name: rel.table_name.clone(), table_ref: rel.table_ref })
                    }
                    _ => None,
                });
                self.finished_column_refs.insert(expr, FinishedColumnRef::Bound(owner));
                Lookup::Bound
            }
            [(source_node, _, resolution)] => {
                let (source_node, resolution) = (*source_node, *resolution);
                if let Some(column_ref) = state.out.expression_mut(expr).and_then(Expression::column_ref_mut) {
                    column_ref.resolved = resolution;
                    column_ref.resolved_source = Some(source_node);
                }
                Lookup::Resolved
            }
            _ => {
                let names: Vec<Option<Arc<str>>> = candidates.into_iter().map(|(_, name, _)| name).collect();
                self.report_ambiguous(state, expr, column_name, &names);
                Lookup::Ambiguous
            }
        }
    }

    /// The aliased joins of a scope that hide the FROM items inside them from an AST node: the outermost ones that
    /// don't contain the node
    fn hiding_joins(&self, state: &AnalysisState, scope: ScopeId, node_id: u32) -> Vec<ScopeJoin> {
        let Some(s) = state.out.scope(scope) else { return Vec::new() };
        s.hiding_joins(state.ast, node_id).into_iter().cloned().collect()
    }

    /// Is a FROM item inside one of some aliased joins?
    fn is_hidden(state: &AnalysisState, source: &ScopeSource, joins: &[ScopeJoin]) -> bool {
        joins.iter().any(|join| Self::is_within(state, source.ast_node_id, join.ast_node_id))
    }

    /// The columns of an aliased join with a name, as candidates of a column ref. A candidate is named by its FROM item,
    /// an ambiguous column ref lists the columns inside the join.
    fn join_alias_candidates(
        &self,
        state: &AnalysisState,
        scope: ScopeId,
        join: &ScopeJoin,
        column_name: &str,
    ) -> Vec<(u32, Option<Arc<str>>, ColumnResolution)> {
        let Some(s) = state.out.scope(scope) else { return Vec::new() };
        let mut candidates = Vec::new();
        for column in self.join_alias_columns(state, s, join) {
            if &*column.column.column_name.text != column_name {
                continue;
            }
            let Some(source) = s.sources.iter().find(|s| s.ast_node_id == column.source) else { continue };
            let resolution = Self::source_column(state, source, column.position);
            if resolution.is_resolved() {
                candidates.push((column.source, source.name.clone(), resolution));
            }
        }
        candidates
    }

    /// The column of a FROM item at a position
    fn source_column(state: &AnalysisState, source: &ScopeSource, position: u32) -> ColumnResolution {
        match &source.table {
            ReferencedTable::Table(loc) => ColumnResolution::TableColumn(ColumnLoc { table: *loc, column: position }),
            ReferencedTable::Cte(loc) => {
                let cte = state.out.scope(loc.scope).and_then(|s| s.cte_definitions.at(loc.index as usize));
                match cte.and_then(|cte| cte.child_scope) {
                    Some(scope) => ColumnResolution::ScopeColumn { scope, column: position },
                    None => ColumnResolution::Unresolved,
                }
            }
            ReferencedTable::Subquery(scope) => ColumnResolution::ScopeColumn { scope: *scope, column: position },
            ReferencedTable::Unresolved(_) => ColumnResolution::Unresolved,
        }
    }

    /// Resolve a column ref whose qualifier names an aliased join against the columns of the join
    fn resolve_join_alias_column(
        &mut self,
        state: &mut AnalysisState,
        expr: ExprId,
        scope: ScopeId,
        join: &ScopeJoin,
        column_name: &str,
    ) -> Lookup {
        let candidates = self.join_alias_candidates(state, scope, join, column_name);
        let Some(s) = state.out.scope(scope) else { return Lookup::Missing };
        let inner: Vec<ScopeSource> = s
            .sources
            .iter()
            .filter(|source| Self::is_within(state, source.ast_node_id, join.ast_node_id))
            .cloned()
            .collect();
        self.bind_qualified_column(state, expr, candidates, &inner, column_name)
    }

    /// Look up a column ref with more than two names as a column of a schema-qualified table, `s.t.a` or `d.s.t.a`.
    /// The longest qualifier that names a FROM item wins, None if none does.
    fn try_resolve_table_qualified_column(
        &mut self,
        state: &mut AnalysisState,
        expr: ExprId,
        target: ScopeId,
        visibility: SourceVisibility,
    ) -> Option<Lookup> {
        let path = self.column_paths.get(&expr)?.clone();
        let node_id = state.out.expression(expr)?.ast_node_id;
        let scope = state.out.scope(target)?;
        for qualifiers in (2..path.len().min(4)).rev() {
            let (Some(schema), Some(table), Some(column)) =
                (path.get(qualifiers - 2), path.get(qualifiers - 1), path.get(qualifiers))
            else {
                continue;
            };
            let database = path.first().filter(|_| qualifiers == 3);
            let names_table = |name: &QualifiedTableName| {
                name.table_name.text == table.text
                    && name.schema_name.text == schema.text
                    && database.is_none_or(|d| name.database_name.text == d.text)
            };
            let sources: Vec<ScopeSource> = scope
                .named_sources(state.ast, node_id, visibility, |s| s.table_name.as_ref().is_some_and(names_table))
                .into_iter()
                .cloned()
                .collect();
            if sources.is_empty() {
                continue;
            }
            // The column ref names the table and the column
            if let Some(database) = database {
                state.tag(database, NameTag::DATABASE_NAME);
            }
            state.tag(schema, NameTag::SCHEMA_NAME);
            state.tag(table, NameTag::TABLE_NAME);
            if let Some(column_ref) = state.out.expression_mut(expr).and_then(Expression::column_ref_mut) {
                column_ref.column_name.table_alias = Some(table.clone());
                column_ref.column_name.column_name = column.clone();
            }
            return Some(self.resolve_qualified_column(state, expr, &sources, &column.text));
        }
        None
    }

    /// Look up a column ref in the visible FROM items of a scope
    fn try_resolve_column_in_scope(
        &mut self,
        state: &mut AnalysisState,
        expr: ExprId,
        target: ScopeId,
        visibility: SourceVisibility,
    ) -> Lookup {
        let Some(expression) = state.out.expression(expr) else { return Lookup::Missing };
        let Some(column_ref) = expression.column_ref() else { return Lookup::Missing };
        let column_name = column_ref.column_name.column_name.text.clone();
        let alias = column_ref.column_name.table_alias.as_ref().map(|a| a.text.clone());
        let node_id = expression.ast_node_id;
        // The aliased joins that the column ref is outside of stand for the FROM items inside them
        let hiding: Vec<ScopeJoin> = self
            .hiding_joins(state, target, node_id)
            .into_iter()
            .filter(|join| visibility.sees_node(state.ast, join.ast_node_id))
            .collect();

        if let Some(alias) = alias {
            if let Some(lookup) = self.try_resolve_table_qualified_column(state, expr, target, visibility) {
                return lookup;
            }
            if let Some(join) = hiding.iter().find(|join| join.name == alias) {
                return self.resolve_join_alias_column(state, expr, target, join, &column_name);
            }
            let Some(scope) = state.out.scope(target) else { return Lookup::Missing };
            let sources: Vec<ScopeSource> = scope
                .named_sources(state.ast, node_id, visibility, |s| s.name.as_deref() == Some(&*alias))
                .into_iter()
                .cloned()
                .collect();
            return self.resolve_qualified_column(state, expr, &sources, &column_name);
        }

        // No table alias, scan all FROM items for the column and check for ambiguity
        let Some(scope) = state.out.scope(target) else { return Lookup::Missing };
        let mut candidates = Vec::new();
        for source in
            scope.sources.iter().filter(|s| visibility.sees(state.ast, s) && !Self::is_hidden(state, s, &hiding))
        {
            let resolution = Self::resolve_column(state, source, &column_name);
            if resolution.is_resolved() {
                candidates.push((source.ast_node_id, source.name.clone(), resolution));
            }
        }
        // An aliased join has the columns of its FROM items, a USING column once
        if !hiding.is_empty() {
            for join in &hiding {
                candidates.extend(self.join_alias_candidates(state, target, join, &column_name));
            }
            candidates.sort_by_key(|c| c.0);
        }
        let (source_node, resolution) = match candidates.as_slice() {
            [] => return Lookup::Missing,
            [(source_node, _, resolution)] => (*source_node, *resolution),
            // A USING column resolves to the column of the first input
            [(source_node, _, resolution), ..]
                if self.is_using_column(
                    state,
                    target,
                    &candidates.iter().map(|c| c.0).collect::<Vec<_>>(),
                    &column_name,
                ) =>
            {
                (*source_node, *resolution)
            }
            _ => {
                let names: Vec<Option<Arc<str>>> = candidates.into_iter().map(|(_, name, _)| name).collect();
                self.report_ambiguous(state, expr, &column_name, &names);
                return Lookup::Ambiguous;
            }
        };
        if let Some(column_ref) = state.out.expression_mut(expr).and_then(Expression::column_ref_mut) {
            column_ref.resolved = resolution;
            column_ref.resolved_source = Some(source_node);
        }
        Lookup::Resolved
    }

    /// Try to resolve a column ref against the output columns of a scope
    fn try_resolve_column_from_outputs(state: &mut AnalysisState, expr: ExprId, target: ScopeId) -> bool {
        let Some(column_ref) = state.out.expression(expr).and_then(Expression::column_ref) else { return false };
        if column_ref.column_name.table_alias.is_some() {
            return false;
        }
        let Some(scope) = state.out.scope(target) else { return false };
        match scope.output_columns_by_name.get(&column_ref.column_name.column_name.text) {
            Some(&column) => {
                let resolution = ColumnResolution::ScopeColumn { scope: target, column: column as u32 };
                match state.out.expression_mut(expr).and_then(Expression::column_ref_mut) {
                    Some(column_ref) => {
                        column_ref.resolved = resolution;
                        true
                    }
                    None => false,
                }
            }
            None => false,
        }
    }

    fn is_unresolved_column_ref(state: &AnalysisState, expr: ExprId) -> bool {
        state.out.expression(expr).and_then(Expression::column_ref).is_some_and(|c| !c.resolved.is_resolved())
    }

    /// Is a column ref unresolved, and may a lookup elsewhere still resolve it?
    fn is_open_column_ref(&self, state: &AnalysisState, expr: ExprId) -> bool {
        Self::is_unresolved_column_ref(state, expr) && !self.finished_column_refs.contains_key(&expr)
    }

    /// How a column ref sees the output columns of its scope
    fn output_names(state: &AnalysisState, expr: ExprId) -> OutputNames {
        match state.out.expression(expr) {
            Some(expression) => output_names_at(state.ast, expression.ast_node_id),
            None => OutputNames::Invisible,
        }
    }

    /// The clause of a bare column ref that may name an output column of its scope, see `output_name_clause_at`
    fn output_name_clause(state: &AnalysisState, expr: ExprId) -> Option<(OutputNames, &'static str)> {
        output_name_clause_at(state.ast, state.out.expression(expr)?.ast_node_id)
    }

    /// The FROM items of its own scope that a column ref sees, as the clauses of the scope publish them
    fn visibility(state: &AnalysisState, scope: ScopeId, expr: ExprId) -> SourceVisibility {
        match (state.out.scope(scope), state.out.expression(expr)) {
            (Some(scope), Some(expr)) => scope.visibility_at(state.ast, expr.ast_node_id),
            _ => SourceVisibility::All,
        }
    }

    /// Resolve column refs against the FROM items and the output columns of the own scope
    fn resolve_column_refs_locally(&mut self, state: &mut AnalysisState, scope: ScopeId) {
        let Some(exprs) = state.out.scope(scope).map(|s| s.expressions.clone()) else { return };
        for expr in exprs {
            if !Self::is_unresolved_column_ref(state, expr) {
                continue;
            }
            if let Some(&target) = self.assignment_targets.get(&expr) {
                self.resolve_assignment_target(state, expr, scope, target);
                continue;
            }
            match Self::output_names(state, expr) {
                OutputNames::Invisible => {
                    self.try_resolve_column_in_scope(state, expr, scope, Self::visibility(state, scope, expr));
                }
                OutputNames::Preferred => {
                    if !Self::try_resolve_column_from_outputs(state, expr, scope) {
                        self.try_resolve_column_in_scope(state, expr, scope, Self::visibility(state, scope, expr));
                    }
                }
                OutputNames::Fallback => {
                    if self.try_resolve_column_in_scope(state, expr, scope, Self::visibility(state, scope, expr))
                        == Lookup::Missing
                    {
                        Self::try_resolve_column_from_outputs(state, expr, scope);
                    }
                }
            }
        }
    }

    /// Do two output columns of one name read the same value? PostgreSQL compares their expressions: `select a, t.a`
    /// reads one column twice, `select a, b as a` two columns. Columns read through the same FROM item are the same,
    /// other expressions are the same if their texts are.
    fn same_output_value(state: &AnalysisState, left: &ScopeColumn, right: &ScopeColumn) -> bool {
        let column = |c: &ScopeColumn| match c.source {
            ScopeColumnSource::TableColumn(loc) => Some((ColumnResolution::TableColumn(loc), None)),
            ScopeColumnSource::Expression(expr) => state
                .out
                .expression(expr)
                .and_then(Expression::column_ref)
                .filter(|c| c.resolved.is_resolved())
                .map(|c| (c.resolved, c.resolved_source)),
            ScopeColumnSource::Computed => None,
        };
        if let (Some((l, l_source)), Some((r, r_source))) = (column(left), column(right)) {
            return l == r && (l_source.is_none() || r_source.is_none() || l_source == r_source);
        }
        let text = |c: &ScopeColumn| match c.source {
            ScopeColumnSource::Expression(expr) => {
                state.out.expression(expr).and_then(|e| e.location).map(|location| state.text_at(location))
            }
            _ => None,
        };
        text(left).is_some_and(|l| Some(l) == text(right))
    }

    /// Report a name in ORDER BY, DISTINCT ON or GROUP BY that names output columns of different values, as in PostgreSQL:
    /// `select a, b as a from t order by a` is ambiguous. The column ref stays unresolved.
    fn check_ambiguous_output_names(&mut self, state: &mut AnalysisState, scope: ScopeId) {
        let Some(s) = state.out.scope(scope) else { return };
        let mut ambiguous = Vec::new();
        for &expr in &s.expressions {
            let Some(column_ref) = state.out.expression(expr).and_then(Expression::column_ref) else { continue };
            let ColumnResolution::ScopeColumn { scope: target, column } = column_ref.resolved else { continue };
            let Some(first) = s.output_columns.get(column as usize).filter(|_| target == scope) else { continue };
            let name = &first.column_name.text;
            let mut others = s
                .output_columns
                .iter()
                .enumerate()
                .filter(|&(i, c)| i != column as usize && &c.column_name.text == name);
            if others.any(|(_, c)| !Self::same_output_value(state, first, c)) {
                ambiguous.push((expr, name.clone()));
            }
        }
        for (expr, name) in ambiguous {
            let clause = Self::output_name_clause(state, expr).map_or("ORDER BY", |(_, clause)| clause);
            let Some(expression) = state.out.expression_mut(expr) else { continue };
            let node_id = expression.ast_node_id;
            if let Some(column_ref) = expression.column_ref_mut() {
                column_ref.resolved = ColumnResolution::Unresolved;
            }
            let message = format!("{clause} {} is ambiguous", quote_identifier(&name));
            state.add_error(AnalyzerErrorType::COLUMN_REF_AMBIGUOUS, AnalyzerErrorSeverity::ERROR, node_id, message);
            self.finished_column_refs.insert(expr, FinishedColumnRef::Ambiguous);
        }
    }

    /// Resolve column refs by walking up the parent scopes
    fn resolve_column_refs_from_parents(&mut self, state: &mut AnalysisState, scope: ScopeId) {
        let Some(exprs) = state.out.scope(scope).map(|s| s.expressions.clone()) else { return };
        for expr in exprs {
            if self.is_open_column_ref(state, expr) {
                self.resolve_from_parent_chain(state, expr, scope);
            }
        }
    }

    /// Try the FROM items that a scope sees in its parent scopes, stopping at correlation barriers
    fn resolve_from_parent_chain(&mut self, state: &mut AnalysisState, expr: ExprId, scope: ScopeId) -> bool {
        let mut current = scope;
        loop {
            let Some(s) = state.out.scope(current) else { return false };
            let (Some(parent), false) = (s.parent_scope, s.column_correlation_barrier) else { return false };
            match self.try_resolve_column_in_scope(state, expr, parent, s.parent_visibility) {
                Lookup::Resolved => return true,
                Lookup::Ambiguous | Lookup::Bound => return false,
                Lookup::Missing => current = parent,
            }
        }
    }

    /// Attach parsed CTE definitions to a scope
    fn attach_ctes(state: &mut AnalysisState, scope: ScopeId, ctes: Vec<CteDefinition>) {
        for cte in ctes {
            let Some(&child_scope) = state.out.name_scopes_by_root_node.get(&cte.select_node_id) else { continue };
            // A CTE cannot correlate with the FROM items of the statement it is attached to
            if let Some(child) = state.out.scope_mut(child_scope) {
                child.parent_visibility = SourceVisibility::None;
            }
            let mut column_aliases = Vec::new();
            if let Some(columns) = cte.columns_node_id.filter(|_| cte.columns_count > 0).and_then(|id| state.node(id)) {
                let begin = columns.children_begin_or_value() as usize;
                for column in state.ast.get(begin..begin + cte.columns_count as usize).unwrap_or_default() {
                    if column.node_type() == NodeType::NAME {
                        column_aliases.push(state.node_name(column));
                    }
                }
            }
            let definition = ResolvedCte {
                cte_name: cte.cte_name.clone(),
                child_scope: Some(child_scope),
                definition_node_id: cte.ast_node_id,
                column_aliases,
            };
            // A name that the WITH clause defines twice is an error as in PostgreSQL, the first definition stays. Both
            // are an alias that is taken, SQLSTATE 42712.
            if state.out.scope(scope).is_some_and(|s| s.cte_definitions.get_index(&cte.cte_name.text).is_some()) {
                let message =
                    format!("WITH query name {} specified more than once", quote_identifier(&cte.cte_name.text));
                state.add_error(
                    AnalyzerErrorType::DUPLICATE_TABLE_ALIAS,
                    AnalyzerErrorSeverity::ERROR,
                    cte.ast_node_id,
                    message,
                );
                continue;
            }
            let Some(s) = state.out.scope_mut(scope) else { continue };
            s.cte_definitions.insert(cte.cte_name.text.clone(), definition);
            s.cte_definition_nodes.entry(cte.cte_name.text.clone()).or_insert(cte.ast_node_id);
        }
    }

    /// Look up a FROM item by name in a scope and in the parent scopes it sees, from an AST node that sees some FROM
    /// items of its own scope. An aliased join hides the names of the FROM items inside it.
    fn lookup_source_in_scope_chain<'s>(
        state: &'s AnalysisState,
        scope: ScopeId,
        name: &str,
        node_id: u32,
        mut visibility: SourceVisibility,
    ) -> Option<&'s ScopeSource> {
        let mut current = scope;
        loop {
            let s = state.out.scope(current)?;
            let named = s.named_sources(state.ast, node_id, visibility, |x| x.name.as_deref() == Some(name));
            if let Some(&source) = named.first() {
                return Some(source);
            }
            let (Some(parent), false) = (s.parent_scope, s.column_correlation_barrier) else { return None };
            visibility = s.parent_visibility;
            current = parent;
        }
    }

    /// The message of an invalid reference to a FROM item that a qualifier names, but that an AST node doesn't see,
    /// in a scope and in the parent scopes it sees, as in PostgreSQL. An aliased join hides the FROM items and the
    /// aliased joins inside it, the alias names them. A clause, a lateral FROM item and a FROM item of UPDATE, DELETE
    /// and MERGE see only some FROM items. A derived table without LATERAL and a CTE see none of their parent scope, a
    /// qualifier of them is no invalid reference.
    fn invalid_from_clause_reference(
        state: &AnalysisState,
        scope: ScopeId,
        name: &str,
        node_id: u32,
        mut visibility: SourceVisibility,
    ) -> Option<String> {
        let table = quote_identifier(name);
        let mut current = scope;
        loop {
            let s = state.out.scope(current)?;
            let hiding = s.hiding_joins(state.ast, node_id);
            let sources = s.sources.iter().filter(|x| x.name.as_deref() == Some(name)).map(|x| x.ast_node_id);
            let joins = s.joins.iter().filter(|join| &*join.name == name).map(|join| join.ast_node_id);
            for item in sources.chain(joins) {
                let join = hiding
                    .iter()
                    .find(|join| join.ast_node_id != item && Self::is_within(state, item, join.ast_node_id));
                match join {
                    Some(join) if visibility.sees_node(state.ast, join.ast_node_id) => {
                        let alias = quote_identifier(&join.name);
                        return Some(format!(
                            "invalid reference to FROM-clause entry for table {table}, use the alias {alias} of its join"
                        ));
                    }
                    _ if visibility != SourceVisibility::None && !visibility.sees_node(state.ast, item) => {
                        return Some(format!(
                            "invalid reference to FROM-clause entry for table {table}, it cannot be referenced from this \
                             part of the query"
                        ));
                    }
                    _ => {}
                }
            }
            let (Some(parent), false) = (s.parent_scope, s.column_correlation_barrier) else { return None };
            visibility = s.parent_visibility;
            current = parent;
        }
    }

    /// Resolve the unqualified column refs that name no column, but a FROM item, as the whole row of the FROM item, as
    /// in PostgreSQL: `select t from t`. A column of the name wins, also one of a parent scope. A FROM item with an
    /// unknown schema may have the column, its column is inferred.
    fn resolve_whole_rows(&mut self, state: &mut AnalysisState, scope: ScopeId) {
        let Some(exprs) = state.out.scope(scope).map(|s| s.expressions.clone()) else { return };
        for expr in exprs {
            if !self.is_open_column_ref(state, expr) {
                continue;
            }
            let Some(expression) = state.out.expression(expr) else { continue };
            let node_id = expression.ast_node_id;
            let Some(column_ref) = expression.column_ref().filter(|c| c.column_name.table_alias.is_none()) else {
                continue;
            };
            // `t.` is a qualifier without its column yet
            if Self::has_trailing_dot(state, node_id) {
                continue;
            }
            let name = column_ref.column_name.column_name.clone();
            let visibility = Self::visibility(state, scope, expr);
            let source = Self::lookup_source_in_scope_chain(state, scope, &name.text, node_id, visibility)
                .filter(|source| !source.table.is_unresolved_relation())
                .map(|source| source.ast_node_id);
            let Some(source) = source else { continue };
            if let Some(column_ref) = state.out.expression_mut(expr).and_then(Expression::column_ref_mut) {
                column_ref.resolved = ColumnResolution::WholeRow;
                column_ref.resolved_source = Some(source);
            }
            state.tag(&name, NameTag::TABLE_ALIAS);
        }
    }

    /// Does the path of a column ref end with a dot?
    fn has_trailing_dot(state: &AnalysisState, node_id: u32) -> bool {
        let [path] = state.node(node_id).map_or([None], |n| attrs!(state.children(n), [K::SQL_COLUMN_REF_PATH]));
        let path = path.map(|p| state.children(p)).unwrap_or_default();
        path.iter().any(|n| n.node_type() == NodeType::OBJECT_EXT_TRAILING_DOT)
    }

    /// Resolve qualified column refs whose qualifier is not a table in scope as field accesses of
    /// row-typed columns
    fn resolve_row_field_accesses(&mut self, state: &mut AnalysisState, scope: ScopeId) {
        let Some(exprs) = state.out.scope(scope).map(|s| s.expressions.clone()) else { return };
        for expr in exprs {
            // A qualifier that names a FROM item is no column
            if !self.is_open_column_ref(state, expr) {
                continue;
            }
            let Some(expression) = state.out.expression(expr) else { continue };
            let node_id = expression.ast_node_id;
            let Some(column_ref) = expression.column_ref() else { continue };
            let Some(qualifier) = column_ref.column_name.table_alias.clone() else { continue };
            let visibility = Self::visibility(state, scope, expr);
            if Self::lookup_source_in_scope_chain(state, scope, &qualifier.text, node_id, visibility).is_some() {
                continue;
            }
            // In p.x, p is not a table in scope but may be a row-typed column with a field x
            let qualified = column_ref.column_name.clone();
            let Some(column_ref) = state.out.expression_mut(expr).and_then(Expression::column_ref_mut) else {
                continue;
            };
            column_ref.column_name.table_alias = None;
            column_ref.column_name.column_name = qualifier.clone();
            let resolved = self.try_resolve_column_in_scope(state, expr, scope, Self::visibility(state, scope, expr))
                == Lookup::Resolved
                || self.resolve_from_parent_chain(state, expr, scope);
            if resolved {
                state.tag(&qualifier, NameTag::COLUMN_NAME);
                continue;
            }
            if let Some(column_ref) = state.out.expression_mut(expr).and_then(Expression::column_ref_mut) {
                column_ref.column_name = qualified;
            }
            // The qualifier names a FROM item that the column ref doesn't see, as in PostgreSQL the column ref is an
            // error and its column is not inferred
            if let Some(message) =
                Self::invalid_from_clause_reference(state, scope, &qualifier.text, node_id, visibility)
            {
                state.add_error(
                    AnalyzerErrorType::INVALID_FROM_CLAUSE_REFERENCE,
                    AnalyzerErrorSeverity::ERROR,
                    node_id,
                    message,
                );
                self.finished_column_refs.insert(expr, FinishedColumnRef::Bound(None));
            }
        }
    }

    /// Associate still-unresolved column refs with unresolved tables in scope
    fn associate_unresolved_columns(&self, state: &mut AnalysisState, scope: ScopeId) {
        let Some(s) = state.out.scope(scope) else { return };
        // The unresolved relations of this scope in FROM order
        let local_unresolved: Vec<(u32, InferenceCandidate)> = s
            .sources
            .iter()
            .filter_map(|source| match &source.table {
                ReferencedTable::Unresolved(rel) => Some((
                    source.ast_node_id,
                    InferenceCandidate { table_name: rel.table_name.clone(), table_ref: rel.table_ref },
                )),
                _ => None,
            })
            .collect();

        for expr in s.expressions.clone() {
            let Some(expression) = state.out.expression(expr) else { continue };
            let Some(column_ref) = expression.column_ref() else { continue };
            if column_ref.resolved.is_resolved() || column_ref.inferred.is_some() {
                continue;
            }
            let column_name = column_ref.column_name.column_name.clone();
            let bound = match self.finished_column_refs.get(&expr) {
                Some(FinishedColumnRef::Bound(owner)) => Some(owner),
                _ => None,
            };
            let constraint = match &column_ref.column_name.table_alias {
                // The qualifier names a FROM item without the column, or the column is written to a target without it,
                // the column belongs to an unresolved one
                _ if bound.is_some() => {
                    let Some(Some(owner)) = bound else { continue };
                    InferenceConstraint {
                        kind: InferenceConstraintKind::Forced,
                        expression_id: Some(expression.expression_id),
                        column_name,
                        candidates: vec![owner.clone()],
                    }
                }
                // Alias-qualified, the owner is pinned to whatever the alias refers to
                Some(alias) => {
                    let Some(ReferencedTable::Unresolved(rel)) = Self::lookup_source_in_scope_chain(
                        state,
                        scope,
                        &alias.text,
                        expression.ast_node_id,
                        Self::visibility(state, scope, expr),
                    )
                    .map(|s| &s.table) else {
                        continue;
                    };
                    InferenceConstraint {
                        kind: InferenceConstraintKind::Forced,
                        expression_id: Some(expression.expression_id),
                        column_name,
                        candidates: vec![InferenceCandidate {
                            table_name: rel.table_name.clone(),
                            table_ref: rel.table_ref,
                        }],
                    }
                }
                // Unqualified, the candidates are the unresolved tables in scope that the column ref sees
                None => {
                    let visibility = Self::visibility(state, scope, expr);
                    let mut candidates: Vec<(u32, InferenceCandidate)> = local_unresolved
                        .iter()
                        .filter(|(node_id, _)| visibility.sees_node(state.ast, *node_id))
                        .cloned()
                        .collect();
                    if candidates.is_empty() {
                        continue;
                    }
                    // A USING column of a join is the column of its first input, all inputs have it
                    let nodes: Vec<u32> = candidates.iter().map(|(node_id, _)| *node_id).collect();
                    if let Some(first) = self.using_join_first_input(state, scope, &nodes, &column_name.text) {
                        candidates.retain(|(node_id, _)| Self::is_within(state, *node_id, first));
                    }
                    let candidates: Vec<InferenceCandidate> =
                        candidates.into_iter().map(|(_, candidate)| candidate).collect();
                    InferenceConstraint {
                        kind: if candidates.len() == 1 {
                            InferenceConstraintKind::Forced
                        } else {
                            InferenceConstraintKind::Disjunctive
                        },
                        expression_id: Some(expression.expression_id),
                        column_name,
                        candidates,
                    }
                }
            };
            state.out.inference_constraints.push(constraint);
        }
        self.associate_using_columns(state, scope);
    }

    /// The USING columns of a join are columns of both of its inputs: an input without a FROM item that has the column
    /// gives it to its unresolved FROM items, to the one or to one of them
    fn associate_using_columns(&self, state: &mut AnalysisState, scope: ScopeId) {
        let (Some(s), Some(joins)) = (state.out.scope(scope), self.using_joins.get(&scope)) else { return };
        let mut constraints = Vec::new();
        for join in joins {
            let Some(using) = &join.using else { continue };
            let [inputs] =
                state.node(join.ast_node_id).map_or([None], |n| attrs!(state.children(n), [K::SQL_JOIN_INPUT]));
            for input in inputs.map(|i| state.children(i)).unwrap_or_default() {
                let input = state.node_id(input);
                let sources: Vec<&ScopeSource> =
                    s.sources.iter().filter(|source| Self::is_within(state, source.ast_node_id, input)).collect();
                for column in using {
                    if sources.iter().any(|source| Self::resolve_column(state, source, &column.text).is_resolved()) {
                        continue;
                    }
                    let candidates: Vec<InferenceCandidate> = sources
                        .iter()
                        .filter_map(|source| match &source.table {
                            ReferencedTable::Unresolved(rel) => Some(InferenceCandidate {
                                table_name: rel.table_name.clone(),
                                table_ref: rel.table_ref,
                            }),
                            _ => None,
                        })
                        .collect();
                    let kind = match candidates.len() {
                        0 => continue,
                        1 => InferenceConstraintKind::Forced,
                        _ => InferenceConstraintKind::Disjunctive,
                    };
                    constraints.push(InferenceConstraint {
                        kind,
                        expression_id: None,
                        column_name: column.clone(),
                        candidates,
                    });
                }
            }
        }
        state.out.inference_constraints.extend(constraints);
    }

    /// The columns of a FROM item, as a star forwards them
    fn source_columns(state: &AnalysisState, source: &ScopeSource) -> Vec<ScopeColumn> {
        let scope_columns =
            |scope: ScopeId| state.out.scope(scope).map(|s| s.output_columns.clone()).unwrap_or_default();
        let mut columns = match &source.table {
            ReferencedTable::Table(loc) => match state.table(*loc) {
                Some(table) => table
                    .table_columns
                    .iter()
                    .enumerate()
                    .map(|(ci, column)| ScopeColumn {
                        column_name: column.column_name.clone(),
                        source: ScopeColumnSource::TableColumn(ColumnLoc { table: *loc, column: ci as u32 }),
                    })
                    .collect(),
                None => Vec::new(),
            },
            // An unresolved relation has an unknown schema
            ReferencedTable::Unresolved(_) => Vec::new(),
            ReferencedTable::Cte(loc) => {
                match state.out.scope(loc.scope).and_then(|s| s.cte_definitions.at(loc.index as usize)) {
                    Some(cte) => {
                        let mut columns = cte.child_scope.map(scope_columns).unwrap_or_default();
                        for (column, alias) in columns.iter_mut().zip(&cte.column_aliases) {
                            column.column_name = alias.clone();
                        }
                        columns
                    }
                    None => Vec::new(),
                }
            }
            ReferencedTable::Subquery(child) => scope_columns(*child),
        };
        for (column, alias) in columns.iter_mut().zip(&source.column_aliases) {
            column.column_name = alias.clone();
        }
        columns
    }

    /// The columns of an unqualified star: the columns of the FROM items in FROM order, a join with USING or NATURAL
    /// has its join columns once, before the other columns of its inputs. RETURNING of UPDATE, DELETE and MERGE lists
    /// the target first, then the relations that they read, as in PostgreSQL.
    fn star_columns(&self, state: &AnalysisState, scope: &NameScope) -> Vec<ScopeColumn> {
        let node = state.node(scope.ast_node_id);
        let [update_target, delete_target, merge_target] = node.map_or([None; 3], |node| {
            attrs!(state.children(node), [K::SQL_UPDATE_TARGET, K::SQL_DELETE_TARGET, K::SQL_MERGE_TARGET])
        });
        let target = update_target.or(delete_target).or(merge_target).map(|t| state.node_id(t));
        // The `excluded` row of ON CONFLICT is no FROM item
        let flat = || {
            let sources = scope.sources.iter().filter(|s| !Self::is_insert_excluded(state, s));
            let (targets, reads): (Vec<_>, Vec<_>) = sources.partition(|s| Some(s.ast_node_id) == target);
            targets.into_iter().chain(reads).flat_map(|source| Self::source_columns(state, source)).collect()
        };
        let Some(node) = node else { return flat() };
        let [from] = attrs!(state.children(node), [K::SQL_SELECT_FROM]);
        let Some(from) = from.filter(|n| n.node_type() == NodeType::ARRAY) else { return flat() };
        let mut columns = Vec::new();
        let mut covered = 0;
        for item in state.children(from) {
            columns.extend(self.columns_of_from_item(state, scope, item, &mut covered).into_iter().map(|c| c.column));
        }
        // A FROM item outside of the join trees, forward the FROM items in order
        if covered != scope.sources.len() {
            return flat();
        }
        columns
    }

    /// The columns of an aliased join
    fn join_alias_columns(&self, state: &AnalysisState, scope: &NameScope, join: &ScopeJoin) -> Vec<ScopeJoinColumn> {
        let Some(item) = state.node(join.ast_node_id) else { return Vec::new() };
        self.columns_of_from_item(state, scope, item, &mut 0)
    }

    /// The columns of a FROM item or a join, counting the FROM items it covers
    fn columns_of_from_item(
        &self,
        state: &AnalysisState,
        scope: &NameScope,
        item: &Node,
        covered: &mut usize,
    ) -> Vec<ScopeJoinColumn> {
        let item_id = state.node_id(item);
        if item.node_type() != NodeType::OBJECT_SQL_JOINED_TABLE {
            if let Some(source) = scope.sources.iter().find(|s| s.ast_node_id == item_id) {
                *covered += 1;
                let columns = Self::source_columns(state, source).into_iter().zip(0..);
                let columns = columns.map(|(column, position)| ScopeJoinColumn { source: item_id, position, column });
                return columns.collect();
            }
            // A parenthesized join, its column aliases rename the leading columns
            let [table] = attrs!(state.children(item), [K::SQL_TABLEREF_TABLE]);
            let Some(join) = table.filter(|t| t.node_type() == NodeType::OBJECT_SQL_JOINED_TABLE) else {
                return Vec::new();
            };
            let mut columns = self.columns_of_from_item(state, scope, join, covered);
            if let Some(alias) = scope.joins.iter().find(|alias| alias.ast_node_id == item_id) {
                for (column, name) in columns.iter_mut().zip(&alias.column_aliases) {
                    column.column.column_name = name.clone();
                }
            }
            return columns;
        }
        let joins = self.using_joins.get(&scope.name_scope_id).map(Vec::as_slice).unwrap_or_default();
        let [inputs] = attrs!(state.children(item), [K::SQL_JOIN_INPUT]);
        let Some(inputs) = inputs.filter(|n| n.node_type() == NodeType::ARRAY) else { return Vec::new() };
        let mut sides =
            state.children(inputs).iter().map(|input| self.columns_of_from_item(state, scope, input, covered));
        let (Some(left), Some(right)) = (sides.next(), sides.next()) else { return Vec::new() };
        let name = |c: &ScopeJoinColumn| c.column.column_name.text.clone();
        let join_columns: Vec<Arc<str>> = match joins.iter().find(|join| join.ast_node_id == item_id) {
            Some(UsingJoin { using: Some(using), .. }) => using.iter().map(|c| c.text.clone()).collect(),
            // NATURAL joins the columns that both inputs have, in the order of the left input
            Some(UsingJoin { using: None, .. }) => left
                .iter()
                .map(name)
                .filter(|n| !n.is_empty() && right.iter().any(|r| r.column.column_name.text == *n))
                .collect(),
            None => Vec::new(),
        };
        if join_columns.is_empty() {
            return left.into_iter().chain(right).collect();
        }
        // A join column is the column of the left input
        let mut columns = Vec::new();
        let (mut left_used, mut right_used) = (vec![false; left.len()], vec![false; right.len()]);
        for join_column in &join_columns {
            let l = left.iter().zip(&left_used).position(|(c, used)| !used && name(c) == *join_column);
            let r = right.iter().zip(&right_used).position(|(c, used)| !used && name(c) == *join_column);
            if let Some(used) = r.and_then(|r| right_used.get_mut(r)) {
                *used = true;
            }
            match (l, r) {
                (Some(l), _) => {
                    if let Some(used) = left_used.get_mut(l) {
                        *used = true;
                    }
                    columns.extend(left.get(l).cloned());
                }
                (None, Some(r)) => columns.extend(right.get(r).cloned()),
                (None, None) => {}
            }
        }
        columns.extend(left.iter().zip(&left_used).filter(|(_, used)| !**used).map(|(c, _)| c.clone()));
        columns.extend(right.iter().zip(&right_used).filter(|(_, used)| !**used).map(|(c, _)| c.clone()));
        columns
    }

    /// Populate the output columns of a scope from its result targets
    fn populate_output_columns(&self, state: &mut AnalysisState, scope: ScopeId) {
        let mut columns = Vec::new();
        let Some(scope_node) = state.out.scope(scope).and_then(|s| state.node(s.ast_node_id)) else { return };
        let [combine_inputs, values] = attrs!(state.children(scope_node), [K::SQL_COMBINE_INPUT, K::SQL_SELECT_VALUES]);
        if let Some(combine_inputs) = combine_inputs.filter(|n| n.children_count() > 0) {
            // Set operations expose the column names of the left input
            let left = state.out.name_scopes_by_root_node.get(&combine_inputs.children_begin_or_value());
            if let Some(left) = left.and_then(|&left| state.out.scope(left)) {
                columns = left.output_columns.clone();
            }
        }
        // The columns of VALUES are unnamed, aliases of a derived table can name them
        if let Some(row) = values.and_then(|v| state.children(v).first()).filter(|r| r.node_type() == NodeType::ARRAY) {
            for value in state.children(row) {
                columns.push(ScopeColumn {
                    column_name: state.empty_name(),
                    source: match state.expression_of(state.node_id(value)) {
                        Some(expr) => ScopeColumnSource::Expression(expr),
                        None => ScopeColumnSource::Computed,
                    },
                });
            }
        }
        let Some(s) = state.out.scope_mut(scope) else { return };
        let mut result_targets = std::mem::take(&mut s.result_targets);
        // The star qualifiers that name a FROM item that they don't see
        let mut invalid = Vec::new();
        for rt in result_targets.iter_mut() {
            if rt.is_star {
                // Forward the columns of all FROM items, or of the qualified one
                let Some(s) = state.out.scope(scope) else { continue };
                match &rt.star_qualifier {
                    Some(q) => {
                        // An aliased join names the FROM items inside it, RETURNING doesn't see the excluded row of
                        // ON CONFLICT
                        let visibility = s.visibility_at(state.ast, rt.ast_node_id);
                        let named = s.named_sources(state.ast, rt.ast_node_id, visibility, |x| {
                            x.name.as_deref() == Some(q.text())
                        });
                        let hiding = self.hiding_joins(state, scope, rt.ast_node_id);
                        let joins: Vec<&ScopeJoin> = hiding.iter().filter(|join| &*join.name == q.text()).collect();
                        if named.is_empty() && joins.is_empty() {
                            invalid.extend(
                                Self::invalid_from_clause_reference(state, scope, q.text(), rt.ast_node_id, visibility)
                                    .map(|message| (rt.ast_node_id, message)),
                            );
                        }
                        for source in named {
                            columns.extend(Self::source_columns(state, source));
                        }
                        for join in joins {
                            columns.extend(self.join_alias_columns(state, s, join).into_iter().map(|c| c.column));
                        }
                    }
                    None => columns.extend(self.star_columns(state, s)),
                }
                continue;
            }
            let mut expr = rt.expression_id;
            if let (None, Some(rt_node)) = (expr, state.node(rt.ast_node_id)) {
                let [value] = attrs!(state.children(rt_node), [K::SQL_RESULT_TARGET_VALUE]);
                if let Some(value) = value {
                    expr = state.expression_of(state.node_id(value));
                    rt.expression_id = expr;
                }
            }
            columns.push(ScopeColumn {
                column_name: rt.column_name.clone().unwrap_or_else(|| state.empty_name()),
                // Computed columns keep their position for column aliases
                source: match expr {
                    Some(expr) => ScopeColumnSource::Expression(expr),
                    None => ScopeColumnSource::Computed,
                },
            });
        }
        for (node_id, message) in invalid {
            state.add_error(
                AnalyzerErrorType::INVALID_FROM_CLAUSE_REFERENCE,
                AnalyzerErrorSeverity::ERROR,
                node_id,
                message,
            );
        }
        let Some(s) = state.out.scope_mut(scope) else { return };
        s.result_targets = result_targets;
        // A name refers to its first column, references to later ones would be ambiguous
        for column in columns {
            if !column.column_name.text.is_empty() {
                s.output_columns_by_name.entry(column.column_name.text.clone()).or_insert(s.output_columns.len());
            }
            s.output_columns.push(column);
        }
    }

    /// Resolve all names. The statements resolve in order, a statement reads the tables and views with the columns
    /// that the statements before it derive.
    fn resolve_names(&mut self, state: &mut AnalysisState) {
        let mut roots = self.root_scopes.values.clone();
        let statement_of =
            |state: &AnalysisState, scope: ScopeId| state.out.scope(scope).and_then(|s| s.ast_statement_id);
        // The sort is stable, the roots of a statement keep their order
        roots.sort_by_key(|&root| statement_of(state, root).unwrap_or(u32::MAX));
        // The tables that a statement derives, in the order of the statements of their SELECTs
        let defining_statement = |state: &AnalysisState, table: &PendingDerivedTable| {
            state.out.name_scopes_by_root_node.get(&table.select_node_id).and_then(|&scope| statement_of(state, scope))
        };
        let mut pending = std::mem::take(&mut self.pending_derived_tables);
        pending.sort_by_key(|table| defining_statement(state, table).unwrap_or(u32::MAX));
        let mut pending = pending.into_iter().peekable();
        let mut begin = 0;
        while let Some(&first) = roots.get(begin) {
            let statement = statement_of(state, first);
            let end = roots
                .iter()
                .skip(begin)
                .position(|&root| statement_of(state, root) != statement)
                .map_or(roots.len(), |n| begin + n);
            self.resolve_roots(state, roots.get(begin..end).unwrap_or_default());
            begin = end;
            // The tables that the statements so far derive get their columns
            let Some(statement) = statement else { continue };
            while let Some(table) =
                pending.next_if(|table| defining_statement(state, table).is_some_and(|s| s <= statement))
            {
                self.derive_table(state, &table);
            }
        }
        for table in pending {
            self.derive_table(state, &table);
        }

        // Pass 3: associate the remaining unresolved columns with unresolved tables, in scope order
        for scope in 0..state.out.name_scopes.len() {
            self.associate_unresolved_columns(state, scope as ScopeId);
        }
    }

    /// Publish the columns of the aliased joins, after the FROM items inside them are resolved
    fn publish_join_columns(&self, state: &mut AnalysisState) {
        for scope in 0..state.out.name_scopes.len() {
            let Some(s) = state.out.name_scopes.get(scope).filter(|s| !s.joins.is_empty()) else { continue };
            let columns: Vec<Vec<ScopeJoinColumn>> =
                s.joins.iter().map(|join| self.join_alias_columns(state, s, join)).collect();
            if let Some(s) = state.out.name_scopes.get_mut(scope) {
                for (join, columns) in s.joins.iter_mut().zip(columns) {
                    join.columns = columns;
                }
            }
        }
    }

    /// Derive the columns of a table or view from its SELECT, then apply the `ALTER` statements that wait for them
    fn derive_table(&mut self, state: &mut AnalysisState, pending: &PendingDerivedTable) {
        if let Some(&scope) = state.out.name_scopes_by_root_node.get(&pending.select_node_id) {
            Self::populate_derived_table(state, pending, scope);
        }
        for &(table, action) in &self.pending_alters {
            if table != pending.table {
                continue;
            }
            if let Some(action) = state.node(action) {
                Self::apply_column_action(state, table, action);
            }
        }
    }

    /// Resolve the names of the scopes below some root scopes
    fn resolve_roots(&mut self, state: &mut AnalysisState, roots: &[ScopeId]) {
        // Pass 1, bottom-up: resolve the table refs, populate the output columns for the parent, then
        // resolve the column refs against the own scope
        let mut dfs: Vec<(ScopeId, bool)> = roots.iter().map(|&r| (r, false)).collect();
        while let Some(top) = dfs.last_mut() {
            let scope = top.0;
            if !top.1 {
                top.1 = true;
                // Push children in reverse order so that earlier siblings are processed first
                if let Some(s) = state.out.scope(scope) {
                    dfs.extend(s.child_scopes.iter().rev().map(|&c| (c, false)));
                }
            } else {
                dfs.pop();
                self.resolve_table_refs_in_scope(state, scope);
                self.add_insert_excluded(state, scope);
                self.check_join_alias_names(state, scope);
                self.populate_output_columns(state, scope);
                self.resolve_column_refs_locally(state, scope);
                self.check_ambiguous_output_names(state, scope);
            }
        }

        // Pass 2, top-down: resolve the remaining column refs through the parent scopes
        let mut dfs: Vec<ScopeId> = roots.to_vec();
        while let Some(scope) = dfs.pop() {
            // Recursive CTE outputs are available only after the bottom-up pass, a ref that its qualifier bound to a
            // recursive CTE resolves now. An ambiguous ref stays reported, a written column binds to its target only.
            for expr in state.out.scope(scope).map(|s| s.expressions.clone()).unwrap_or_default() {
                let ambiguous = matches!(self.finished_column_refs.get(&expr), Some(FinishedColumnRef::Ambiguous));
                let written = self.assignment_targets.contains_key(&expr);
                if Self::is_unresolved_column_ref(state, expr) && !ambiguous && !written {
                    self.try_resolve_column_in_scope(state, expr, scope, Self::visibility(state, scope, expr));
                }
            }
            self.resolve_column_refs_from_parents(state, scope);
            self.resolve_whole_rows(state, scope);
            self.resolve_row_field_accesses(state, scope);
            if let Some(s) = state.out.scope(scope) {
                dfs.extend(s.child_scopes.iter().copied());
            }
        }
    }

    /// Is the node nested inside syntax-only property graph syntax?
    fn is_inside_graph_syntax(&self, state: &AnalysisState, ast_node_id: u32) -> bool {
        if !self.has_graph_syntax {
            return false;
        }
        let mut node_id = ast_node_id;
        for _ in 0..state.ast.len() {
            let Some(node) = state.node(node_id) else { return false };
            let parent = node.parent();
            let Some(parent_node) = state.node(parent) else { return false };
            match parent_node.node_type() {
                NodeType::OBJECT_SQL_PROPERTY_GRAPH | NodeType::OBJECT_SQL_GRAPH_TABLE => return true,
                // Statement roots are their own parents
                _ if parent == node_id => return false,
                _ => node_id = parent,
            }
        }
        false
    }

    pub fn visit(&mut self, state: &mut AnalysisState, morsel: Range<usize>) {
        for node_id in morsel {
            // The node states have one entry per node of the AST
            let (Some(node), Some(slot)) = (state.ast.get(node_id), self.node_states.get_mut(node_id)) else { break };
            let mut node_state = std::mem::take(slot);
            self.visit_node(state, node, node_id as u32, &mut node_state);
            if let Some(slot) = self.node_states.get_mut(node_id) {
                *slot = node_state;
            }
        }
    }

    fn visit_node(&mut self, state: &mut AnalysisState, node: &Node, node_id: u32, node_state: &mut NodeState) {
        match node.node_type() {
            NodeType::OBJECT_SQL_COLUMN_DEF => {
                if let Some(parent) = state.node(node.parent()) {
                    // Fields of descriptors and row types are not table columns
                    let key = parent.attribute_key();
                    if key == K::SQL_DESCRIPTOR_COLUMNS || key == K::SQL_ROW_TYPE_FIELDS {
                        return;
                    }
                }
                // The column refs of a column constraint, `b int check (b > 0)`, read the columns of the table
                self.merge_child_states(node_state, node);
                let [name, column_type] =
                    attrs!(state.children(node), [K::SQL_COLUMN_DEF_NAME, K::SQL_COLUMN_DEF_TYPE]);
                if let Some(name) = name.filter(|n| n.node_type() == NodeType::NAME) {
                    let name = state.node_name(name);
                    state.tag(&name, NameTag::COLUMN_NAME);
                    node_state.table_columns.push(PendingColumn {
                        ast_node_id: node_id,
                        column_name: name,
                        column_type: column_type
                            .and_then(|t| read_sql_type(state.parsed, t))
                            .map(|t| Arc::from(t.to_string())),
                    });
                }
            }

            NodeType::OBJECT_SQL_COLUMN_REF => {
                if self.is_inside_graph_syntax(state, node_id) {
                    return;
                }
                // The qualifier of t.* names a FROM item, the result target reads it
                if Self::is_star_qualifier(state, node) {
                    return;
                }
                let [path] = attrs!(state.children(node), [K::SQL_COLUMN_REF_PATH]);
                let names: Vec<Name> = path
                    .map(|p| state.read_name_path(p))
                    .unwrap_or_default()
                    .into_iter()
                    .map(|id| state.name(id))
                    .collect();
                if let Some(column_name) = path.and_then(|p| state.qualified_column_name(p, &names)) {
                    let column_ref = ColumnRef {
                        column_name,
                        ast_scope_root: None,
                        resolved: ColumnResolution::Unresolved,
                        resolved_source: None,
                        resolved_ids: None,
                        inferred: None,
                    };
                    let expr =
                        state.add_expression(node_id, *node.symbol_span(), ExpressionInner::ColumnRef(column_ref));
                    node_state.column_references.push(expr);
                    // More than two names may qualify the column with the schema of its table
                    if names.len() > 2 {
                        self.column_paths.insert(expr, names);
                    }
                    state.set_expression_of(node_id, expr);
                    state.mark(node_id, SemanticNodeMarkerType::COLUMN_REFERENCE);
                }
                // Column refs may be recursive
                self.merge_child_states(node_state, node);
            }

            NodeType::OBJECT_SQL_TABLEREF => {
                if self.is_inside_graph_syntax(state, node_id) {
                    return;
                }
                let [name_node, alias_node, table_node, lateral] = attrs!(
                    state.children(node),
                    [K::SQL_TABLEREF_NAME, K::SQL_TABLEREF_ALIAS, K::SQL_TABLEREF_TABLE, K::SQL_TABLEREF_LATERAL,]
                );
                if let Some(name) = state.read_qualified_table_name(name_node) {
                    let (alias, column_aliases) = Self::read_alias(state, alias_node);
                    let id = state.out.table_references.len() as TableRefId;
                    state.out.table_references.push(TableReference {
                        table_reference_id: ExternalObjectId::new(state.entry_id, id),
                        ast_node_id: node_id,
                        location: Some(*node.symbol_span()),
                        ast_statement_id: None,
                        ast_scope_root: None,
                        alias,
                        column_aliases,
                        inner: Some(RelationExpression {
                            table_name: name,
                            resolved_table: None,
                            resolved_alternatives: Vec::new(),
                            resolved_cte: None,
                        }),
                        role: TableRole::Read,
                    });
                    node_state.table_references.push(id);
                    state.mark(node_id, SemanticNodeMarkerType::TABLE_REFERENCE);
                } else if let Some((source, table_ref)) =
                    Self::table_parameter_source(state, node_id, node, table_node, alias_node)
                {
                    // A table parameter that reads the result of a script of the session
                    node_state.derived_tables.push(source);
                    node_state.table_references.push(table_ref);
                } else if let Some(select) = table_node.filter(|n| n.node_type() == NodeType::OBJECT_SQL_SELECT) {
                    // A derived table, the scope of its SELECT is a FROM item
                    if let Some(&child) = state.out.name_scopes_by_root_node.get(&state.node_id(select)) {
                        let (alias, column_aliases) = Self::read_alias(state, alias_node);
                        if let Some(s) = state.out.scope_mut(child) {
                            s.parent_visibility = match lateral {
                                Some(_) => SourceVisibility::Before(node_id),
                                None => SourceVisibility::None,
                            };
                        }
                        node_state.derived_tables.push(ScopeSource {
                            ast_node_id: node_id,
                            name: alias.map(|(name, _)| name.text),
                            column_aliases,
                            table: ReferencedTable::Subquery(child),
                            table_name: None,
                        });
                    }
                } else if table_node.is_some_and(|n| n.node_type() == NodeType::OBJECT_SQL_JOINED_TABLE) {
                    // A parenthesized join with an alias, the alias names the join
                    if let (Some((name, _)), column_aliases) = Self::read_alias(state, alias_node) {
                        node_state.join_aliases.push(ScopeJoin {
                            ast_node_id: node_id,
                            name: name.text,
                            column_aliases,
                            columns: Vec::new(),
                        });
                    }
                } else if let Some(function) =
                    table_node.filter(|n| n.node_type() == NodeType::OBJECT_SQL_FUNCTION_TABLE)
                {
                    self.visit_function_table(state, node_id, node, function, alias_node, node_state);
                    return;
                }
                // Table refs may be recursive
                self.merge_child_states(node_state, node);
            }

            NodeType::OBJECT_SQL_RESULT_TARGET => {
                if self.is_inside_graph_syntax(state, node_id) {
                    return;
                }
                self.merge_child_states(node_state, node);
                let [value, name, star] = attrs!(
                    state.children(node),
                    [K::SQL_RESULT_TARGET_VALUE, K::SQL_RESULT_TARGET_NAME, K::SQL_RESULT_TARGET_STAR,]
                );
                let mut rt = ResultTarget { ast_node_id: node_id, ..Default::default() };
                if star.is_some() {
                    rt.is_star = true;
                    let [path] = value.map(|v| attrs!(state.children(v), [K::SQL_COLUMN_REF_PATH])).unwrap_or([None]);
                    if let Some(&qualifier) = path.map(|p| state.read_name_path(p)).unwrap_or_default().last() {
                        let qualifier = state.name(qualifier);
                        state.tag(&qualifier, NameTag::TABLE_ALIAS);
                        rt.star_qualifier = Some(qualifier);
                    }
                } else {
                    if let Some(name) = name.filter(|n| n.node_type() == NodeType::NAME) {
                        rt.column_name = Some(state.node_name(name));
                    }
                    if let Some(expr) = value.and_then(|v| state.expression_of(state.node_id(v))) {
                        rt.expression_id = Some(expr);
                        if rt.column_name.is_none() {
                            if let Some(column_ref) = state.out.expression(expr).and_then(Expression::column_ref) {
                                // The last name names the output column, as in PostgreSQL: the column of `s.t.a`
                                // and the field of `t.c.f`
                                let last = self.column_paths.get(&expr).and_then(|path| path.last());
                                rt.column_name = Some(last.unwrap_or(&column_ref.column_name.column_name).clone());
                            }
                        }
                    }
                }
                node_state.result_targets.push(rt);
            }

            NodeType::OBJECT_SQL_CTE => {
                let [name, columns, statement] =
                    attrs!(state.children(node), [K::SQL_CTE_NAME, K::SQL_CTE_COLUMNS, K::SQL_CTE_STATEMENT]);
                self.merge_child_states(node_state, node);
                if let (Some(name), Some(statement)) = (name.filter(|n| n.node_type() == NodeType::NAME), statement) {
                    node_state.ctes.push(CteDefinition {
                        cte_name: state.node_name(name),
                        select_node_id: state.node_id(statement),
                        columns_node_id: columns.map(|c| state.node_id(c)),
                        columns_count: columns.map(|c| c.children_count() as u16).unwrap_or(0),
                        ast_node_id: node_id,
                    });
                }
            }

            NodeType::OBJECT_SQL_SELECT => {
                if self.is_inside_graph_syntax(state, node_id) {
                    return;
                }
                self.merge_child_states(node_state, node);
                let result_targets = std::mem::take(&mut node_state.result_targets);
                let ctes = std::mem::take(&mut node_state.ctes);
                let scope = self.create_scope(state, node_state, node_id);
                let [recursive] = attrs!(state.children(node), [K::SQL_SELECT_WITH_RECURSIVE]);
                if let Some(s) = state.out.scope_mut(scope) {
                    s.result_targets.extend(result_targets);
                    // Completion needs the declaration order and the recursive visibility of CTEs
                    s.ctes_recursive = recursive.is_some();
                }
                Self::attach_ctes(state, scope, ctes);
                let [into] = attrs!(state.children(node), [K::SQL_SELECT_INTO]);
                if let Some(into) = into.filter(|n| n.node_type() == NodeType::OBJECT_SQL_INTO) {
                    let [into_name] = attrs!(state.children(into), [K::SQL_TEMP_NAME]);
                    self.register_derived_table(state, into, into_name, None, node);
                }
            }

            NodeType::OBJECT_SQL_INSERT => {
                let [target, columns, source, default_values, on_conflict, returning, recursive] = attrs!(
                    state.children(node),
                    [
                        K::SQL_INSERT_TARGET,
                        K::SQL_INSERT_COLUMNS,
                        K::SQL_INSERT_SOURCE,
                        K::SQL_INSERT_DEFAULT_VALUES,
                        K::SQL_INSERT_ON_CONFLICT,
                        K::SQL_INSERT_RETURNING,
                        K::SQL_SELECT_WITH_RECURSIVE,
                    ]
                );
                let target_ref = target
                    .and_then(|t| self.node_states.get(state.node_id(t) as usize)?.table_references.first().copied());
                let Some(target_ref) = target_ref else {
                    self.merge_child_states(node_state, node);
                    return;
                };
                if let Some(target) = state.out.table_ref_mut(target_ref) {
                    target.role = TableRole::Write;
                }

                self.merge_child_states(node_state, node);
                let on_conflict = on_conflict.filter(|n| n.node_type() == NodeType::OBJECT_SQL_INSERT_ON_CONFLICT);
                let target_node = target.map(|t| state.node_id(t));
                let excluded = match (on_conflict, target_node) {
                    (Some(on_conflict), Some(target)) => {
                        self.visit_insert_on_conflict(state, node_state, node_id, on_conflict, target)
                    }
                    _ => None,
                };
                let result_targets = std::mem::take(&mut node_state.result_targets);
                let ctes = std::mem::take(&mut node_state.ctes);
                let scope = self.create_scope(state, node_state, node_id);
                if let Some(s) = state.out.scope_mut(scope) {
                    s.result_targets.extend(result_targets);
                    s.ctes_recursive = recursive.is_some();
                }
                if let (Some(excluded), Some(target)) = (excluded, target_node) {
                    self.insert_excluded.insert(scope, (excluded, target));
                }
                Self::attach_ctes(state, scope, ctes);
                if let Some(source) = source {
                    if let Some(&source_scope) = state.out.name_scopes_by_root_node.get(&state.node_id(source)) {
                        if let Some(s) = state.out.scope_mut(source_scope) {
                            s.column_correlation_barrier = true;
                        }
                    }
                }
                self.set_cte_correlation_barriers(state, scope);

                let mut insert = InsertStatement {
                    ast_node_id: node_id,
                    ast_statement_id: state.find_statement_id(node_id),
                    target: target_ref,
                    source_ast_node_id: source.map(|s| state.node_id(s)),
                    default_values: default_values.is_some(),
                    returning: returning.is_some(),
                    target_columns: Vec::new(),
                };
                if let Some(columns) = columns.filter(|n| n.node_type() == NodeType::ARRAY) {
                    for column in state.children(columns) {
                        if column.node_type() != NodeType::NAME {
                            continue;
                        }
                        let name = state.node_name(column);
                        state.tag(&name, NameTag::COLUMN_NAME);
                        insert.target_columns.push(InsertTargetColumn {
                            ast_node_id: state.node_id(column),
                            column_name: name,
                            resolved: None,
                        });
                    }
                }
                state.out.insert_statements.push(insert);
            }

            NodeType::OBJECT_SQL_DELETE => {
                let [target, using, recursive] = attrs!(
                    state.children(node),
                    [K::SQL_DELETE_TARGET, K::SQL_DELETE_USING, K::SQL_SELECT_WITH_RECURSIVE]
                );
                if let Some(target) = target {
                    let target_refs =
                        self.node_states.get(state.node_id(target) as usize).map(|s| s.table_references.as_slice());
                    for &table_ref in target_refs.unwrap_or_default() {
                        if let Some(table_ref) = state.out.table_ref_mut(table_ref) {
                            table_ref.role = TableRole::Write;
                        }
                    }
                }
                self.merge_child_states(node_state, node);
                if let (Some(target), Some(using)) = (target, using) {
                    let (target, using) = (state.node_id(target), state.node_id(using));
                    Self::hide_target_from_reads(state, node_state, target, using);
                }
                let result_targets = std::mem::take(&mut node_state.result_targets);
                let ctes = std::mem::take(&mut node_state.ctes);
                let scope = self.create_scope(state, node_state, node_id);
                if let Some(s) = state.out.scope_mut(scope) {
                    s.result_targets.extend(result_targets);
                    s.ctes_recursive = recursive.is_some();
                }
                Self::attach_ctes(state, scope, ctes);
                // CTE definitions cannot correlate to the DELETE target or USING relations
                self.set_cte_correlation_barriers(state, scope);
            }

            NodeType::OBJECT_SQL_UPDATE | NodeType::OBJECT_SQL_MERGE => {
                self.visit_update_or_merge(state, node, node_id, node_state);
            }

            // TRUNCATE writes the relations that it names, its scope resolves them
            NodeType::OBJECT_SQL_TRUNCATE => {
                // The array of the relations holds the table refs of its elements
                let [relations] = attrs!(state.children(node), [K::SQL_TRUNCATE_RELATIONS]);
                if let Some(relations) = relations {
                    let refs =
                        self.node_states.get(state.node_id(relations) as usize).map(|s| s.table_references.as_slice());
                    for &table_ref in refs.unwrap_or_default() {
                        if let Some(table_ref) = state.out.table_ref_mut(table_ref) {
                            table_ref.role = TableRole::Write;
                        }
                    }
                }
                self.merge_child_states(node_state, node);
                self.create_scope(state, node_state, node_id);
            }

            // COPY of a relation writes it when it loads (FROM) and reads it when it unloads (TO), its scope resolves
            // it. COPY of a query reads what the query reads.
            NodeType::OBJECT_SQL_COPY => {
                let [relation, direction] = attrs!(state.children(node), [K::SQL_COPY_RELATION, K::SQL_COPY_DIRECTION]);
                let (Some(relation), Some(name)) = (relation, state.read_qualified_table_name(relation)) else {
                    self.merge_child_states(node_state, node);
                    return;
                };
                let loads =
                    direction.is_some_and(|d| CopyDirection(d.children_begin_or_value() as u8) == CopyDirection::FROM);
                let id = state.out.table_references.len() as TableRefId;
                let relation_id = state.node_id(relation);
                state.out.table_references.push(TableReference {
                    table_reference_id: ExternalObjectId::new(state.entry_id, id),
                    ast_node_id: relation_id,
                    location: Some(*relation.symbol_span()),
                    ast_statement_id: None,
                    ast_scope_root: None,
                    alias: None,
                    column_aliases: Vec::new(),
                    inner: Some(RelationExpression {
                        table_name: name,
                        resolved_table: None,
                        resolved_alternatives: Vec::new(),
                        resolved_cte: None,
                    }),
                    role: if loads { TableRole::Write } else { TableRole::Read },
                });
                node_state.table_references.push(id);
                state.mark(relation_id, SemanticNodeMarkerType::TABLE_REFERENCE);
                self.merge_child_states(node_state, node);
                self.create_scope(state, node_state, node_id);
            }

            NodeType::OBJECT_SQL_JOINED_TABLE => {
                self.merge_child_states(node_state, node);
                let [join_type, using, on] =
                    attrs!(state.children(node), [K::SQL_JOIN_TYPE, K::SQL_JOIN_USING, K::SQL_JOIN_ON]);
                if let Some(on) = on {
                    Self::restrict_join_condition(state, node_state, node_id, state.node_id(on));
                }
                if let Some(using) = using.filter(|n| n.node_type() == NodeType::ARRAY) {
                    let mut columns = Vec::new();
                    for column in state.children(using) {
                        if column.node_type() == NodeType::NAME {
                            let name = state.node_name(column);
                            state.tag(&name, NameTag::COLUMN_NAME);
                            columns.push(name);
                        }
                    }
                    node_state.using_joins.push(UsingJoin { ast_node_id: node_id, using: Some(columns) });
                } else if join_type.is_some_and(|t| t.children_begin_or_value() as u8 & JoinType::NATURAL_.0 != 0) {
                    node_state.using_joins.push(UsingJoin { ast_node_id: node_id, using: None });
                }
            }

            NodeType::OBJECT_SQL_CREATE => {
                if Self::is_explain(state, state.find_statement_id(node_id)) {
                    self.merge_child_states(node_state, node);
                    self.create_scope(state, node_state, node_id);
                    return;
                }
                let [name_node, elements] =
                    attrs!(state.children(node), [K::SQL_CREATE_TABLE_NAME, K::SQL_CREATE_TABLE_ELEMENTS]);
                let Some(table_name) = state.read_qualified_table_name(name_node) else { return };
                let schema_id = Self::register_schema(state, &table_name.database_name, &table_name.schema_name);
                let index = state.out.entry.table_declarations.len() as u32;
                let table_id = state.reserve_table_id(&table_name);
                // Only the elements are merged
                if let Some(elements) = elements {
                    if let Some(elements) = self.node_states.get_mut(state.node_id(elements) as usize) {
                        node_state.merge(elements);
                    }
                }
                // The columns keep their declaration order, column aliases rename them by position
                let columns = std::mem::take(&mut node_state.table_columns);
                // The CHECK constraints and generated columns read the columns of the table, `check (a > b)`
                node_state.derived_tables.push(ScopeSource {
                    ast_node_id: name_node.map_or(node_id, |n| state.node_id(n)),
                    name: Some(table_name.table_name.text.clone()),
                    column_aliases: Vec::new(),
                    table: ReferencedTable::Table(TableLoc { entry: state.entry_id, index }),
                    table_name: Some(table_name.clone()),
                });
                self.create_scope(state, node_state, node_id);

                let name = table_name.table_name.clone();
                let mut table = TableDeclaration::new(schema_id, table_id, table_name);
                table.ast_node_id = Some(node_id);
                table.ast_statement_id = state.find_statement_id(node_id);
                table.location = name_node.map(|n| state.text_span(*n.symbol_span()));
                let column_ids = state.reserve_column_ids(table_id, columns.iter().map(|c| &c.column_name.text));
                for ((column_index, column), column_id) in columns.iter().enumerate().zip(column_ids) {
                    table.table_columns_by_name.entry(column.column_name.text.clone()).or_insert(column_index);
                    table.table_columns.push(TableColumn {
                        object_id: QualifiedCatalogObjectId::table_column(table_id, column_id),
                        table: Some(table_id),
                        ast_node_id: Some(column.ast_node_id),
                        column_name: column.column_name.clone(),
                        column_type: column.column_type.clone(),
                        location: state.node(column.ast_node_id).map(|n| state.text_span(*n.symbol_span())),
                    });
                }
                state.entry_mut().table_declarations.push(table);
                state.resolve_name(&name, CatalogObjectRef::Table(TableLoc { entry: state.entry_id, index }));
                for (column_index, column) in columns.iter().enumerate() {
                    let loc =
                        ColumnLoc { table: TableLoc { entry: state.entry_id, index }, column: column_index as u32 };
                    state.resolve_name(&column.column_name, CatalogObjectRef::Column(loc));
                }
            }

            NodeType::OBJECT_SQL_CREATE_FUNCTION => {
                if Self::is_explain(state, state.find_statement_id(node_id)) {
                    self.merge_child_states(node_state, node);
                    return;
                }
                let [name_node, params, returns, is_aggregate] = attrs!(
                    state.children(node),
                    [
                        K::SQL_CREATE_FUNCTION_NAME,
                        K::SQL_CREATE_FUNCTION_PARAMS,
                        K::SQL_CREATE_FUNCTION_RETURNS,
                        K::SQL_CREATE_FUNCTION_IS_AGGREGATE,
                    ]
                );
                let Some(function_name) = state.read_qualified_function_name(name_node) else { return };
                let schema_id = Self::register_schema(state, &function_name.database_name, &function_name.schema_name);
                let index = state.out.entry.function_declarations.len() as u32;
                let function_id = state.reserve_function_id(&function_name);
                let return_type: Arc<str> =
                    returns.map(|r| Arc::from(state.text_at(*r.symbol_span()))).unwrap_or_else(|| Arc::from(""));
                let mut declaration = FunctionDeclaration {
                    object_id: QualifiedCatalogObjectId::function(function_id),
                    catalog_schema_id: schema_id,
                    is_aggregate: is_aggregate.is_some(),
                    ast_node_id: Some(node_id),
                    ast_statement_id: None,
                    function_name: function_name.clone(),
                    params: Vec::new(),
                    return_type,
                    location: name_node.map(|n| state.text_span(*n.symbol_span())),
                };
                if let Some(params) = params.filter(|n| n.node_type() == NodeType::ARRAY) {
                    for param in state.children(params) {
                        if param.node_type() != NodeType::OBJECT_SQL_FUNCTION_PARAM {
                            continue;
                        }
                        let [param_name, param_type] =
                            attrs!(state.children(param), [K::SQL_FUNCTION_PARAM_NAME, K::SQL_FUNCTION_PARAM_TYPE]);
                        let Some(param_name) = param_name.filter(|n| n.node_type() == NodeType::NAME) else { continue };
                        let param_type = param_type.map(|t| state.text_at(*t.symbol_span())).unwrap_or("");
                        declaration.params.push(FunctionParam {
                            ast_node_id: Some(state.node_id(param)),
                            param_name: state.node_name(param_name),
                            param_type: Arc::from(param_type),
                        });
                    }
                }
                state.entry_mut().function_declarations.push(declaration);
                state.tag(&function_name.function_name, NameTag::FUNCTION_NAME);
                state.resolve_name(&function_name.function_name, CatalogObjectRef::Function(state.loc(index as usize)));
            }

            NodeType::OBJECT_SQL_CREATE_AS | NodeType::OBJECT_SQL_VIEW => {
                let [name, columns, statement] = if node.node_type() == NodeType::OBJECT_SQL_CREATE_AS {
                    attrs!(
                        state.children(node),
                        [K::SQL_CREATE_AS_NAME, K::SQL_CREATE_AS_COLUMNS, K::SQL_CREATE_AS_STATEMENT]
                    )
                } else {
                    attrs!(state.children(node), [K::SQL_VIEW_NAME, K::SQL_VIEW_COLUMNS, K::SQL_VIEW_STATEMENT])
                };
                if let Some(statement) = statement.filter(|n| n.node_type() == NodeType::OBJECT_SQL_SELECT) {
                    self.register_derived_table(state, node, name, columns, statement);
                }
                self.merge_child_states(node_state, node);
            }

            NodeType::OBJECT_SQL_ALTER_TABLE | NodeType::OBJECT_SQL_ALTER_VIEW => {
                // The columns of the actions belong to the table, not to a scope
                self.merge_child_states(node_state, node);
                node_state.clear();
                self.visit_alter(state, node, node_id);
            }

            NodeType::OBJECT_SQL_DROP_TABLE | NodeType::OBJECT_SQL_DROP_VIEW => {
                self.visit_drop(state, node, node_id);
            }

            NodeType::OBJECT_SQL_PROPERTY_GRAPH | NodeType::OBJECT_SQL_GRAPH_TABLE => {
                // Property graph analysis is syntax-only. Keep graph-local references in the
                // analyzed buffers, but prevent them from entering or affecting an SQL scope.
                self.merge_child_states(node_state, node);
                node_state.clear();
            }

            // By default, merge child states into the node state
            _ => self.merge_child_states(node_state, node),
        }
    }

    /// UPDATE and MERGE write their target, the FROM items of UPDATE and the source of MERGE are read. Their
    /// conditions, values and RETURNING see the target and the read relations, as in PostgreSQL. The columns that they
    /// write, the SET targets and the INSERT columns of MERGE, are column refs that bind to the target only.
    fn visit_update_or_merge(
        &mut self,
        state: &mut AnalysisState,
        node: &Node,
        node_id: u32,
        node_state: &mut NodeState,
    ) {
        let [update_target, merge_target, update_from, merge_source, assignments, clauses, recursive] = attrs!(
            state.children(node),
            [
                K::SQL_UPDATE_TARGET,
                K::SQL_MERGE_TARGET,
                K::SQL_UPDATE_FROM,
                K::SQL_MERGE_SOURCE,
                K::SQL_UPDATE_ASSIGNMENTS,
                K::SQL_MERGE_CLAUSES,
                K::SQL_SELECT_WITH_RECURSIVE,
            ]
        );
        let target = update_target.or(merge_target).map(|t| state.node_id(t));
        if let Some(target) = target {
            let target_refs = self.node_states.get(target as usize).map(|s| s.table_references.as_slice());
            for &table_ref in target_refs.unwrap_or_default() {
                if let Some(table_ref) = state.out.table_ref_mut(table_ref) {
                    table_ref.role = TableRole::Write;
                }
            }
        }
        self.merge_child_states(node_state, node);
        if let (Some(target), Some(reads)) = (target, update_from.or(merge_source)) {
            let reads = state.node_id(reads);
            Self::hide_target_from_reads(state, node_state, target, reads);
        }

        // A WHEN NOT MATCHED [BY TARGET] clause of MERGE sees the source only, a WHEN NOT MATCHED BY SOURCE clause the
        // target only, as in PostgreSQL
        let mut restricted = Vec::new();
        for clause in clauses.map(|c| state.children(c)).unwrap_or_default() {
            let [kind] = attrs!(state.children(clause), [K::SQL_MERGE_WHEN_CLAUSE_KIND]);
            let visibility = match (target, kind.map(|k| MergeMatch(k.children_begin_or_value() as u8))) {
                (Some(target), Some(MergeMatch::NOT_MATCHED_BY_TARGET)) => SourceVisibility::Except(target),
                (Some(target), Some(MergeMatch::NOT_MATCHED_BY_SOURCE)) => SourceVisibility::Only(target),
                _ => continue,
            };
            let clause_id = state.node_id(clause);
            restricted.push(ScopeClause { ast_node_id: clause_id, visibility });
            for &child in &node_state.child_scopes {
                if state.out.scope(child).is_some_and(|s| Self::is_within(state, s.ast_node_id, clause_id)) {
                    if let Some(s) = state.out.scope_mut(child) {
                        s.parent_visibility = visibility;
                    }
                }
            }
        }

        // The written columns: the SET targets of UPDATE, the SET targets and the INSERT columns of the MERGE actions
        let mut written: Vec<&Node> = Vec::new();
        let mut assignment_lists: Vec<&Node> = assignments.into_iter().collect();
        for clause in clauses.map(|c| state.children(c)).unwrap_or_default() {
            let [action] = attrs!(state.children(clause), [K::SQL_MERGE_WHEN_CLAUSE_ACTION]);
            let Some(action) = action.filter(|a| a.node_type() == NodeType::OBJECT_SQL_MERGE_ACTION) else { continue };
            let [set, columns] =
                attrs!(state.children(action), [K::SQL_MERGE_ACTION_TARGET, K::SQL_MERGE_ACTION_COLUMNS]);
            assignment_lists.extend(set);
            if let Some(columns) = columns.filter(|c| c.node_type() == NodeType::ARRAY) {
                written.extend(state.children(columns));
            }
        }
        for list in assignment_lists.into_iter().filter(|l| l.node_type() == NodeType::ARRAY) {
            for assignment in state.children(list).iter().filter(|a| a.node_type() == NodeType::OBJECT_SQL_ASSIGNMENT) {
                // One column, or a list of columns that a row assigns
                let [columns] = attrs!(state.children(assignment), [K::SQL_ASSIGNMENT_COLUMNS]);
                match columns {
                    Some(columns) if columns.node_type() == NodeType::ARRAY => written.extend(state.children(columns)),
                    Some(column) => written.push(column),
                    None => {}
                }
            }
        }
        // Without a target, in a statement that doesn't parse, the columns bind to nothing
        if let Some(target) = target {
            for column in written.into_iter().filter(|c| c.node_type() == NodeType::NAME) {
                self.add_written_column(state, node_state, column, target);
            }
        }

        let result_targets = std::mem::take(&mut node_state.result_targets);
        let ctes = std::mem::take(&mut node_state.ctes);
        let scope = self.create_scope(state, node_state, node_id);
        if let Some(s) = state.out.scope_mut(scope) {
            s.result_targets.extend(result_targets);
            s.ctes_recursive = recursive.is_some();
            s.clauses.extend(restricted);
        }
        Self::attach_ctes(state, scope, ctes);
        // CTE definitions cannot correlate to the target or the read relations
        self.set_cte_correlation_barriers(state, scope);
    }

    /// The `ON` condition of a join sees only the FROM items inside the join, also from its subqueries, as in
    /// PostgreSQL: `t join u on u.a = v.id, v` is an invalid reference to the FROM-clause entry v
    fn restrict_join_condition(state: &mut AnalysisState, node_state: &mut NodeState, join: u32, on: u32) {
        let visibility = SourceVisibility::Within(join);
        for &child in &node_state.child_scopes {
            if state.out.scope(child).is_some_and(|s| Self::is_within(state, s.ast_node_id, on)) {
                if let Some(s) = state.out.scope_mut(child) {
                    s.parent_visibility = visibility;
                }
            }
        }
        node_state.clauses.push(ScopeClause { ast_node_id: on, visibility });
    }

    /// The relations that UPDATE, DELETE and MERGE read, the FROM items of UPDATE, the USING items of DELETE and the
    /// source of MERGE, don't see the target, also not laterally, as in PostgreSQL: neither the conditions of their
    /// joins nor the scopes in them, a function in FROM and a lateral derived table see the FROM items before them
    /// without the target. The condition of a join in them is a clause inside of the reads, it sees the FROM items
    /// inside of its join only, the target is none of them.
    fn hide_target_from_reads(state: &mut AnalysisState, node_state: &mut NodeState, target: u32, reads: u32) {
        node_state.clauses.push(ScopeClause { ast_node_id: reads, visibility: SourceVisibility::Except(target) });
        for &child in &node_state.child_scopes {
            let Some(s) = state.out.scope_mut(child) else { continue };
            if !is_within(state.ast, s.ast_node_id, reads) {
                continue;
            }
            s.parent_visibility = match s.parent_visibility {
                SourceVisibility::All => SourceVisibility::Except(target),
                SourceVisibility::Before(node_id) => SourceVisibility::BeforeExcept(node_id, target),
                visibility => visibility,
            };
        }
    }

    /// ON CONFLICT of an INSERT: the columns of the conflict target and the SET targets of DO UPDATE are column refs that
    /// bind to the target only. The values and the condition of DO UPDATE also see the row proposed for insertion,
    /// `excluded` with the columns of the target, as in PostgreSQL, the other column refs of the INSERT don't: the INSERT
    /// is a clause that doesn't see `excluded`, the values and the condition of DO UPDATE are clauses inside of it that
    /// see all FROM items. Returns the ON CONFLICT node for a DO UPDATE, the AST node of its `excluded` row.
    fn visit_insert_on_conflict(
        &mut self,
        state: &mut AnalysisState,
        node_state: &mut NodeState,
        insert: u32,
        on_conflict: &Node,
        target: u32,
    ) -> Option<u32> {
        let [conflict_target, assignments, where_clause] = attrs!(
            state.children(on_conflict),
            [K::SQL_INSERT_ON_CONFLICT_TARGET, K::SQL_INSERT_ON_CONFLICT_ASSIGNMENTS, K::SQL_INSERT_ON_CONFLICT_WHERE,]
        );
        // The column refs of DO UPDATE see `excluded`, the others of the INSERT don't
        let on_conflict_id = state.node_id(on_conflict);
        let update: Vec<u32> = [assignments, where_clause].into_iter().flatten().map(|n| state.node_id(n)).collect();
        let sees_excluded = |state: &AnalysisState, node: u32| update.iter().any(|&u| Self::is_within(state, node, u));
        let hidden = SourceVisibility::Except(on_conflict_id);
        if assignments.is_some() {
            node_state.clauses.push(ScopeClause { ast_node_id: insert, visibility: hidden });
            let sees_all = |&u: &u32| ScopeClause { ast_node_id: u, visibility: SourceVisibility::All };
            node_state.clauses.extend(update.iter().map(sees_all));
        }
        for &child in &node_state.child_scopes {
            let Some(s) = state.out.scope(child) else { continue };
            if !sees_excluded(state, s.ast_node_id) {
                if let Some(s) = state.out.scope_mut(child) {
                    s.parent_visibility = hidden;
                }
            }
        }

        let mut columns: Vec<&Node> = Vec::new();
        let elements = conflict_target.filter(|t| t.node_type() == NodeType::ARRAY).map(|t| state.children(t));
        for element in elements.unwrap_or_default() {
            let [name] = attrs!(state.children(element), [K::SQL_INDEX_ELEMENT_NAME]);
            columns.extend(name.filter(|_| element.node_type() == NodeType::OBJECT_SQL_INDEX_ELEMENT));
        }
        let assignment_list = assignments.filter(|a| a.node_type() == NodeType::ARRAY).map(|a| state.children(a));
        for assignment in assignment_list.unwrap_or_default() {
            if assignment.node_type() != NodeType::OBJECT_SQL_ASSIGNMENT {
                continue;
            }
            // One column, or a list of columns that a row assigns
            match attrs!(state.children(assignment), [K::SQL_ASSIGNMENT_COLUMNS]) {
                [Some(list)] if list.node_type() == NodeType::ARRAY => columns.extend(state.children(list)),
                [Some(column)] => columns.push(column),
                [None] => {}
            }
        }
        for column in columns.into_iter().filter(|c| c.node_type() == NodeType::NAME) {
            self.add_written_column(state, node_state, column, target);
        }
        assignments.map(|_| on_conflict_id)
    }

    /// Add the `excluded` row of ON CONFLICT DO UPDATE to the scope of an INSERT, a FROM item with the table of the
    /// target. The target was resolved with the other table refs of the scope.
    fn add_insert_excluded(&self, state: &mut AnalysisState, scope: ScopeId) {
        let Some(&(excluded, target)) = self.insert_excluded.get(&scope) else { return };
        let target = state.out.scope(scope).and_then(|s| s.sources.iter().find(|s| s.ast_node_id == target));
        let Some(target) = target.cloned() else { return };
        let source = ScopeSource {
            ast_node_id: excluded,
            name: Some(Arc::from("excluded")),
            column_aliases: Vec::new(),
            table: target.table,
            table_name: None,
        };
        Self::add_source(state, scope, source);
    }

    /// Is a FROM item the `excluded` row of ON CONFLICT?
    fn is_insert_excluded(state: &AnalysisState, source: &ScopeSource) -> bool {
        state.node(source.ast_node_id).is_some_and(|n| n.node_type() == NodeType::OBJECT_SQL_INSERT_ON_CONFLICT)
    }

    /// A column that UPDATE or MERGE writes, a column ref of its scope that binds to the target
    fn add_written_column(
        &mut self,
        state: &mut AnalysisState,
        node_state: &mut NodeState,
        column: &Node,
        target: u32,
    ) {
        let column_node_id = state.node_id(column);
        let column_name = state.node_name(column);
        state.tag(&column_name, NameTag::COLUMN_NAME);
        let column_ref = ColumnRef {
            column_name: QualifiedColumnName { ast_node_id: Some(column_node_id), table_alias: None, column_name },
            ast_scope_root: None,
            resolved: ColumnResolution::Unresolved,
            resolved_source: None,
            resolved_ids: None,
            inferred: None,
        };
        let expr = state.add_expression(column_node_id, *column.symbol_span(), ExpressionInner::ColumnRef(column_ref));
        state.set_expression_of(column_node_id, expr);
        state.mark(column_node_id, SemanticNodeMarkerType::COLUMN_REFERENCE);
        node_state.column_references.push(expr);
        self.assignment_targets.insert(expr, target);
    }

    /// Bind a column that UPDATE or MERGE writes to the target table. A target without the column binds it all the
    /// same, the column of a target that the catalog doesn't know is inferred.
    fn resolve_assignment_target(&mut self, state: &mut AnalysisState, expr: ExprId, scope: ScopeId, target: u32) {
        let source = state.out.scope(scope).and_then(|s| s.sources.iter().find(|s| s.ast_node_id == target)).cloned();
        let Some(column_ref) = state.out.expression(expr).and_then(Expression::column_ref) else { return };
        let column_name = column_ref.column_name.column_name.text.clone();
        match source {
            Some(source) => {
                self.resolve_qualified_column(state, expr, &[source], &column_name);
            }
            None => {
                self.finished_column_refs.insert(expr, FinishedColumnRef::Bound(None));
            }
        }
    }

    /// A table function in FROM is a FROM item. Its arguments are a scope of their own that sees the FROM items before
    /// it, a function in FROM is lateral as in PostgreSQL. The scope has the columns of the function: those of its
    /// column definition list, or one named by the alias of a single function or by the function, then the ordinality.
    fn visit_function_table(
        &mut self,
        state: &mut AnalysisState,
        node_id: u32,
        node: &Node,
        function_table: &Node,
        alias_node: Option<&Node>,
        node_state: &mut NodeState,
    ) {
        self.merge_child_states(node_state, node);
        let [function, ordinality, ordinality_name, rows_from] = attrs!(
            state.children(function_table),
            [
                K::SQL_FUNCTION_TABLE_FUNCTION,
                K::SQL_FUNCTION_TABLE_WITH_ORDINALITY,
                K::SQL_FUNCTION_TABLE_ORDINALITY_NAME,
                K::SQL_FUNCTION_TABLE_ROWS_FROM,
            ]
        );
        // The functions with their column definition lists, a semantic view has no columns that the script knows
        let mut functions: Vec<(Option<&Node>, Option<&Node>)> = Vec::new();
        match (function, rows_from.filter(|n| n.node_type() == NodeType::ARRAY)) {
            (_, Some(items)) => {
                for item in state.children(items) {
                    let [function, columns] =
                        attrs!(state.children(item), [K::SQL_ROWSFROM_ITEM_FUNCTION, K::SQL_ROWSFROM_ITEM_COLUMNS]);
                    functions.push((function, columns));
                }
            }
            (Some(function), None) if function.node_type() == NodeType::OBJECT_SQL_FUNCTION_EXPRESSION => {
                let alias = alias_node.filter(|a| a.node_type() == NodeType::OBJECT_SQL_ALIAS);
                let [columns] = alias.map(|a| attrs!(state.children(a), [K::SQL_ALIAS_COLUMN_DEFS])).unwrap_or([None]);
                functions.push((Some(function), columns));
            }
            _ => return,
        }
        let scope = self.create_scope(state, node_state, node_id);
        let (alias, column_aliases) = Self::read_alias(state, alias_node);
        let single = functions.len() == 1;
        // The FROM item is named by its alias or by its first function
        let first_function = functions.first().and_then(|(function, _)| *function);
        let with_ordinality =
            ordinality.is_some_and(|n| n.node_type() == NodeType::BOOL && n.children_begin_or_value() != 0);
        let mut columns = Vec::new();
        for (function, definitions) in functions {
            match definitions.filter(|d| d.node_type() == NodeType::ARRAY) {
                Some(definitions) => {
                    for definition in state.children(definitions) {
                        let [name] = attrs!(state.children(definition), [K::SQL_COLUMN_DEF_NAME]);
                        columns.extend(name.filter(|n| n.node_type() == NodeType::NAME).map(|n| state.node_name(n)));
                    }
                }
                None => {
                    columns.push(match &alias {
                        Some((alias, _)) if single => alias.clone(),
                        _ => Self::function_column_name(state, function),
                    });
                    // A function of a composite type has more columns, the column aliases of a single function name
                    // them
                    if single {
                        let aliased = column_aliases.len().saturating_sub(usize::from(with_ordinality));
                        columns.extend((1..aliased).map(|_| state.empty_name()));
                    }
                }
            }
        }
        if with_ordinality {
            columns.push(match ordinality_name.filter(|n| n.node_type() == NodeType::NAME) {
                Some(name) => state.node_name(name),
                None => Name { entry: state.entry_id, id: state.out.empty_name, text: Arc::from("ordinality") },
            });
        }
        let name = match &alias {
            Some((alias, _)) => Some(alias.text.clone()),
            None => Some(Self::function_column_name(state, first_function).text).filter(|n| &**n != "?column?"),
        };
        if let Some(s) = state.out.scope_mut(scope) {
            s.parent_visibility = SourceVisibility::Before(node_id);
            for column_name in columns {
                if !column_name.text.is_empty() {
                    s.output_columns_by_name.entry(column_name.text.clone()).or_insert(s.output_columns.len());
                }
                s.output_columns.push(ScopeColumn { column_name, source: ScopeColumnSource::Computed });
            }
        }
        node_state.derived_tables.push(ScopeSource {
            ast_node_id: node_id,
            name,
            column_aliases,
            table: ReferencedTable::Subquery(scope),
            table_name: None,
        });
    }

    /// The name of the column of a function in FROM without a column definition list: the name of the function
    fn function_column_name(state: &AnalysisState, function: Option<&Node>) -> Name {
        let generated = |text: Arc<str>| Name { entry: state.entry_id, id: state.out.empty_name, text };
        let [name] = function
            .filter(|f| f.node_type() == NodeType::OBJECT_SQL_FUNCTION_EXPRESSION)
            .map(|f| attrs!(state.children(f), [K::SQL_FUNCTION_NAME]))
            .unwrap_or([None]);
        match name {
            Some(name) if name.node_type() == NodeType::ARRAY => match state.read_name_path(name).last() {
                Some(&id) => state.name(id),
                None => generated(Arc::from("?column?")),
            },
            Some(name) if name.node_type() == NodeType::ENUM_SQL_KNOWN_FUNCTION => {
                let known = KnownFunction(name.children_begin_or_value() as u8);
                generated(
                    known.variant_name().map_or_else(|| Arc::from("?column?"), |n| Arc::from(n.to_ascii_lowercase())),
                )
            }
            _ => generated(Arc::from("?column?")),
        }
    }

    /// Is a column ref the qualifier of a star result target (`t.*`)?
    fn is_star_qualifier(state: &AnalysisState, node: &Node) -> bool {
        if node.attribute_key() != K::SQL_RESULT_TARGET_VALUE {
            return false;
        }
        let Some(target) = state.ast.get(node.parent() as usize) else { return false };
        let [star] = attrs!(state.children(target), [K::SQL_RESULT_TARGET_STAR]);
        target.node_type() == NodeType::OBJECT_SQL_RESULT_TARGET && star.is_some()
    }

    /// Mark the CTEs of a scope as correlation barriers
    fn set_cte_correlation_barriers(&self, state: &mut AnalysisState, scope: ScopeId) {
        let Some(s) = state.out.scope(scope) else { return };
        let children: Vec<ScopeId> = s.cte_definitions.iter().filter_map(|(_, cte)| cte.child_scope).collect();
        for child in children {
            if let Some(child) = state.out.scope_mut(child) {
                child.column_correlation_barrier = true;
            }
        }
    }

    pub fn finish(&mut self, state: &mut AnalysisState) {
        // Index the tables and functions
        state.entry_mut().index_declarations();

        // Assign statement ids to scopes before resolving ordered script-local names
        for i in 0..state.out.name_scopes.len() {
            let Some(node_id) = state.out.name_scopes.get(i).map(|s| s.ast_node_id) else { break };
            let statement = state.find_statement_id(node_id);
            if let Some(s) = state.out.name_scopes.get_mut(i) {
                s.ast_statement_id = statement;
            }
        }

        // Resolve all names, derive the columns of the tables of `CREATE TABLE AS` and of the views
        self.resolve_names(state);
        self.publish_join_columns(state);

        // Assign statement ids. The objects are not ordered by their AST nodes: every morsel of the scan adds the
        // column refs, then the function calls, then the constants, so every node looks up its statement
        if !state.parsed.statements.is_empty() {
            let statements = &state.parsed.statements;
            let assign = |nodes: &mut dyn Iterator<Item = (u32, &mut Option<u32>)>| {
                for (ast_node_id, statement) in nodes {
                    // The statements are ordered by their nodes, find the last one that begins at or before the node
                    let next = statements.partition_point(|s| s.nodes_begin <= ast_node_id);
                    let Some(i) = next.checked_sub(1) else { continue };
                    if statements.get(i).is_some_and(|s| ast_node_id < s.nodes_begin + s.node_count) {
                        *statement = Some(i as u32);
                    }
                }
            };
            assign(&mut state.out.table_references.iter_mut().map(|r| (r.ast_node_id, &mut r.ast_statement_id)));
            assign(&mut state.out.expressions.iter_mut().map(|e| (e.ast_node_id, &mut e.ast_statement_id)));
            let mut scope_statements: Vec<Option<u32>> = vec![None; state.out.name_scopes.len()];
            assign(
                &mut state
                    .out
                    .name_scopes
                    .iter()
                    .zip(scope_statements.iter_mut())
                    .map(|(s, statement)| (s.ast_node_id, statement)),
            );
            for (scope, statement) in state.out.name_scopes.iter_mut().zip(scope_statements) {
                if statement.is_some() {
                    scope.ast_statement_id = statement;
                }
            }
            assign(
                &mut Arc::make_mut(&mut state.out.entry)
                    .function_declarations
                    .iter_mut()
                    .filter_map(|f| Some((f.ast_node_id?, &mut f.ast_statement_id))),
            );
        }

        // Index the columns of the table declarations
        state.entry_mut().index_table_columns();

        // Solve the schema-inference constraints
        Self::run_schema_inference(state);
        Self::resolve_insert_target_columns(state);
        Self::compute_resolved_column_ids(state);
    }

    /// Bind explicit INSERT target columns after target-table resolution
    fn resolve_insert_target_columns(state: &mut AnalysisState) {
        for i in 0..state.out.insert_statements.len() {
            let Some(insert) = state.out.insert_statements.get(i) else { break };
            let relation = state.out.table_ref(insert.target).and_then(|t| t.inner.as_ref());
            let Some(resolved) = relation.and_then(|r| r.resolved_table.as_ref()) else {
                continue;
            };
            let table_id = resolved.catalog_table_id.unpack_table_id();
            let loc = if table_id.origin == state.entry_id {
                state.out.entry.table_loc_by_id(table_id)
            } else {
                state.catalog.entry(table_id.origin).and_then(|e| e.data().table_loc_by_id(table_id))
            };
            let Some(loc) = loc else { continue };
            let Some(table) = state.table(loc) else { continue };
            let resolved: Vec<Option<ColumnLoc>> = insert
                .target_columns
                .iter()
                .map(|c| {
                    table
                        .table_columns_by_name
                        .get(&c.column_name.text)
                        .map(|&column| ColumnLoc { table: loc, column: column as u32 })
                })
                .collect();
            let Some(insert) = state.out.insert_statements.get_mut(i) else { break };
            for (column, resolved) in insert.target_columns.iter_mut().zip(resolved) {
                if resolved.is_some() {
                    column.resolved = resolved;
                }
            }
        }
    }

    /// The table column behind a resolved column, scope columns are followed through their source expressions
    fn resolved_table_column(state: &AnalysisState, resolution: ColumnResolution) -> Option<ColumnLoc> {
        let mut current = resolution;
        for _ in 0..256 {
            match current {
                ColumnResolution::Unresolved | ColumnResolution::WholeRow => return None,
                ColumnResolution::TableColumn(loc) => return Some(loc),
                ColumnResolution::ScopeColumn { scope, column } => {
                    let column = state.out.scope(scope)?.output_columns.get(column as usize)?;
                    match column.source {
                        ScopeColumnSource::TableColumn(loc) => return Some(loc),
                        ScopeColumnSource::Computed => return None,
                        ScopeColumnSource::Expression(expr) => {
                            current = state.out.expression(expr).and_then(Expression::column_ref)?.resolved;
                        }
                    }
                }
            }
        }
        None
    }

    /// The catalog ids of a resolved column
    fn resolved_column_ids(state: &AnalysisState, resolution: ColumnResolution) -> Option<ResolvedColumnIds> {
        let loc = Self::resolved_table_column(state, resolution)?;
        let table = state.table(loc.table)?;
        let column = table.table_columns.get(loc.column as usize)?;
        Some(ResolvedColumnIds {
            catalog_schema_id: table.catalog_schema_id,
            catalog_table_column_id: column.object_id,
            referenced_catalog_version: table.catalog_version,
        })
    }

    fn compute_resolved_column_ids(state: &mut AnalysisState) {
        for i in 0..state.out.expressions.len() {
            let Some(column_ref) = state.out.expressions.get(i).and_then(Expression::column_ref) else { continue };
            let ids = Self::resolved_column_ids(state, column_ref.resolved);
            if let Some(column_ref) = state.out.expressions.get_mut(i).and_then(Expression::column_ref_mut) {
                column_ref.resolved_ids = ids;
            }
        }
    }

    /// Solve the schema-inference constraints into inferred table schemas
    fn run_schema_inference(state: &mut AnalysisState) {
        let constraints = std::mem::take(&mut state.out.inference_constraints);
        if constraints.is_empty() {
            return;
        }
        let out = &mut state.out;

        fn get_or_create_schema(out: &mut super::AnalyzedScript, table_name: &QualifiedTableName) -> usize {
            let key = table_name.key();
            if let Some(&i) = out.inferred_table_schemas_by_name.get(&key) {
                return i;
            }
            out.inferred_table_schemas.push(InferredTableSchema {
                table_name: table_name.clone(),
                confidence: InferenceConfidence::None,
                columns: Vec::new(),
                columns_by_name: HashMap::default(),
            });
            let i = out.inferred_table_schemas.len() - 1;
            out.inferred_table_schemas_by_name.insert(key, i);
            i
        }
        fn add_column(schema: &mut InferredTableSchema, column: &Name, confidence: InferenceConfidence) -> usize {
            if let Some(&i) = schema.columns_by_name.get(&column.text) {
                if let Some(c) = schema.columns.get_mut(i) {
                    c.confidence = c.confidence.max(confidence);
                }
                schema.confidence = schema.confidence.max(confidence);
                return i;
            }
            let i = schema.columns.len();
            schema.columns_by_name.insert(column.text.clone(), i);
            schema.columns.push(InferredColumn {
                column_name: column.clone(),
                confidence,
                candidate_table_names: Vec::new(),
            });
            schema.confidence = schema.confidence.max(confidence);
            i
        }
        let has_confident_column = |out: &super::AnalyzedScript, table_name: &QualifiedTableName, column: &str| {
            let schema = out
                .inferred_table_schemas_by_name
                .get(&table_name.key())
                .and_then(|&i| out.inferred_table_schemas.get(i));
            let Some(schema) = schema else { return false };
            let column = schema.columns_by_name.get(column).and_then(|&c| schema.columns.get(c));
            column.is_some_and(|c| c.confidence == InferenceConfidence::Confident)
        };
        let write_owner =
            |out: &mut super::AnalyzedScript, expr: Option<u32>, owner: &InferenceCandidate, confidence| {
                let expr = expr.and_then(|expr| out.expressions.get_mut(expr as usize));
                if let Some(column_ref) = expr.and_then(|e| e.column_ref_mut()) {
                    column_ref.inferred = Some(InferredOwner {
                        table_ref: owner.table_ref,
                        table_name: owner.table_name.clone(),
                        confidence,
                    });
                }
            };

        let mut resolved = vec![false; constraints.len()];

        // Step 1: seed the forced constraints
        for (c, is_resolved) in constraints.iter().zip(resolved.iter_mut()) {
            if c.kind != InferenceConstraintKind::Forced {
                continue;
            }
            let Some(candidate) = c.candidates.first() else { continue };
            let schema = get_or_create_schema(out, &candidate.table_name);
            if let Some(schema) = out.inferred_table_schemas.get_mut(schema) {
                add_column(schema, &c.column_name, InferenceConfidence::Confident);
            }
            write_owner(out, c.expression_id, candidate, InferenceConfidence::Confident);
            *is_resolved = true;
        }

        // Step 2: propagate over disjunctive constraints to a fixpoint. A disjunction is explained
        // when exactly one candidate confidently owns its column.
        let mut changed = true;
        while changed {
            changed = false;
            for (c, is_resolved) in constraints.iter().zip(resolved.iter_mut()) {
                if *is_resolved || c.kind != InferenceConstraintKind::Disjunctive {
                    continue;
                }
                let owners: Vec<&InferenceCandidate> = c
                    .candidates
                    .iter()
                    .filter(|candidate| has_confident_column(out, &candidate.table_name, &c.column_name.text))
                    .collect();
                let Some(&owner) = owners.first() else { continue };
                // Several owners make the use ambiguous, record a best guess
                let confidence =
                    if owners.len() == 1 { InferenceConfidence::Confident } else { InferenceConfidence::Candidate };
                write_owner(out, c.expression_id, owner, confidence);
                *is_resolved = true;
                changed = true;
            }
        }

        // Step 3: assign the residual disjunctions to the candidate with the most inferred columns
        for (c, is_resolved) in constraints.iter().zip(resolved.iter_mut()) {
            if *is_resolved || c.kind != InferenceConstraintKind::Disjunctive {
                continue;
            }
            if c.candidates.is_empty() || c.candidates.len() > MAX_TABLE_REF_AMBIGUITY {
                *is_resolved = true;
                continue;
            }
            let mut best = 0;
            let mut best_columns = 0;
            for (ci, candidate) in c.candidates.iter().enumerate() {
                let n = out
                    .inferred_table_schemas_by_name
                    .get(&candidate.table_name.key())
                    .and_then(|&s| out.inferred_table_schemas.get(s))
                    .map_or(0, |s| s.columns.len());
                if n > best_columns {
                    best_columns = n;
                    best = ci;
                }
            }
            let Some(best_candidate) = c.candidates.get(best) else { continue };
            let schema = get_or_create_schema(out, &best_candidate.table_name);
            if let Some(schema) = out.inferred_table_schemas.get_mut(schema) {
                let column = add_column(schema, &c.column_name, InferenceConfidence::Candidate);
                if let Some(column) = schema.columns.get_mut(column) {
                    // Several uses of the column name the same other tables once
                    for (ci, candidate) in c.candidates.iter().enumerate() {
                        let key = candidate.table_name.key();
                        if ci != best && !column.candidate_table_names.iter().any(|n| n.key() == key) {
                            column.candidate_table_names.push(candidate.table_name.clone());
                        }
                    }
                }
            }
            write_owner(out, c.expression_id, best_candidate, InferenceConfidence::Candidate);
            *is_resolved = true;
        }
        state.out.inference_constraints = constraints;
    }
}
