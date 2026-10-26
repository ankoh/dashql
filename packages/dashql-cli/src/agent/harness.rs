//! Runs a harness (Claude Code, Codex, opencode, ...) headless and reads its event stream

use crate::agent::config::{HarnessAdapter, HarnessConfig};
use serde_json::Value;
use std::collections::BTreeMap;
use std::ffi::{OsStr, OsString};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::sync::{mpsc, Notify};

/// What a harness reported while it ran
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HarnessEvent {
    /// A status line, e.g. the command the agent runs
    Status(String),
    /// The id of the harness session, to resume it with the next request
    Session(String),
}

/// The outcome of a harness run
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HarnessOutcome {
    /// The final message of the agent
    pub message: String,
    /// The error of a failed run, None if it succeeded
    pub error: Option<String>,
}

impl HarnessOutcome {
    pub fn failed(error: impl Into<String>) -> Self {
        HarnessOutcome { message: String::new(), error: Some(error.into()) }
    }
}

/// Reads the output of a harness line by line
pub trait HarnessReader: Send {
    fn line(&mut self, line: &str, emit: &mut dyn FnMut(HarnessEvent));
    /// The final message once the process exited, the error of a failed run
    fn finish(&self, exit_code: Option<i32>, stderr: &str) -> HarnessOutcome;
}

/// The arguments of a harness run
pub fn build_harness_args(config: &HarnessConfig, prompt: &str, harness_session: Option<&str>) -> Vec<String> {
    let mut args = Vec::new();
    for arg in &config.command {
        match arg.as_str() {
            "{resume}" => {
                if let Some(session) = harness_session {
                    args.extend(config.resume_args.iter().map(|a| a.replace("{harnessSession}", session)));
                }
            }
            "{prompt}" => args.push(prompt.to_string()),
            _ => args.push(arg.clone()),
        }
    }
    args
}

/// The first line of a text, cut to a status line
pub fn status_line(text: &str) -> String {
    let line = text.trim().lines().next().unwrap_or_default().trim();
    if line.chars().count() > 160 {
        line.chars().take(159).chain(['…']).collect()
    } else {
        line.to_string()
    }
}

fn parse_event(line: &str) -> Option<Value> {
    serde_json::from_str(line).ok().filter(Value::is_object)
}

fn exit_error(exit_code: Option<i32>, stderr: &str) -> String {
    let detail = status_line(stderr);
    let status = match exit_code {
        None => "was killed".to_string(),
        Some(code) => format!("exited with code {code}"),
    };
    if detail.is_empty() {
        format!("The harness {status}")
    } else {
        format!("The harness {status}: {detail}")
    }
}

/// The outcome of a run that reported its own error or exited
fn outcome(message: String, error: &Option<String>, exit_code: Option<i32>, stderr: &str) -> HarnessOutcome {
    let error = match (error, exit_code) {
        (Some(error), _) => Some(error.clone()),
        (None, Some(0)) => None,
        (None, _) => Some(exit_error(exit_code, stderr)),
    };
    HarnessOutcome { message, error }
}

/// Reads `codex exec --json`: thread.started, item.started / item.completed, turn.completed, turn.failed, error
#[derive(Default)]
struct CodexReader {
    message: String,
    error: Option<String>,
}

impl HarnessReader for CodexReader {
    fn line(&mut self, line: &str, emit: &mut dyn FnMut(HarnessEvent)) {
        let Some(event) = parse_event(line) else { return };
        match event["type"].as_str().unwrap_or_default() {
            "thread.started" => {
                if let Some(id) = event["thread_id"].as_str() {
                    emit(HarnessEvent::Session(id.into()));
                }
            }
            kind @ ("item.started" | "item.completed") => {
                let item = &event["item"];
                match (item["type"].as_str().unwrap_or_default(), kind) {
                    ("command_execution", "item.started") => {
                        if let Some(command) = item["command"].as_str() {
                            emit(HarnessEvent::Status(status_line(command)));
                        }
                    }
                    ("agent_message", "item.completed") => {
                        if let Some(text) = item["text"].as_str() {
                            self.message = text.into();
                            emit(HarnessEvent::Status(status_line(text)));
                        }
                    }
                    ("reasoning", _) => {
                        if let Some(text) = item["text"].as_str() {
                            emit(HarnessEvent::Status(status_line(text)));
                        }
                    }
                    _ => {}
                }
            }
            "turn.failed" => {
                self.error =
                    Some(event.pointer("/error/message").and_then(Value::as_str).unwrap_or("The turn failed").into());
            }
            "error" => self.error = Some(event["message"].as_str().unwrap_or("The harness failed").into()),
            _ => {}
        }
    }

    fn finish(&self, exit_code: Option<i32>, stderr: &str) -> HarnessOutcome {
        outcome(self.message.clone(), &self.error, exit_code, stderr)
    }
}

/// Reads `claude -p --output-format stream-json --verbose`: system init, assistant messages, result
#[derive(Default)]
struct ClaudeReader {
    message: String,
    error: Option<String>,
}

impl HarnessReader for ClaudeReader {
    fn line(&mut self, line: &str, emit: &mut dyn FnMut(HarnessEvent)) {
        let Some(event) = parse_event(line) else { return };
        if let Some(id) = event["session_id"].as_str() {
            emit(HarnessEvent::Session(id.into()));
        }
        match event["type"].as_str().unwrap_or_default() {
            "assistant" => {
                for block in event.pointer("/message/content").and_then(Value::as_array).into_iter().flatten() {
                    match block["type"].as_str().unwrap_or_default() {
                        "text" => {
                            if let Some(text) = block["text"].as_str() {
                                emit(HarnessEvent::Status(status_line(text)));
                            }
                        }
                        "tool_use" => {
                            let command = block.pointer("/input/command").and_then(Value::as_str);
                            let text = command.or(block["name"].as_str()).unwrap_or_default();
                            emit(HarnessEvent::Status(status_line(text)));
                        }
                        _ => {}
                    }
                }
            }
            "result" => {
                let result = event["result"].as_str();
                if let Some(result) = result {
                    self.message = result.into();
                }
                let subtype = &event["subtype"];
                if event["is_error"] == true || (!subtype.is_null() && subtype != "success") {
                    self.error = Some(match result {
                        Some(result) if !result.is_empty() => result.into(),
                        _ => format!("The run ended with {}", subtype.as_str().unwrap_or("an error")),
                    });
                }
            }
            _ => {}
        }
    }

    fn finish(&self, exit_code: Option<i32>, stderr: &str) -> HarnessOutcome {
        outcome(self.message.clone(), &self.error, exit_code, stderr)
    }
}

/// Reads `opencode run --format json`: step_start, text, tool_use, step_finish, error.
/// Every event carries the sessionID, the final message is the text after the last tool call.
#[derive(Default)]
struct OpencodeReader {
    texts: Vec<String>,
    error: Option<String>,
}

impl HarnessReader for OpencodeReader {
    fn line(&mut self, line: &str, emit: &mut dyn FnMut(HarnessEvent)) {
        let Some(event) = parse_event(line) else { return };
        if let Some(id) = event["sessionID"].as_str().or(event.pointer("/part/sessionID").and_then(Value::as_str)) {
            emit(HarnessEvent::Session(id.into()));
        }
        match event["type"].as_str().unwrap_or_default() {
            "text" => {
                if let Some(text) = event.pointer("/part/text").and_then(Value::as_str).filter(|t| !t.trim().is_empty())
                {
                    self.texts.push(text.into());
                    emit(HarnessEvent::Status(status_line(text)));
                }
            }
            "tool_use" => {
                self.texts.clear();
                let command = event.pointer("/part/state/input/command").and_then(Value::as_str);
                let text = command.or(event.pointer("/part/tool").and_then(Value::as_str)).unwrap_or_default();
                emit(HarnessEvent::Status(status_line(text)));
            }
            "error" => {
                let candidates = ["/message", "/error/data/message", "/error/message", "/error/name"];
                let error = candidates.iter().filter_map(|p| event.pointer(p)).find(|v| !v.is_null());
                self.error = Some(match error {
                    Some(Value::String(s)) => s.clone(),
                    Some(other) => other.to_string(),
                    None => "The harness failed".into(),
                });
            }
            _ => {}
        }
    }

    fn finish(&self, exit_code: Option<i32>, stderr: &str) -> HarnessOutcome {
        outcome(self.texts.join("\n").trim().to_string(), &self.error, exit_code, stderr)
    }
}

/// Reads plain text, the output is the final message
#[derive(Default)]
struct TextReader {
    lines: Vec<String>,
}

impl HarnessReader for TextReader {
    fn line(&mut self, line: &str, emit: &mut dyn FnMut(HarnessEvent)) {
        self.lines.push(line.into());
        if !line.trim().is_empty() {
            emit(HarnessEvent::Status(status_line(line)));
        }
    }

    fn finish(&self, exit_code: Option<i32>, stderr: &str) -> HarnessOutcome {
        outcome(self.lines.join("\n").trim().to_string(), &None, exit_code, stderr)
    }
}

pub fn create_harness_reader(adapter: HarnessAdapter) -> Box<dyn HarnessReader> {
    match adapter {
        HarnessAdapter::Codex => Box::<CodexReader>::default(),
        HarnessAdapter::Claude => Box::<ClaudeReader>::default(),
        HarnessAdapter::Opencode => Box::<OpencodeReader>::default(),
        HarnessAdapter::Text => Box::<TextReader>::default(),
    }
}

/// Stops a harness run, may be called more than once
pub type Kill = Arc<dyn Fn() + Send + Sync>;

/// A running harness process
pub struct HarnessProcess {
    /// Resolves once the process exited and its output is read
    pub outcome: Pin<Box<dyn Future<Output = HarnessOutcome> + Send>>,
    /// Kill the process and its children
    pub kill: Kill,
}

/// What a harness run gets
pub struct HarnessSpawnArgs {
    pub config: HarnessConfig,
    pub prompt: String,
    pub harness_session: Option<String>,
    pub cwd: PathBuf,
    pub env: BTreeMap<OsString, OsString>,
    pub events: mpsc::UnboundedSender<HarnessEvent>,
}

/// The stderr of a harness is kept for error messages, up to this many bytes
const STDERR_LIMIT: usize = 16 * 1024;
/// How long a killed harness may take to exit before it is killed for good
const KILL_GRACE: Duration = Duration::from_secs(3);

/// Start a harness run.
/// The process gets its own process group, so killing the run kills the commands the agent started as well.
pub fn spawn_harness(args: HarnessSpawnArgs) -> HarnessProcess {
    let kill = Arc::new(Notify::new());
    let run = tokio::spawn(run_harness(args, kill.clone()));
    HarnessProcess {
        outcome: Box::pin(async move {
            run.await.unwrap_or_else(|e| HarnessOutcome::failed(format!("The harness run failed: {e}")))
        }),
        kill: Arc::new(move || kill.notify_one()),
    }
}

async fn run_harness(args: HarnessSpawnArgs, kill: Arc<Notify>) -> HarnessOutcome {
    let argv = build_harness_args(&args.config, &args.prompt, args.harness_session.as_deref());
    let Some((program, rest)) = argv.split_first() else {
        return HarnessOutcome::failed("The harness command is empty");
    };
    let mut command = tokio::process::Command::new(program);
    command
        .args(rest)
        .current_dir(&args.cwd)
        .env_clear()
        .envs(&args.env)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => return HarnessOutcome::failed(format!("Cannot start {program}: {e}")),
    };
    let pid = child.id();
    let mut stderr = child.stderr.take().expect("stderr is piped");
    let stderr = tokio::spawn(async move {
        let mut kept = Vec::new();
        let mut chunk = [0; 4096];
        while let Ok(n @ 1..) = stderr.read(&mut chunk).await {
            kept.extend_from_slice(&chunk[..n]);
            kept.drain(..kept.len().saturating_sub(STDERR_LIMIT));
        }
        String::from_utf8_lossy(&kept).into_owned()
    });
    let mut stdout = BufReader::new(child.stdout.take().expect("stdout is piped"));
    let mut reader = create_harness_reader(args.config.adapter);
    let events = args.events;
    let stdout = tokio::spawn(async move {
        let mut line = Vec::new();
        while let Ok(1..) = stdout.read_until(b'\n', &mut line).await {
            let text = String::from_utf8_lossy(&line);
            reader.line(text.trim_end_matches(['\n', '\r']), &mut |event| {
                let _ = events.send(event);
            });
            line.clear();
        }
        reader
    });
    let status = tokio::select! {
        status = child.wait() => status,
        _ = kill.notified() => {
            signal_process_group(pid, false);
            match tokio::time::timeout(KILL_GRACE, child.wait()).await {
                Ok(status) => status,
                Err(_) => {
                    signal_process_group(pid, true);
                    child.wait().await
                }
            }
        }
    };
    let exit_code = status.ok().and_then(|s| s.code());
    let stderr = stderr.await.unwrap_or_default();
    match stdout.await {
        Ok(reader) => reader.finish(exit_code, &stderr),
        Err(e) => HarnessOutcome::failed(format!("Cannot read the output of {program}: {e}")),
    }
}

/// Stop a process group, SIGTERM first and SIGKILL with `force`
#[cfg(unix)]
fn signal_process_group(pid: Option<u32>, force: bool) {
    let Some(pid) = pid.and_then(|p| i32::try_from(p).ok()) else { return };
    // SAFETY: kill has no memory effects, a group that is gone already reports ESRCH
    unsafe {
        libc::kill(-pid, if force { libc::SIGKILL } else { libc::SIGTERM });
    }
}

/// Stop a process and everything it started
#[cfg(windows)]
fn signal_process_group(pid: Option<u32>, _force: bool) {
    let Some(pid) = pid else { return };
    let _ = std::process::Command::new("taskkill").args(["/pid", &pid.to_string(), "/T", "/F"]).spawn();
}

/// Resolve the PATH of the user's login shell.
/// Apps started at login or from Finder get launchd's minimal PATH without Homebrew, nvm or ~/.local/bin.
pub async fn resolve_login_shell_path() -> Option<OsString> {
    let fallback = std::env::var_os("PATH");
    let shell = match std::env::var_os("SHELL") {
        Some(shell) if !shell.is_empty() && cfg!(unix) => shell,
        _ => return fallback,
    };
    // Interactive shells may print greetings, markers delimit the PATH
    const MARKER: &str = "__DASHQL_PATH__";
    let mut command = tokio::process::Command::new(shell);
    command
        .args(["-ilc", &format!("printf '{MARKER}%s{MARKER}' \"$PATH\"")])
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    match tokio::time::timeout(Duration::from_secs(5), command.output()).await {
        Ok(Ok(output)) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let path = stdout.split(MARKER).nth(1).map(str::trim).unwrap_or_default();
            if path.is_empty() {
                fallback
            } else {
                Some(path.into())
            }
        }
        _ => fallback,
    }
}

fn is_executable(file: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(file) else { return false };
    #[cfg(unix)]
    let executable = std::os::unix::fs::PermissionsExt::mode(&metadata.permissions()) & 0o111 != 0;
    #[cfg(not(unix))]
    let executable = true;
    metadata.is_file() && executable
}

/// The file that a program name resolves to on a PATH, None if there is none
pub fn resolve_program(program: &str, path: Option<&OsStr>) -> Option<PathBuf> {
    let extensions: Vec<String> = if cfg!(windows) {
        let pathext = std::env::var("PATHEXT").unwrap_or_else(|_| ".EXE;.CMD;.BAT".into());
        std::iter::once(String::new()).chain(pathext.split(';').map(str::to_string)).collect()
    } else {
        vec![String::new()]
    };
    let find = |base: PathBuf| {
        extensions.iter().map(|ext| PathBuf::from(format!("{}{ext}", base.display()))).find(|f| is_executable(f))
    };
    if Path::new(program).is_absolute() || program.contains('/') {
        return find(PathBuf::from(program));
    }
    std::env::split_paths(path?).filter(|dir| !dir.as_os_str().is_empty()).find_map(|dir| find(dir.join(program)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn harness(name: &str) -> HarnessConfig {
        let home = crate::agent::config::temp_dir("dashql-harness");
        let config = crate::agent::config::load_config(&home, &|_| None, false).unwrap();
        config.harness(name).unwrap().clone()
    }

    struct Read {
        statuses: Vec<String>,
        sessions: Vec<String>,
        outcome: HarnessOutcome,
    }

    fn read(adapter: HarnessAdapter, lines: &[Value], exit_code: Option<i32>, stderr: &str) -> Read {
        let mut reader = create_harness_reader(adapter);
        let (mut statuses, mut sessions) = (Vec::new(), Vec::new());
        for line in lines {
            let text = line.as_str().map_or_else(|| line.to_string(), str::to_string);
            reader.line(&text, &mut |event| match event {
                HarnessEvent::Status(s) => statuses.push(s),
                HarnessEvent::Session(s) => sessions.push(s),
            });
        }
        Read { statuses, sessions, outcome: reader.finish(exit_code, stderr) }
    }

    fn ok(message: &str) -> HarnessOutcome {
        HarnessOutcome { message: message.into(), error: None }
    }

    #[test]
    fn passes_the_prompt_as_one_argument() {
        assert_eq!(
            build_harness_args(&harness("codex"), "say \"hi\"; rm -rf /", None),
            ["codex", "exec", "--json", "--skip-git-repo-check", "say \"hi\"; rm -rf /"]
        );
    }

    #[test]
    fn resumes_a_harness_session() {
        assert_eq!(
            build_harness_args(&harness("codex"), "next", Some("t-1")),
            ["codex", "exec", "--json", "--skip-git-repo-check", "resume", "t-1", "next"]
        );
        assert_eq!(
            build_harness_args(&harness("claude"), "next", Some("c-1")),
            [
                "claude",
                "-p",
                "--output-format",
                "stream-json",
                "--verbose",
                "--allowedTools",
                "Bash(dashql agent:*)",
                "--disallowedTools",
                "Bash(dashql agent serve:*)",
                "--resume",
                "c-1",
                "next"
            ]
        );
        assert_eq!(
            build_harness_args(&harness("opencode"), "next", Some("ses_1")),
            ["opencode", "run", "--format", "json", "--session", "ses_1", "next"]
        );
    }

    #[test]
    fn reads_codex_events() {
        let read = read(
            HarnessAdapter::Codex,
            &[
                json!({ "type": "thread.started", "thread_id": "t-1" }),
                json!({ "type": "turn.started" }),
                json!({ "type": "item.started", "item": { "id": "1", "type": "command_execution", "command": "dashql agent catalog" } }),
                json!({ "type": "item.completed", "item": { "id": "1", "type": "command_execution", "command": "dashql agent catalog" } }),
                json!("not json"),
                json!({ "type": "item.completed", "item": { "id": "2", "type": "agent_message", "text": "Wrote q1.\nIt counts orders." } }),
                json!({ "type": "turn.completed", "usage": {} }),
            ],
            Some(0),
            "",
        );
        assert_eq!(read.sessions, ["t-1"]);
        assert_eq!(read.statuses, ["dashql agent catalog", "Wrote q1."]);
        assert_eq!(read.outcome, ok("Wrote q1.\nIt counts orders."));
    }

    #[test]
    fn reads_failed_codex_turns() {
        let failed = json!({ "type": "turn.failed", "error": { "message": "rate limited" } });
        assert_eq!(read(HarnessAdapter::Codex, &[failed], Some(1), "").outcome.error.unwrap(), "rate limited");
        assert_eq!(
            read(HarnessAdapter::Codex, &[], Some(2), "error: unknown flag\n").outcome.error.unwrap(),
            "The harness exited with code 2: error: unknown flag"
        );
    }

    #[test]
    fn reads_claude_events() {
        let read = read(
            HarnessAdapter::Claude,
            &[
                json!({ "type": "system", "subtype": "init", "session_id": "c-1" }),
                json!({ "type": "assistant", "session_id": "c-1", "message": { "content": [
                    { "type": "text", "text": "Looking at the schema" },
                    { "type": "tool_use", "name": "Bash", "input": { "command": "dashql agent catalog" } },
                ] } }),
                json!({ "type": "result", "subtype": "success", "is_error": false, "result": "Done", "session_id": "c-1" }),
            ],
            Some(0),
            "",
        );
        assert!(read.sessions.contains(&"c-1".to_string()));
        assert_eq!(read.statuses, ["Looking at the schema", "dashql agent catalog"]);
        assert_eq!(read.outcome, ok("Done"));
    }

    #[test]
    fn reads_failed_claude_runs() {
        let result = json!({ "type": "result", "subtype": "error_max_turns", "is_error": true });
        assert_eq!(
            read(HarnessAdapter::Claude, &[result], Some(1), "").outcome.error.unwrap(),
            "The run ended with error_max_turns"
        );
    }

    #[test]
    fn reads_opencode_events() {
        let session = "ses_494719016ffe85dkDMj0FPRbHK";
        let read = read(
            HarnessAdapter::Opencode,
            &[
                json!({ "type": "step_start", "sessionID": session, "part": { "type": "step-start" } }),
                json!({ "type": "text", "sessionID": session, "part": { "type": "text", "text": "Looking at the schema" } }),
                json!({ "type": "tool_use", "sessionID": session, "part": { "type": "tool", "tool": "bash", "state": { "status": "completed", "input": { "command": "dashql agent catalog" } } } }),
                json!({ "type": "step_finish", "sessionID": session, "part": { "type": "step-finish", "reason": "tool-calls" } }),
                json!({ "type": "text", "sessionID": session, "part": { "type": "text", "text": "There are 42 orders." } }),
                json!({ "type": "step_finish", "sessionID": session, "part": { "type": "step-finish", "reason": "stop" } }),
            ],
            Some(0),
            "",
        );
        assert_eq!(read.sessions[0], session);
        assert_eq!(read.statuses, ["Looking at the schema", "dashql agent catalog", "There are 42 orders."]);
        assert_eq!(read.outcome, ok("There are 42 orders."));
    }

    #[test]
    fn reads_opencode_errors() {
        let error = json!({ "type": "error", "sessionID": "ses_1", "error": { "name": "APIError", "data": { "message": "Rate limit exceeded" } } });
        assert_eq!(read(HarnessAdapter::Opencode, &[error], Some(1), "").outcome.error.unwrap(), "Rate limit exceeded");
    }

    #[test]
    fn reads_plain_text() {
        assert_eq!(read(HarnessAdapter::Text, &[json!("a"), json!(""), json!("b")], Some(0), "").outcome, ok("a\n\nb"));
        assert_eq!(read(HarnessAdapter::Text, &[], None, "").outcome.error.unwrap(), "The harness was killed");
    }

    #[test]
    fn cuts_status_lines() {
        assert_eq!(status_line("  first\nsecond"), "first");
        assert_eq!(status_line(&"x".repeat(200)).chars().count(), 160);
    }

    #[cfg(unix)]
    #[test]
    fn finds_executables_on_the_path() {
        use std::os::unix::fs::PermissionsExt;
        let dir = crate::agent::config::temp_dir("dashql-path");
        let file = dir.join("claude");
        std::fs::write(&file, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
        std::fs::write(dir.join("codex"), "not executable").unwrap();
        let path = std::env::join_paths([Path::new("/nonexistent"), &dir]).unwrap();
        assert_eq!(resolve_program("claude", Some(&path)), Some(file.clone()));
        assert_eq!(resolve_program("codex", Some(dir.as_os_str())), None);
        assert_eq!(resolve_program(file.to_str().unwrap(), None), Some(file));
        assert_eq!(resolve_program("opencode", Some(dir.as_os_str())), None);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn runs_a_harness_and_kills_it() {
        let cwd = crate::agent::config::temp_dir("dashql-run");
        let env = std::env::vars_os().collect::<BTreeMap<_, _>>();
        let config = |command: &[&str]| HarnessConfig {
            command: command.iter().map(|s| s.to_string()).collect(),
            resume_args: Vec::new(),
            terminal_command: None,
            adapter: HarnessAdapter::Text,
        };
        let (events, mut received) = mpsc::unbounded_channel();
        let process = spawn_harness(HarnessSpawnArgs {
            config: config(&["sh", "-c", "echo hello; echo oops >&2; exit 3"]),
            prompt: String::new(),
            harness_session: None,
            cwd: cwd.clone(),
            env: env.clone(),
            events: events.clone(),
        });
        let outcome = process.outcome.await;
        assert_eq!(outcome.message, "hello");
        assert_eq!(outcome.error.unwrap(), "The harness exited with code 3: oops");
        assert_eq!(received.recv().await, Some(HarnessEvent::Status("hello".into())));

        let process = spawn_harness(HarnessSpawnArgs {
            config: config(&["sh", "-c", "sleep 30 & wait"]),
            prompt: String::new(),
            harness_session: None,
            cwd,
            env,
            events,
        });
        (process.kill)();
        let outcome = tokio::time::timeout(Duration::from_secs(10), process.outcome).await.unwrap();
        assert_eq!(outcome.error.unwrap(), "The harness was killed");

        let missing = spawn_harness(HarnessSpawnArgs {
            config: config(&["/nonexistent/harness"]),
            prompt: String::new(),
            harness_session: None,
            cwd: PathBuf::from("/"),
            env: BTreeMap::new(),
            events: mpsc::unbounded_channel().0,
        });
        assert!(missing.outcome.await.error.unwrap().starts_with("Cannot start /nonexistent/harness"));
    }
}
