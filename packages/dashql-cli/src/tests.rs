//! The binary with a fake server of the app: the requests that it sends, the answers that it prints, its exit codes

use super::*;
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::PathBuf;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::mpsc;
use std::thread;

/// A request that the fake server got
struct Request {
    head: String,
    body: Value,
}

/// A fake server of the app that answers one call with the raw answer, returns its port and the request it got
fn serve(answer: Vec<String>) -> (u16, mpsc::Receiver<Request>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let (send, receive) = mpsc::channel();
    thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut head = String::new();
        let mut length = 0;
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                length = value.trim().parse().unwrap();
            }
            head.push_str(&line);
            if line == "\r\n" {
                break;
            }
        }
        let mut body = vec![0; length];
        reader.read_exact(&mut body).unwrap();
        // A test that drops the receiver checks only the answer
        let _ = send.send(Request { head, body: serde_json::from_slice(&body).unwrap() });
        let mut stream = stream;
        // The parts of the answer arrive one after the other, like the lines of a run
        for part in answer {
            stream.write_all(part.as_bytes()).unwrap();
            stream.flush().unwrap();
            thread::sleep(std::time::Duration::from_millis(5));
        }
    });
    (port, receive)
}

/// A new folder for the files of a test
fn folder() -> PathBuf {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let root = std::env::var_os("TEST_TMPDIR").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    let dir = root.join(format!("dashql-cli-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst)));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A session file of a server on a port
fn session_file(port: u16) -> String {
    let path = folder().join("session.json");
    let text = json!({"url": format!("http://127.0.0.1:{port}"), "token": "s3cret", "workbookId": "wb1"});
    std::fs::write(&path, text.to_string()).unwrap();
    path.display().to_string()
}

/// The result of a run
#[derive(Debug, PartialEq)]
struct Output {
    code: u8,
    stdout: String,
    stderr: String,
}

fn run_with(args: &[&str], stdin: &str, stdin_is_terminal: bool) -> Output {
    let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
    let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
    let code = run(
        &args,
        &mut Process { stdin: &mut stdin.as_bytes(), stdin_is_terminal, stdout: &mut stdout, stderr: &mut stderr },
    );
    Output { code, stdout: String::from_utf8(stdout).unwrap(), stderr: String::from_utf8(stderr).unwrap() }
}

/// The head of an answer of 200 with the body in chunks
const CHUNKED: &str = "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nTransfer-Encoding: chunked\r\n\r\n";

/// A chunk of a chunked body
fn chunk(data: &str) -> String {
    format!("{:x}\r\n{data}\r\n", data.len())
}

/// The end of a chunked body
const LAST: &str = "0\r\n\r\n";

/// The parts of an answer as owned strings
fn parts(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| part.to_string()).collect()
}

#[test]
fn prints_the_usage_and_the_guide() {
    let usage = run_with(&["--help"], "", true);
    assert_eq!((usage.code, usage.stdout.as_str()), (EXIT_OK, commands::usage().as_str()));
    let guide = run_with(&["guide"], "", true);
    assert_eq!(guide.code, EXIT_OK);
    assert!(guide.stdout.starts_with("DashQL is a SQL workbench."));
}

#[test]
fn rejects_a_bad_command_line_with_the_usage() {
    for args in [&[][..], &["bogus"][..], &["--session", "s.json", "read"][..], &["scripts"][..]] {
        let output = run_with(args, "", true);
        assert_eq!(output.code, EXIT_USAGE, "{args:?}");
        assert!(output.stderr.starts_with("error: "), "{args:?}: {}", output.stderr);
        assert!(output.stderr.ends_with(&commands::usage()), "{args:?}");
    }
}

#[test]
fn fails_without_a_readable_session_file() {
    let missing = folder().join("missing.json").display().to_string();
    let output = run_with(&["--session", &missing, "scripts"], "", true);
    assert_eq!(output.code, EXIT_USAGE);
    assert!(output.stderr.starts_with(&format!("error: the session file {missing}: ")), "{}", output.stderr);
    let broken = folder().join("session.json");
    std::fs::write(&broken, "{\"url\": 1}").unwrap();
    let output = run_with(&["--session", &broken.display().to_string(), "scripts"], "", true);
    assert_eq!(output.code, EXIT_USAGE);
    assert!(output.stderr.contains("no url"), "{}", output.stderr);
}

#[test]
fn sends_a_call_and_streams_its_answer() {
    // A line can span chunks, and a chunk can arrive in parts
    let last = chunk("{\"out\": \"1 row\\n\"}\n{\"exit\"");
    let (head, tail) = last.split_at(10);
    let (port, request) = serve(vec![
        CHUNKED.to_string(),
        chunk("{\"out\": \"started\\n\"}\n"),
        chunk("{\"err\": \"slow\\n\"}\n"),
        head.to_string(),
        tail.to_string(),
        chunk(": 1}\n"),
        LAST.to_string(),
    ]);
    let session = session_file(port);
    let output = run_with(&["--session", &session, "run", "orders", "--rows", "5"], "", true);
    assert_eq!(output, Output { code: 1, stdout: "started\n1 row\n".into(), stderr: "slow\n".into() });
    let request = request.recv().unwrap();
    assert!(request.head.starts_with("POST /v1/call HTTP/1.1\r\n"), "{}", request.head);
    assert!(request.head.contains("Authorization: Bearer s3cret\r\n"));
    assert!(request.head.contains("Content-Type: application/json\r\n"));
    assert_eq!(
        request.body,
        json!({"workbookId": "wb1", "command": "run", "args": {"scripts": ["orders"], "refresh": false, "rows": 5}, "input": null})
    );
}

#[test]
fn reads_an_answer_with_a_length_or_until_the_end() {
    let (port, _) = serve(parts(&["HTTP/1.1 200 OK\r\nContent-Length: 12\r\n\r\n{\"exit\": 0}\n"]));
    assert_eq!(run_with(&["--session", &session_file(port), "scripts"], "", true).code, EXIT_OK);
    let (port, _) = serve(parts(&["HTTP/1.1 200 OK\r\n\r\n{\"out\": \"x\"}\n", "{\"exit\": 0}\n"]));
    let output = run_with(&["--session", &session_file(port), "scripts"], "", true);
    assert_eq!((output.code, output.stdout.as_str()), (EXIT_OK, "x"));
}

#[test]
fn fails_an_answer_that_ends_without_an_exit_code() {
    let (port, _) = serve(vec![CHUNKED.to_string(), chunk("{\"out\": \"half\\n\"}\n")]);
    let output = run_with(&["--session", &session_file(port), "scripts"], "", true);
    assert_eq!(
        output,
        Output { code: EXIT_FAILED, stdout: "half\n".into(), stderr: "error: DashQL stopped answering\n".into() }
    );
}

#[test]
fn prints_the_message_of_an_answer_that_is_not_200() {
    let (port, _) =
        serve(parts(&["HTTP/1.1 409 Conflict\r\nContent-Length: 39\r\n\r\nDashQL runs no question on the workbook"]));
    let output = run_with(&["--session", &session_file(port), "read", "orders"], "", true);
    assert_eq!(
        output,
        Output {
            code: EXIT_USAGE,
            stdout: "".into(),
            stderr: "error: DashQL runs no question on the workbook\n".into()
        }
    );
    let (port, _) = serve(parts(&["HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n"]));
    let output = run_with(&["--session", &session_file(port), "scripts"], "", true);
    assert_eq!((output.code, output.stderr.as_str()), (EXIT_USAGE, "error: DashQL answered 401 Unauthorized\n"));
}

#[test]
fn tells_when_dashql_does_not_run() {
    // A port that nothing listens on
    let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let output = run_with(&["--session", &session_file(port), "scripts"], "", true);
    assert_eq!(output.code, EXIT_USAGE);
    assert!(output.stderr.starts_with("error: DashQL is not running"), "{}", output.stderr);
}

#[test]
fn sends_the_text_of_edit_from_a_file_or_stdin() {
    let file = folder().join("orders.sql");
    std::fs::write(&file, "select 1;\n").unwrap();
    let (port, request) = serve(vec![CHUNKED.to_string(), chunk("{\"exit\": 0}\n"), LAST.to_string()]);
    let file = file.display().to_string();
    let output = run_with(
        &["--session", &session_file(port), "edit", "orders", "--file", &file, "--connection", "c1"],
        "",
        true,
    );
    assert_eq!(output.code, EXIT_OK, "{output:?}");
    assert_eq!(
        request.recv().unwrap().body,
        json!({"workbookId": "wb1", "command": "edit", "args": {"script": "orders", "connection": "c1"}, "input": "select 1;\n"})
    );
    let (port, request) = serve(vec![CHUNKED.to_string(), chunk("{\"exit\": 0}\n"), LAST.to_string()]);
    let output = run_with(&["--session", &session_file(port), "edit", "orders"], "select 2;\n", false);
    assert_eq!(output.code, EXIT_OK, "{output:?}");
    assert_eq!(request.recv().unwrap().body["input"], json!("select 2;\n"));
}

#[test]
fn needs_a_text_for_edit() {
    let session = session_file(1);
    let output = run_with(&["--session", &session, "edit", "orders"], "", true);
    assert_eq!(
        (output.code, output.stderr.as_str()),
        (EXIT_USAGE, "error: pass the text with --file <file> or on stdin\n")
    );
    let missing = folder().join("gone.sql").display().to_string();
    let output = run_with(&["--session", &session, "edit", "orders", "--file", &missing], "", true);
    assert_eq!(output.code, EXIT_USAGE);
    assert!(output.stderr.starts_with(&format!("error: {missing}: ")), "{}", output.stderr);
}
