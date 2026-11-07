//! The planner snapshot encoder.

use super::{plain, Map};
use crate::ryml::Node;
use dashql_buffers::execution::{ExecutionGraphEntityType, ExecutionGraphT};
use dashql_core::catalog::{Catalog, CatalogLayer};
use dashql_core::script::Script;
use dashql_core::utils::quote_identifier;
use dashql_core_session::script_references::{CheckedScript, ReferenceKind, TableParameterCollision};
use dashql_parser::keywords::Keyword;
use yaml_rust2::Yaml;

/// Does `identifier_requires_quotes` hold?
fn requires_quotes(text: &str) -> bool {
    quote_identifier(text) != text
}

/// The qualified name of an entity: keywords are quoted, as are names with upper-case letters
fn qualified_name(database: &Option<String>, schema: &Option<String>, name: &Option<String>) -> String {
    let mut out = String::new();
    for component in [database, schema, name] {
        let component = component.as_deref().unwrap_or("");
        if component.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push('.');
        }
        if Keyword::find(component.as_bytes()).is_some() && !requires_quotes(component) {
            out.push('"');
            out.push_str(component);
            out.push('"');
        } else {
            out.push_str(&quote_identifier(component));
        }
    }
    out
}

fn publishable(script: &Script) -> bool {
    let (Some(scanned), Some(parsed), Some(analyzed)) = (&script.scanned, &script.parsed, &script.analyzed) else {
        return false;
    };
    scanned.errors.is_empty()
        && parsed.errors.is_empty()
        && analyzed.errors.iter().all(|e| e.severity != dashql_buffers::analyzer::AnalyzerErrorSeverity::ERROR)
}

fn prepare(catalog: &Catalog, text: &str) -> Result<Script, String> {
    let mut script = Script::new(catalog);
    script.replace_text(text);
    script.scan();
    script.parse();
    script.analyze(catalog, false).map_err(|e| e.message)?;
    Ok(script)
}

/// A connection of a planner fixture
pub struct FixtureConnection {
    /// The connection name, scripts reference it
    pub name: String,
    /// Is the connection the LOCAL one?
    pub local: bool,
    /// The catalog script of the connection
    pub catalog: Option<String>,
    /// Does the connection speak Trino? Hyper otherwise, `dialect: trino`.
    pub trino: bool,
}

/// A script of a planner fixture
pub struct FixtureScript {
    /// The script name, table parameters reference it
    pub name: String,
    /// The script text
    pub input: String,
    /// The text to prepend after the analysis, which makes the analysis stale (`stale-prepend`)
    pub stale_prepend: Option<String>,
    /// The connection name, the implicit connection if absent
    pub connection: Option<String>,
}

/// An attachment of a planner fixture, a Parquet file of the session
pub struct FixtureAttachment {
    /// The file name, `sales.parquet` is the table parameter `:sales`
    pub file: String,
    /// The stamp of the file
    pub stamp: String,
    /// The query whose result the file holds, the validation in Hyper writes it (`query`)
    pub query: Option<String>,
}

impl FixtureAttachment {
    /// The name of the table parameter, the file name without `.parquet`
    pub fn name(&self) -> &str {
        self.file.strip_suffix(".parquet").unwrap_or(&self.file)
    }
}

/// The texts of a planner fixture
pub struct Fixture {
    /// The catalog script of the implicit connection
    pub catalog: Option<String>,
    /// The connections, an implicit REMOTE connection with `catalog` if empty
    pub connections: Vec<FixtureConnection>,
    /// The scripts
    pub scripts: Vec<FixtureScript>,
    /// The target scripts of a plan of targets, a plan of the session if absent
    pub targets: Option<Vec<String>>,
    /// The scripts whose materialized results the host provides
    pub materialized: Vec<String>,
    /// Is the plan tolerant (`scope: tolerant`), the plan of the dataflow?
    pub tolerant: bool,
    /// The attachments of the session
    pub attachments: Vec<FixtureAttachment>,
    /// Do the connections have the fixture client functions (`client_functions: tickets`)?
    pub client_functions: bool,
}

/// The directory of the materialized results in planner snapshots
pub const PLANNER_MOUNT_PREFIX: &str = "/mnt/external/dashql-run-test";

/// The directory of the attachments in planner snapshots
pub const PLANNER_ATTACHMENT_PREFIX: &str = "/mnt/external/attachments/test";

impl Fixture {
    /// Read a fixture of a snapshot file
    pub fn from_yaml(fixture: &Yaml) -> Self {
        let text = |node: &Yaml| node.as_str().unwrap_or("").to_string();
        let present = |node: &Yaml| !matches!(node, Yaml::BadValue);
        let names = |node: &Yaml| node.as_vec().into_iter().flatten().map(text).collect::<Vec<_>>();
        Self {
            catalog: present(&fixture["catalog"]).then(|| text(&fixture["catalog"])),
            client_functions: present(&fixture["client_functions"]),
            connections: fixture["connections"]
                .as_vec()
                .into_iter()
                .flatten()
                .map(|c| FixtureConnection {
                    name: text(&c["name"]),
                    local: c["kind"].as_str() == Some("LOCAL"),
                    catalog: present(&c["catalog"]).then(|| text(&c["catalog"])),
                    trino: c["dialect"].as_str() == Some("trino"),
                })
                .collect(),
            scripts: fixture["scripts"]
                .as_vec()
                .into_iter()
                .flatten()
                .map(|s| FixtureScript {
                    name: text(&s["name"]),
                    input: text(&s["input"]),
                    stale_prepend: s["stale-prepend"].as_str().map(str::to_string),
                    connection: s["connection"].as_str().map(str::to_string),
                })
                .collect(),
            targets: present(&fixture["targets"]).then(|| names(&fixture["targets"])),
            materialized: names(&fixture["materialized"]),
            tolerant: fixture["scope"].as_str() == Some("tolerant"),
            attachments: fixture["attachments"]
                .as_vec()
                .into_iter()
                .flatten()
                .map(|a| FixtureAttachment {
                    file: text(&a["file"]),
                    stamp: match &a["stamp"] {
                        Yaml::Integer(i) => i.to_string(),
                        stamp => text(stamp),
                    },
                    query: a["query"].as_str().map(str::to_string),
                })
                .collect(),
        }
    }

    /// Read a fixture of a template
    pub fn from_node(fixture: &Node) -> Self {
        Self::from_yaml(&fixture.to_yaml())
    }
}

/// Plan a fixture and encode the execution graph
pub fn encode_fixture(fixture: &Yaml) -> Result<Yaml, String> {
    encode_planner_fixture(&Fixture::from_yaml(fixture)).map(|node| node.to_yaml())
}

/// Plan a fixture and encode the execution graph as a styled tree
pub fn encode_planner_fixture(fixture: &Fixture) -> Result<Node, String> {
    let planned = plan_fixture(fixture)?;
    let inputs: Vec<&Script> = planned.scripts.iter().collect();
    let connection_names: Vec<String> = planned.connections.iter().map(|c| c.name.clone()).collect();
    let declared = !fixture.connections.is_empty();
    Ok(encode_graph(&planned.graph, &planned.checks, &planned.collisions, &inputs, &planned.names, declared.then_some(&connection_names[..]), fixture.targets.is_some()))
}

/// A planned fixture
pub struct PlannedFixture {
    /// The execution graph
    pub graph: ExecutionGraphT,
    /// The connections, the implicit one of a fixture without connections
    pub connections: Vec<FixtureConnection>,
    /// The script names
    pub names: Vec<String>,
    /// The planned scripts
    pub scripts: Vec<Script>,
    /// The checked script references of the scripts
    pub checks: Vec<CheckedScript>,
    /// The names of table parameters that collide
    pub collisions: Vec<TableParameterCollision>,
}

/// The analyzed scripts and catalogs of a fixture
pub struct PreparedFixture {
    /// The connections, the implicit one of a fixture without connections
    pub connections: Vec<FixtureConnection>,
    /// The catalogs of the connections
    pub catalogs: Vec<Catalog>,
    /// The scripts of the catalogs of the connections
    pub catalog_scripts: Vec<Script>,
    /// The script names
    pub names: Vec<String>,
    /// The scripts and their connections
    pub scripts: Vec<(Script, usize)>,
    /// The target scripts of a plan of targets
    pub targets: Option<Vec<u32>>,
    /// The scripts whose materialized results the host provides
    pub materialized: Vec<u32>,
    /// The attachments: the name, the file and the stamp
    pub attachments: Vec<(String, String, String)>,
}

impl PreparedFixture {
    /// Pass the plan request of the fixture to `f`, with `scope` in place of the scope of the fixture if given
    pub fn with_request<R>(&self, scope: Option<dashql_core_session::planner::PlanScope>, f: impl FnOnce(&dashql_core_session::planner::SessionPlanRequest) -> R) -> R {
        use dashql_core_session::planner::{ConnectionKind, PlanScope, PlannerAttachment, PlannerConnection, PlannerScript, SessionPlanRequest};
        let connections: Vec<PlannerConnection> = self
            .connections
            .iter()
            .zip(&self.catalogs)
            .map(|(c, catalog)| PlannerConnection {
                id: &c.name,
                kind: if c.local { ConnectionKind::Local } else { ConnectionKind::Remote },
                catalog,
                dialect: if c.trino { dashql_buffers::formatting::FormattingDialect::TRINO } else { dashql_buffers::formatting::FormattingDialect::HYPER },
            })
            .collect();
        let scripts: Vec<PlannerScript> = self
            .scripts
            .iter()
            .zip(&self.names)
            .map(|((script, connection), name)| PlannerScript { script, name, connection: *connection as u32, materialization_file: None })
            .collect();
        let attachments: Vec<PlannerAttachment> =
            self.attachments.iter().map(|(name, file, stamp)| PlannerAttachment { name, file, stamp }).collect();
        let request = SessionPlanRequest {
            connections: &connections,
            scripts: &scripts,
            scope: scope.unwrap_or(match &self.targets {
                Some(t) => PlanScope::Targets(t),
                None => PlanScope::Session,
            }),
            materialized: &self.materialized,
            mount_prefix: PLANNER_MOUNT_PREFIX,
            attachments: &attachments,
            attachment_prefix: PLANNER_ATTACHMENT_PREFIX,
        };
        f(&request)
    }
}

/// Analyze the scripts of a fixture like the app: the declarations of every connection are published before the
/// scripts are analyzed again, then the stale prepends are applied
pub fn prepare_fixture(fixture: &Fixture) -> Result<PreparedFixture, String> {
    // The connections and their catalogs, an implicit connection without connections
    let declared = !fixture.connections.is_empty();
    let connections: Vec<FixtureConnection> = if declared {
        fixture.connections.iter().map(|c| FixtureConnection { name: c.name.clone(), local: c.local, catalog: c.catalog.clone(), trino: c.trino }).collect()
    } else {
        vec![FixtureConnection { name: "default".into(), local: false, catalog: fixture.catalog.clone(), trino: false }]
    };
    let mut catalogs: Vec<Catalog> = Vec::new();
    let mut catalog_scripts = Vec::new();
    for connection in &connections {
        let mut catalog = Catalog::new();
        if fixture.client_functions {
            catalog.register_client_functions(crate::clfn_fixture::TICKETS).map_err(|e| e.message)?;
        }
        if let Some(text) = &connection.catalog {
            let script = prepare(&catalog, &crate::trim_input(text))?;
            if !publishable(&script) {
                return Err("invalid planner fixture catalog".into());
            }
            catalog.load_script(script.analyzed.clone().unwrap(), CatalogLayer::CONNECTION).map_err(|e| e.message)?;
            catalog_scripts.push(script);
        }
        catalogs.push(catalog);
    }
    let connection_of = |script: &FixtureScript| -> Result<usize, String> {
        match &script.connection {
            None if !declared => Ok(0),
            None => Err(format!("planner fixture script {} needs a connection", script.name)),
            Some(name) => connections.iter().position(|c| &c.name == name).ok_or_else(|| format!("unknown planner fixture connection {name}")),
        }
    };
    let mut names = Vec::new();
    let mut scripts = Vec::new();
    for script in &fixture.scripts {
        if script.name.is_empty() || names.contains(&script.name) {
            return Err("planner fixture script names must be nonempty and unique".into());
        }
        names.push(script.name.clone());
        let connection = connection_of(script)?;
        scripts.push((prepare(&catalogs[connection], &crate::trim_input(&script.input))?, script.stale_prepend.clone(), connection));
    }
    // Publish the complete definition set of every connection before resolving any cross-script references
    for (ci, catalog) in catalogs.iter_mut().enumerate() {
        let definitions: Vec<_> = scripts
            .iter()
            .filter(|(s, _, c)| *c == ci && publishable(s) && !s.analyzed.as_ref().unwrap().entry.table_declarations.is_empty())
            .map(|(s, _, _)| (s.analyzed.clone().unwrap(), CatalogLayer::SESSION))
            .collect();
        catalog.load_scripts(&definitions).map_err(|e| e.message)?;
    }
    for (script, _, connection) in scripts.iter_mut() {
        script.analyze(&catalogs[*connection], false).map_err(|e| e.message)?;
    }
    for (script, prepend, _) in scripts.iter_mut() {
        if let Some(prepend) = prepend {
            script.insert_text_at(0, prepend);
        }
    }
    let index_of = |name: &String| names.iter().position(|n| n == name).map(|i| i as u32).ok_or_else(|| format!("unknown planner fixture script {name}"));
    let targets = fixture.targets.as_ref().map(|t| t.iter().map(index_of).collect::<Result<Vec<_>, _>>()).transpose()?;
    let materialized = fixture.materialized.iter().map(index_of).collect::<Result<Vec<_>, _>>()?;
    let scripts = scripts.into_iter().map(|(s, _, c)| (s, c)).collect();
    let attachments = fixture.attachments.iter().map(|a| (a.name().to_string(), a.file.clone(), a.stamp.clone())).collect();
    Ok(PreparedFixture { connections, catalogs, catalog_scripts, names, scripts, targets, materialized, attachments })
}

/// Plan a fixture
pub fn plan_fixture(fixture: &Fixture) -> Result<PlannedFixture, String> {
    use dashql_core_session::planner::plan_session;
    use dashql_core_session::script_references::{check_script_references, table_parameter_collisions};
    let prepared = prepare_fixture(fixture)?;
    let scope = fixture.tolerant.then_some(dashql_core_session::planner::PlanScope::Tolerant);
    let (graph, checks, collisions) =
        prepared.with_request(scope, |request| (plan_session(request), check_script_references(request), table_parameter_collisions(request)));
    let PreparedFixture { connections, names, scripts, .. } = prepared;
    Ok(PlannedFixture { graph, connections, names, scripts: scripts.into_iter().map(|(s, _)| s).collect(), checks, collisions })
}

/// Encode an execution graph. `connections` are the names of the declared connections, a fixture without them
/// leaves the connections out.
fn encode_graph(
    graph: &ExecutionGraphT,
    checks: &[CheckedScript],
    collisions: &[TableParameterCollision],
    inputs: &[&Script],
    names: &[String],
    connections: Option<&[String]>,
    targets: bool,
) -> Node {
    let none = u32::MAX;
    let attachments = graph.attachments.as_deref().unwrap_or_default();
    let attachment_file = |a: u32| attachments.get(a as usize).and_then(|a| a.file.clone()).unwrap_or_default();
    let mut out = Map::new();
    out.boolean("valid", graph.valid);
    if let Some(connections) = connections {
        let list = graph
            .connections
            .iter()
            .flatten()
            .zip(connections)
            .map(|(c, name)| {
                let mut m = Map::new();
                m.plain("name", name);
                m.plain("kind", c.kind.variant_name().unwrap_or(""));
                m.into_node()
            })
            .collect();
        out.insert("connections", Node::seq(list));
    }
    let connection_name = |c: u32| connections.and_then(|names| names.get(c as usize)).cloned().unwrap_or_default();
    let scripts = graph
        .scripts
        .iter()
        .flatten()
        .enumerate()
        .map(|(index, s)| {
            let mut m = Map::new();
            // The scripts of the graph are the scripts of the request
            debug_assert_eq!(inputs[index].catalog_entry_id(), s.script_id);
            m.plain("name", &names[index]);
            if connections.is_some() {
                m.plain("connection", &connection_name(s.connection));
            }
            m.int("text-version", s.text_version as i64);
            m.int("analyzed-text-version", s.analyzed_text_version as i64);
            m.int("analyzed-catalog-revision", s.analyzed_catalog_revision as i64);
            if !s.planned {
                m.boolean("planned", false);
            }
            if targets {
                m.boolean("target", s.target);
            }
            if s.planned {
                m.boolean("cacheable", s.cacheable);
                if s.terminal_statement_id != none {
                    m.int("terminal-statement-id", s.terminal_statement_id as i64);
                }
                if let Some(signature) = &s.signature {
                    m.quoted("signature", signature);
                }
            }
            let referenced: Vec<Node> = s.referenced_scripts.iter().flatten().map(|&r| plain(&names[r as usize])).collect();
            if !referenced.is_empty() {
                m.insert("references", Node::flow_seq(referenced));
            }
            m.into_node()
        })
        .collect();
    out.insert("scripts", Node::seq(scripts));
    let entities = graph.entities.as_deref().unwrap_or_default();
    let catalog_id = |index: u32| -> String {
        let entity = &entities[index as usize];
        let id = &entity.catalog_object_id;
        let mut text = match id.object_type {
            ExecutionGraphEntityType::DATABASE => id.object_id.to_string(),
            ExecutionGraphEntityType::SCHEMA => format!("{}.{}", id.object_id, id.sub_object_id),
            _ => {
                let mut t = format!("{}.{}.{}", entity.catalog_database_id, entity.catalog_schema_id, id.object_id);
                if id.object_type == ExecutionGraphEntityType::COLUMN || id.sub_object_id != 0 {
                    t.push_str(&format!(".{}", id.sub_object_id));
                }
                t
            }
        };
        if id.object_type != ExecutionGraphEntityType::TABLE {
            text = format!("{}:{text}", id.object_type.variant_name().unwrap_or(""));
        }
        // Catalog ids of different connections may be equal
        if connections.is_some() {
            text = format!("{}/{text}", connection_name(entity.connection));
        }
        text
    };
    let entity_list = entities
        .iter()
        .enumerate()
        .map(|(i, e)| {
            let mut m = Map::new();
            m.insert("catalog-id", Node::squo(catalog_id(i as u32)));
            m.plain("type", e.catalog_object_id.object_type.variant_name().unwrap_or(""));
            m.plain("name", &qualified_name(&e.database_name, &e.schema_name, &e.name));
            m.into_node()
        })
        .collect();
    out.insert("entities", Node::seq(entity_list));
    let unresolved = graph
        .unresolved_references
        .iter()
        .flatten()
        .map(|r| {
            let mut m = Map::new();
            m.plain("name", &qualified_name(&r.database_name, &r.schema_name, &r.name));
            if connections.is_some() {
                m.plain("connection", &connection_name(r.connection));
            }
            m.into_node()
        })
        .collect();
    out.insert("unresolved-references", Node::seq(unresolved));
    let target = |m: &mut Map, entity: u32, unresolved: u32| {
        if entity != none {
            m.insert("entity", Node::squo(catalog_id(entity)));
        }
        if unresolved != none {
            m.int("unresolved-reference", unresolved as i64);
        }
    };
    let nodes = graph
        .nodes
        .iter()
        .flatten()
        .enumerate()
        .map(|(i, n)| {
            let mut m = Map::new();
            m.int("id", i as i64);
            m.plain("script", &names[n.script as usize]);
            if connections.is_some() {
                m.plain("connection", &connection_name(n.connection));
            }
            m.int("statement-id", n.statement_id as i64);
            m.plain("type", n.statement_type.variant_name().unwrap_or(""));
            let sql = n.sql.as_deref().unwrap_or("");
            if sql.contains('\n') {
                m.insert("sql", Node::literal(sql));
            } else {
                m.quoted("sql", sql);
            }
            if let Some(call) = n.client_function_call.as_deref() {
                m.quoted("client-function-call", call);
            }
            m.boolean("produces-output", n.produces_output);
            m.boolean("barrier", n.barrier);
            if n.script_result {
                m.boolean("script-result", true);
            }
            if n.materialization != none {
                m.int("materialization", n.materialization as i64);
            }
            let inputs: Vec<Node> = n.inputs.iter().flatten().map(|&i| Node::int(i)).collect();
            if !inputs.is_empty() {
                m.insert("inputs", Node::flow_seq(inputs));
            }
            let inlined: Vec<Node> = n.inlined_scripts.iter().flatten().map(|&s| Node::int(s)).collect();
            if !inlined.is_empty() {
                m.insert("inlined-scripts", Node::flow_seq(inlined));
            }
            let scanned: Vec<Node> = n.attachments.iter().flatten().map(|&a| plain(&attachment_file(a))).collect();
            if !scanned.is_empty() {
                m.insert("attachments", Node::flow_seq(scanned));
            }
            let accesses = n
                .accesses
                .iter()
                .flatten()
                .map(|a| {
                    let mut am = Map::new();
                    target(&mut am, a.entity, a.unresolved_reference);
                    am.plain("mode", a.mode.variant_name().unwrap_or(""));
                    am.into_node()
                })
                .collect();
            m.insert("accesses", Node::seq(accesses));
            m.into_node()
        })
        .collect();
    out.insert("nodes", Node::seq(nodes));
    let edges = graph
        .edges
        .iter()
        .flatten()
        .map(|e| {
            let mut m = Map::new();
            m.int("from", e.from as i64);
            m.int("to", e.to as i64);
            m.plain("reason", e.reason.variant_name().unwrap_or(""));
            target(&mut m, e.entity, e.unresolved_reference);
            m.into_node()
        })
        .collect();
    out.insert("edges", Node::seq(edges));
    let span_text = |script: u32, span: &Option<dashql_buffers::parser::TextSpanT>| -> Option<String> {
        let span = span.as_ref()?;
        let text = &inputs.get(script as usize)?.scanned.as_ref()?.text;
        Some(super::location_text(text, span.offset, span.length))
    };
    let materializations: Vec<Node> = graph
        .materializations
        .iter()
        .flatten()
        .map(|mat| {
            let mut m = Map::new();
            m.plain("script", &names[mat.script as usize]);
            if mat.node != none {
                m.int("node", mat.node as i64);
            } else {
                m.boolean("reused", true);
            }
            m.plain("path", mat.path.as_deref().unwrap_or(""));
            m.into_node()
        })
        .collect();
    if !materializations.is_empty() {
        out.insert("materializations", Node::seq(materializations));
    }
    let attachment_list: Vec<Node> = attachments
        .iter()
        .map(|a| {
            let mut m = Map::new();
            m.plain("name", a.name.as_deref().unwrap_or(""));
            m.plain("path", a.path.as_deref().unwrap_or(""));
            m.into_node()
        })
        .collect();
    if !attachment_list.is_empty() {
        out.insert("attachments", Node::seq(attachment_list));
    }
    let references: Vec<Node> = graph
        .references
        .iter()
        .flatten()
        .map(|r| {
            let mut m = Map::new();
            m.int("node", r.node as i64);
            m.plain("script", &names[r.consumer_script as usize]);
            if let Some(text) = span_text(r.consumer_script, &r.text_span) {
                m.quoted("text", &text);
            }
            if r.attachment != none {
                m.plain("attachment", &attachment_file(r.attachment));
            } else {
                m.plain("target", &names[r.script as usize]);
            }
            m.plain("cte", r.cte_name.as_deref().unwrap_or(""));
            if r.materialization != none {
                m.int("materialization", r.materialization as i64);
            }
            m.into_node()
        })
        .collect();
    if !references.is_empty() {
        out.insert("references", Node::seq(references));
    }
    let diagnostics = graph
        .diagnostics
        .iter()
        .flatten()
        .map(|d| {
            let mut m = Map::new();
            if d.node != none {
                m.int("node", d.node as i64);
            }
            if d.script != none {
                if let Some(name) = names.get(d.script as usize) {
                    m.plain("script", name);
                }
                if let Some(text) = span_text(d.script, &d.text_span) {
                    m.quoted("text", &text);
                }
            }
            m.boolean("error", d.error);
            m.insert("message", plain(d.message.as_deref().unwrap_or("")));
            m.into_node()
        })
        .collect();
    out.insert("diagnostics", Node::seq(diagnostics));
    // The check of the script references, of fixtures with table parameters
    let checked: Vec<Node> = checks
        .iter()
        .enumerate()
        .filter(|(_, c)| !c.checked || !c.references.is_empty())
        .map(|(i, c)| {
            let mut m = Map::new();
            m.plain("script", &names[i]);
            if !c.checked {
                m.boolean("checked", false);
            }
            let references = c
                .references
                .iter()
                .map(|r| {
                    let mut rm = Map::new();
                    if let Some(text) = inputs[i].scanned.as_ref().map(|s| super::location_text(&s.text, r.text_span.offset, r.text_span.length)) {
                        rm.quoted("text", &text);
                    }
                    if let Some(target) = r.script {
                        rm.plain("target", &names[target as usize]);
                    }
                    if let Some(attachment) = r.attachment {
                        rm.plain("attachment", &attachment_file(attachment));
                    }
                    rm.plain(
                        "kind",
                        match r.kind {
                            ReferenceKind::Inline => "inline",
                            ReferenceKind::Scan => "scan",
                            ReferenceKind::Invalid => "invalid",
                            ReferenceKind::Attachment => "attachment",
                        },
                    );
                    if !r.errors.is_empty() {
                        rm.insert("errors", Node::seq(r.errors.iter().map(|e| plain(e)).collect()));
                    }
                    rm.into_node()
                })
                .collect();
            if !c.references.is_empty() {
                m.insert("references", Node::seq(references));
            }
            m.into_node()
        })
        .collect();
    if !checked.is_empty() {
        out.insert("checked-references", Node::seq(checked));
    }
    let collisions: Vec<Node> = collisions
        .iter()
        .map(|c| {
            let mut m = Map::new();
            m.plain("name", &c.name);
            let mut members: Vec<Node> = c.scripts.iter().map(|&s| plain(&format!("{}.sql", names[s as usize]))).collect();
            members.extend(c.attachments.iter().map(|&a| plain(&attachment_file(a))));
            m.insert("members", Node::flow_seq(members));
            m.into_node()
        })
        .collect();
    if !collisions.is_empty() {
        out.insert("collisions", Node::seq(collisions));
    }
    out.into_node()
}
