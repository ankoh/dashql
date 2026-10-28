//! The agent bridge with the real harnesses that are installed: their logins, their models, their tool permissions.
//! Runs outside the sandbox with the environment of the user and costs model calls, so it is manual:
//!   bazel test //packages/dashql-cli:bridge_harness_test
//!   bazel test //packages/dashql-cli:bridge_harness_test --test_env=DASHQL_TEST_HARNESSES=opencode
//! Harnesses that are not installed are skipped.

mod support;

use serde_json::json;
use std::time::Duration;
use support::{Environment, Server};

const TURN_TIMEOUT: Duration = Duration::from_secs(300);

/// A question about a script. The composer of DashQL lets the agent pick the script, the test names it to check
/// the edits of the script.
fn script_prompt(script: &str, question: &str) -> String {
    format!(
        "Answer the question below with a SQL query in the DashQL script {script}.\n\
         The connection speaks SQLite.\n\
         Look up the schema with dashql agent catalog, write the query into {script} with dashql agent edit, \
         check it with dashql agent lint and run it with dashql agent run.\n\
         Keep the comment lines at the top of the script.\n\n\
         Question: {question}"
    )
}

/// The harnesses to test, DASHQL_TEST_HARNESSES picks them
fn harnesses() -> Vec<String> {
    let names = std::env::var("DASHQL_TEST_HARNESSES").unwrap_or_else(|_| "claude,opencode".into());
    names.split(',').map(str::trim).filter(|n| !n.is_empty()).map(str::to_string).collect()
}

/// Whether the login shell finds the program, as the server does
fn installed(program: &str) -> bool {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let check = std::process::Command::new(shell).args(["-ilc", &format!("command -v {program}")]).output();
    check.is_ok_and(|output| output.status.success())
}

#[tokio::test]
async fn real_harnesses_answer_follow_up_and_stop() {
    let mut tested = Vec::new();
    for harness in harnesses() {
        if !installed(&harness) {
            eprintln!("skipping {harness}: not installed");
            continue;
        }
        eprintln!("testing {harness}");
        check_harness(&harness).await;
        tested.push(harness);
    }
    assert!(!tested.is_empty(), "no harness is installed");
}

async fn check_harness(harness: &str) {
    let server = Server::start(json!({ "defaultHarness": harness }), Environment::Inherited);
    let mut page = server.connect().await;
    page.announce(&["s1", "s2"], Some("s2")).await;

    // A question about the data: the agent writes the script, checks it and runs it
    let turn = page.request("s1", harness, &script_prompt("q1", "How many orders are there?")).await;
    let message = page.finished(&turn, TURN_TIMEOUT).await;
    let message = message.unwrap_or_else(|failed| panic!("{harness} failed: {failed}\n{}", server.log()));
    eprintln!("{harness}: {message}");
    assert!(message.contains('6'), "{harness} answered: {message}");
    let q1 = page.script("s1", "q1").unwrap();
    assert!(q1.starts_with("-- How many orders are there?"), "{harness} dropped the comment: {q1}");
    assert!(q1.to_lowercase().contains("from orders"), "{harness} wrote: {q1}");
    let commands = page.commands();
    assert!(commands.iter().all(|(session, _, _)| session == "s1"), "{harness} left its session: {commands:?}");
    assert!(commands.iter().any(|(_, c, s)| c == "edit" && s == "q1"), "{harness} did not edit q1: {commands:?}");
    assert!(commands.iter().any(|(_, c, s)| c == "run" && s == "q1"), "{harness} did not run q1: {commands:?}");
    assert!(page.statuses(&turn).len() > 1, "{harness} reported no progress");

    // A follow-up continues the conversation
    let context = page.context("s1").await;
    assert_eq!(context["harness"], harness);
    let harness_session = context["harnessSession"].clone();
    assert!(harness_session.is_string(), "{harness} has no conversation: {context}");
    let prompt = "-- Which number did you report in your previous answer? Reply with the number only, no tools.";
    let turn = page.request("s1", harness, prompt).await;
    let message = page.finished(&turn, TURN_TIMEOUT).await;
    let message = message.unwrap_or_else(|failed| panic!("{harness} failed the follow-up: {failed}"));
    assert!(message.contains('6'), "{harness} forgot the conversation: {message}");
    assert_eq!(page.context("s1").await["harnessSession"], harness_session);

    // A cancel stops the turn
    let prompt = script_prompt("q3", "What is the total amount of the orders per country?");
    let turn = page.request("s1", harness, &prompt).await;
    page.next(|m| m["method"] == "agent/status" && m["params"]["turnId"] == turn && m["params"]["text"] != "starting the agent...", TURN_TIMEOUT)
        .await;
    let started = std::time::Instant::now();
    page.call("agent/cancel", json!({ "session": "s1" })).await.unwrap();
    let failed = page.finished(&turn, Duration::from_secs(10)).await.unwrap_err();
    assert_eq!(failed["cancelled"], true);
    assert!(started.elapsed() < Duration::from_secs(5), "{harness} took {:?} to stop", started.elapsed());
}
