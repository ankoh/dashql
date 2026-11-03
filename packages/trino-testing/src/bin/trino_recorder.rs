//! Records the Trino API responses of the queries in `queries.rs` into `snapshots/plans/trino/recordings/`.
//!
//! `bazel run //packages/trino-testing:trino_recorder` starts a Trino server, runs every query and writes one
//! JSON file per query: the `/v1/statement` responses, the pruned `/v1/query/{id}` samples, the full final
//! QueryInfo and the distributed plan.
//! The recordings drive the regular tests of the progress model without a server.

use serde_json::{json, Value};
use std::path::PathBuf;
use trino_testing::queries::RECORDED_QUERIES;
use trino_testing::{TimedResponse, TrinoServer};

/// Serialize timed responses
fn timed(responses: &[TimedResponse]) -> Value {
    Value::Array(responses.iter().map(|r| json!({ "elapsedMs": r.elapsed_ms, "body": r.body })).collect())
}

fn main() {
    let workspace = std::env::var("BUILD_WORKSPACE_DIRECTORY").expect("run with bazel run");
    let output_dir = PathBuf::from(workspace).join("snapshots/plans/trino/recordings");
    std::fs::create_dir_all(&output_dir).expect("create the recordings directory");

    let server = TrinoServer::start().unwrap_or_else(|e| panic!("cannot start Trino: {e}"));
    let client = server.client();
    let info = client.get_json("/v1/info").expect("server info");
    let version = info.pointer("/nodeVersion/version").and_then(Value::as_str).unwrap_or("unknown").to_string();
    println!("Trino {version} at {}", server.endpoint);

    for query in RECORDED_QUERIES {
        let run = client.run_query(query.sql, &query.options("pruned=true"));
        let run = run.unwrap_or_else(|e| panic!("{}: {e}", query.name));
        match (run.error(), query.fails) {
            (Some(error), false) => panic!("{}: query failed: {}", query.name, error.get("message").unwrap_or(error)),
            (None, true) => panic!("{}: query was expected to fail", query.name),
            _ => {}
        }
        let explain = if query.explain {
            client.explain_distributed(query.sql).unwrap_or_else(|e| panic!("{}: EXPLAIN failed: {e}", query.name))
        } else {
            Value::Null
        };
        let recording = json!({
            "name": query.name,
            "trinoVersion": version,
            "sql": query.sql,
            "session": query.session.iter().map(|(k, v)| json!({ "name": k, "value": v })).collect::<Vec<_>>(),
            "queryId": run.query_id,
            "explain": explain,
            "statementResponses": timed(&run.statement_responses),
            "queryInfos": timed(&run.query_infos),
        });
        let path = output_dir.join(format!("{}.json", query.name));
        let text = serde_json::to_string_pretty(&recording).expect("serialize the recording");
        std::fs::write(&path, text + "\n").unwrap_or_else(|e| panic!("cannot write {}: {e}", path.display()));
        println!(
            "{}: {} statement responses, {} query infos -> {}",
            query.name,
            run.statement_responses.len(),
            run.query_infos.len(),
            path.display()
        );
    }
}
