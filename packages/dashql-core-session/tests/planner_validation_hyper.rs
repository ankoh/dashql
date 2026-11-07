//! Executes the planned SQL of the planner snapshots with script references in Hyper.
//!
//! Every valid plan with script references runs on fresh databases, one per connection: the catalog script of a
//! connection runs first, then the SQL of the nodes in node order, which orders every edge. A materialization is
//! written with `COPY (<query>) TO <file> WITH (format => 'parquet')` into a temporary directory, which stands for
//! the mount prefix of the plan. The host computes a result it provides with a plan of its script as target, its
//! references spliced in. The query of an attachment of a fixture is written the same way, below the attachment prefix.
//! A fixture with `hyper: skip` is left out.

use dashql_buffers::execution::ExecutionGraphT;
use dashql_snapshots::encode::planner::{
    plan_fixture, Fixture, FixtureAttachment, FixtureConnection, FixtureScript, PlannedFixture, PLANNER_ATTACHMENT_PREFIX, PLANNER_MOUNT_PREFIX,
};
use dashql_snapshots::{load_category, run, Arguments, Failed, Trial};
use hyper_ffi::{hyper_process, HyperConnection, HyperProcess, TemporaryDatabase};
use std::sync::{Arc, OnceLock};

/// Does a plan splice script references into its SQL?
fn has_references(graph: &ExecutionGraphT) -> bool {
    graph.references.as_ref().is_some_and(|r| !r.is_empty())
}

/// Run the nodes of a plan in node order and write their materializations
fn run_nodes(connections: &mut [HyperConnection], planned: &PlannedFixture, mount: &dyn Fn(&str) -> String) -> Result<(), String> {
    let materializations = planned.graph.materializations.as_deref().unwrap_or_default();
    for (i, node) in planned.graph.nodes.iter().flatten().enumerate() {
        let sql = mount(node.sql.as_deref().unwrap_or(""));
        if sql.is_empty() {
            continue;
        }
        connections[node.connection as usize]
            .execute_command(&sql)
            .map_err(|e| format!("node {i} ({}): {e}\n{sql}", planned.names[node.script as usize]))?;
        if node.materialization != u32::MAX {
            let path = mount(materializations[node.materialization as usize].path.as_deref().unwrap_or(""));
            write(connections, node.connection, &sql, &path)?;
        }
    }
    Ok(())
}

/// Write the result of a query as Parquet file
fn write(connections: &mut [HyperConnection], connection: u32, query: &str, path: &str) -> Result<(), String> {
    let copy = format!("COPY ({query}) TO '{path}' WITH (format => 'parquet')");
    connections[connection as usize].execute_command(&copy).map_err(|e| format!("materialization: {e}\n{copy}"))
}

/// Provide the result of a script the way the host does: run a plan of the script as target and write its result
fn provide(connections: &mut [HyperConnection], fixture: &Fixture, planned: &PlannedFixture, script: u32, path: &str, mount: &dyn Fn(&str) -> String) -> Result<(), String> {
    let name = planned.names[script as usize].clone();
    let target = Fixture {
        catalog: fixture.catalog.clone(),
        client_functions: fixture.client_functions,
        connections: fixture.connections.iter().map(|c| FixtureConnection { name: c.name.clone(), local: c.local, catalog: c.catalog.clone(), trino: c.trino }).collect(),
        scripts: fixture.scripts.iter().map(|s| FixtureScript { name: s.name.clone(), input: s.input.clone(), stale_prepend: None, connection: s.connection.clone() }).collect(),
        targets: Some(vec![name.clone()]),
        materialized: Vec::new(),
        tolerant: false,
        attachments: fixture.attachments.iter().map(|a| FixtureAttachment { file: a.file.clone(), stamp: a.stamp.clone(), query: a.query.clone() }).collect(),
    };
    let sub = plan_fixture(&target).map_err(|e| format!("plan of the provided result of {name}: {e}"))?;
    if !sub.graph.valid {
        return Err(format!("the plan of the provided result of {name} is invalid"));
    }
    run_nodes(connections, &sub, mount)?;
    let result = sub.graph.nodes.iter().flatten().find(|n| n.script == script && n.script_result).ok_or(format!("{name} has no result"))?;
    write(connections, result.connection, &mount(result.sql.as_deref().unwrap_or("")), path)
}

fn check(process: &OnceLock<HyperProcess>, name: &str, fixture: &Fixture, planned: &PlannedFixture) -> Result<(), String> {
    let graph = &planned.graph;
    let directory = TemporaryDatabase::new(&format!("{name}.files"));
    let files = directory.path.parent().unwrap().to_string_lossy().into_owned();
    let mount = |sql: &str| sql.replace(PLANNER_MOUNT_PREFIX, &files).replace(PLANNER_ATTACHMENT_PREFIX, &files);
    // A database per connection with the catalog of the connection
    let mut databases = Vec::new();
    let mut connections: Vec<HyperConnection> = Vec::new();
    for (i, connection) in planned.connections.iter().enumerate() {
        let database = TemporaryDatabase::new(&format!("{name}.{i}"));
        let mut c = hyper_process(process, "dashql-planner-validation").connect(&database.path)?;
        if let Some(catalog) = &connection.catalog {
            c.execute_script(catalog).map_err(|e| format!("catalog of {}: {e}", connection.name))?;
        }
        databases.push(database);
        connections.push(c);
    }
    // The attachments of the session
    for attachment in &fixture.attachments {
        let Some(query) = &attachment.query else { continue };
        write(&mut connections, 0, query, &format!("{files}/{}", attachment.file))?;
    }
    let materializations = graph.materializations.as_deref().unwrap_or_default();
    // The host provides reused materializations
    for materialization in materializations.iter().filter(|m| m.node == u32::MAX) {
        let path = mount(materialization.path.as_deref().unwrap_or(""));
        provide(&mut connections, fixture, planned, materialization.script, &path, &mount)?;
    }
    run_nodes(&mut connections, planned, &mount)?;
    drop(connections);
    drop(databases);
    Ok(())
}

fn main() {
    let args = Arguments::from_args();
    let process = Arc::new(OnceLock::new());
    let mut trials = Vec::new();
    for case in load_category("planner").expect("cannot load planner snapshots") {
        if case.node["hyper"].as_str() == Some("skip") {
            continue;
        }
        let fixture = Fixture::from_yaml(&case.node);
        let planned = plan_fixture(&fixture).unwrap_or_else(|e| panic!("cannot plan {}: {e}", case.trial_name()));
        if !planned.graph.valid || !has_references(&planned.graph) {
            continue;
        }
        let process = process.clone();
        let name = case.trial_name().replace(['/', ' ', ':'], "_");
        trials.push(Trial::test(case.trial_name(), move || check(&process, &name, &fixture, &planned).map_err(Failed::from)));
    }
    println!("{} planner cases with script references", trials.len());
    let conclusion = run(&args, trials);
    // The trials are dropped, stop Hyper before exiting
    drop(Arc::try_unwrap(process).ok().and_then(OnceLock::into_inner));
    conclusion.exit();
}
