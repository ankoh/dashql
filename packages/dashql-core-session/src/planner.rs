//! The planner.
//!
//! Plans relation-level hazards between the statements of several scripts: every statement becomes
//! a node with the relations it reads, writes or defines, and edges order conflicting accesses.
//! Opaque SELECT functions may have side effects; barriers order statements but do not promise
//! backend session affinity.
//!
//! Scripts run on connections, every connection has its own catalog. Relations of different connections
//! never conflict. A script references the result of another script with a table parameter, `:foo` reads
//! the terminal query of `foo.sql` (see `script_references`). A reference within one connection inlines the
//! query into the statement as a common table expression, a reference of the LOCAL connection to another
//! connection scans the result as Parquet file that the host materializes, a reference of a REMOTE
//! connection to another connection is an error.
//!
//! A plan covers the whole session or the target scripts and what they need: the statements that an inlined
//! reference needs before it, and the scripts that a scan reference scans unless the host provides
//! their results. A plan of the session leaves out the scripts whose results the host provides. A plan of targets treats statements like a run of a single script: statements of every
//! kind keep their SQL, and the statements of a script run in their order.

use crate::catalog_changes::{derive_catalog_change, CatalogChangeOptions};
use crate::compiler::{compile_visualization, produces_output, read_executable_text, read_executable_text_with};
use crate::script_references::{self, ReferenceErrors, ReferenceKind, ScriptReferences};
use crate::session_inputs::{bind_inputs, collect_session_inputs, SessionInputs};
use dashql_buffers::analyzer::AnalyzerErrorSeverity;
use dashql_buffers::formatting::FormattingDialect;
use dashql_buffers::execution::{
    ExecutionGraphAccessMode as Mode, ExecutionGraphAccessT, ExecutionGraphCatalogObjectIDT, ExecutionGraphConnectionKind,
    ExecutionGraphConnectionT, ExecutionGraphDiagnosticT, ExecutionGraphEdgeReason as Reason, ExecutionGraphEdgeT, ExecutionGraphEntityT,
    ExecutionGraphAttachmentT, ExecutionGraphEntityType, ExecutionGraphMaterializationT, ExecutionGraphNodeT, ExecutionGraphScriptReferenceT, ExecutionGraphScriptT,
    ExecutionGraphT, ExecutionGraphUnresolvedReferenceT,
};
use dashql_buffers::parser::{AttributeKey as Key, Node, NodeType, StatementType as Type, TempType, TextSpanT};
use dashql_core::analyzer::{AnalyzedScript, ReferencedTable, RelationExpression, TableRole};
use dashql_core::catalog::{Catalog, CatalogEntryId, CatalogEntryRef, QualifiedCatalogObjectId, QualifiedTableName, TableDeclaration};
use dashql_core::pack;
use dashql_core::script::Script;
use dashql_parser::attrs;
use dashql_parser::parser::context::resolve_text_span;
use dashql_parser::parser::ParsedScript;
use dashql_parser::scanner::ScannedScript;
use dashql_parser::span::TextSpan;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

/// A relation name: (database, schema, table)
type Name = (String, String, String);

const NONE: u32 = u32::MAX;

fn resource_name(name: &QualifiedTableName) -> Name {
    (name.database_name.text.to_string(), name.schema_name.text.to_string(), name.table_name.text.to_string())
}

/// The table declarations of an entry with their AST statement ids
fn tables(entry: &CatalogEntryRef) -> &[TableDeclaration] {
    &entry.data().table_declarations
}

/// The kind of a connection
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConnectionKind {
    /// A database that only reads its own relations
    Remote,
    /// The embedded Hyper, which scans the materialized results of scripts of other connections
    Local,
}

/// A connection of the plan
#[derive(Clone, Copy)]
pub struct PlannerConnection<'a> {
    /// The connection id of the host
    pub id: &'a str,
    /// The kind of the connection
    pub kind: ConnectionKind,
    /// The catalog of the connection, its scripts were analyzed with it
    pub catalog: &'a Catalog,
    /// The SQL dialect of the connection, the planner prints the values of inputs in it
    pub dialect: FormattingDialect,
}

/// A script of the plan
#[derive(Clone, Copy)]
pub struct PlannerScript<'a> {
    /// The script
    pub script: &'a Script,
    /// The name of the script, `foo` for `foo.sql`, that table parameters reference
    pub name: &'a str,
    /// The connection index
    pub connection: u32,
    /// The name of the Parquet file of the result of the script below the mount prefix, if a statement of another
    /// connection scans it. `s<index>.parquet` if absent.
    pub materialization_file: Option<&'a str>,
}

/// An attachment of the session, a Parquet file that the table parameter `:name` reads
#[derive(Clone, Copy)]
pub struct PlannerAttachment<'a> {
    /// The name, `foo` for `foo.parquet`
    pub name: &'a str,
    /// The file name below the attachment prefix
    pub file: &'a str,
    /// Changes when the file changes, e.g. its size and modification time. The signature of a script that reads the
    /// attachment covers it.
    pub stamp: &'a str,
}

/// What a plan covers
#[derive(Clone, Copy)]
pub enum PlanScope<'a> {
    /// Every statement of every script whose result the host doesn't provide, in session order
    Session,
    /// The target scripts and what they need
    Targets(&'a [u32]),
    /// Every statement of every script whose analysis is current with its text, for the dataflow of a session. Like a
    /// plan of targets, but problems are diagnostics that don't stop the plan: a script without a current analysis is
    /// left out, as are script references with errors or to scripts that were left out. An analysis of an earlier
    /// catalog revision is planned as it is. A plan that left something out is not valid.
    Tolerant,
}

/// A plan request
#[derive(Clone, Copy)]
pub struct SessionPlanRequest<'a> {
    /// The connections
    pub connections: &'a [PlannerConnection<'a>],
    /// The scripts in session order
    pub scripts: &'a [PlannerScript<'a>],
    /// What the plan covers
    pub scope: PlanScope<'a>,
    /// The scripts whose materialized results the host provides. A plan computes them only for its targets, a scan
    /// reads the file of the result.
    pub materialized: &'a [u32],
    /// The directory that the host mounts materialized results in, e.g. the query result cache at `/mnt/external/cache`
    pub mount_prefix: &'a str,
    /// The attachments of the session
    pub attachments: &'a [PlannerAttachment<'a>],
    /// The directory that the host mounts the attachments in, e.g. `/mnt/external/attachments/<session>`
    pub attachment_prefix: &'a str,
}

/// A script with a current analysis
pub(crate) struct Prepared<'a> {
    pub(crate) scanned: &'a ScannedScript,
    pub(crate) parsed: &'a ParsedScript,
    pub(crate) analyzed: &'a Arc<AnalyzedScript>,
}

impl<'a> Prepared<'a> {
    /// The analysis of a script if it is current with the text, whatever catalog it was analyzed with. Script
    /// references depend on the text only.
    pub(crate) fn lenient(script: &'a Script) -> Option<Self> {
        script.current_analysis().map(|(scanned, parsed, analyzed)| Prepared { scanned, parsed, analyzed })
    }

    /// Does the script parse without errors?
    pub(crate) fn parses(&self) -> bool {
        self.scanned.errors.is_empty() && self.parsed.errors.is_empty()
    }

    /// The last statement
    pub(crate) fn terminal(&self) -> Option<u32> {
        self.parsed.statements.len().checked_sub(1).map(|s| s as u32)
    }
}

/// How much of a script a plan includes
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Include {
    /// Nothing
    None,
    /// No statement, the single query of the script is inlined into its consumers, its references are planned
    Inlined,
    /// Every statement
    All,
}

/// The state of the plan
struct PlanState {
    /// The execution graph, completed with the lists below when finished
    graph: ExecutionGraphT,
    /// The entity indexes by connection and table object id
    entities: BTreeMap<(u32, QualifiedCatalogObjectId), u32>,
    /// The unresolved reference indexes by connection and name
    unresolved_references: BTreeMap<(u32, Name), u32>,
    /// The interned table entities, in interning order
    entity_list: Vec<ExecutionGraphEntityT>,
    /// The interned unresolved references, in interning order
    unresolved_list: Vec<ExecutionGraphUnresolvedReferenceT>,
    /// The diagnostics of the plan
    diagnostics: Vec<ExecutionGraphDiagnosticT>,
    /// Do errors leave something out of the plan instead of stopping it? See `PlanScope::Tolerant`.
    tolerant: bool,
    /// Did a tolerant plan leave something out?
    partial: bool,
    /// The inputs of the session, the scalar parameters that the statements bind
    inputs: SessionInputs,
    /// The text span of the statement of every node
    spans: Vec<TextSpan>,
    /// The relations that a node reads only through the queries of inlined scripts: (node, entity, unresolved)
    inherited: BTreeSet<(u32, u32, u32)>,
}

/// A plan and what the planner derived on the way, the dataflow of a session projects it
pub(crate) struct Plan {
    /// The execution graph
    pub(crate) graph: ExecutionGraphT,
    /// The script references, an invalid one keeps the script that its name finds
    pub(crate) references: ScriptReferences,
    /// The inputs of the session
    pub(crate) inputs: SessionInputs,
    /// The text span of the statement of every node
    pub(crate) spans: Vec<TextSpan>,
    /// The relations that a node reads only through the queries of inlined scripts: (node, entity, unresolved)
    pub(crate) inherited: BTreeSet<(u32, u32, u32)>,
}

impl PlanState {
    /// Report a diagnostic, an error invalidates the plan
    fn report(&mut self, node: u32, script: u32, text_span: Option<TextSpan>, message: String, error: bool) {
        let mut d = ExecutionGraphDiagnosticT::default();
        d.node = node;
        d.script = script;
        d.message = opt(Some(message));
        d.text_span = text_span.map(|s| {
            let mut t = TextSpanT::default();
            t.offset = s.offset;
            t.length = s.length;
            t
        });
        d.error = error;
        self.diagnostics.push(d);
        if error && self.tolerant {
            self.partial = true;
        } else if error {
            self.graph.valid = false;
        }
    }

    /// Report a diagnostic of a statement. It is a warning in every scope: the statement runs as written, a barrier
    /// orders it against the other statements of its connection.
    fn diagnose(&mut self, node: u32, script: u32, message: String) {
        self.report(node, script, None, message, false);
    }

    fn intern_entity(&mut self, connection: u32, table: &TableDeclaration) -> u32 {
        if let Some(&i) = self.entities.get(&(connection, table.object_id)) {
            return i;
        }
        let i = self.entity_list.len() as u32;
        self.entities.insert((connection, table.object_id), i);
        let mut entity = ExecutionGraphEntityT::default();
        let mut id = ExecutionGraphCatalogObjectIDT::default();
        id.object_type = ExecutionGraphEntityType::TABLE;
        id.object_id = table.table_id().pack();
        id.sub_object_id = 0;
        entity.catalog_object_id = id;
        (entity.catalog_database_id, entity.catalog_schema_id) = table.catalog_schema_id.unpack_schema_id();
        let (db, schema, name) = resource_name(&table.table_name);
        entity.database_name = opt(Some(db));
        entity.schema_name = opt(Some(schema));
        entity.name = opt(Some(name));
        entity.connection = connection;
        self.entity_list.push(entity);
        i
    }

    fn intern_unresolved(&mut self, connection: u32, name: &Name) -> u32 {
        if let Some(&i) = self.unresolved_references.get(&(connection, name.clone())) {
            return i;
        }
        let i = self.unresolved_list.len() as u32;
        self.unresolved_references.insert((connection, name.clone()), i);
        let mut r = ExecutionGraphUnresolvedReferenceT::default();
        r.database_name = opt(Some(name.0.clone()));
        r.schema_name = opt(Some(name.1.clone()));
        r.name = opt(Some(name.2.clone()));
        r.connection = connection;
        self.unresolved_list.push(r);
        i
    }
}

/// The relations of a connection: the declarations of its catalog and of the planned scripts, and the live
/// namespace while the statements are planned in order
#[derive(Default)]
struct ConnectionState<'a> {
    /// The node of the statement that declares a table, by packed table id
    producers: BTreeMap<u64, u32>,
    /// The declarations by object id
    declarations: BTreeMap<QualifiedCatalogObjectId, &'a TableDeclaration>,
    /// The kinds of the published declarations
    published_views: BTreeMap<QualifiedCatalogObjectId, bool>,
    /// Declarations that are a view in one place and a table in another
    incompatible_kinds: BTreeSet<QualifiedCatalogObjectId>,
    /// The views by packed table id
    views: BTreeSet<u64>,
    /// The relations that a planned statement created
    live_producers: BTreeSet<Name>,
    /// The relations that a planned statement dropped
    dropped_resources: BTreeSet<Name>,
    /// The views that a planned statement created
    live_views: BTreeSet<Name>,
    /// The declarations by name, as the planned statements see them
    live_namespace: BTreeMap<Name, &'a TableDeclaration>,
}

impl<'a> ConnectionState<'a> {
    /// The name of a relation and the declaration that it reads, None if it is unresolved or its declaration is
    /// incompatible or unavailable. Analysis can bind an earlier access to a later declaration of the same name, the
    /// live lifetime still owns that access.
    fn resolve(&self, relation: &RelationExpression) -> (Name, Option<&'a TableDeclaration>) {
        let name = resource_name(relation.resolved_table.as_ref().map(|t| &t.table_name).unwrap_or(&relation.table_name));
        let Some(resolved) = &relation.resolved_table else { return (name, None) };
        let declaration = self.declarations.get(&resolved.catalog_table_id).copied().filter(|d| {
            d.catalog_schema_id == resolved.catalog_schema_id && resource_name(&d.table_name) == name && !self.incompatible_kinds.contains(&resolved.catalog_table_id)
        });
        let owned = self.live_producers.contains(&name) || self.producers.contains_key(&resolved.catalog_table_id.unpack_table_id().pack());
        let table = declaration.map(|d| self.live_namespace.get(&name).copied().filter(|_| owned).unwrap_or(d));
        (name, table)
    }
}

/// Validate the analysis of a script against the catalog of its connection
fn prepare<'a>(state: &mut PlanState, index: u32, script: &'a Script, catalog: &Catalog) -> Option<Prepared<'a>> {
    let Some(prepared) = Prepared::lenient(script) else {
        state.report(NONE, index, None, "missing or stale script analysis".into(), true);
        return None;
    };
    let analyzed = prepared.analyzed;
    if analyzed.snapshot.id() != catalog.id() {
        state.report(NONE, index, None, "script was analyzed with another catalog than the one of its connection".into(), true);
        return None;
    }
    // A tolerant plan takes the analysis of an earlier catalog revision, its declarations keep their ids
    if !catalog.is_current(&analyzed.snapshot) && !state.tolerant {
        state.report(NONE, index, None, "stale catalog analysis".into(), true);
        return None;
    }
    Some(prepared)
}

/// Report the syntax errors of a script, they invalidate a plan of the session
fn diagnose_syntax(state: &mut PlanState, index: u32, prepared: &Prepared) {
    let (scanned, parsed) = (prepared.scanned, prepared.parsed);
    for e in &scanned.errors {
        state.report(NONE, index, None, format!("scanner: {}", e.message), true);
    }
    for e in &parsed.errors {
        state.report(NONE, index, None, format!("parser: {}", e.message), true);
    }
    if parsed.statements.is_empty() {
        let text = scanned.text.as_bytes();
        let mut offset = 0;
        while offset < text.len() {
            let comment = scanned.comments.iter().find(|c| c.offset as usize <= offset && offset < (c.offset + c.length) as usize);
            if let Some(c) = comment {
                offset = (c.offset + c.length) as usize;
                continue;
            }
            if !b" \t\r\n\x0c;".contains(&text[offset]) {
                state.report(NONE, index, None, "unsupported SQL: parser produced no statements".into(), true);
                break;
            }
            offset += 1;
        }
    }
}

/// Does a script run only on request? Its current analysis has a `@manual` tag.
pub(crate) fn runs_on_request(script: &Script) -> bool {
    script.current_analysis().is_some_and(|(_, _, analyzed)| analyzed.manual)
}

/// The scripts whose statements a plan includes in full before their references: the targets, or the scripts of the
/// session whose results the host doesn't provide and that don't run only on request
fn seeds(request: &SessionPlanRequest) -> Vec<u32> {
    match request.scope {
        PlanScope::Session => (0..request.scripts.len() as u32)
            .filter(|&i| !request.materialized.contains(&i) && !runs_on_request(request.scripts[i as usize].script))
            .collect(),
        PlanScope::Targets(targets) => targets.to_vec(),
        PlanScope::Tolerant => (0..request.scripts.len() as u32).collect(),
    }
}

/// Plan the statements of the scripts of a session. Consumes the current analysis without analyzing, publishing or
/// changing scripts.
pub fn plan_session(request: &SessionPlanRequest) -> ExecutionGraphT {
    plan(request).graph
}

/// Plan the statements of the scripts of a session, see `plan_session`
pub(crate) fn plan(request: &SessionPlanRequest) -> Plan {
    // A plan of targets, and a tolerant plan like one, prepares what its targets need, runs the statements of a script
    // in order and passes a script that doesn't parse through as written
    let targeted = matches!(request.scope, PlanScope::Targets(_) | PlanScope::Tolerant);
    let tolerant = matches!(request.scope, PlanScope::Tolerant);
    let mut state = PlanState {
        graph: ExecutionGraphT::default(),
        entities: BTreeMap::new(),
        unresolved_references: BTreeMap::new(),
        entity_list: Vec::new(),
        unresolved_list: Vec::new(),
        diagnostics: Vec::new(),
        tolerant,
        partial: false,
        inputs: collect_session_inputs(request),
        spans: Vec::new(),
        inherited: BTreeSet::new(),
    };
    state.graph.valid = true;
    let script_count = request.scripts.len();

    // The request itself
    let mut catalogs: BTreeSet<u64> = BTreeSet::new();
    for connection in request.connections {
        if !catalogs.insert(connection.catalog.id()) {
            state.report(NONE, NONE, None, format!("connections share a catalog: {}", connection.id), true);
        }
    }
    // Catalog entry ids are unique within a catalog
    let mut script_ids: BTreeSet<(u32, CatalogEntryId)> = BTreeSet::new();
    let mut names: BTreeSet<&str> = BTreeSet::new();
    for (i, s) in request.scripts.iter().enumerate() {
        if s.connection as usize >= request.connections.len() {
            state.report(NONE, i as u32, None, "unknown planner connection".into(), true);
        }
        if !script_ids.insert((s.connection, s.script.catalog_entry_id())) {
            state.report(NONE, i as u32, None, "duplicate planner script".into(), true);
        }
        if !s.name.is_empty() && !names.insert(s.name) {
            state.report(NONE, i as u32, None, format!("duplicate script name: {}", s.name), true);
        }
    }
    let mut files: BTreeSet<&str> = BTreeSet::new();
    for a in request.attachments {
        if !files.insert(a.file) {
            state.report(NONE, NONE, None, format!("duplicate attachment: {}", a.file), true);
        }
    }
    let targets = seeds(request);
    if targets.iter().chain(request.materialized).any(|&t| t as usize >= script_count) {
        state.report(NONE, NONE, None, "unknown planner script".into(), true);
    }
    // An invalid request stops every plan, also a tolerant one
    if !state.graph.valid || state.partial {
        state.graph.valid = false;
        return finish(state, request, &[], &[], ScriptReferences::new(script_count));
    }

    // Prepare the scripts: all of them in a plan of the session, also those whose results the host provides, the
    // targets and the scripts they reference in a plan of targets
    let mut prepared: Vec<Option<Prepared>> = (0..script_count).map(|_| None).collect();
    let mut planned = vec![false; script_count];
    let mut references = ScriptReferences::new(script_count);
    let mut pending: Vec<u32> = if targeted { targets.clone() } else { (0..script_count as u32).collect() };
    while let Some(i) = pending.pop() {
        if planned[i as usize] {
            continue;
        }
        planned[i as usize] = true;
        let input = &request.scripts[i as usize];
        let catalog = request.connections[input.connection as usize].catalog;
        let Some(p) = prepare(&mut state, i, input.script, catalog) else { continue };
        if !targeted {
            diagnose_syntax(&mut state, i, &p);
        }
        references.resolve(&mut state_reporter(&mut state), request, i, &p);
        pending.extend(references.of(i).iter().filter_map(|r| r.producer));
        prepared[i as usize] = Some(p);
    }
    // Invalid input snapshots must never yield executable partial plans
    if !state.graph.valid {
        return finish(state, request, &prepared, &planned, references);
    }
    references.check(&mut state_reporter(&mut state), request, &prepared);
    if tolerant {
        references.invalidate_unprepared(&prepared);
    }
    if !state.graph.valid {
        return finish(state, request, &prepared, &planned, references);
    }

    // The statements of the plan
    let mut include = vec![Include::None; script_count];
    {
        let mut pending: Vec<(u32, Include)> = targets.iter().map(|&t| (t, Include::All)).collect();
        while let Some((i, level)) = pending.pop() {
            if include[i as usize] >= level {
                continue;
            }
            include[i as usize] = level;
            // The references of the included statements and of the terminal query, which an inline reference inlines
            for r in references.of(i) {
                let Some(producer) = r.producer else { continue };
                match r.kind {
                    ReferenceKind::Inline => pending.push((producer, Include::Inlined)),
                    ReferenceKind::Scan if request.materialized.contains(&producer) => {}
                    ReferenceKind::Scan => pending.push((producer, Include::All)),
                    ReferenceKind::Invalid | ReferenceKind::Attachment => {}
                }
            }
        }
    }
    // A plan includes every statement of a script or none
    let included = |i: usize| include[i] == Include::All;
    // Scripts that a plan of targets passes through as one statement, they don't parse
    let opaque: Vec<bool> = (0..script_count).map(|i| targeted && include[i] == Include::All && prepared[i].as_ref().is_some_and(|p| !p.parses())).collect();

    // The node ids of the included statements
    let mut node_of: BTreeMap<(u32, u32), u32> = BTreeMap::new();
    let mut node_count = 0u32;
    for i in 0..script_count {
        let Some(p) = prepared[i].as_ref() else { continue };
        if opaque[i] {
            node_of.insert((i as u32, 0), node_count);
            node_count += 1;
            continue;
        }
        if !included(i) {
            continue;
        }
        for statement_id in 0..p.parsed.statements.len() as u32 {
            node_of.insert((i as u32, statement_id), node_count);
            node_count += 1;
        }
    }
    let participates = |i: usize| node_of.range((i as u32, 0)..=(i as u32, u32::MAX)).next().is_some();

    // The relations of every connection
    let mut connections: Vec<ConnectionState> = (0..request.connections.len()).map(|_| ConnectionState::default()).collect();
    // Catalog entry ids are unique within the catalog of a connection
    let participating_ids: BTreeSet<(u32, CatalogEntryId)> = (0..script_count)
        .filter(|&i| participates(i))
        .map(|i| (request.scripts[i].connection, request.scripts[i].script.catalog_entry_id()))
        .collect();
    for (ci, connection) in request.connections.iter().enumerate() {
        let c = &mut connections[ci];
        for (_, entry) in connection.catalog.entries_ranked() {
            c.views.extend(tables(entry).iter().filter(|t| t.is_view).map(|t| t.table_id().pack()));
            for table in tables(entry) {
                c.declarations.insert(table.object_id, table);
                c.published_views.insert(table.object_id, table.is_view);
            }
        }
        for (i, s) in request.scripts.iter().enumerate() {
            let Some(p) = prepared[i].as_ref().filter(|_| s.connection as usize == ci) else { continue };
            let analyzed = p.analyzed;
            c.views.extend(analyzed.entry.table_declarations.iter().filter(|t| t.is_view).map(|t| t.table_id().pack()));
            for table in &analyzed.entry.table_declarations {
                if c.published_views.get(&table.object_id).is_some_and(|&v| v != table.is_view) {
                    c.incompatible_kinds.insert(table.object_id);
                }
                c.declarations.insert(table.object_id, table);
                let node = table.ast_statement_id.and_then(|statement| node_of.get(&(i as u32, statement)));
                if let Some(&node) = node {
                    c.producers.insert(table.table_id().pack(), node);
                }
            }
        }
        for (_, entry) in connection.catalog.entries_ranked() {
            // Participating declarations enter the namespace only when their CREATE is reached
            if participating_ids.contains(&(ci as u32, entry.data().catalog_entry_id)) {
                continue;
            }
            for table in tables(entry) {
                c.live_namespace.entry(resource_name(&table.table_name)).or_insert(table);
            }
        }
    }

    // The materializations: the scripts that a reference of the LOCAL connection scans
    let mut materializations: Vec<ExecutionGraphMaterializationT> = Vec::new();
    let mut materialization_of: BTreeMap<u32, u32> = BTreeMap::new();
    for i in 0..script_count as u32 {
        for r in references.of(i) {
            if include[i as usize] == Include::None {
                continue;
            }
            let (ReferenceKind::Scan, Some(producer)) = (r.kind, r.producer) else { continue };
            materialization_of.entry(producer).or_insert_with(|| {
                let mut m = ExecutionGraphMaterializationT::default();
                m.script = producer;
                let terminal = prepared[producer as usize].as_ref().and_then(Prepared::terminal);
                m.node = terminal.and_then(|t| node_of.get(&(producer, t)).copied()).unwrap_or(NONE);
                m.path = Some(match request.scripts[producer as usize].materialization_file {
                    Some(file) => format!("{}/{}", request.mount_prefix, file),
                    None => format!("{}/s{}.parquet", request.mount_prefix, producer),
                });
                materializations.push(m);
                (materializations.len() - 1) as u32
            });
        }
    }

    let mut nodes: Vec<ExecutionGraphNodeT> = Vec::new();
    let mut graph_references: Vec<ExecutionGraphScriptReferenceT> = Vec::new();
    // Edges of script references: (from, to, reason)
    let mut reference_edges: Vec<(u32, u32, Reason, u32)> = Vec::new();
    // Temporary relations do not outlive the database session
    let change_options = CatalogChangeOptions::default();
    for si in 0..script_count {
        let Some(p) = prepared[si].as_ref() else { continue };
        let connection = request.scripts[si].connection;
        let (scanned, parsed, analyzed) = (p.scanned, p.parsed, p.analyzed);
        if opaque[si] {
            // A script that does not parse runs as written, as one statement
            let node_id = nodes.len() as u32;
            let mut node = ExecutionGraphNodeT::default();
            node.script = si as u32;
            node.statement_id = 0;
            node.statement_type = parsed.statements.first().map(|s| s.statement_type).unwrap_or(Type::NONE);
            node.sql = opt(Some(read_executable_text(scanned, TextSpan::new(0, scanned.text.len() as u32)).trim().to_string()));
            node.produces_output = true;
            node.script_result = true;
            node.barrier = true;
            node.connection = connection;
            state.diagnose(node_id, si as u32, "the script does not parse, it runs as written".into());
            state.spans.push(parsed.associate_descriptions().first().map(|d| d.statement_span).unwrap_or_default());
            nodes.push(node);
            continue;
        }
        let text_at = |offset: u32, length: u32| -> String {
            let text = scanned.text.as_bytes();
            let begin = (offset as usize).min(text.len());
            let end = (begin + length as usize).min(text.len());
            String::from_utf8_lossy(&text[begin..end]).into_owned()
        };
        let descriptions = parsed.associate_descriptions();
        let terminal = p.terminal();
        for (statement_id, statement) in parsed.statements.iter().enumerate() {
            if !included(si) {
                continue;
            }
            let node_id = nodes.len() as u32;
            debug_assert_eq!(node_of.get(&(si as u32, statement_id as u32)), Some(&node_id));
            let c = &mut connections[connection as usize];
            let mut node = ExecutionGraphNodeT::default();
            node.script = si as u32;
            node.statement_id = statement_id as u32;
            node.statement_type = statement.statement_type;
            node.connection = connection;
            let ty = statement.statement_type;
            let span = descriptions[statement_id].statement_span;
            state.spans.push(span);
            node.produces_output = produces_output(parsed, statement);
            node.script_result = terminal == Some(statement_id as u32) && node.produces_output;
            if node.script_result {
                if let Some(&m) = materialization_of.get(&(si as u32)) {
                    node.materialization = m;
                }
            }
            // The SQL of the statement as written, with the script references spliced in
            let mut spliced = script_references::splice_statement(
                request,
                &prepared,
                &references,
                si as u32,
                statement_id as u32,
                &materialization_of,
                &materializations,
                &state.inputs,
            );
            // The inputs of the statement become literals, an input without a value fails the plan
            let dialect = request.connections[connection as usize].dialect;
            let bindings = bind_inputs(&state.inputs, p, Some(statement_id as u32), dialect);
            spliced.edits.extend(bindings.edits);
            for (span, message) in bindings.errors {
                state.report(node_id, si as u32, Some(span), message, true);
            }
            for (script, span, message) in std::mem::take(&mut spliced.input_errors) {
                state.report(node_id, script, Some(span), message, true);
            }
            let mut sql = if spliced.edits.is_empty() { read_executable_text(scanned, span) } else { read_executable_text_with(scanned, span, &spliced.edits) };
            for r in &spliced.references {
                let mut reference = ExecutionGraphScriptReferenceT::default();
                reference.node = node_id;
                reference.consumer_script = si as u32;
                reference.text_span = Some(text_span_t(r.reference.text_span));
                reference.script = r.reference.producer.unwrap_or(NONE);
                reference.attachment = r.reference.attachment.unwrap_or(NONE);
                reference.parameter = Some(r.reference.name.clone());
                reference.cte_name = Some(r.cte_name.clone());
                reference.materialization = r.materialization.unwrap_or(NONE);
                graph_references.push(reference);
            }
            let root = &parsed.nodes[statement.root as usize];
            let mut explain_executes = false;
            let mut accesses: BTreeMap<(u32, u32), Mode> = BTreeMap::new();
            let mut barrier = false;
            // A statement that the planner can't classify is a barrier, it runs in session order
            macro_rules! barrier {
                ($message:expr) => {{
                    barrier = true;
                    state.diagnose(node_id, si as u32, $message.to_string());
                }};
            }
            let access = |state: &mut PlanState, accesses: &mut BTreeMap<(u32, u32), Mode>, name: &Name, table: Option<&TableDeclaration>, mode: Mode| {
                let target = match table {
                    Some(t) => (state.intern_entity(connection, t), NONE),
                    None => (NONE, state.intern_unresolved(connection, name)),
                };
                let entry = accesses.entry(target).or_insert(mode);
                if mode > *entry {
                    *entry = mode;
                }
                target
            };
            match ty {
                Type::SELECT
                | Type::INSERT
                | Type::DELETE
                | Type::EXPLAIN
                | Type::CREATE_TABLE
                | Type::CREATE_TABLE_AS
                | Type::CREATE_VIEW
                | Type::SELECT_INTO
                | Type::DROP_TABLE
                | Type::DROP_VIEW => {}
                // An overlay call doesn't run on the backend, see below
                Type::CALL if analyzed.overlay_calls.iter().any(|c| c.ast_statement_id == statement_id as u32) => {}
                _ => {
                    barrier!("unsupported statement effects; backend session semantics are not guaranteed");
                }
            }
            // A spec shadows its namespace, a call in it never reaches the backend. Without a runtime that sends it, it can't
            // run. Any other call goes to the backend as written.
            if let Some(call) = analyzed.overlay_calls.iter().find(|c| c.ast_statement_id == statement_id as u32) {
                barrier = true;
                state.report(node_id, si as u32, None, format!("CALL {}.*: overlay calls can't run yet", call.namespace), true);
                sql.clear();
            }
            // A query with `@vis` tags carries its visualization
            let visualization = analyzed.visualization_specs.iter().find(|s| s.ast_statement_id == Some(statement_id as u32));
            if let Some(spec) = visualization.filter(|_| ty == Type::SELECT) {
                match compile_visualization(spec, analyzed) {
                    Ok(mut compiled) => {
                        compiled.renderer = opt(compiled.renderer.take());
                        compiled.vegalite_spec = opt(compiled.vegalite_spec.take());
                        node.visualization = Some(Box::new(compiled));
                    }
                    Err(e) => {
                        barrier = true;
                        state.report(node_id, si as u32, None, format!("visualization: {e}"), true);
                        sql.clear();
                    }
                }
            }
            if ty == Type::EXPLAIN {
                let [body, options] = attrs!(parsed.children(root), [Key::EXT_EXPLAIN_STATEMENT, Key::EXT_EXPLAIN_OPTIONS]);
                let option_text = |n: Option<&Node>| -> String {
                    let Some(n) = n.filter(|n| n.node_type() != NodeType::NONE) else { return String::new() };
                    let ts = resolve_text_span(&scanned.text, &scanned.symbols, *n.symbol_span());
                    let mut text = text_at(ts.offset, ts.length).to_ascii_lowercase();
                    let b = text.as_bytes();
                    if b.len() >= 2 && (b[0] == b'\'' || b[0] == b'"') && b[b.len() - 1] == b[0] {
                        text = text[1..text.len() - 1].to_string();
                    }
                    text
                };
                if let Some(options) = options.filter(|o| o.node_type() == NodeType::ARRAY) {
                    for option in parsed.children(options) {
                        if option.node_type() != NodeType::OBJECT_SQL_GENERIC_OPTION {
                            continue;
                        }
                        let [key, value] = attrs!(parsed.children(option), [Key::SQL_GENERIC_OPTION_KEY, Key::SQL_GENERIC_OPTION_VALUE]);
                        let name = option_text(key);
                        if name == "analyze" || name == "analyse" {
                            // Unknown arguments are execution-enabled, not proof of read-only behavior
                            explain_executes |= value.is_none_or(|v| v.node_type() != NodeType::BOOL || v.children_begin_or_value() != 0);
                        } else if name == "format" && matches!(option_text(value).as_str(), "analyze" | "analyse") {
                            explain_executes = true;
                        }
                    }
                }
                if body.is_none_or(|b| b.node_type() == NodeType::NONE) {
                    barrier!("EXPLAIN requires a statement or expressions body");
                }
            }
            for e in &analyzed.errors {
                let Some(error_node) = e.ast_node_id else { continue };
                if error_node < statement.nodes_begin || error_node >= statement.nodes_begin + statement.node_count {
                    continue;
                }
                state.diagnose(node_id, si as u32, format!("analyzer: {}", e.message));
                if e.severity == AnalyzerErrorSeverity::ERROR {
                    barrier = true;
                }
            }
            // AST effects that are not represented by ordinary relation reads, reported once per statement
            let mut effects = false;
            for ni in statement.nodes_begin..statement.nodes_begin + statement.node_count {
                let ast = &parsed.nodes[ni as usize];
                if ast.node_type() == NodeType::NONE {
                    continue;
                }
                let mutating = matches!(
                    ast.node_type(),
                    NodeType::OBJECT_SQL_INSERT
                        | NodeType::OBJECT_SQL_DELETE
                        | NodeType::OBJECT_SQL_CREATE
                        | NodeType::OBJECT_SQL_CREATE_AS
                        | NodeType::OBJECT_SQL_VIEW
                        | NodeType::OBJECT_SQL_CREATE_FUNCTION
                ) || ast.attribute_key() == Key::SQL_SELECT_INTO;
                if ty == Type::EXPLAIN && explain_executes && mutating {
                    barrier!("execution-enabled EXPLAIN with a mutating body cannot be safely classified");
                }
                if ast.node_type() == NodeType::ENUM_SQL_TEMP_TYPE && ast.children_begin_or_value() == TempType::NONE.0 as u32 {
                    continue;
                }
                if matches!(
                    ast.attribute_key(),
                    Key::SQL_CREATE_TABLE_TEMP
                        | Key::SQL_CREATE_AS_TEMP
                        | Key::SQL_VIEW_TEMP
                        | Key::SQL_TEMP_TYPE
                        | Key::SQL_SELECT_ROW_LOCKING
                        | Key::SQL_TABLE_CONSTRAINT_REFERENCES_NAME
                ) || matches!(ast.node_type(), NodeType::OBJECT_SQL_GRAPH_TABLE | NodeType::OBJECT_SQL_PROPERTY_GRAPH)
                {
                    if !effects {
                        barrier!("unsupported session, locking, constraint, or graph effects");
                    }
                    effects = true;
                }
            }
            for table_ref in &analyzed.table_references {
                // A table parameter reads its script through the script references
                if table_ref.ast_statement_id != Some(statement_id as u32) || table_ref.reads_table_parameter() {
                    continue;
                }
                let Some(relation) = &table_ref.inner else {
                    barrier!("unsupported table source");
                    continue;
                };
                if !relation.resolved_alternatives.is_empty() {
                    barrier!("ambiguous relation reference");
                }
                // References to CTEs are no relation accesses
                if is_cte_reference(analyzed, table_ref) {
                    continue;
                }
                let (name, table) = c.resolve(relation);
                if relation.resolved_table.is_some() && table.is_none() {
                    barrier!("resolved relation declaration is incompatible or unavailable");
                }
                let write = table_ref.role == TableRole::Write && (ty != Type::EXPLAIN || explain_executes);
                access(&mut state, &mut accesses, &name, table, if write { Mode::WRITE } else { Mode::READ });
                if c.dropped_resources.contains(&name) {
                    barrier!("relation was dropped without an earlier lifetime producer; later producer cannot be reordered");
                }
                match &relation.resolved_table {
                    None => barrier!(format!("unresolved relation: {}", relation.table_name.debug_string())),
                    Some(resolved) => {
                        let id = match table {
                            Some(t) => t.table_id().pack(),
                            None => resolved.catalog_table_id.unpack_table_id().pack(),
                        };
                        if c.producers.get(&id).is_some_and(|&p| p >= node_id) && !c.live_producers.contains(&name) {
                            barrier!("relation resolves to a later producer in input order");
                        }
                        if c.views.contains(&id) || c.live_views.contains(&name) {
                            barrier!("view dependencies are not expanded; conservative access barrier");
                        }
                    }
                }
            }
            // An inline script reference reads the relations of the terminal query of the referenced script
            let direct: BTreeSet<(u32, u32)> = accesses.keys().copied().collect();
            let mut inherited: BTreeSet<(u32, u32)> = BTreeSet::new();
            for &(producer, producer_statement) in &spliced.inlined {
                let producer_analyzed = prepared[producer as usize].as_ref().unwrap().analyzed;
                for table_ref in &producer_analyzed.table_references {
                    if table_ref.ast_statement_id != Some(producer_statement)
                        || is_cte_reference(producer_analyzed, table_ref)
                        || table_ref.reads_table_parameter()
                    {
                        continue;
                    }
                    let Some(relation) = &table_ref.inner else { continue };
                    let (name, table) = c.resolve(relation);
                    let target = access(&mut state, &mut accesses, &name, table, Mode::READ);
                    if !direct.contains(&target) {
                        inherited.insert(target);
                    }
                    if relation.resolved_table.is_none() {
                        barrier!(format!("unresolved relation: {}", relation.table_name.debug_string()));
                    }
                }
            }
            for &m in &spliced.inputs {
                let producer_node = materializations[m as usize].node;
                if producer_node != NONE {
                    reference_edges.push((producer_node, node_id, Reason::MATERIALIZATION, materializations[m as usize].script));
                }
            }
            node.inputs = (!spliced.inputs.is_empty()).then(|| spliced.inputs.clone());
            node.inlined_scripts = (!spliced.inlined.is_empty()).then(|| spliced.inlined.iter().map(|&(producer, _)| producer).collect());
            node.attachments = (!spliced.attachments.is_empty()).then(|| spliced.attachments.clone());
            let drop = matches!(ty, Type::DROP_TABLE | Type::DROP_VIEW);
            let ddl = drop || matches!(ty, Type::CREATE_TABLE | Type::CREATE_TABLE_AS | Type::CREATE_VIEW | Type::SELECT_INTO);
            if ddl {
                let packed = pack::pack_parsed_statement(parsed, statement_id);
                match packed.target {
                    None => barrier!("missing DDL target"),
                    Some(target) => {
                        let mut name: Name = (
                            target.database_name.clone().unwrap_or_default(),
                            target.schema_name.clone().unwrap_or_default(),
                            target.relation_name.clone().unwrap_or_default(),
                        );
                        let mut table: Option<&TableDeclaration> = None;
                        if drop {
                            // Prefer an exact live name, then native suffix matches. Never let a future
                            // declaration in an analyzed input redirect this DROP.
                            if !c.live_namespace.contains_key(&name) {
                                let matches: BTreeSet<Name> = c
                                    .live_namespace
                                    .keys()
                                    .filter(|n| n.2 == name.2 && (name.1.is_empty() || n.1 == name.1) && (name.0.is_empty() || n.0 == name.0))
                                    .cloned()
                                    .collect();
                                if matches.len() == 1 {
                                    name = matches.into_iter().next().unwrap();
                                } else if matches.len() > 1 {
                                    barrier!("ambiguous DROP target");
                                }
                            }
                            match c.live_namespace.get(&name) {
                                Some(&live) => table = Some(live),
                                None => barrier!("unresolved DROP target; conservative access barrier"),
                            }
                            if let Some(t) = table {
                                if c.views.contains(&t.table_id().pack()) || c.live_views.contains(&name) {
                                    barrier!("view dependencies are not expanded; conservative access barrier");
                                }
                            }
                        } else {
                            for declaration in &analyzed.entry.table_declarations {
                                if declaration.ast_statement_id == Some(statement_id as u32) && resource_name(&declaration.table_name) == name {
                                    table = Some(declaration);
                                }
                            }
                            match table {
                                Some(t) => name = resource_name(&t.table_name),
                                None => barrier!("missing DDL target declaration"),
                            }
                        }
                        let target = access(&mut state, &mut accesses, &name, table, Mode::DDL);
                        inherited.remove(&target);
                        if drop {
                            c.live_producers.remove(&name);
                            c.live_namespace.remove(&name);
                            c.live_views.remove(&name);
                            c.dropped_resources.insert(name);
                        } else {
                            c.live_producers.insert(name.clone());
                            if let Some(t) = table {
                                c.live_namespace.insert(name.clone(), t);
                            }
                            c.dropped_resources.remove(&name);
                            if ty == Type::CREATE_VIEW {
                                c.live_views.insert(name);
                            } else {
                                c.live_views.remove(&name);
                            }
                        }
                    }
                }
            }
            state.inherited.extend(inherited.into_iter().map(|(entity, unresolved)| (node_id, entity, unresolved)));
            node.accesses = opt_vec(
                accesses
                    .into_iter()
                    .map(|((entity, unresolved), mode)| {
                        let mut a = ExecutionGraphAccessT::default();
                        a.entity = entity;
                        a.unresolved_reference = unresolved;
                        a.mode = mode;
                        a
                    })
                    .collect(),
            );
            // The catalog changes of the statement once it succeeded. A script with syntax errors changes
            // nothing we could follow.
            if !sql.is_empty() && parsed.errors.is_empty() && scanned.errors.is_empty() {
                node.catalog_changes = derive_catalog_change(analyzed, statement_id, &change_options).map(|c| vec![c.pack()]);
            }
            node.sql = opt(Some(sql));
            node.barrier = barrier;
            nodes.push(node);
        }
    }

    // Order conflicting accesses along the timeline of every relation
    /// The accesses of a relation that later accesses must be ordered after
    #[derive(Default)]
    struct Timeline {
        /// The node that wrote the relation last
        writer: Option<u32>,
        /// The access mode of the last writer
        mode: Option<Mode>,
        /// The nodes that read the relation since the last write
        readers: Vec<u32>,
    }
    let mut timelines: BTreeMap<(u32, Name), Timeline> = BTreeMap::new();
    let mut edges: BTreeSet<(u32, u32, u32, u32, u8)> = BTreeSet::new();
    let mut edge = |from: Option<u32>, to: u32, entity: u32, unresolved: u32, reason: Reason| {
        if let Some(from) = from {
            if from != to {
                edges.insert((from, to, entity, unresolved, reason.0));
            }
        }
    };
    // Barriers order the statements of their connection
    let mut last_barrier: BTreeMap<u32, u32> = BTreeMap::new();
    let mut since_barrier: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
    let mut previous_of_script: BTreeMap<u32, u32> = BTreeMap::new();
    for (i, node) in nodes.iter().enumerate() {
        let i = i as u32;
        let connection = node.connection;
        // A plan of targets runs the statements of a script in order
        if targeted {
            edge(previous_of_script.insert(node.script, i), i, NONE, NONE, Reason::SEQUENCE);
        }
        edge(last_barrier.get(&connection).copied(), i, NONE, NONE, Reason::BARRIER);
        let since = since_barrier.entry(connection).or_default();
        if node.barrier {
            for &earlier in since.iter() {
                edge(Some(earlier), i, NONE, NONE, Reason::BARRIER);
            }
            since.clear();
            last_barrier.insert(connection, i);
        } else {
            since.push(i);
        }
        // Merge by name only for conflict tracking
        let mut merged: BTreeMap<Name, &ExecutionGraphAccessT> = BTreeMap::new();
        for a in node.accesses.iter().flatten() {
            let name = if a.entity != NONE {
                let e = &state.entity_list[a.entity as usize];
                (e.database_name.clone().unwrap_or_default(), e.schema_name.clone().unwrap_or_default(), e.name.clone().unwrap_or_default())
            } else {
                let r = &state.unresolved_list[a.unresolved_reference as usize];
                (r.database_name.clone().unwrap_or_default(), r.schema_name.clone().unwrap_or_default(), r.name.clone().unwrap_or_default())
            };
            match merged.get(&name) {
                Some(existing) if a.mode <= existing.mode => {}
                _ => {
                    merged.insert(name, a);
                }
            }
        }
        for (name, a) in merged {
            let timeline = timelines.entry((connection, name)).or_default();
            let ddl = a.mode == Mode::DDL || timeline.mode == Some(Mode::DDL);
            if a.mode == Mode::READ {
                edge(timeline.writer, i, a.entity, a.unresolved_reference, if ddl { Reason::DDL } else { Reason::READ_AFTER_WRITE });
                timeline.readers.push(i);
            } else {
                edge(timeline.writer, i, a.entity, a.unresolved_reference, if ddl { Reason::DDL } else { Reason::WRITE_AFTER_WRITE });
                for &reader in &timeline.readers {
                    edge(Some(reader), i, a.entity, a.unresolved_reference, if a.mode == Mode::DDL { Reason::DDL } else { Reason::WRITE_AFTER_READ });
                }
                timeline.readers.clear();
                timeline.writer = Some(i);
                timeline.mode = Some(a.mode);
            }
        }
    }
    // A scan reference needs the result of the referenced script before it in the session
    for (from, to, reason, producer) in reference_edges {
        if from < to {
            edge(Some(from), to, NONE, NONE, reason);
        } else {
            let consumer = nodes[to as usize].script;
            let message = format!(
                "{} references {}, which runs later; move {} above {}",
                script_label(request, consumer),
                script_label(request, producer),
                script_label(request, producer),
                script_label(request, consumer)
            );
            state.report(to, consumer, None, message, true);
        }
    }
    let edges = edges
        .into_iter()
        .map(|(from, to, entity, unresolved, reason)| {
            let mut e = ExecutionGraphEdgeT::default();
            e.from = from;
            e.to = to;
            e.entity = entity;
            e.unresolved_reference = unresolved;
            e.reason = Reason(reason);
            e
        })
        .collect();
    state.graph.nodes = opt_vec(nodes);
    state.graph.edges = opt_vec(edges);
    state.graph.materializations = opt_vec(materializations);
    state.graph.references = opt_vec(graph_references);
    finish(state, request, &prepared, &planned, references)
}

/// The label of a script in diagnostics, `foo.sql`
pub(crate) fn script_label(request: &SessionPlanRequest, script: u32) -> String {
    match request.scripts.get(script as usize).map(|s| s.name).filter(|n| !n.is_empty()) {
        Some(name) => format!("{name}.sql"),
        None => format!("script {script}"),
    }
}

/// Does a table reference read a common table expression?
fn is_cte_reference(analyzed: &AnalyzedScript, table_ref: &dashql_core::analyzer::TableReference) -> bool {
    let Some(relation) = &table_ref.inner else { return false };
    if relation.resolved_table.is_some()
        || table_ref.role != TableRole::Read
        || !relation.table_name.database_name.text.is_empty()
        || !relation.table_name.schema_name.text.is_empty()
    {
        return false;
    }
    let Some(&scope) = table_ref.ast_scope_root.and_then(|r| analyzed.name_scopes_by_root_node.get(&r)) else { return false };
    let alias = match &table_ref.alias {
        Some((a, _)) => a.text.clone(),
        None => relation.table_name.table_name.text.clone(),
    };
    matches!(analyzed.name_scopes[scope as usize].source(&alias).map(|s| &s.table), Some(ReferencedTable::Cte(_)))
}

fn text_span_t(span: TextSpan) -> TextSpanT {
    let mut t = TextSpanT::default();
    t.offset = span.offset;
    t.length = span.length;
    t
}

/// A reporter for the diagnostics of script references
struct Reporter<'s> {
    state: &'s mut PlanState,
}

impl ReferenceErrors for Reporter<'_> {
    fn error(&mut self, script: u32, text_span: Option<TextSpan>, message: String) {
        self.state.report(NONE, script, text_span, message, true);
    }
}

fn state_reporter(state: &mut PlanState) -> Reporter<'_> {
    Reporter { state }
}

/// A string that is left out of the packed buffer when empty
fn opt(s: Option<String>) -> Option<String> {
    s.filter(|s| !s.is_empty())
}

/// A vector that is left out of the packed buffer when empty
fn opt_vec<T>(v: Vec<T>) -> Option<Vec<T>> {
    (!v.is_empty()).then_some(v)
}

/// Complete the graph of a plan with its connections, scripts, entities and diagnostics
fn finish(state: PlanState, request: &SessionPlanRequest, prepared: &[Option<Prepared>], planned: &[bool], references: ScriptReferences) -> Plan {
    let targets: BTreeSet<u32> = seeds(request).into_iter().collect();
    let mut graph = state.graph;
    if state.partial {
        graph.valid = false;
    }
    graph.connections = opt_vec(
        request
            .connections
            .iter()
            .map(|c| {
                let mut out = ExecutionGraphConnectionT::default();
                out.connection_id = opt(Some(c.id.to_string()));
                out.kind = match c.kind {
                    ConnectionKind::Remote => ExecutionGraphConnectionKind::REMOTE,
                    ConnectionKind::Local => ExecutionGraphConnectionKind::LOCAL,
                };
                out
            })
            .collect(),
    );
    graph.attachments = opt_vec(
        request
            .attachments
            .iter()
            .enumerate()
            .map(|(i, a)| {
                let mut out = ExecutionGraphAttachmentT::default();
                out.name = opt(Some(a.name.to_string()));
                out.file = opt(Some(a.file.to_string()));
                out.path = opt(Some(script_references::attachment_path(request, i as u32)));
                out
            })
            .collect(),
    );
    graph.scripts = opt_vec(
        request
            .scripts
            .iter()
            .enumerate()
            .map(|(i, s)| {
                let mut meta = ExecutionGraphScriptT::default();
                let script = s.script;
                meta.script_id = script.catalog_entry_id();
                meta.text_version = script.text_version();
                if let Some(analyzed) = script.analyzed.as_ref() {
                    meta.analyzed_text_version = analyzed.parsed.scanned.text_version;
                    meta.analyzed_catalog_revision = analyzed.snapshot.version() as u64;
                }
                meta.name = opt(Some(s.name.to_string()));
                meta.connection = s.connection;
                meta.planned = planned.get(i).copied().unwrap_or(false);
                meta.target = targets.contains(&(i as u32));
                if let Some(p) = prepared.get(i).and_then(Option::as_ref) {
                    // The signature of the AST, the values that the script binds, `:min=10` per line, and the stamps of the
                    // attachments it reads, `attachment sales.parquet=<stamp>` per line. The keys of the scripts it
                    // references cover what they read.
                    meta.signature = opt(dashql_core::signature::compute_signature(p.parsed).ok().map(|signature| {
                        // The values in the Hyper dialect, the key covers the connection
                        let values = bind_inputs(&state.inputs, p, None, FormattingDialect::HYPER).values;
                        let attachments: BTreeSet<(&str, &str)> = references
                            .of(i as u32)
                            .iter()
                            .filter_map(|r| request.attachments.get(r.attachment? as usize))
                            .map(|a| (a.file, a.stamp))
                            .collect();
                        std::iter::once(signature)
                            .chain(values.iter().map(|(name, value)| format!(":{name}={value}")))
                            .chain(attachments.iter().map(|(file, stamp)| format!("attachment {file}={stamp}")))
                            .collect::<Vec<_>>()
                            .join("\n")
                    }));
                    // Queries only. The scripts that a script references are single queries, or the plan is invalid.
                    meta.cacheable = p.parses() && !p.parsed.statements.is_empty() && p.parsed.statements.iter().all(|s| matches!(s.statement_type, Type::SELECT | Type::EXPLAIN));
                    meta.terminal_statement_id = p.terminal().unwrap_or(NONE);
                    meta.referenced_scripts = opt_vec(references.producers_of(i as u32));
                } else {
                    meta.terminal_statement_id = NONE;
                }
                meta
            })
            .collect(),
    );
    graph.entities = opt_vec(state.entity_list);
    graph.unresolved_references = opt_vec(state.unresolved_list);
    graph.diagnostics = opt_vec(state.diagnostics);
    Plan { graph, references, inputs: state.inputs, spans: state.spans, inherited: state.inherited }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn analyzed(catalog: &Catalog, text: &str) -> Script {
        let mut script = Script::new(catalog);
        script.replace_text(text);
        script.scan();
        script.parse();
        script.analyze(catalog, false).unwrap();
        script
    }

    fn messages(graph: &ExecutionGraphT) -> Vec<String> {
        graph.diagnostics.iter().flatten().filter_map(|d| d.message.clone()).collect()
    }

    fn request<'a>(connections: &'a [PlannerConnection<'a>], scripts: &'a [PlannerScript<'a>]) -> SessionPlanRequest<'a> {
        SessionPlanRequest { connections, scripts, scope: PlanScope::Session, materialized: &[], mount_prefix: "/mnt/external/test", attachments: &[], attachment_prefix: "" }
    }

    #[test]
    fn rejects_duplicate_script_names() {
        let catalog = Catalog::new();
        let (a, b) = (analyzed(&catalog, "select 1"), analyzed(&catalog, "select 2"));
        let connections = [PlannerConnection { id: "c", kind: ConnectionKind::Local, catalog: &catalog, dialect: FormattingDialect::HYPER }];
        let scripts = [PlannerScript { script: &a, name: "foo", connection: 0, materialization_file: None }, PlannerScript { script: &b, name: "foo", connection: 0, materialization_file: None }];
        let graph = plan_session(&request(&connections, &scripts));
        assert!(!graph.valid);
        assert!(graph.nodes.is_none());
        assert_eq!(messages(&graph), vec!["duplicate script name: foo"]);
    }

    #[test]
    fn rejects_connections_that_share_a_catalog() {
        let catalog = Catalog::new();
        let a = analyzed(&catalog, "select 1");
        let connections = [
            PlannerConnection { id: "first", kind: ConnectionKind::Local, catalog: &catalog, dialect: FormattingDialect::HYPER },
            PlannerConnection { id: "second", kind: ConnectionKind::Remote, catalog: &catalog, dialect: FormattingDialect::HYPER },
        ];
        let scripts = [PlannerScript { script: &a, name: "foo", connection: 0, materialization_file: None }];
        let graph = plan_session(&request(&connections, &scripts));
        assert!(!graph.valid);
        assert_eq!(messages(&graph), vec!["connections share a catalog: second"]);
    }

    #[test]
    fn rejects_unknown_connections_and_scripts() {
        let catalog = Catalog::new();
        let a = analyzed(&catalog, "select 1");
        let connections = [PlannerConnection { id: "c", kind: ConnectionKind::Local, catalog: &catalog, dialect: FormattingDialect::HYPER }];
        let scripts = [PlannerScript { script: &a, name: "foo", connection: 1, materialization_file: None }];
        assert_eq!(messages(&plan_session(&request(&connections, &scripts))), vec!["unknown planner connection"]);
        let scripts = [PlannerScript { script: &a, name: "foo", connection: 0, materialization_file: None }];
        let mut targets = request(&connections, &scripts);
        targets.scope = PlanScope::Targets(&[3]);
        assert_eq!(messages(&plan_session(&targets)), vec!["unknown planner script"]);
    }

    #[test]
    fn names_materializations_after_the_files_of_the_host() {
        let (trino, local) = (Catalog::new(), Catalog::new());
        let (foo, bar) = (analyzed(&trino, "select 1 as a"), analyzed(&local, "select * from :foo"));
        let connections = [
            PlannerConnection { id: "trino", kind: ConnectionKind::Remote, catalog: &trino, dialect: FormattingDialect::HYPER },
            PlannerConnection { id: "local", kind: ConnectionKind::Local, catalog: &local, dialect: FormattingDialect::HYPER },
        ];
        let scripts = [
            PlannerScript { script: &foo, name: "foo", connection: 0, materialization_file: Some("abc.0123.parquet") },
            PlannerScript { script: &bar, name: "bar", connection: 1, materialization_file: None },
        ];
        let graph = plan_session(&request(&connections, &scripts));
        assert!(graph.valid, "{:?}", messages(&graph));
        let path = graph.materializations.as_ref().unwrap()[0].path.clone().unwrap();
        assert_eq!(path, "/mnt/external/test/abc.0123.parquet");
        assert!(graph.nodes.as_ref().unwrap()[1].sql.as_ref().unwrap().contains("external('/mnt/external/test/abc.0123.parquet'"));
    }

    #[test]
    fn rejects_duplicate_scripts_and_attachments() {
        let catalog = Catalog::new();
        let a = analyzed(&catalog, "select 1");
        let connections = [PlannerConnection { id: "c", kind: ConnectionKind::Local, catalog: &catalog, dialect: FormattingDialect::HYPER }];
        // The same script under two names
        let scripts = [PlannerScript { script: &a, name: "foo", connection: 0, materialization_file: None }, PlannerScript { script: &a, name: "bar", connection: 0, materialization_file: None }];
        let graph = plan_session(&request(&connections, &scripts));
        assert!(!graph.valid);
        assert_eq!(messages(&graph), vec!["duplicate planner script"]);
        // Two attachments of one file
        let scripts = [PlannerScript { script: &a, name: "foo", connection: 0, materialization_file: None }];
        let attachments = [PlannerAttachment { name: "x", file: "x.parquet", stamp: "1" }, PlannerAttachment { name: "y", file: "x.parquet", stamp: "1" }];
        let graph = plan_session(&SessionPlanRequest { attachments: &attachments, ..request(&connections, &scripts) });
        assert!(!graph.valid);
        assert_eq!(messages(&graph), vec!["duplicate attachment: x.parquet"]);
    }

    #[test]
    fn rejects_analyses_of_an_older_catalog_revision() {
        let mut catalog = Catalog::new();
        let a = analyzed(&catalog, "select * from t");
        // Publishing another script makes the analysis stale
        let schema = analyzed(&catalog, "create table t (x int)");
        catalog.load_script(schema.analyzed.clone().unwrap(), dashql_core::catalog::CatalogLayer::SESSION).unwrap();
        let connections = [PlannerConnection { id: "c", kind: ConnectionKind::Local, catalog: &catalog, dialect: FormattingDialect::HYPER }];
        let scripts = [PlannerScript { script: &a, name: "foo", connection: 0, materialization_file: None }];
        let graph = plan_session(&request(&connections, &scripts));
        assert!(!graph.valid);
        assert_eq!(messages(&graph), vec!["stale catalog analysis"]);
        // A tolerant plan takes the older analysis
        let tolerant = plan_session(&SessionPlanRequest { scope: PlanScope::Tolerant, ..request(&connections, &scripts) });
        assert!(!messages(&tolerant).contains(&"stale catalog analysis".to_string()));
    }

    #[test]
    fn rejects_scripts_of_another_catalog() {
        let (catalog, other) = (Catalog::new(), Catalog::new());
        let a = analyzed(&other, "select 1");
        let connections = [PlannerConnection { id: "c", kind: ConnectionKind::Local, catalog: &catalog, dialect: FormattingDialect::HYPER }];
        let scripts = [PlannerScript { script: &a, name: "foo", connection: 0, materialization_file: None }];
        let graph = plan_session(&request(&connections, &scripts));
        assert!(!graph.valid);
        assert_eq!(messages(&graph), vec!["script was analyzed with another catalog than the one of its connection"]);
    }

    #[test]
    fn caches_the_results_of_scripts_of_queries() {
        // A cache hit skips the whole script, so every statement must be a query
        for (text, cacheable) in [
            ("select 1", true),
            ("explain select 1", true),
            ("select 1; select 2", true),
            ("create table t as select 1 as a; select a from t", false),
            ("set search_path = x; select 1", false),
            ("create table t (a int)", false),
            ("select 1 +;", false),
        ] {
            let catalog = Catalog::new();
            let mut script = Script::new(&catalog);
            script.replace_text(text);
            script.scan();
            script.parse();
            script.analyze(&catalog, false).unwrap();
            let connections = [PlannerConnection { id: "c", kind: ConnectionKind::Remote, catalog: &catalog, dialect: FormattingDialect::HYPER }];
            let scripts = [PlannerScript { script: &script, name: "foo", connection: 0, materialization_file: None }];
            let mut targets = request(&connections, &scripts);
            targets.scope = PlanScope::Targets(&[0]);
            let graph = plan_session(&targets);
            assert!(graph.valid, "{text}: {:?}", messages(&graph));
            assert_eq!(graph.scripts.as_ref().unwrap()[0].cacheable, cacheable, "{text}");
        }
    }

    #[test]
    fn plans_scripts_without_names() {
        let catalog = Catalog::new();
        let (a, b) = (analyzed(&catalog, "select 1"), analyzed(&catalog, "select 2"));
        let connections = [PlannerConnection { id: "c", kind: ConnectionKind::Remote, catalog: &catalog, dialect: FormattingDialect::HYPER }];
        let scripts = [PlannerScript { script: &a, name: "", connection: 0, materialization_file: None }, PlannerScript { script: &b, name: "", connection: 0, materialization_file: None }];
        let graph = plan_session(&request(&connections, &scripts));
        assert!(graph.valid);
        assert_eq!(graph.nodes.as_ref().map(Vec::len), Some(2));
        assert!(graph.connections.as_ref().is_some_and(|c| c.len() == 1 && c[0].kind == ExecutionGraphConnectionKind::REMOTE));
    }
}
