//! Script references.
//!
//! A table parameter `:foo` references the script `foo.sql` and reads the result of its terminal query. The
//! connections of the two scripts decide what a reference becomes:
//!
//! A referenced script is a single SELECT, a reference never runs commands. A script that is a single call of a client
//! function that reads is referenced too, but only scanned: the call runs in the host, no query can inline it.
//!
//! - Within one connection the query is inlined into the statement as a common table expression,
//!   `with foo as (<query of foo>) select * from foo`.
//! - A statement of the LOCAL connection (the embedded Hyper) scans the result of a script of another
//!   connection, which the host writes to a Parquet file and mounts:
//!   `with foo as (select * from external('<path>', format => 'parquet')) select * from foo`.
//! - A statement of a REMOTE connection cannot read a script of another connection.
//!
//! A table parameter `:sales` can also read the attachment `sales.parquet` of the session. Only a statement of the
//! LOCAL connection reads attachments, it scans the file below the attachment prefix that the host mounts:
//! `with sales as (select * from external('<prefix>/sales.parquet', format => 'parquet')) select * from sales`.
//!
//! The common table expressions of a statement are flattened: the references of an inlined query are resolved
//! in the context of the statement, every script appears once, after the scripts it references. They go into
//! the outermost SELECT around the references, before the common table expressions the statement already has.

use crate::compiler::read_executable_text_with;
use crate::planner::{has_manual_tag, script_label, ConnectionKind, Prepared, SessionPlanRequest};
use dashql_buffers::execution::ExecutionGraphMaterializationT;
use dashql_buffers::parser::{AttributeKey as Key, NodeType, StatementType};
use dashql_core::analyzer::ParameterKind;
use dashql_core::table_parameters::{colliding_names, find_table_parameter, TableParameterLookup, TableParameterSource};
use dashql_core::utils::quote_identifier;
use dashql_parser::attrs;
use dashql_parser::keywords::Keyword;
use dashql_parser::parser::context::resolve_text_span;
use dashql_parser::span::TextSpan;
use std::collections::{BTreeMap, BTreeSet};

/// Receives the errors of script references
pub(crate) trait ReferenceErrors {
    /// Report an error at the text of a script
    fn error(&mut self, script: u32, text_span: Option<TextSpan>, message: String);
}

/// What a script reference becomes
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReferenceKind {
    /// The terminal query of the referenced script is inlined into the statement
    Inline,
    /// The statement scans the materialized result of the referenced script
    Scan,
    /// The reference has errors, it cannot be planned
    Invalid,
    /// The statement scans an attachment of the session
    Attachment,
}

/// A table parameter that references a script or an attachment
#[derive(Clone, Debug)]
pub(crate) struct Reference {
    /// The statement of the parameter
    pub statement_id: u32,
    /// The parameter node
    pub ast_node_id: u32,
    /// The parameter in the text, with the prefix
    pub text_span: TextSpan,
    /// The parameter name
    pub name: String,
    /// The referenced script
    pub producer: Option<u32>,
    /// The referenced attachment
    pub attachment: Option<u32>,
    /// What the reference becomes
    pub kind: ReferenceKind,
}

impl Reference {
    /// What the reference reads
    pub(crate) fn source(&self) -> Option<TableParameterSource> {
        match (self.producer, self.attachment) {
            (Some(producer), _) => Some(TableParameterSource::Script(producer)),
            (None, Some(attachment)) => Some(TableParameterSource::Attachment(attachment)),
            (None, None) => None,
        }
    }
}

/// The label of an attachment in messages, its file name
pub(crate) fn attachment_label(request: &SessionPlanRequest, attachment: u32) -> String {
    match request.attachments.get(attachment as usize) {
        Some(a) => a.file.to_string(),
        None => format!("attachment {attachment}"),
    }
}

/// The label of what a table parameter reads in messages
pub(crate) fn source_label(request: &SessionPlanRequest, source: TableParameterSource) -> String {
    match source {
        TableParameterSource::Script(script) => script_label(request, script),
        TableParameterSource::Attachment(attachment) => attachment_label(request, attachment),
    }
}

/// The source of the name `index` among the names of the scripts followed by the names of the attachments
fn source_of(request: &SessionPlanRequest, index: usize) -> TableParameterSource {
    match index.checked_sub(request.scripts.len()) {
        None => TableParameterSource::Script(index as u32),
        Some(attachment) => TableParameterSource::Attachment(attachment as u32),
    }
}

/// The names of the table parameters of a request: the scripts in session order, then the attachments
fn table_parameter_names<'a>(request: &'a SessionPlanRequest) -> impl Iterator<Item = &'a str> + Clone {
    request.scripts.iter().map(|s| s.name).chain(request.attachments.iter().map(|a| a.name))
}

/// The script references of the scripts of a plan
pub(crate) struct ScriptReferences {
    /// The references of every script in text order
    by_script: Vec<Vec<Reference>>,
}

impl ScriptReferences {
    pub(crate) fn new(script_count: usize) -> Self {
        Self { by_script: vec![Vec::new(); script_count] }
    }

    /// The references of a script
    pub(crate) fn of(&self, script: u32) -> &[Reference] {
        &self.by_script[script as usize]
    }

    /// The scripts that a script references, in the order of their first reference
    pub(crate) fn producers_of(&self, script: u32) -> Vec<u32> {
        let mut out: Vec<u32> = Vec::new();
        for producer in self.of(script).iter().filter_map(|r| r.producer) {
            if !out.contains(&producer) {
                out.push(producer);
            }
        }
        out
    }

    /// Invalidate the references of scripts that were not prepared. A tolerant plan keeps going after their errors and
    /// splices no invalid reference.
    pub(crate) fn invalidate_unprepared(&mut self, prepared: &[Option<Prepared>]) {
        for r in self.by_script.iter_mut().flatten() {
            if r.producer.is_some_and(|p| prepared[p as usize].is_none()) {
                r.kind = ReferenceKind::Invalid;
            }
        }
    }

    /// Resolve the table parameters of a script to the scripts and attachments they reference
    pub(crate) fn resolve(&mut self, reporter: &mut dyn ReferenceErrors, request: &SessionPlanRequest, script: u32, prepared: &Prepared) {
        let (scanned, parsed, analyzed) = (prepared.scanned, prepared.parsed, prepared.analyzed);
        let consumer = &request.scripts[script as usize];
        let mut out = Vec::new();
        for parameter in analyzed.parameters.iter().filter(|p| p.kind == ParameterKind::Table) {
            let text_span = resolve_text_span(&scanned.text, &scanned.symbols, parameter.location);
            let named = scanned.text.as_bytes().get(text_span.offset as usize) == Some(&b':');
            let Some(statement_id) = parameter.ast_statement_id else { continue };
            let label = &scanned.text[text_span.offset as usize..text_span.end() as usize];
            let name = match (&parameter.name, named) {
                (Some(name), true) => name.to_string(),
                _ => {
                    reporter.error(script, Some(text_span), format!("the positional table parameter {label} cannot reference a script or an attachment"));
                    continue;
                }
            };
            let mut reference = Reference {
                statement_id,
                ast_node_id: parameter.ast_node_id,
                text_span,
                name: name.clone(),
                producer: None,
                attachment: None,
                kind: ReferenceKind::Invalid,
            };
            // The table reference of the parameter, a table parameter cannot be the target of a write
            let tableref = &parsed.nodes[parsed.nodes[parameter.ast_node_id as usize].parent() as usize];
            if matches!(tableref.attribute_key(), Key::SQL_INSERT_TARGET | Key::SQL_DELETE_TARGET) {
                reporter.error(script, Some(text_span), format!("the table parameter {label} cannot be written"));
                out.push(reference);
                continue;
            }
            // An exact name, or a single name that differs in case, among the scripts and the attachments
            let producer = match find_table_parameter(table_parameter_names(request), &name) {
                TableParameterLookup::Found(i) => match source_of(request, i) {
                    TableParameterSource::Script(producer) => producer as usize,
                    TableParameterSource::Attachment(attachment) => {
                        reference.attachment = Some(attachment);
                        reference.kind = if request.connections[consumer.connection as usize].kind == ConnectionKind::Local {
                            ReferenceKind::Attachment
                        } else {
                            reporter.error(
                                script,
                                Some(text_span),
                                format!(
                                    "{} runs on the connection {} and cannot read the attachment {}, only the embedded Hyper reads attachments",
                                    script_label(request, script),
                                    request.connections[consumer.connection as usize].id,
                                    attachment_label(request, attachment)
                                ),
                            );
                            ReferenceKind::Invalid
                        };
                        out.push(reference);
                        continue;
                    }
                },
                TableParameterLookup::Unknown => {
                    reporter.error(script, Some(text_span), format!("unknown script or attachment {label}"));
                    out.push(reference);
                    continue;
                }
                TableParameterLookup::Ambiguous(matches) => {
                    let labels: Vec<String> = matches.iter().map(|&i| source_label(request, source_of(request, i))).collect();
                    reporter.error(script, Some(text_span), format!("the table parameter {label} matches {}", labels.join(" and ")));
                    out.push(reference);
                    continue;
                }
            };
            reference.producer = Some(producer as u32);
            let producer_connection = request.scripts[producer].connection;
            let connection = |c: u32| request.connections[c as usize].id;
            reference.kind = if producer_connection == consumer.connection {
                ReferenceKind::Inline
            } else if has_manual_tag(request.scripts[producer].script) {
                // Reading the result on another connection would run the script in full
                reporter.error(
                    script,
                    Some(text_span),
                    format!(
                        "{} runs only on request (@manual), the scripts of the connection {} inline it but {} of the connection {} cannot read it",
                        script_label(request, producer as u32),
                        connection(producer_connection),
                        script_label(request, script),
                        connection(consumer.connection)
                    ),
                );
                ReferenceKind::Invalid
            } else if request.connections[consumer.connection as usize].kind == ConnectionKind::Local {
                ReferenceKind::Scan
            } else {
                reporter.error(
                    script,
                    Some(text_span),
                    format!(
                        "{} runs on the connection {} and cannot read {} of the connection {}",
                        script_label(request, script),
                        connection(consumer.connection),
                        script_label(request, producer as u32),
                        connection(producer_connection)
                    ),
                );
                ReferenceKind::Invalid
            };
            out.push(reference);
        }
        self.by_script[script as usize] = out;
    }

    /// The scripts that references read, every script after the scripts it references, with what reads them: the
    /// producer of a reference and, through the terminal query of an inlined script, the producers of its references
    fn closure<'r>(&self, prepared: &[Option<Prepared>], roots: impl IntoIterator<Item = &'r Reference>) -> Vec<(u32, ReferenceKind)> {
        fn visit(this: &ScriptReferences, prepared: &[Option<Prepared>], r: &Reference, visited: &mut BTreeSet<u32>, out: &mut Vec<(u32, ReferenceKind)>) {
            let Some(producer) = r.producer else { return };
            if r.kind == ReferenceKind::Invalid || !visited.insert(producer) {
                return;
            }
            if r.kind == ReferenceKind::Inline {
                let terminal = prepared[producer as usize].as_ref().and_then(Prepared::terminal);
                for nested in this.of(producer).iter().filter(|n| Some(n.statement_id) == terminal) {
                    visit(this, prepared, nested, visited, out);
                }
            }
            out.push((producer, r.kind));
        }
        let (mut visited, mut out) = (BTreeSet::new(), Vec::new());
        for r in roots {
            visit(self, prepared, r, &mut visited, &mut out);
        }
        out
    }

    /// Check the referenced scripts: they are a single query, references form no cycle, and a view does not scan a
    /// materialized result, neither directly nor through the queries it inlines. A reference with errors becomes
    /// invalid.
    pub(crate) fn check(&mut self, reporter: &mut dyn ReferenceErrors, request: &SessionPlanRequest, prepared: &[Option<Prepared>]) {
        // The references with errors: (script, index)
        let mut failed: BTreeSet<(u32, usize)> = BTreeSet::new();
        let mut reporter = FailedReferences { reporter, failed: &mut failed, current: (0, 0) };
        let reporter = &mut reporter;
        for (script, references) in self.by_script.iter().enumerate() {
            let Some(consumer) = prepared[script].as_ref() else { continue };
            for (index, r) in references.iter().enumerate() {
                reporter.current = (script as u32, index);
                let producer = match r.source() {
                    Some(TableParameterSource::Script(producer)) => {
                        let Some(p) = prepared[producer as usize].as_ref() else { continue };
                        if let Some(message) = unreadable(request, p, producer, script as u32, r.kind) {
                            reporter.error(script as u32, Some(r.text_span), message);
                        }
                        Some(producer)
                    }
                    // An attachment is a file, it is read like a table
                    Some(TableParameterSource::Attachment(_)) => None,
                    None => continue,
                };
                let anchor = anchor_of(consumer.parsed, r.ast_node_id);
                if anchor.is_none() {
                    reporter.error(script as u32, Some(r.text_span), "a table parameter must be part of a query".into());
                }
                let Some(producer) = producer else { continue };
                // The scripts that the reference reads, the nearest first
                let closure: Vec<(u32, ReferenceKind)> = self.closure(prepared, [r]).into_iter().rev().collect();
                // A relation of an inlined query must not resolve to a common table expression of the statement
                if let (Some(anchor), ReferenceKind::Inline) = (anchor, r.kind) {
                    let visible = visible_ctes(consumer, r.statement_id, anchor);
                    let conflict = closure.iter().filter(|(_, kind)| *kind == ReferenceKind::Inline).find_map(|&(inlined, _)| {
                        let p = prepared[inlined as usize].as_ref()?;
                        let terminal = p.terminal()?;
                        // The query reads its own common table expressions
                        let (mut own, mut relations) = (BTreeSet::new(), BTreeSet::new());
                        cte_names(p, terminal, &mut own);
                        relation_names(p, terminal, &mut relations);
                        relations.difference(&own).find(|name| visible.contains(*name)).map(|name| (inlined, name.clone()))
                    });
                    if let Some((inlined, relation)) = conflict {
                        reporter.error(
                            script as u32,
                            Some(r.text_span),
                            format!(
                                "the query of {} reads {relation}, which {} defines as a common table expression there",
                                script_label(request, inlined),
                                script_label(request, script as u32)
                            ),
                        );
                    }
                }
                let statement_type = consumer.parsed.statements[r.statement_id as usize].statement_type;
                if statement_type == StatementType::CREATE_VIEW {
                    // The view scans what the queries it inlines scan
                    let message = |materialized: u32| format!("a view cannot read {} of another connection", script_label(request, materialized));
                    let lifetime = "its result exists only while the statement runs";
                    let scanned = closure.iter().find(|(_, kind)| *kind == ReferenceKind::Scan).map(|&(materialized, _)| materialized);
                    if r.kind == ReferenceKind::Scan {
                        reporter.error(script as u32, Some(r.text_span), format!("{}, {lifetime}", message(producer)));
                    } else if let Some(materialized) = scanned {
                        reporter.error(
                            script as u32,
                            Some(r.text_span),
                            format!("{} through {}, {lifetime}", message(materialized), script_label(request, producer)),
                        );
                    }
                }
            }
        }
        // Cycles: a reference back to a script on the path
        #[derive(Clone, Copy, PartialEq)]
        enum Color {
            White,
            Gray,
            Black,
        }
        let mut colors = vec![Color::White; self.by_script.len()];
        let mut path: Vec<u32> = Vec::new();
        fn visit(this: &ScriptReferences, reporter: &mut FailedReferences, request: &SessionPlanRequest, script: u32, colors: &mut [Color], path: &mut Vec<u32>) {
            colors[script as usize] = Color::Gray;
            path.push(script);
            for (index, r) in this.of(script).iter().enumerate() {
                let Some(producer) = r.producer else { continue };
                match colors[producer as usize] {
                    Color::Gray => {
                        let begin = path.iter().position(|&s| s == producer).unwrap();
                        let cycle: Vec<String> = path[begin..].iter().chain(std::iter::once(&producer)).map(|&s| script_label(request, s)).collect();
                        reporter.current = (script, index);
                        reporter.error(script, Some(r.text_span), format!("cyclic script reference: {}", cycle.join(" -> ")));
                    }
                    Color::White => visit(this, reporter, request, producer, colors, path),
                    Color::Black => {}
                }
            }
            path.pop();
            colors[script as usize] = Color::Black;
        }
        for script in 0..self.by_script.len() as u32 {
            if colors[script as usize] == Color::White && !self.of(script).is_empty() {
                visit(self, reporter, request, script, &mut colors, &mut path);
            }
        }
        for (script, index) in failed {
            self.by_script[script as usize][index].kind = ReferenceKind::Invalid;
        }
    }
}

/// Why a script cannot read the result of a script it references, None if it can. A referenced script is a single
/// SELECT, or a single call of a client function that reads. A call runs in the host and not in a database, so no query
/// can inline it: only a scan reads its result, which the host materializes.
fn unreadable(request: &SessionPlanRequest, p: &Prepared, producer: u32, consumer: u32, kind: ReferenceKind) -> Option<String> {
    let (producer_label, consumer_label) = (script_label(request, producer), script_label(request, consumer));
    if !p.parses() {
        return Some(format!("{producer_label} is no single SELECT that {consumer_label} could read"));
    }
    let Some(call) = p.analyzed.single_client_function_call() else {
        return match &p.parsed.statements[..] {
            [statement] if statement.statement_type == StatementType::SELECT => None,
            _ => Some(format!("{producer_label} is no single SELECT that {consumer_label} could read")),
        };
    };
    let function = match &call.function {
        Some(function) => format!("{}.{function}", call.namespace),
        None => format!("an unknown function of {}", call.namespace),
    };
    if call.explain {
        Some(format!("{producer_label} explains a call of {function} and sends nothing, {consumer_label} cannot read it"))
    } else if !call.readable() {
        Some(format!("{producer_label} calls {function}, which writes, {consumer_label} can only read a call that reads"))
    } else if kind == ReferenceKind::Inline {
        let connection = request.connections[request.scripts[consumer as usize].connection as usize].id;
        Some(format!(
            "{producer_label} calls {function}, which no query of the connection {connection} can inline, only the scripts of the embedded Hyper read its result"
        ))
    } else {
        None
    }
}

/// Passes the errors of the checked reference on and remembers that it failed
struct FailedReferences<'r> {
    reporter: &'r mut dyn ReferenceErrors,
    failed: &'r mut BTreeSet<(u32, usize)>,
    /// The checked reference: (script, index)
    current: (u32, usize),
}

impl ReferenceErrors for FailedReferences<'_> {
    fn error(&mut self, script: u32, text_span: Option<TextSpan>, message: String) {
        self.failed.insert(self.current);
        self.reporter.error(script, text_span, message);
    }
}

/// A checked table parameter that references a script or an attachment
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CheckedReference {
    /// The statement of the parameter, absent for the errors of parameters that reference no script
    pub statement_id: Option<u32>,
    /// The parameter in the text of the script, with the prefix, in UTF-8 bytes
    pub text_span: TextSpan,
    /// The parameter name, empty for a positional parameter
    pub parameter: String,
    /// The referenced script, if the name finds one
    pub script: Option<u32>,
    /// The referenced attachment, if the name finds one
    pub attachment: Option<u32>,
    /// What the reference reads
    pub kind: ReferenceKind,
    /// The errors of the reference, the messages of the planner
    pub errors: Vec<String>,
}

/// The checked script references of a script
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CheckedScript {
    /// Was the script checked? A script whose analysis is not current with its text is not.
    pub checked: bool,
    /// The text version of the analysis that was checked
    pub text_version: u64,
    /// The table parameters of the script in text order
    pub references: Vec<CheckedReference>,
}

/// Collects the errors of script references by script and text
#[derive(Default)]
struct CollectedErrors {
    errors: BTreeMap<(u32, u32, u32), Vec<String>>,
}

impl ReferenceErrors for CollectedErrors {
    fn error(&mut self, script: u32, text_span: Option<TextSpan>, message: String) {
        let span = text_span.unwrap_or_default();
        let messages = self.errors.entry((script, span.offset, span.length)).or_default();
        if !messages.contains(&message) {
            messages.push(message);
        }
    }
}

/// Check the script references of every script of a session whose analysis is current with its text, like a plan
/// of the session would. Other scripts may be broken or stale meanwhile: a referenced script without a current
/// analysis is read as a single SELECT. Ignores the scope, the order of the scripts and the catalogs.
pub fn check_script_references(request: &SessionPlanRequest) -> Vec<CheckedScript> {
    let count = request.scripts.len();
    let prepared: Vec<Option<Prepared>> = request.scripts.iter().map(|s| Prepared::lenient(s.script)).collect();
    let mut references = ScriptReferences::new(count);
    let mut errors = CollectedErrors::default();
    for (i, p) in prepared.iter().enumerate() {
        if let Some(p) = p {
            references.resolve(&mut errors, request, i as u32, p);
        }
    }
    references.check(&mut errors, request, &prepared);
    let mut out = Vec::with_capacity(count);
    for (i, p) in prepared.iter().enumerate() {
        let Some(p) = p else {
            out.push(CheckedScript::default());
            continue;
        };
        let mut checked: Vec<CheckedReference> = references
            .of(i as u32)
            .iter()
            .map(|r| {
                CheckedReference {
                    statement_id: Some(r.statement_id),
                    text_span: r.text_span,
                    parameter: r.name.clone(),
                    script: r.producer,
                    attachment: r.attachment,
                    kind: r.kind,
                    errors: errors.errors.remove(&(i as u32, r.text_span.offset, r.text_span.length)).unwrap_or_default(),
                }
            })
            .collect();
        // Errors of parameters that reference no script, e.g. positional ones
        let rest: Vec<_> = errors.errors.keys().filter(|(s, _, _)| *s == i as u32).copied().collect();
        for key in rest {
            let (_, offset, length) = key;
            checked.push(CheckedReference {
                statement_id: None,
                text_span: TextSpan { offset, length },
                parameter: String::new(),
                script: None,
                attachment: None,
                kind: ReferenceKind::Invalid,
                errors: errors.errors.remove(&key).unwrap_or_default(),
            });
        }
        checked.sort_by_key(|r| (r.text_span.offset, r.text_span.length));
        out.push(CheckedScript { checked: true, text_version: p.scanned.text_version, references: checked });
    }
    out
}

/// Scripts and attachments whose names are equal in case
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TableParameterCollision {
    /// The name of the first of them
    pub name: String,
    /// The scripts with the name
    pub scripts: Vec<u32>,
    /// The attachments with the name
    pub attachments: Vec<u32>,
}

/// The names of the scripts and attachments of a session that collide. A table parameter with such a name is
/// ambiguous, at least in case.
pub fn table_parameter_collisions(request: &SessionPlanRequest) -> Vec<TableParameterCollision> {
    let names: Vec<&str> = table_parameter_names(request).collect();
    colliding_names(names.iter().copied())
        .into_iter()
        .map(|group| {
            let mut collision = TableParameterCollision { name: names[group[0]].to_string(), scripts: Vec::new(), attachments: Vec::new() };
            for i in group {
                match source_of(request, i) {
                    TableParameterSource::Script(s) => collision.scripts.push(s),
                    TableParameterSource::Attachment(a) => collision.attachments.push(a),
                }
            }
            collision
        })
        .collect()
}

/// A reference of a spliced statement
pub(crate) struct SplicedReference {
    /// The reference
    pub reference: Reference,
    /// The name of the common table expression
    pub cte_name: String,
    /// The materialization that the reference scans
    pub materialization: Option<u32>,
}

/// A statement with its script references spliced in
#[derive(Default)]
pub(crate) struct SplicedStatement {
    /// The edits of the statement text
    pub edits: Vec<(TextSpan, String)>,
    /// The references of the statement
    pub references: Vec<SplicedReference>,
    /// The queries of the inlined scripts: (script, statement)
    pub inlined: Vec<(u32, u32)>,
    /// The materializations that the statement scans
    pub inputs: Vec<u32>,
    /// The attachments that the statement scans, also those that the inlined queries read
    pub attachments: Vec<u32>,
    /// The values of inputs that the inlined queries don't read: (script, text span, message)
    pub input_errors: Vec<(u32, TextSpan, String)>,
}

/// The path of an attachment that a statement scans
pub(crate) fn attachment_path(request: &SessionPlanRequest, attachment: u32) -> String {
    format!("{}/{}", request.attachment_prefix, request.attachments[attachment as usize].file)
}

/// The text of a CTE name or a script name as identifier
fn identifier(name: &str) -> String {
    let quoted = quote_identifier(name);
    if quoted == name && Keyword::find(name.as_bytes()).is_some() {
        return format!("\"{name}\"");
    }
    quoted
}

/// The relation names that a statement uses unqualified, lower-cased
fn relation_names(prepared: &Prepared, statement_id: u32, out: &mut BTreeSet<String>) {
    for table_ref in prepared.analyzed.table_references.iter().filter(|t| t.ast_statement_id == Some(statement_id) && !t.reads_table_parameter()) {
        let Some(relation) = &table_ref.inner else { continue };
        let name = &relation.table_name;
        if name.database_name.text.is_empty() && name.schema_name.text.is_empty() {
            out.insert(name.table_name.text.to_lowercase());
        }
    }
}

/// The common table expressions of a statement: the node, its name lower-cased
fn ctes<'a>(prepared: &'a Prepared, statement_id: u32) -> impl Iterator<Item = (u32, String)> + 'a {
    let (scanned, parsed) = (prepared.scanned, prepared.parsed);
    let statement = &parsed.statements[statement_id as usize];
    (statement.nodes_begin..statement.nodes_begin + statement.node_count).filter_map(move |ni| {
        let node = &parsed.nodes[ni as usize];
        if node.node_type() != NodeType::OBJECT_SQL_CTE {
            return None;
        }
        let [name] = attrs!(parsed.children(node), [Key::SQL_CTE_NAME]);
        let span = resolve_text_span(&scanned.text, &scanned.symbols, *name?.symbol_span());
        let text = &scanned.text[span.offset as usize..span.end() as usize];
        Some((ni, text.trim_matches('"').to_lowercase()))
    })
}

/// The names of the common table expressions of a statement, lower-cased
fn cte_names(prepared: &Prepared, statement_id: u32, out: &mut BTreeSet<String>) {
    out.extend(ctes(prepared, statement_id).map(|(_, name)| name));
}

/// The relation names that a statement uses unqualified and the names of its common table expressions,
/// lower-cased. A common table expression of a script must not shadow them.
fn used_names(prepared: &Prepared, statement_id: u32, out: &mut BTreeSet<String>) {
    relation_names(prepared, statement_id, out);
    cte_names(prepared, statement_id, out);
}

/// The names of the common table expressions of a statement that the common table expressions of the inlined queries
/// see at an anchor, lower-cased: those of an enclosing WITH, e.g. the one of an INSERT, and those of the WITH of the
/// anchor if it is recursive. The common table expressions go before the ones of a WITH that is not recursive.
fn visible_ctes(prepared: &Prepared, statement_id: u32, anchor: u32) -> BTreeSet<String> {
    let nodes = &prepared.parsed.nodes;
    let encloses = |owner: u32| {
        let mut node_id = anchor;
        loop {
            let parent = nodes[node_id as usize].parent();
            if parent == node_id {
                return false;
            }
            if parent == owner {
                return true;
            }
            node_id = parent;
        }
    };
    let mut out = BTreeSet::new();
    for (cte, name) in ctes(prepared, statement_id) {
        // The common table expression is an element of the WITH array of its owner
        let owner = nodes[nodes[cte as usize].parent() as usize].parent();
        let visible = if owner == anchor {
            let [recursive] = attrs!(prepared.parsed.children(&nodes[owner as usize]), [Key::SQL_SELECT_WITH_RECURSIVE]);
            recursive.is_some()
        } else {
            encloses(owner)
        };
        if visible {
            out.insert(name);
        }
    }
    out
}

/// The offset of a query within the parentheses that enclose all of it, `(select ...)` is the query of a subquery.
/// `(select 1) union (select 2)` is enclosed by no parentheses.
fn inside_parentheses(text: &[u8], span: TextSpan) -> u32 {
    let (mut begin, mut end) = (span.offset as usize, (span.end() as usize).min(text.len()));
    loop {
        while begin < end && text[begin].is_ascii_whitespace() {
            begin += 1;
        }
        while end > begin && text[end - 1].is_ascii_whitespace() {
            end -= 1;
        }
        if begin >= end || text[begin] != b'(' || text[end - 1] != b')' {
            return begin as u32;
        }
        // Does the opening parenthesis close at the end? Quoted text and comments do not count.
        let mut depth = 0usize;
        let mut i = begin;
        let mut closes_at_end = false;
        while i < end {
            match text[i] {
                b'\'' | b'"' => {
                    let quote = text[i];
                    i += 1;
                    while i < end && text[i] != quote {
                        i += 1;
                    }
                }
                b'-' if text.get(i + 1) == Some(&b'-') => {
                    while i < end && text[i] != b'\n' {
                        i += 1;
                    }
                }
                b'/' if text.get(i + 1) == Some(&b'*') => {
                    i += 2;
                    while i + 1 < end && !(text[i] == b'*' && text[i + 1] == b'/') {
                        i += 1;
                    }
                    i += 1;
                }
                b'(' => depth += 1,
                b')' => {
                    depth -= 1;
                    if depth == 0 {
                        closes_at_end = i == end - 1;
                        break;
                    }
                }
                _ => {}
            }
            i += 1;
        }
        if !closes_at_end {
            return begin as u32;
        }
        begin += 1;
        end -= 1;
    }
}

/// The outermost SELECT around a node within its statement
fn anchor_of(parsed: &dashql_parser::parser::ParsedScript, ast_node_id: u32) -> Option<u32> {
    let mut anchor = None;
    let mut node_id = ast_node_id;
    loop {
        let node = &parsed.nodes[node_id as usize];
        if node.node_type() == NodeType::OBJECT_SQL_SELECT {
            anchor = Some(node_id);
        }
        let parent = node.parent();
        if parent == node_id {
            break;
        }
        node_id = parent;
    }
    anchor
}

/// Splice the script references of a statement into its text
pub(crate) fn splice_statement(
    request: &SessionPlanRequest,
    prepared: &[Option<Prepared>],
    references: &ScriptReferences,
    script: u32,
    statement_id: u32,
    materialization_of: &BTreeMap<u32, u32>,
    materializations: &[ExecutionGraphMaterializationT],
    inputs: &crate::session_inputs::SessionInputs,
) -> SplicedStatement {
    let mut out = SplicedStatement::default();
    let direct: Vec<&Reference> = references.of(script).iter().filter(|r| r.statement_id == statement_id && r.kind != ReferenceKind::Invalid).collect();
    if direct.is_empty() {
        return out;
    }
    let consumer = prepared[script as usize].as_ref().unwrap();
    let (scanned, parsed) = (consumer.scanned, consumer.parsed);

    // The scripts of the statement, every script after the scripts it references
    let order = references.closure(prepared, direct.iter().copied());

    // The names of the common table expressions, distinct from the names the statement and the inlined queries use
    let mut used = BTreeSet::new();
    used_names(consumer, statement_id, &mut used);
    for &(producer, kind) in &order {
        if kind == ReferenceKind::Inline {
            let p = prepared[producer as usize].as_ref().unwrap();
            if let Some(terminal) = p.terminal() {
                used_names(p, terminal, &mut used);
            }
        }
    }
    // The attachments that the statement and the inlined queries scan, in the order of their first reference
    let mut attachments: Vec<u32> = Vec::new();
    {
        let mut read = |r: &Reference| {
            if let (ReferenceKind::Attachment, Some(a)) = (r.kind, r.attachment) {
                if !attachments.contains(&a) {
                    attachments.push(a);
                }
            }
        };
        direct.iter().for_each(|r| read(r));
        for &(producer, kind) in &order {
            let terminal = prepared[producer as usize].as_ref().and_then(Prepared::terminal);
            if kind == ReferenceKind::Inline && terminal.is_some() {
                references.of(producer).iter().filter(|r| Some(r.statement_id) == terminal).for_each(&mut read);
            }
        }
    }
    // What the common table expressions stand for: the attachments first, the inlined queries may read them, then the
    // scripts, every script after the scripts it references
    let sources: Vec<TableParameterSource> =
        attachments.iter().map(|&a| TableParameterSource::Attachment(a)).chain(order.iter().map(|&(p, _)| TableParameterSource::Script(p))).collect();
    let name_of = |source: TableParameterSource| match source {
        TableParameterSource::Script(script) => request.scripts[script as usize].name,
        TableParameterSource::Attachment(attachment) => request.attachments[attachment as usize].name,
    };

    // A table parameter is no relation of the statement, a relation of the same name as a script would be shadowed
    let mut cte_names: BTreeMap<TableParameterSource, String> = BTreeMap::new();
    let mut taken = used;
    for &source in &sources {
        let name = name_of(source);
        let shadows = |candidate: &str| taken.contains(&candidate.to_lowercase());
        let mut candidate = name.to_string();
        if shadows(&candidate) {
            let mut n = 2;
            loop {
                candidate = format!("{name}_{n}");
                if !shadows(&candidate) {
                    break;
                }
                n += 1;
            }
        }
        taken.insert(candidate.to_lowercase());
        cte_names.insert(source, candidate);
    }

    // The edits of the references of a statement text: the parameter becomes the name of the common table expression,
    // a renamed one keeps the name of the script as alias unless the statement reads a relation of that name
    let reference_edits = |p: &Prepared, statement: u32, refs: &[Reference]| -> Vec<(TextSpan, String)> {
        let mut edits = Vec::new();
        let mut relations = BTreeSet::new();
        relation_names(p, statement, &mut relations);
        for r in refs.iter().filter(|r| r.statement_id == statement && r.kind != ReferenceKind::Invalid) {
            let Some(source) = r.source() else { continue };
            let cte = &cte_names[&source];
            let tableref = &p.parsed.nodes[p.parsed.nodes[r.ast_node_id as usize].parent() as usize];
            let [alias] = attrs!(p.parsed.children(tableref), [Key::SQL_TABLEREF_ALIAS]);
            let has_alias = alias.is_some_and(|a| a.node_type() != NodeType::NONE);
            let script_name = name_of(source);
            let keeps_name = has_alias || cte == script_name || relations.contains(&script_name.to_lowercase());
            let text = if keeps_name { identifier(cte) } else { format!("{} as {}", identifier(cte), identifier(script_name)) };
            edits.push((r.text_span, text));
        }
        edits
    };

    // The common table expressions in order
    let mut ctes: Vec<String> = Vec::new();
    for &attachment in &attachments {
        let cte = identifier(&cte_names[&TableParameterSource::Attachment(attachment)]);
        let path = attachment_path(request, attachment);
        ctes.push(format!("{cte} as (select * from external('{}', format => 'parquet'))", path.replace('\'', "''")));
    }
    out.attachments = attachments;
    for &(producer, kind) in &order {
        let cte = identifier(&cte_names[&TableParameterSource::Script(producer)]);
        match kind {
            ReferenceKind::Inline => {
                let p = prepared[producer as usize].as_ref().unwrap();
                let Some(terminal) = p.terminal() else { continue };
                let span = p.parsed.associate_descriptions()[terminal as usize].statement_span;
                let mut edits = reference_edits(p, terminal, references.of(producer));
                // The inlined query binds the inputs of its script
                // Within the connection of the statement
                let dialect = request.connections[request.scripts[script as usize].connection as usize].dialect;
                let bindings = crate::session_inputs::bind_inputs(inputs, p, Some(terminal), dialect);
                edits.extend(bindings.edits);
                out.input_errors.extend(bindings.errors.into_iter().map(|(span, message)| (producer, span, message)));
                let body = read_executable_text_with(p.scanned, span, &edits);
                ctes.push(format!("{cte} as (\n{}\n)", body.trim_end()));
                out.inlined.push((producer, terminal));
            }
            _ => {
                let Some(&m) = materialization_of.get(&producer) else { continue };
                let path = materializations[m as usize].path.as_deref().unwrap_or("");
                ctes.push(format!("{cte} as (select * from external('{}', format => 'parquet'))", path.replace('\'', "''")));
                if !out.inputs.contains(&m) {
                    out.inputs.push(m);
                }
            }
        }
    }

    // The common table expressions go into the outermost SELECT around the references, before the ones it has
    let mut anchors: BTreeMap<u32, Vec<&Reference>> = BTreeMap::new();
    for r in &direct {
        if let Some(anchor) = anchor_of(parsed, r.ast_node_id) {
            anchors.entry(anchor).or_default().push(r);
        }
    }
    for &anchor in anchors.keys() {
        let node = &parsed.nodes[anchor as usize];
        let [with] = attrs!(parsed.children(node), [Key::SQL_SELECT_WITH_CTES]);
        let first_cte = with.filter(|w| w.node_type() == NodeType::ARRAY && w.children_count() > 0).map(|w| parsed.children(w)[0]);
        match first_cte {
            Some(first) => {
                let at = resolve_text_span(&scanned.text, &scanned.symbols, *first.symbol_span()).offset;
                out.edits.push((TextSpan::new(at, 0), format!("{},\n", ctes.join(",\n"))));
            }
            None => {
                let span = resolve_text_span(&scanned.text, &scanned.symbols, *node.symbol_span());
                let at = inside_parentheses(scanned.text.as_bytes(), span);
                out.edits.push((TextSpan::new(at, 0), format!("with {}\n", ctes.join(",\n"))));
            }
        }
    }
    out.edits.extend(reference_edits(consumer, statement_id, references.of(script)));
    out.edits.sort_by_key(|(s, _)| (s.offset, s.length));
    for r in direct {
        let Some(source) = r.source() else { continue };
        out.references.push(SplicedReference {
            reference: r.clone(),
            cte_name: cte_names[&source].clone(),
            materialization: match (r.kind, r.producer) {
                (ReferenceKind::Scan, Some(producer)) => materialization_of.get(&producer).copied(),
                _ => None,
            },
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The text from the offset of the query inside the parentheses that enclose all of it
    fn inside(text: &str) -> &str {
        let span = TextSpan { offset: 0, length: text.len() as u32 };
        &text[inside_parentheses(text.as_bytes(), span) as usize..]
    }

    #[test]
    fn skips_the_parentheses_that_enclose_all_of_a_query() {
        assert_eq!(inside("select 1"), "select 1");
        assert_eq!(inside("  (select 1) "), "select 1) ");
        assert_eq!(inside("(( select 1 ))"), "select 1 ))");
        // The first parenthesis closes before the end
        assert_eq!(inside("(select 1) union (select 2)"), "(select 1) union (select 2)");
        assert_eq!(inside("()"), ")");
    }

    #[test]
    fn parentheses_in_quotes_and_comments_do_not_count() {
        assert_eq!(inside("(select ')' as a)"), "select ')' as a)");
        assert_eq!(inside(r#"(select 1 as ")")"#), r#"select 1 as ")")"#);
        assert_eq!(inside("(select 1 -- )\n)"), "select 1 -- )\n)");
        assert_eq!(inside("(select /* ) */ 1)"), "select /* ) */ 1)");
        assert_eq!(inside("(select 1 /* ) */) union (select 2)"), "(select 1 /* ) */) union (select 2)");
    }
}
