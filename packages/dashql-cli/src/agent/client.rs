//! The commands that agents call: they reach the open DashQL session through the agent server

use crate::agent::config::AgentConfig;
use crate::agent::http;
use crate::agent::protocol::ErrorCode;
use base64::Engine;
use serde_json::{json, Map, Value};
use std::io::{Read, Write};

/// Exit codes: 0 ok, 1 the command failed, 2 not connected or usage
pub const EXIT_OK: u8 = 0;
pub const EXIT_FAILED: u8 = 1;
pub const EXIT_USAGE: u8 = 2;

pub const NOT_RUNNING_MESSAGE: &str =
    "The DashQL agent server is not running: start DashQL, or run `dashql agent serve`";

pub const USAGE: &str = "Usage: dashql agent <command> [options]

Commands for the DashQL session that is open in the browser or the desktop app:
  status                              Connected clients, sessions, the focused session
  scripts                             Scripts of the session with their connections
  read <script>                       Script text
  edit <script> [--file f]            Replace or create a script with the text of the file or stdin,
       [--connection c]               on a connection of the session, default: the connection of the
                                      script, then the default connection
  catalog [connection]                CREATE TABLE statements
  lint <script>                       Diagnostics of a script
  run <script> [--max-rows N]         Run a script: columns, first rows, row count or error
  result <script> [--page N]          More rows of the last result
  vis get <script>                    The chart of a script: its renderer and Vega-Lite spec
  vis edit <script> [--file f]        Chart the last query with the Vega-Lite spec of the file or stdin,
                                      after checking it
  vis image <script> [--out f]        Render the chart of a script with its last result as PNG, default:
            [--width N] [--height N]  <script>.png, 800x500 at scale 2
            [--scale N]
  serve [--dev] [--exit-with-stdin]   Run the agent server in the foreground, --exit-with-stdin stops it when
                                      stdin closes, for an app that runs it as a child process

Options:
  --session <id>   Target session, default: $DASHQL_SESSION, then the focused session
  --json           Print structured output
  --dev            Use the dev server: port 47101, ~/.dashql/agent-dev, accepts the dev origins";

/// The output of a command
#[derive(Debug, PartialEq, Eq)]
pub struct CliOutput {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: u8,
}

impl CliOutput {
    fn ok(stdout: String) -> Self {
        CliOutput { stdout: with_newline(stdout), stderr: String::new(), exit_code: EXIT_OK }
    }

    fn error(message: &str, exit_code: u8) -> Self {
        CliOutput { stdout: String::new(), stderr: with_newline(message.to_string()), exit_code }
    }

    fn usage(message: &str) -> Self {
        CliOutput { stdout: String::new(), stderr: format!("{message}\n\n{USAGE}\n"), exit_code: EXIT_USAGE }
    }
}

fn with_newline(text: String) -> String {
    if text.is_empty() || text.ends_with('\n') {
        text
    } else {
        text + "\n"
    }
}

/// The options of the commands, they may appear anywhere
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Options {
    pub session: Option<String>,
    pub json: bool,
    pub file: Option<String>,
    pub connection: Option<String>,
    pub max_rows: Option<String>,
    pub page: Option<String>,
    pub out: Option<String>,
    pub width: Option<String>,
    pub height: Option<String>,
    pub scale: Option<String>,
    pub dev: bool,
    pub exit_with_stdin: bool,
    pub help: bool,
    pub positionals: Vec<String>,
}

pub fn parse_args(argv: &[String]) -> Result<Options, String> {
    let mut options = Options::default();
    let mut args = argv.iter();
    while let Some(arg) = args.next() {
        let (name, inline) = match arg.split_once('=') {
            Some((name, value)) if name.starts_with("--") => (name, Some(value.to_string())),
            _ => (arg.as_str(), None),
        };
        let target = match name {
            "--session" => Some(&mut options.session),
            "--file" => Some(&mut options.file),
            "--connection" => Some(&mut options.connection),
            "--max-rows" => Some(&mut options.max_rows),
            "--page" => Some(&mut options.page),
            "--out" => Some(&mut options.out),
            "--width" => Some(&mut options.width),
            "--height" => Some(&mut options.height),
            "--scale" => Some(&mut options.scale),
            _ => None,
        };
        if let Some(target) = target {
            let value = inline.or_else(|| args.next().cloned());
            *target = Some(value.ok_or(format!("option {name} needs a value"))?);
            continue;
        }
        match name {
            "--json" if inline.is_none() => options.json = true,
            "--dev" if inline.is_none() => options.dev = true,
            "--exit-with-stdin" if inline.is_none() => options.exit_with_stdin = true,
            "-h" | "--help" if inline.is_none() => options.help = true,
            "--" => options.positionals.extend(args.by_ref().cloned()),
            a if a.starts_with('-') && a != "-" => return Err(format!("unknown option {arg}")),
            _ => options.positionals.push(arg.clone()),
        }
    }
    Ok(options)
}

fn parse_positive(value: &str, name: &str) -> Result<u64, String> {
    value.parse().ok().filter(|n| *n > 0).ok_or(format!("{name} must be a positive integer"))
}

/// Where the command line tool finds the agent server and its input
pub struct CliEnvironment<'a> {
    /// The value of DASHQL_SESSION
    pub session: Option<String>,
    /// Read stdin, for edit without --file
    pub read_stdin: &'a dyn Fn() -> std::io::Result<String>,
    /// Read a file, for edit --file
    pub read_file: &'a dyn Fn(&str) -> Result<String, String>,
    /// Write a file, for image --out
    pub write_file: &'a dyn Fn(&str, &[u8]) -> Result<(), String>,
    /// Send a request to the agent server, the JSON body of the response, None if the server does not run
    pub request: &'a dyn Fn(&str, &str, Option<&str>) -> Option<Value>,
}

/// Send a request to the agent server on 127.0.0.1
pub fn request(config: &AgentConfig, method: &str, path: &str, body: Option<&str>) -> Option<Value> {
    let mut stream = std::net::TcpStream::connect(("127.0.0.1", config.port)).ok()?;
    let body = body.unwrap_or_default();
    let request = format!(
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\n\
         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
        config.port,
        config.token,
        body.len()
    );
    stream.write_all(request.as_bytes()).ok()?;
    let mut response = Vec::new();
    stream.read_to_end(&mut response).ok()?;
    let (_, body) = http::parse_response(&response)?;
    serde_json::from_slice(body).ok()
}

/// Render the state of the server
pub fn format_status(status: &Value) -> String {
    let mut lines = vec![format!("Agent server on 127.0.0.1:{}", status["port"])];
    let clients = status["clients"].as_array().map(Vec::as_slice).unwrap_or_default();
    if clients.is_empty() {
        lines.push("No DashQL client is connected: open https://dashql.app and turn on agent access".into());
    }
    let text = |v: &Value| v.as_str().unwrap_or_default().to_string();
    for client in clients {
        let sessions = client["sessions"].as_array().map(Vec::as_slice).unwrap_or_default();
        let plural = if sessions.len() == 1 { "" } else { "s" };
        lines.push(format!(
            "Client {} ({}), {} session{plural}",
            text(&client["kind"]),
            text(&client["origin"]),
            sessions.len()
        ));
        for session in sessions {
            let focused = if session["id"] == client["focused"] { " (focused)" } else { "" };
            lines.push(format!("  {}  {}{focused}", text(&session["id"]), Value::from(text(&session["name"]))));
        }
    }
    for turn in status["turns"].as_array().into_iter().flatten() {
        let [harness, session, state, status] = ["harness", "session", "state", "status"].map(|k| text(&turn[k]));
        lines.push(format!("Turn of {harness} in {session}: {state}, {status}"));
    }
    lines.join("\n")
}

/// The arguments of a call
fn call_args(
    command: &str,
    rest: &[String],
    options: &Options,
    cli: &CliEnvironment,
) -> Result<Map<String, Value>, String> {
    let mut args = Map::new();
    let one = |what: &str| match rest {
        [script] => Ok(Value::from(script.clone())),
        _ => Err(format!("{} takes one {what}", command.replace('.', " "))),
    };
    match command {
        "scripts" if rest.is_empty() => {}
        "scripts" => return Err("scripts takes no arguments".into()),
        "read" | "lint" | "vis.get" => {
            args.insert("script".into(), one("script")?);
        }
        "edit" | "vis.edit" => {
            args.insert("script".into(), one("script")?);
            let text = match &options.file {
                Some(file) => (cli.read_file)(file)?,
                None => (cli.read_stdin)().map_err(|e| format!("stdin: {e}"))?,
            };
            args.insert((if command == "edit" { "text" } else { "spec" }).into(), text.into());
            if let (Some(connection), "edit") = (&options.connection, command) {
                args.insert("connection".into(), connection.clone().into());
            }
        }
        "catalog" => match rest {
            [] => {}
            [connection] => {
                args.insert("connection".into(), connection.clone().into());
            }
            _ => return Err("catalog takes at most one connection".into()),
        },
        "run" => {
            args.insert("script".into(), one("script")?);
            if let Some(max_rows) = &options.max_rows {
                args.insert("maxRows".into(), parse_positive(max_rows, "--max-rows")?.into());
            }
        }
        "result" => {
            args.insert("script".into(), one("script")?);
            if let Some(page) = &options.page {
                args.insert("page".into(), parse_positive(page, "--page")?.into());
            }
        }
        "vis.image" => {
            args.insert("script".into(), one("script")?);
            for (name, value) in [("width", &options.width), ("height", &options.height), ("scale", &options.scale)] {
                if let Some(value) = value {
                    args.insert(name.into(), parse_positive(value, &format!("--{name}"))?.into());
                }
            }
        }
        _ => return Err(format!("Unknown command: {command}")),
    }
    Ok(args)
}

/// Run a command against the open DashQL session
pub fn run_cli(options: &Options, cli: &CliEnvironment) -> CliOutput {
    let Some((command, rest)) = options.positionals.split_first() else {
        return CliOutput::usage("Missing command");
    };
    // The vis commands are calls of their own: vis edit calls vis.edit
    let (command, rest) = match (command.as_str(), rest) {
        ("vis", [sub, rest @ ..]) if ["get", "edit", "image"].contains(&sub.as_str()) => (format!("vis.{sub}"), rest),
        ("vis", [sub, ..]) => return CliOutput::usage(&format!("Unknown vis command: {sub}")),
        ("vis", []) => return CliOutput::usage("vis needs a command: get, edit or image"),
        _ => (command.clone(), rest),
    };
    if command == "status" {
        let Some(body) = (cli.request)("GET", "/v1/status", None) else {
            return CliOutput::error(NOT_RUNNING_MESSAGE, EXIT_USAGE);
        };
        if body["ok"] != true {
            return failure(&body);
        }
        let status = &body["status"];
        return CliOutput::ok(if options.json { pretty(status) } else { format_status(status) });
    }
    let args = match call_args(&command, rest, options, cli) {
        Ok(args) => args,
        Err(e) => return CliOutput::usage(&e),
    };
    let session = options.session.clone().or(cli.session.clone()).filter(|s| !s.is_empty());
    let mut call = json!({ "command": command, "args": args });
    if let Some(session) = session {
        call["session"] = session.into();
    }
    let Some(body) = (cli.request)("POST", "/v1/call", Some(&call.to_string())) else {
        return CliOutput::error(NOT_RUNNING_MESSAGE, EXIT_USAGE);
    };
    if body["ok"] != true {
        return failure(&body);
    }
    let result = &body["result"];
    if command == "vis.image" {
        return write_image(result, rest, options, cli);
    }
    if options.json {
        let data = if result["data"].is_null() { json!({ "text": result["text"] }) } else { result["data"].clone() };
        return CliOutput::ok(pretty(&data));
    }
    CliOutput::ok(result["text"].as_str().unwrap_or_default().to_string())
}

/// Write the PNG of a vis image call to --out, default: <script>.png
fn write_image(result: &Value, rest: &[String], options: &Options, cli: &CliEnvironment) -> CliOutput {
    let png = result["data"]["png"].as_str().and_then(|png| base64::engine::general_purpose::STANDARD.decode(png).ok());
    let Some(png) = png else {
        return CliOutput::error("DashQL sent no PNG", EXIT_FAILED);
    };
    let file = options.out.clone().unwrap_or_else(|| format!("{}.png", rest[0].trim_end_matches(".sql")));
    if let Err(e) = (cli.write_file)(&file, &png) {
        return CliOutput::error(&e, EXIT_FAILED);
    }
    if options.json {
        let mut data = result["data"].clone();
        data["png"] = file.into();
        return CliOutput::ok(pretty(&data));
    }
    CliOutput::ok(format!("{}\nWrote {file}", result["text"].as_str().unwrap_or_default()))
}

fn pretty(value: &Value) -> String {
    serde_json::to_string_pretty(value).expect("JSON values serialize")
}

/// The output of a failed call: exit code 2 when DashQL is not connected or the call is malformed
fn failure(body: &Value) -> CliOutput {
    let error = &body["error"];
    let code = ErrorCode::parse(error["code"].as_str().unwrap_or_default());
    let exit_code = if matches!(code, ErrorCode::NotConnected | ErrorCode::Usage) { EXIT_USAGE } else { EXIT_FAILED };
    CliOutput::error(error["message"].as_str().unwrap_or("the call failed"), exit_code)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct Fake {
        response: Option<Value>,
        requests: RefCell<Vec<(String, String, Option<Value>)>>,
        written: RefCell<Vec<(String, Vec<u8>)>>,
    }

    impl Fake {
        fn new(response: Option<Value>) -> Self {
            Fake { response, requests: RefCell::new(Vec::new()), written: RefCell::new(Vec::new()) }
        }

        fn run(&self, argv: &[&str], session: Option<&str>, stdin: &str) -> CliOutput {
            let argv: Vec<String> = argv.iter().map(|a| a.to_string()).collect();
            let request = |method: &str, path: &str, body: Option<&str>| {
                let body = body.map(|b| serde_json::from_str(b).unwrap());
                self.requests.borrow_mut().push((method.into(), path.into(), body));
                self.response.clone()
            };
            let stdin = stdin.to_string();
            let cli = CliEnvironment {
                session: session.map(str::to_string),
                read_stdin: &move || Ok(stdin.clone()),
                read_file: &|file| Err(format!("{file}: not found")),
                write_file: &|file, bytes| {
                    self.written.borrow_mut().push((file.to_string(), bytes.to_vec()));
                    Ok(())
                },
                request: &request,
            };
            match parse_args(&argv) {
                Ok(options) => run_cli(&options, &cli),
                Err(e) => CliOutput::usage(&e),
            }
        }

        fn body(&self, index: usize) -> Value {
            self.requests.borrow()[index].2.clone().unwrap()
        }
    }

    #[test]
    fn sends_a_call_and_prints_the_text() {
        let fake = Fake::new(Some(
            json!({ "ok": true, "session": "s", "result": { "text": "select 1", "data": { "text": "select 1" } } }),
        ));
        let output = fake.run(&["read", "q1"], None, "");
        assert_eq!(output, CliOutput { stdout: "select 1\n".into(), stderr: String::new(), exit_code: EXIT_OK });
        assert_eq!(fake.requests.borrow()[0].1, "/v1/call");
        assert_eq!(fake.body(0), json!({ "command": "read", "args": { "script": "q1" } }));
    }

    #[test]
    fn targets_the_session_of_the_environment_then_the_flag() {
        let fake = Fake::new(Some(json!({ "ok": true, "session": "s", "result": { "text": "" } })));
        fake.run(&["scripts"], Some("env-session"), "");
        assert_eq!(fake.body(0)["session"], "env-session");
        fake.run(&["scripts", "--session", "flag-session"], Some("env-session"), "");
        assert_eq!(fake.body(1)["session"], "flag-session");
        fake.run(&["--session=x", "scripts"], None, "");
        assert_eq!(fake.body(2)["session"], "x");
    }

    #[test]
    fn reads_the_text_of_an_edit_from_stdin() {
        let fake = Fake::new(Some(json!({ "ok": true, "session": "s", "result": { "text": "ok" } })));
        fake.run(&["edit", "q1"], None, "select 2");
        assert_eq!(fake.body(0)["args"], json!({ "script": "q1", "text": "select 2" }));
        let output = fake.run(&["edit", "q1", "--file", "missing.sql"], None, "");
        assert_eq!(output.exit_code, EXIT_USAGE);
        assert!(output.stderr.starts_with("missing.sql: not found"));
    }

    #[test]
    fn passes_the_connection_of_an_edit() {
        let fake = Fake::new(Some(json!({ "ok": true, "session": "s", "result": { "text": "ok" } })));
        fake.run(&["edit", "q1", "--connection", "lake"], None, "select 2");
        assert_eq!(fake.body(0)["args"], json!({ "script": "q1", "text": "select 2", "connection": "lake" }));
    }

    #[test]
    fn sends_the_vis_commands_as_calls_of_their_own() {
        let fake = Fake::new(Some(json!({ "ok": true, "session": "s", "result": { "text": "ok" } })));
        fake.run(&["vis", "edit", "q1"], None, "{\"mark\": \"bar\"}");
        let args = json!({ "script": "q1", "spec": "{\"mark\": \"bar\"}" });
        assert_eq!(fake.body(0), json!({ "command": "vis.edit", "args": args }));
        fake.run(&["vis", "get", "q1"], None, "");
        assert_eq!(fake.body(1), json!({ "command": "vis.get", "args": { "script": "q1" } }));
    }

    #[test]
    fn writes_the_png_of_an_image() {
        let data = json!({ "script": "q1", "width": 2, "height": 1, "png": "iVBORw==" });
        let fake =
            Fake::new(Some(json!({ "ok": true, "session": "s", "result": { "text": "Rendered", "data": data } })));
        let output = fake.run(&["vis", "image", "q1.sql", "--width", "400", "--scale=1"], None, "");
        let stdout = "Rendered\nWrote q1.png\n".to_string();
        assert_eq!(output, CliOutput { stdout, stderr: String::new(), exit_code: EXIT_OK });
        assert_eq!(fake.body(0)["args"], json!({ "script": "q1.sql", "width": 400, "scale": 1 }));
        assert_eq!(fake.written.borrow()[0], ("q1.png".to_string(), b"\x89PNG".to_vec()));

        let output = fake.run(&["vis", "image", "q1", "--out", "chart.png", "--json"], None, "");
        let printed: Value = serde_json::from_str(&output.stdout).unwrap();
        assert_eq!(printed, json!({ "script": "q1", "width": 2, "height": 1, "png": "chart.png" }));
        assert_eq!(fake.written.borrow()[1].0, "chart.png");

        let no_png = Fake::new(Some(json!({ "ok": true, "session": "s", "result": { "text": "Rendered" } })));
        assert_eq!(no_png.run(&["vis", "image", "q1"], None, "").exit_code, EXIT_FAILED);
        assert_eq!(fake.run(&["vis", "image", "q1", "--height", "0"], None, "").exit_code, EXIT_USAGE);
    }

    #[test]
    fn prints_structured_output_with_json() {
        let fake =
            Fake::new(Some(json!({ "ok": true, "session": "s", "result": { "text": "x", "data": { "rows": 1 } } })));
        assert_eq!(fake.run(&["run", "q1", "--json", "--max-rows", "5"], None, "").stdout, "{\n  \"rows\": 1\n}\n");
        assert_eq!(fake.body(0)["args"], json!({ "script": "q1", "maxRows": 5 }));
    }

    #[test]
    fn exits_with_2_when_not_connected_and_1_when_the_command_failed() {
        let not_connected =
            Fake::new(Some(json!({ "ok": false, "error": { "code": "not_connected", "message": "no" } })));
        assert_eq!(not_connected.run(&["scripts"], None, "").exit_code, EXIT_USAGE);
        let busy = Fake::new(Some(json!({ "ok": false, "error": { "code": "busy", "message": "busy" } })));
        assert_eq!(
            busy.run(&["scripts"], None, ""),
            CliOutput { stdout: String::new(), stderr: "busy\n".into(), exit_code: EXIT_FAILED }
        );
        let not_running = Fake::new(None);
        assert_eq!(not_running.run(&["scripts"], None, "").stderr, format!("{NOT_RUNNING_MESSAGE}\n"));
        assert_eq!(not_running.run(&["status"], None, "").exit_code, EXIT_USAGE);
    }

    #[test]
    fn rejects_malformed_calls() {
        let fake = Fake::new(Some(json!({})));
        for argv in [
            &[][..],
            &["read"],
            &["frobnicate"],
            &["run", "q1", "--max-rows", "-1"],
            &["run", "q1", "--bogus"],
            &["read", "--session"],
            &["vis"],
            &["vis", "show", "q1"],
            &["vis", "get"],
            &["visualize", "q1"],
        ] {
            assert_eq!(fake.run(argv, None, "").exit_code, EXIT_USAGE, "{argv:?}");
        }
        assert!(fake.requests.borrow().is_empty());
    }

    #[test]
    fn formats_the_status() {
        let status = json!({
            "port": 47100,
            "clients": [{ "id": "c", "kind": "web", "origin": "https://dashql.app", "sessions": [{ "id": "s1", "name": "Revenue" }], "focused": "s1" }],
            "turns": [{ "turnId": "t", "session": "s1", "harness": "codex", "state": "running", "status": "dashql agent catalog" }],
        });
        assert_eq!(
            format_status(&status),
            "Agent server on 127.0.0.1:47100\nClient web (https://dashql.app), 1 session\n  s1  \"Revenue\" (focused)\nTurn of codex in s1: running, dashql agent catalog"
        );
        assert_eq!(
            format_status(&json!({ "port": 1, "clients": [], "turns": [] })),
            "Agent server on 127.0.0.1:1\nNo DashQL client is connected: open https://dashql.app and turn on agent access"
        );
    }
}
