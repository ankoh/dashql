//! The analyzer types.
//!
//! Every object lives in an arena of the analyzed script and is referenced by its index.

use crate::catalog::*;
use crate::hash::HashMap;
use dashql_buffers::algebra::{BinaryExpressionFunction, ComparisonFunction, LiteralType};
use dashql_buffers::analyzer::{AnalyzerErrorSeverity, AnalyzerErrorType};
use dashql_buffers::parser::{IntervalType as IntervalTypeEnum, KnownFunction, Node, SymbolSpan};
use dashql_parser::span::TextSpan;
use std::sync::Arc;

/// An expression id (index into the expressions)
pub type ExprId = u32;
/// A name scope id (index into the name scopes)
pub type ScopeId = u32;
/// A table reference id (index into the table references)
pub type TableRefId = u32;

/// A map that iterates in insertion order and never overwrites
#[derive(Clone, Debug)]
pub struct OrderedMap<V> {
    /// The keys and values in insertion order
    entries: Vec<(Arc<str>, V)>,
    /// The index of every key in the entries
    index: HashMap<Arc<str>, usize>,
}

impl<V> Default for OrderedMap<V> {
    fn default() -> Self {
        Self { entries: Vec::new(), index: HashMap::default() }
    }
}

impl<V> OrderedMap<V> {
    pub fn get_index(&self, key: &str) -> Option<usize> {
        self.index.get(key).copied()
    }
    pub fn at(&self, i: usize) -> Option<&V> {
        self.entries.get(i).map(|(_, v)| v)
    }
    /// Insert a value unless the key exists. Returns the index of the key.
    pub fn insert(&mut self, key: Arc<str>, value: V) -> usize {
        if let Some(&i) = self.index.get(&key) {
            return i;
        }
        self.entries.push((key.clone(), value));
        self.index.insert(key, self.entries.len() - 1);
        self.entries.len() - 1
    }
    pub fn iter(&self) -> impl Iterator<Item = (&Arc<str>, &V)> {
        self.entries.iter().map(|(k, v)| (k, v))
    }
}

/// An analyzer error
#[derive(Clone, Debug, PartialEq)]
pub struct AnalyzerError {
    /// The error type
    pub error_type: AnalyzerErrorType,
    /// The error severity
    pub severity: AnalyzerErrorSeverity,
    /// The AST node id of the error location, None if there is none
    pub ast_node_id: Option<u32>,
    /// The symbol span of the AST node
    pub symbol_span: Option<SymbolSpan>,
    /// The location in the script text
    pub text_span: Option<TextSpan>,
    /// The error message
    pub message: String,
}

/// Whether a table reference reads or writes
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TableRole {
    #[default]
    Read,
    Write,
}

/// A resolved table
#[derive(Clone, Debug)]
pub struct ResolvedTableEntry {
    /// The table name, may refer to a different catalog entry
    pub table_name: QualifiedTableName,
    /// The catalog id of the schema
    pub catalog_schema_id: QualifiedCatalogObjectId,
    /// The catalog id of the table
    pub catalog_table_id: QualifiedCatalogObjectId,
    /// The catalog version of the resolved table
    pub referenced_catalog_version: CatalogVersion,
}

/// A relation expression
#[derive(Clone, Debug)]
pub struct RelationExpression {
    /// The table name as written in the script
    pub table_name: QualifiedTableName,
    /// The resolved table, None if the name was not found
    pub resolved_table: Option<ResolvedTableEntry>,
    /// The ambiguous matches
    pub resolved_alternatives: Vec<ResolvedTableEntry>,
    /// The CTE that a read resolves to, a CTE has no catalog ids and leaves `resolved_table` empty
    pub resolved_cte: Option<CteLoc>,
}

/// A table reference
#[derive(Clone, Debug)]
pub struct TableReference {
    /// The table reference id
    pub table_reference_id: ExternalObjectId,
    /// The AST node id of the table ref
    pub ast_node_id: u32,
    /// The location in the script
    pub location: Option<SymbolSpan>,
    /// The AST statement id
    pub ast_statement_id: Option<u32>,
    /// The AST node id of the root of the enclosing name scope
    pub ast_scope_root: Option<u32>,
    /// The alias name and its location
    pub alias: Option<(Name, SymbolSpan)>,
    /// The column names of the alias, they rename the leading columns of the table
    pub column_aliases: Vec<Name>,
    /// The referenced relation, None if the table ref has no table name
    pub inner: Option<RelationExpression>,
    /// Whether the reference reads or writes the table
    pub role: TableRole,
}

impl TableReference {
    /// Does the table reference read the result of a script, a table parameter `:foo`? The planner reads it through
    /// the script references, not as a relation.
    pub fn reads_table_parameter(&self) -> bool {
        self.inner.as_ref().and_then(|r| r.resolved_table.as_ref()).is_some_and(|t| {
            t.catalog_table_id.unpack_table_id().origin == crate::table_parameters::TABLE_PARAMETERS_ENTRY_ID
        })
    }
}

/// An explicit INSERT target column
#[derive(Clone, Debug)]
pub struct InsertTargetColumn {
    /// The AST node id of the column name
    pub ast_node_id: u32,
    /// The column name
    pub column_name: Name,
    /// The resolved column of the target table
    pub resolved: Option<ColumnLoc>,
}

/// An INSERT statement
#[derive(Clone, Debug)]
pub struct InsertStatement {
    /// The AST node id of the INSERT
    pub ast_node_id: u32,
    /// The AST statement id
    pub ast_statement_id: Option<u32>,
    /// The table reference of the target table
    pub target: TableRefId,
    /// The AST node id of the source query
    pub source_ast_node_id: Option<u32>,
    /// Whether the statement inserts DEFAULT VALUES
    pub default_values: bool,
    /// Whether the statement has a RETURNING clause
    pub returning: bool,
    /// The explicit target columns
    pub target_columns: Vec<InsertTargetColumn>,
}

/// The confidence of a schema inference
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
pub enum InferenceConfidence {
    #[default]
    None = 0,
    Candidate = 1,
    Confident = 2,
}

/// The inferred owner of an unresolved column
#[derive(Clone, Debug)]
pub struct InferredOwner {
    /// The unresolved table reference that owns the column
    pub table_ref: TableRefId,
    /// The (un-normalized) table name of the owner
    pub table_name: QualifiedTableName,
    /// The confidence of the assignment
    pub confidence: InferenceConfidence,
}

/// What a column reference resolved to
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ColumnResolution {
    #[default]
    Unresolved,
    /// A catalog table column
    TableColumn(ColumnLoc),
    /// An output column of a scope
    ScopeColumn { scope: ScopeId, column: u32 },
}

impl ColumnResolution {
    pub fn is_resolved(&self) -> bool {
        !matches!(self, ColumnResolution::Unresolved)
    }
}

/// The catalog ids of a resolved column
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ResolvedColumnIds {
    /// The catalog id of the schema
    pub catalog_schema_id: QualifiedCatalogObjectId,
    /// The catalog id of the table column
    pub catalog_table_column_id: QualifiedCatalogObjectId,
    /// The catalog version of the table
    pub referenced_catalog_version: CatalogVersion,
}

/// A column reference
#[derive(Clone, Debug)]
pub struct ColumnRef {
    /// The qualified column name as written in the script
    pub column_name: QualifiedColumnName,
    /// The AST node id of the root of the enclosing name scope
    pub ast_scope_root: Option<u32>,
    /// What the column ref resolved to
    pub resolved: ColumnResolution,
    /// The AST node of the FROM item that the column ref reads, a table ref or a derived table. None for an output
    /// column of the own scope, e.g. an alias in ORDER BY.
    pub resolved_source: Option<u32>,
    /// The catalog ids behind the resolution, computed once the analysis is done
    /// (scope columns are followed through their source expressions)
    pub resolved_ids: Option<ResolvedColumnIds>,
    /// The inferred owner of a column that stays unresolved, set by the schema inference
    pub inferred: Option<InferredOwner>,
}

/// A literal
#[derive(Clone, Debug)]
pub struct Literal {
    /// The literal type
    pub literal_type: LiteralType,
    /// The raw value in the script text
    pub raw_value: TextSpan,
}

/// A comparison
#[derive(Clone, Copy, Debug)]
pub struct Comparison {
    /// The comparison function
    pub func: ComparisonFunction,
    /// The expression id of the left child
    pub left_expression_id: u32,
    /// The expression id of the right child
    pub right_expression_id: u32,
}

/// A binary expression
#[derive(Clone, Copy, Debug)]
pub struct BinaryExpression {
    /// The binary expression function
    pub func: BinaryExpressionFunction,
    /// The expression id of the left child
    pub left_expression_id: u32,
    /// The expression id of the right child
    pub right_expression_id: u32,
}

/// A function argument
#[derive(Clone, Debug)]
pub struct FunctionArgument {
    /// The AST node id of the argument
    pub ast_node_id: u32,
    /// The AST node id of the argument value
    pub value_ast_node_id: u32,
    /// The argument name, if the argument is named
    pub name: Option<Name>,
    /// The expression id, `Some(0)` by default
    pub expression_id: Option<u32>,
}

impl Default for FunctionArgument {
    fn default() -> Self {
        Self { ast_node_id: 0, value_ast_node_id: 0, name: None, expression_id: Some(0) }
    }
}

/// The name of a called function
#[derive(Clone, Debug)]
pub enum FunctionName {
    Known(KnownFunction),
    Qualified(QualifiedFunctionName),
}

/// The arguments of a function call
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum FunctionArguments {
    #[default]
    None,
    /// A slice of the function arguments of the script
    Generic { begin: u32, count: u32 },
}

/// A function call
#[derive(Clone, Debug)]
pub struct FunctionCall {
    /// The function name
    pub function_name: FunctionName,
    /// The `FunctionCallModifier` bits (star, ALL, DISTINCT, VARIADIC, OVER, WITHIN GROUP)
    pub function_call_modifiers: u8,
    /// The arguments
    pub arguments: FunctionArguments,
}

/// An interval type
#[derive(Clone, Copy, Debug)]
pub struct IntervalType {
    /// The interval type
    pub interval_type: IntervalTypeEnum,
    /// The expression id of the interval precision, if any
    pub precision_expression: Option<i32>,
}

/// A constant interval cast
#[derive(Clone, Copy, Debug)]
pub struct ConstIntervalCast {
    /// The expression id of the value
    pub value_expression_id: u32,
    /// The interval type, if not in the value text
    pub interval: Option<IntervalType>,
}

/// The kind of an expression
#[derive(Clone, Debug, Default)]
pub enum ExpressionInner {
    #[default]
    None,
    ColumnRef(ColumnRef),
    Literal(Literal),
    Comparison(Comparison),
    BinaryExpression(BinaryExpression),
    FunctionCall(FunctionCall),
    ConstIntervalCast(ConstIntervalCast),
}

/// An expression
#[derive(Clone, Debug)]
pub struct Expression {
    /// The expression id (index into the expressions)
    pub expression_id: u32,
    /// The AST node id
    pub ast_node_id: u32,
    /// The location in the script
    pub location: Option<SymbolSpan>,
    /// The AST statement id
    pub ast_statement_id: Option<u32>,
    /// The kind of the expression
    pub inner: ExpressionInner,
    /// Whether the expression is constant
    pub is_constant_expression: bool,
}

impl Expression {
    pub fn column_ref(&self) -> Option<&ColumnRef> {
        match &self.inner {
            ExpressionInner::ColumnRef(c) => Some(c),
            _ => None,
        }
    }
    pub fn column_ref_mut(&mut self) -> Option<&mut ColumnRef> {
        match &mut self.inner {
            ExpressionInner::ColumnRef(c) => Some(c),
            _ => None,
        }
    }
}

/// A result target
#[derive(Clone, Debug, Default)]
pub struct ResultTarget {
    /// The AST node id
    pub ast_node_id: u32,
    /// The output column name, the alias or the name of a column ref
    pub column_name: Option<Name>,
    /// The expression id, if not a star
    pub expression_id: Option<u32>,
    /// Whether the target is a star
    pub is_star: bool,
    /// The source name of a qualified star (`t.*`)
    pub star_qualifier: Option<Name>,
}

/// The source of a scope output column
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScopeColumnSource {
    Expression(ExprId),
    TableColumn(ColumnLoc),
    /// A computed column that has no expression of the analyzer
    Computed,
}

/// An output column of a scope
#[derive(Clone, Debug)]
pub struct ScopeColumn {
    /// The column name
    pub column_name: Name,
    /// The source of the column values
    pub source: ScopeColumnSource,
}

/// A CTE definition in the AST
#[derive(Clone, Debug)]
pub struct CteDefinition {
    /// The CTE name
    pub cte_name: Name,
    /// The AST node id of the CTE statement
    pub select_node_id: u32,
    /// The AST node id of the column alias array, if there is one
    pub columns_node_id: Option<u32>,
    /// The number of column aliases
    pub columns_count: u16,
    /// The AST node id of the CTE definition
    pub ast_node_id: u32,
}

/// A CTE attached to a scope
#[derive(Clone, Debug)]
pub struct ResolvedCte {
    /// The CTE name
    pub cte_name: Name,
    /// The scope of the CTE statement
    pub child_scope: Option<ScopeId>,
    /// The AST node id of the CTE definition
    pub definition_node_id: u32,
    /// The column aliases, they rename the leading output columns of the statement
    pub column_aliases: Vec<Name>,
}

/// A CTE location: the scope that defines it and its index in the CTEs of that scope
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CteLoc {
    /// The scope that defines the CTE
    pub scope: ScopeId,
    /// The index in the CTEs of that scope
    pub index: u32,
}

/// An unresolved table in scope
#[derive(Clone, Debug)]
pub struct UnresolvedRelation {
    /// The table reference that introduced the relation
    pub table_ref: TableRefId,
    /// The (un-normalized) table name, the identity for schema inference
    pub table_name: QualifiedTableName,
}

/// A table-like source in scope
#[derive(Clone, Debug)]
pub enum ReferencedTable {
    Table(TableLoc),
    Cte(CteLoc),
    /// A derived table, the output columns of a child scope
    Subquery(ScopeId),
    Unresolved(UnresolvedRelation),
}

impl ReferencedTable {
    pub fn is_unresolved_relation(&self) -> bool {
        matches!(self, ReferencedTable::Unresolved(_))
    }
}

/// A FROM item of a scope
#[derive(Clone, Debug)]
pub struct ScopeSource {
    /// The table ref node
    pub ast_node_id: u32,
    /// The alias or the table name, an unaliased derived table has no name
    pub name: Option<Arc<str>>,
    /// The column names of the alias, they rename the leading columns of the source
    pub column_aliases: Vec<Name>,
    /// The table-like source
    pub table: ReferencedTable,
    /// The qualified name of the table of a table ref without alias, a column ref can qualify a column with the
    /// schema and the database of the table (`s.t.a`). Unaliased tables of different schemas share their name.
    pub table_name: Option<QualifiedTableName>,
}

/// The FROM items of a scope that column refs can see
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SourceVisibility {
    #[default]
    All,
    /// The FROM items before a table ref node, a lateral derived table sees those of its parent
    Before(u32),
    /// Derived tables and CTEs see no FROM items of their parent, but those of the scopes above it
    None,
    /// The FROM item of a table ref node only, a WHEN NOT MATCHED BY SOURCE clause of MERGE sees the target only
    Only(u32),
    /// The FROM items except the one of a table ref node, a WHEN NOT MATCHED clause of MERGE sees no target
    Except(u32),
    /// The FROM items before a table ref node except the one of another, a lateral FROM item of UPDATE, DELETE and
    /// MERGE sees no target
    BeforeExcept(u32, u32),
}

impl SourceVisibility {
    pub fn sees(self, source: &ScopeSource) -> bool {
        self.sees_node(source.ast_node_id)
    }

    /// Whether the FROM item with an AST node id is visible
    pub fn sees_node(self, ast_node_id: u32) -> bool {
        match self {
            SourceVisibility::All => true,
            SourceVisibility::Before(node_id) => ast_node_id < node_id,
            SourceVisibility::None => false,
            SourceVisibility::Only(node_id) => ast_node_id == node_id,
            SourceVisibility::Except(node_id) => ast_node_id != node_id,
            SourceVisibility::BeforeExcept(node_id, except) => ast_node_id < node_id && ast_node_id != except,
        }
    }
}

/// A parenthesized join with an alias, `(t join u using (a)) as j`. The alias names the join, outside of the join it
/// hides the names of the FROM items inside it, as in PostgreSQL.
#[derive(Clone, Debug)]
pub struct ScopeJoin {
    /// The AST node id of the table ref of the join
    pub ast_node_id: u32,
    /// The alias
    pub name: Arc<str>,
    /// The column aliases, they rename the leading columns of the join
    pub column_aliases: Vec<Name>,
    /// The columns of the join as `*` lists them, a USING column once, renamed by the column aliases. Set when the
    /// names of the script are resolved.
    pub columns: Vec<ScopeJoinColumn>,
}

/// A column of a join: the FROM item that it comes from and its position among the columns of the FROM item
#[derive(Clone, Debug)]
pub struct ScopeJoinColumn {
    /// The AST node id of the FROM item
    pub source: u32,
    /// The position among the columns of the FROM item
    pub position: u32,
    /// The column, with the name that the join gives it
    pub column: ScopeColumn,
}

/// A clause of a scope whose column refs see only some FROM items of the scope
#[derive(Clone, Copy, Debug)]
pub struct ScopeClause {
    /// The AST node id of the clause
    pub ast_node_id: u32,
    /// The FROM items that the column refs of the clause see, also from its subqueries
    pub visibility: SourceVisibility,
}

/// Is an AST node within the subtree of another one?
pub fn is_within(ast: &[Node], mut node_id: u32, ancestor: u32) -> bool {
    // Parents follow their children in the post-order AST
    while node_id < ancestor {
        let Some(node) = ast.get(node_id as usize) else { return false };
        let parent = node.parent();
        // Statement roots are their own parents
        if parent == node_id || parent as usize >= ast.len() {
            return false;
        }
        node_id = parent;
    }
    node_id == ancestor
}

/// A naming scope
#[derive(Clone, Debug, Default)]
pub struct NameScope {
    /// The scope id (index into the name scopes)
    pub name_scope_id: u32,
    /// The AST node id of the scope root
    pub ast_node_id: u32,
    /// The AST statement id, None outside of statements
    pub ast_statement_id: Option<u32>,
    /// The parent scope, None for a root scope
    pub parent_scope: Option<ScopeId>,
    /// The child scopes
    pub child_scopes: Vec<ScopeId>,
    /// The column references of the scope
    pub expressions: Vec<ExprId>,
    /// The table references of the scope
    pub table_references: Vec<TableRefId>,
    /// The result targets of the scope
    pub result_targets: Vec<ResultTarget>,
    /// The output columns in order, for positional column aliases
    pub output_columns: Vec<ScopeColumn>,
    /// The output columns by name (index into the output columns)
    pub output_columns_by_name: HashMap<Arc<str>, usize>,
    /// The CTEs attached to the scope by name, in declaration order
    pub cte_definitions: OrderedMap<ResolvedCte>,
    /// The AST node ids of the CTE definitions by name
    pub cte_definition_nodes: HashMap<Arc<str>, u32>,
    /// Whether the WITH clause of the scope is recursive
    pub ctes_recursive: bool,
    /// Column refs cannot correlate with any parent scope
    pub column_correlation_barrier: bool,
    /// The FROM items of the parent scope that the column refs of this scope can see
    pub parent_visibility: SourceVisibility,
    /// The FROM items in FROM order
    pub sources: Vec<ScopeSource>,
    /// The parenthesized joins with an alias, an outer join before the joins inside it. The FROM items inside them stay
    /// the sources.
    pub joins: Vec<ScopeJoin>,
    /// The clauses whose column refs see only some FROM items, the WHEN NOT MATCHED clauses of MERGE
    pub clauses: Vec<ScopeClause>,
}

impl NameScope {
    /// The FROM item with a name
    pub fn source(&self, name: &str) -> Option<&ScopeSource> {
        self.sources.iter().find(|s| s.name.as_deref() == Some(name))
    }

    /// Does a name name a FROM item or an aliased join of the scope?
    pub fn names_relation(&self, name: &str) -> bool {
        self.source(name).is_some() || self.joins.iter().any(|join| &*join.name == name)
    }

    /// The FROM items of the scope that an AST node in it sees, all of them outside of a restricting clause
    pub fn visibility_at(&self, ast: &[Node], node_id: u32) -> SourceVisibility {
        let clause = self.clauses.iter().find(|clause| is_within(ast, node_id, clause.ast_node_id));
        clause.map_or(SourceVisibility::All, |clause| clause.visibility)
    }

    /// The aliased joins that hide the FROM items inside them from an AST node: the outermost ones that don't contain
    /// the node
    pub fn hiding_joins(&self, ast: &[Node], node_id: u32) -> Vec<&ScopeJoin> {
        let outside = |join: &ScopeJoin| !is_within(ast, node_id, join.ast_node_id);
        let nested = |join: &ScopeJoin| {
            self.joins.iter().any(|other| {
                other.ast_node_id != join.ast_node_id
                    && outside(other)
                    && is_within(ast, join.ast_node_id, other.ast_node_id)
            })
        };
        self.joins.iter().filter(|join| outside(join) && !nested(join)).collect()
    }

    /// Is a FROM item inside one of some aliased joins?
    pub fn is_hidden(ast: &[Node], source: &ScopeSource, joins: &[&ScopeJoin]) -> bool {
        joins.iter().any(|join| is_within(ast, source.ast_node_id, join.ast_node_id))
    }

    /// The FROM items that match a name from an AST node: those that the node sees and that no aliased join hides from
    /// it. Inside an aliased join, the FROM items of the join shadow those outside of it, which can take their names.
    pub fn named_sources(
        &self,
        ast: &[Node],
        node_id: u32,
        visibility: SourceVisibility,
        named: impl Fn(&ScopeSource) -> bool,
    ) -> Vec<&ScopeSource> {
        let hiding = self.hiding_joins(ast, node_id);
        let mut sources: Vec<&ScopeSource> = self
            .sources
            .iter()
            .filter(|s| visibility.sees(s) && !Self::is_hidden(ast, s, &hiding) && named(s))
            .collect();
        // The aliased joins around the node, the innermost first: a nested join precedes the outer one in the
        // post-order AST
        let mut around: Vec<&ScopeJoin> =
            self.joins.iter().filter(|join| is_within(ast, node_id, join.ast_node_id)).collect();
        around.sort_by_key(|join| join.ast_node_id);
        let inside = |s: &ScopeSource, join: &ScopeJoin| is_within(ast, s.ast_node_id, join.ast_node_id);
        if let Some(join) = around.into_iter().find(|join| sources.iter().any(|s| inside(s, join))) {
            sources.retain(|s| inside(s, join));
        }
        sources
    }
}

/// A candidate owner of an inference constraint
#[derive(Clone, Debug)]
pub struct InferenceCandidate {
    /// The (un-normalized) table name, the identity in the solver
    pub table_name: QualifiedTableName,
    /// The unresolved table reference
    pub table_ref: TableRefId,
}

/// The kind of an inference constraint
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum InferenceConstraintKind {
    Forced,
    Disjunctive,
}

/// A schema-inference constraint
#[derive(Clone, Debug)]
pub struct InferenceConstraint {
    /// The kind of the constraint
    pub kind: InferenceConstraintKind,
    /// The column ref expression the constraint was derived from
    pub expression_id: u32,
    /// The column name that must be owned
    pub column_name: Name,
    /// The candidate owner tables, one for a forced constraint
    pub candidates: Vec<InferenceCandidate>,
}

/// An inferred column of an unresolved table
#[derive(Clone, Debug)]
pub struct InferredColumn {
    /// The column name
    pub column_name: Name,
    /// The confidence of the inference
    pub confidence: InferenceConfidence,
    /// The other feasible owner tables of a candidate column, empty if confident
    pub candidate_table_names: Vec<QualifiedTableName>,
}

/// An inferred schema of a table that is not in the catalog
#[derive(Clone, Debug)]
pub struct InferredTableSchema {
    /// The (un-normalized) table name, the identity across statements
    pub table_name: QualifiedTableName,
    /// The confidence of the schema, the maximum over its columns
    pub confidence: InferenceConfidence,
    /// The inferred columns in order of first appearance
    pub columns: Vec<InferredColumn>,
    /// The columns by name (index into the columns)
    pub columns_by_name: HashMap<Arc<str>, usize>,
}

/// What a parameter stands for
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ParameterKind {
    /// A scalar value, e.g. `where x > :min`
    Scalar,
    /// A table, e.g. `from :source`
    Table,
}

/// A parameter of the script: a named `:name` (also `:"name"`, `:'name'`), a positional `$1` or an unnamed `?`
#[derive(Clone, Debug)]
pub struct Parameter {
    /// The parameter ref node
    pub ast_node_id: u32,
    /// The statement of the parameter
    pub ast_statement_id: Option<u32>,
    /// The location, with the prefix
    pub location: SymbolSpan,
    /// What the parameter stands for
    pub kind: ParameterKind,
    /// The name without the prefix, `1` for `$1`, None for an unnamed `?`
    pub name: Option<Arc<str>>,
    /// The type of the cast whose value is a scalar parameter, `:min::int`
    pub cast_type: Option<super::sql_types::SqlType>,
}

/// A constant expression root
#[derive(Clone, Copy, Debug)]
pub struct ConstantExpression {
    /// The root expression of the constant tree
    pub root: ExprId,
}

/// Dashboard placement
#[derive(Clone, Debug)]
pub struct DashboardSpec {
    /// The grid row, None for automatic placement
    pub row: Option<i32>,
    /// The grid column (0-11), None for automatic placement
    pub column: Option<i32>,
    /// The width in grid columns (1-12)
    pub width: i32,
    /// The height in grid rows (at least 1), a row is as high as a collapsed card
    pub height: i32,
}

impl Default for DashboardSpec {
    fn default() -> Self {
        Self { row: None, column: None, width: 6, height: 6 }
    }
}

impl DashboardSpec {
    /// The size of a KPI card without a size of its own: four of them fill a row of the board
    pub const KPI_WIDTH: i32 = 3;
    pub const KPI_HEIGHT: i32 = 3;
}

/// The dashboard placement of a script, the `@board` tag of its last statement. A statement without a renderer is a
/// collapsed card.
#[derive(Clone, Debug)]
pub struct BoardSpec {
    /// The statement whose annotation holds the tag, the last statement
    pub statement_id: u32,
    /// The placement
    pub dashboard: DashboardSpec,
}

/// The placement of a script on the dataflow canvas, its `@flow` tag: a position, a size, or both
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FlowSpec {
    /// The statement whose annotation holds the tag
    pub statement_id: u32,
    /// The x and y coordinates of the top left corner of the box, None places the box automatically
    pub position: Option<(i32, i32)>,
    /// The width of the box, None for the default width
    pub width: Option<i32>,
    /// The height of the chart of the box, None for the default height
    pub height: Option<i32>,
}

/// The value of an input of the script, its `@param :name = <literal>` tag
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ParamTag {
    /// The statement whose annotation holds the tag
    pub statement_id: u32,
    /// The name of the input, the scalar parameter `:name`
    pub name: Arc<str>,
    /// The value, a literal in the Hyper dialect, None if the input is unset or the value is no literal
    pub literal: Option<crate::sql_literal::SqlLiteral>,
}

/// A Markdown spec
#[derive(Clone, Debug, Default)]
pub struct MarkdownSpec {
    /// The row template of the `@vis markdown` tag
    pub row_template: String,
}

/// The change that a KPI card shows next to its value, the `delta` of `@vis kpi`
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum KpiDelta {
    /// The value of the last row against the row before it
    #[default]
    Previous,
    /// The value of the last row against the first row
    First,
    /// Only the value
    None,
}

impl KpiDelta {
    /// The values of the `delta` arg
    pub const NAMES: &'static [&'static str] = &["previous", "first", "none"];

    /// The delta of a value of the `delta` arg
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "previous" => Some(Self::Previous),
            "first" => Some(Self::First),
            "none" => Some(Self::None),
            _ => None,
        }
    }
}

/// The chart of a KPI card behind its value, the `chart` of `@vis kpi`
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum KpiChart {
    /// A line with its area
    #[default]
    Line,
    /// A bar per row, from zero
    Bar,
    /// Only the value
    None,
}

impl KpiChart {
    /// The values of the `chart` arg
    pub const NAMES: &'static [&'static str] = &["line", "bar", "none"];

    /// The chart of a value of the `chart` arg
    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "line" => Some(Self::Line),
            "bar" => Some(Self::Bar),
            "none" => Some(Self::None),
            _ => None,
        }
    }
}

/// A KPI card, the args of the `@vis kpi` tag. The value of the last row is the figure, the rows are the chart
/// behind it.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct KpiSpec {
    /// The column of the value, None for the last column of the result
    pub value: Option<String>,
    /// The column of the x axis of the chart, None for the first column of a result with more than one
    pub x: Option<String>,
    /// The change next to the value
    pub delta: KpiDelta,
    /// The chart behind the value
    pub chart: KpiChart,
}

/// A visualization specification, built from the `@vis` tags of a query
#[derive(Clone, Debug, Default)]
pub struct VisualizationSpec {
    /// The AST node id of the visualized query
    pub ast_node_id: u32,
    /// The AST statement id
    pub ast_statement_id: Option<u32>,
    /// The renderer named by the `@vis` tag (`vegalite`, `markdown`, `kpi` or `table`)
    pub renderer: Option<String>,
    /// The dashboard grid placement
    pub dashboard: DashboardSpec,
    /// The Markdown spec, present if the renderer is `markdown`
    pub markdown: Option<MarkdownSpec>,
    /// The Vega-Lite spec of a `@vis vegalite` tag, a JSON object without `data`
    pub vegalite: Option<serde_json::Map<String, serde_json::Value>>,
    /// The KPI card, present if the renderer is `kpi`
    pub kpi: Option<KpiSpec>,
}
