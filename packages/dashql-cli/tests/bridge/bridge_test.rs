//! The agent bridge end to end, with the dashql binary as server, command line tool and shim of harness runs.
//! An agent calls into DashQL through `dashql agent`, and DashQL runs an agent with `agent/request`.
//! The harness is a script that speaks the stream-json of Claude Code, bridge_harness_test runs the real ones.

mod support;

use serde_json::{json, Value};
use std::time::Duration;
use support::{cli_async, test_file, Environment, Page, Server};

const TURN_TIMEOUT: Duration = Duration::from_secs(30);

fn fake_harness_config() -> Value {
    let script = test_file("FAKE_HARNESS").display().to_string();
    json!({
        "defaultHarness": "fake",
        "callWaitMs": 500,
        "harnesses": {
            "fake": {
                "command": ["/bin/sh", script, "{resume}", "--", "{prompt}"],
                "resumeArgs": ["--resume", "{harnessSession}"],
                "terminalCommand": ["fake", "--resume", "{harnessSession}"],
                "adapter": "claude",
            },
        },
    })
}

fn start() -> Server {
    Server::start(fake_harness_config(), Environment::Hermetic)
}

// ------------------------------------------------------------------------------------------------
// The agent calls into DashQL

#[tokio::test]
async fn commands_of_the_command_line_tool_reach_the_page() {
    let server = start();
    let mut page = server.connect().await;
    page.announce(&["s1", "s2"], Some("s1")).await;

    let status = cli_async(&server, &["status"], "", &[]).await;
    assert_eq!(status.code, 0, "{status:?}");
    assert!(status.stdout.contains("Client web (https://dashql.app), 2 sessions"), "{}", status.stdout);
    assert!(status.stdout.contains("s1  \"Session s1\" (focused)"), "{}", status.stdout);

    let scripts = cli_async(&server, &["scripts"], "", &[]).await;
    assert_eq!(scripts.code, 0, "{scripts:?}");
    assert!(scripts.stdout.starts_with("Session s1\nScripts:\n  notes"), "{}", scripts.stdout);
    assert_eq!(cli_async(&server, &["read", "q1"], "", &[]).await.stdout, "-- How many orders are there?\n");

    // edit reads the text from stdin or a file
    let text = "-- How many orders are there?\nselect count(*) from orders;\n";
    let edit = cli_async(&server, &["edit", "q1"], text, &[]).await;
    assert_eq!((edit.code, edit.stdout.as_str()), (0, "Updated q1: 59 bytes, 0 errors\n"));
    assert_eq!(page.script("s1", "q1").unwrap(), text);
    let file = support::temp_dir("dashql-edit").join("q2.sql");
    std::fs::write(&file, "select sum(amount) from orders;\n").unwrap();
    let edit = cli_async(&server, &["edit", "q2", "--file", file.to_str().unwrap()], "", &[]).await;
    assert_eq!(edit.stdout, "Created q2: 32 bytes, 0 errors\n");

    assert_eq!(cli_async(&server, &["lint", "q1"], "", &[]).await.stdout, "q1: no diagnostics\n");
    assert_eq!(cli_async(&server, &["catalog"], "", &[]).await.stdout, format!("{}\n", support::CATALOG));
    let run = cli_async(&server, &["run", "q1", "--max-rows", "5"], "", &[]).await;
    assert_eq!(run.stdout, "1 row, 1 column\ncount\n6\n");
    assert_eq!(cli_async(&server, &["result", "q1", "--page", "1"], "", &[]).await.stdout, "1 row, 1 column\ncount\n6\n");
    let json = cli_async(&server, &["read", "q2", "--json"], "", &[]).await;
    assert_eq!(serde_json::from_str::<Value>(&json.stdout).unwrap(), json!({ "text": "select sum(amount) from orders;\n" }));

    // The focused session, then DASHQL_SESSION, then --session
    cli_async(&server, &["scripts"], "", &[("DASHQL_SESSION", "s2")]).await;
    cli_async(&server, &["read", "q1", "--session", "s2"], "", &[("DASHQL_SESSION", "s1")]).await;
    let commands = page.commands();
    assert_eq!(
        commands.iter().map(|(session, command, _)| format!("{session} {command}")).collect::<Vec<_>>(),
        [
            "s1 scripts", "s1 read", "s1 edit", "s1 edit", "s1 lint", "s1 catalog", "s1 run", "s1 result", "s1 read",
            "s2 scripts", "s2 read",
        ]
    );
    let model = page.model.lock().unwrap();
    assert_eq!(model.commands[6]["args"], json!({ "script": "q1", "maxRows": 5 }));
    assert_eq!(model.commands[7]["args"], json!({ "script": "q1", "page": 1 }));
}

#[tokio::test]
async fn the_command_line_tool_reports_failures_with_exit_codes() {
    let server = start();
    let mut page = server.connect().await;
    page.announce(&["s1"], Some("s1")).await;

    // A command that fails in DashQL
    let read = cli_async(&server, &["read", "nope"], "", &[]).await;
    assert_eq!((read.code, read.stderr.as_str()), (1, "No script named nope. Scripts: notes, q1\n"));
    let run = cli_async(&server, &["run", "notes2"], "", &[]).await;
    assert_eq!(run.code, 1);
    // A malformed call
    let usage = cli_async(&server, &["read"], "", &[]).await;
    assert_eq!(usage.code, 2);
    assert!(usage.stderr.starts_with("read takes one script\n"), "{}", usage.stderr);
    // A session that no page holds, after callWaitMs
    let missing = cli_async(&server, &["scripts", "--session", "other"], "", &[]).await;
    assert_eq!(missing.code, 2, "{missing:?}");
    assert!(missing.stderr.contains("DashQL is not connected"), "{}", missing.stderr);

    // A wrong token
    let home = support::temp_dir("dashql-agent-home");
    std::fs::write(home.join("config.json"), json!({ "token": "wrong", "port": server.port }).to_string()).unwrap();
    let forbidden = server.cli_in(&home, &["scripts"]);
    assert_eq!((forbidden.code, forbidden.stderr.as_str()), (2, "invalid token\n"));

    // No server
    let port = server.port;
    drop(page);
    drop(server);
    std::fs::write(home.join("config.json"), json!({ "token": support::TOKEN, "port": port }).to_string()).unwrap();
    let mut command = std::process::Command::new(support::dashql_binary());
    let output = command.args(["agent", "scripts"]).env("DASHQL_AGENT_HOME", &home).output().unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("The DashQL agent server is not running"));
}

#[tokio::test]
async fn a_call_fails_when_the_page_goes_away() {
    let server = start();
    let mut page = server.connect().await;
    page.announce(&["s1"], Some("s1")).await;
    page.hang_on("q1");
    let call = {
        let (home, port) = (server.home.clone(), server.port);
        tokio::task::spawn_blocking(move || {
            let mut command = std::process::Command::new(support::dashql_binary());
            command.args(["agent", "read", "q1"]).env("DASHQL_AGENT_HOME", home).env("DASHQL_AGENT_PORT", port.to_string());
            command.output().unwrap()
        })
    };
    // Wait until the command reached the page
    for _ in 0..100 {
        if !page.commands().is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(page.commands().len(), 1);
    drop(page);
    let output = call.await.unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(String::from_utf8_lossy(&output.stderr), "DashQL disconnected during the call\n");
}

#[tokio::test]
async fn the_server_refuses_foreign_pages() {
    let server = start();
    assert_eq!(Page::connect(server.port, "https://evil.example").await.err(), Some(403));
    // Dev origins need a server in dev mode
    assert_eq!(Page::connect(server.port, "http://localhost:9002").await.err(), Some(403));
}

// ------------------------------------------------------------------------------------------------
// DashQL runs an agent

#[tokio::test]
async fn a_request_runs_an_agent_that_works_on_the_session() {
    let server = start();
    let mut page = server.connect().await;
    // The turn works on its own session, not on the focused one
    page.announce(&["s1", "s2"], Some("s2")).await;
    let turn = page.request("s1", "fake", "count").await;
    assert_eq!(page.finished(&turn, TURN_TIMEOUT).await, Ok("There are 6 orders.".to_string()));
    assert_eq!(page.script("s1", "q1").unwrap(), "-- How many orders are there?\nselect count(*) from orders;\n");
    assert_eq!(page.script("s2", "q1").unwrap(), "-- How many orders are there?\n");
    let commands: Vec<_> = page.commands().into_iter().map(|(s, c, _)| format!("{s} {c}")).collect();
    assert_eq!(commands, ["s1 scripts", "s1 catalog", "s1 edit", "s1 lint", "s1 run"]);
    let statuses = page.statuses(&turn);
    assert_eq!(statuses, ["starting the agent...", "dashql agent scripts", "dashql agent catalog", "Writing q1"]);

    // The conversation continues
    let context = page.context("s1").await;
    let harness_session = context["harnessSession"].as_str().unwrap().to_string();
    assert!(harness_session.starts_with("fake-"), "{context}");
    assert_eq!(context["harness"], "fake");
    assert_eq!(context["folder"], server.session_dir("s1").display().to_string());
    assert_eq!(context["terminalCommand"], json!(["fake", "--resume", harness_session]));
    let turn = page.request("s1", "fake", "again").await;
    assert_eq!(page.finished(&turn, TURN_TIMEOUT).await, Ok(format!("resumed {harness_session}")));

    // A reset starts a new conversation
    page.call("agent/reset", json!({ "session": "s1" })).await.unwrap();
    let turn = page.request("s1", "fake", "again").await;
    assert_eq!(page.finished(&turn, TURN_TIMEOUT).await, Ok("resumed ".to_string()));
    assert_ne!(page.context("s1").await["harnessSession"], harness_session.as_str());
}

#[tokio::test]
async fn the_agent_sees_failed_commands() {
    let server = start();
    let mut page = server.connect().await;
    page.announce(&["s1"], Some("s1")).await;
    let turn = page.request("s1", "fake", "error").await;
    let message = page.finished(&turn, TURN_TIMEOUT).await.unwrap();
    assert_eq!(message, "read exited with 1: No script named nope. Scripts: notes, q1");
}

#[tokio::test]
async fn a_failed_turn_reports_stderr_and_keeps_no_conversation() {
    let server = start();
    let mut page = server.connect().await;
    page.announce(&["s1"], Some("s1")).await;
    let turn = page.request("s1", "fake", "fail").await;
    let failed = page.finished(&turn, TURN_TIMEOUT).await.unwrap_err();
    assert_eq!(failed["error"], "The harness exited with code 3: the model is overloaded");
    assert_eq!(failed["cancelled"], false);
    assert_eq!(page.context("s1").await["harnessSession"], Value::Null);
    assert!(server.log().contains("fake failed for session s1"), "{}", server.log());
}

#[tokio::test]
async fn a_cancel_stops_the_agent_and_its_children() {
    let server = start();
    let mut page = server.connect().await;
    page.announce(&["s1"], Some("s1")).await;
    let turn = page.request("s1", "fake", "wait").await;
    page.next(|m| m["method"] == "agent/status" && m["params"]["text"] == "Waiting", TURN_TIMEOUT).await;
    let pid_file = server.session_dir("s1").join("sleep.pid");
    let mut pid = String::new();
    for _ in 0..100 {
        pid = std::fs::read_to_string(&pid_file).unwrap_or_default().trim().to_string();
        if !pid.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(alive(&pid), "the child of the harness runs");

    let started = std::time::Instant::now();
    page.call("agent/cancel", json!({ "session": "s1" })).await.unwrap();
    let failed = page.finished(&turn, TURN_TIMEOUT).await.unwrap_err();
    assert_eq!((failed["error"].as_str(), failed["cancelled"].as_bool()), (Some("Stopped"), Some(true)));
    assert!(started.elapsed() < Duration::from_secs(5));
    for _ in 0..100 {
        if !alive(&pid) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(!alive(&pid), "the child of the harness was stopped");

    // The session takes the next request
    let turn = page.request("s1", "fake", "again").await;
    assert!(page.finished(&turn, TURN_TIMEOUT).await.is_ok());
}

fn alive(pid: &str) -> bool {
    std::process::Command::new("kill").args(["-0", pid]).stderr(std::process::Stdio::null()).status().unwrap().success()
}

#[tokio::test]
async fn an_agent_cannot_start_another_server() {
    let server = start();
    let mut page = server.connect().await;
    page.announce(&["s1"], Some("s1")).await;
    let turn = page.request("s1", "fake", "serve").await;
    assert_eq!(page.finished(&turn, TURN_TIMEOUT).await, Ok("serve exited with 2".to_string()));
}

#[tokio::test]
async fn requests_need_a_session_of_the_page() {
    let server = start();
    let mut page = server.connect().await;
    page.announce(&["s1"], Some("s1")).await;
    let params = json!({ "session": "other", "harness": "fake", "prompt": "count" });
    let error = page.call("agent/request", params).await.unwrap_err();
    assert_eq!(error["code"], "usage");
    let params = json!({ "session": "s1", "harness": "nope", "prompt": "count" });
    assert_eq!(page.call("agent/request", params).await.unwrap_err()["message"], "unknown harness: nope");
}

// ------------------------------------------------------------------------------------------------
// DashQL.app runs the server

#[test]
fn the_server_stops_when_the_app_closes_stdin() {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};
    let home = support::temp_dir("dashql-agent-home");
    let config = json!({ "token": support::TOKEN, "port": support::free_port() });
    std::fs::write(home.join("config.json"), config.to_string()).unwrap();
    let mut command = Command::new(support::dashql_binary());
    command.args(["agent", "serve", "--exit-with-stdin"]);
    command.env_clear().env("HOME", &home).env("DASHQL_AGENT_HOME", &home);
    let mut child = command.stdin(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    let mut stderr = BufReader::new(child.stderr.take().unwrap());
    let mut line = String::new();
    stderr.read_line(&mut line).unwrap();
    assert!(line.starts_with("[dashql] Listening on 127.0.0.1:"), "{line}");

    let started = std::time::Instant::now();
    drop(child.stdin.take());
    let status = child.wait().unwrap();
    assert!(status.success(), "{status}");
    assert!(started.elapsed() < Duration::from_secs(5));
    let mut rest = String::new();
    std::io::Read::read_to_string(&mut stderr, &mut rest).unwrap();
    assert!(rest.contains("Stopping: stdin closed"), "{rest}");
}
