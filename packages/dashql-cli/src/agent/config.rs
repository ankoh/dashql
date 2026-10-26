//! The configuration of the agent server, ~/.dashql/agent/config.json

use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::time::Duration;

/// The default port of the agent server
pub const DEFAULT_PORT: u16 = 47100;
/// The default port of a server in dev mode, an installed DashQL.app may hold the release port
pub const DEV_PORT: u16 = 47101;

/// The origins of DashQL clients that every server accepts
pub const RELEASE_ORIGINS: [&str; 2] = ["https://dashql.app", "app://bundle"];
/// The origins of the dev servers, accepted only by a server started in dev mode
pub const DEV_ORIGINS: [&str; 2] = ["http://localhost:9002", "http://127.0.0.1:9002"];

/// How long a call waits for DashQL to hold its session, unless `callWaitMs` says otherwise
const DEFAULT_CALL_WAIT: Duration = Duration::from_secs(30);

/// How the server reads the event stream of a harness
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum HarnessAdapter {
    Codex,
    Claude,
    Opencode,
    Text,
}

impl HarnessAdapter {
    pub fn name(self) -> &'static str {
        match self {
            HarnessAdapter::Codex => "codex",
            HarnessAdapter::Claude => "claude",
            HarnessAdapter::Opencode => "opencode",
            HarnessAdapter::Text => "text",
        }
    }

    /// Unknown adapters read plain text
    fn parse(name: &str) -> Self {
        match name {
            "codex" => HarnessAdapter::Codex,
            "claude" => HarnessAdapter::Claude,
            "opencode" => HarnessAdapter::Opencode,
            _ => HarnessAdapter::Text,
        }
    }
}

/// How the agent server runs a harness headless.
///
/// Arguments are passed to the process as they are, never through a shell.
/// `{prompt}` is replaced by the prompt, `{resume}` by `resumeArgs` once the DashQL session has a harness
/// session, and is dropped otherwise. `{harnessSession}` in `resumeArgs` is the stored harness session id.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HarnessConfig {
    /// The program and its arguments
    pub command: Vec<String>,
    /// The arguments that resume a harness session
    pub resume_args: Vec<String>,
    /// The command that continues the harness session in a terminal, shown by the app
    pub terminal_command: Option<Vec<String>>,
    /// How the output is read
    pub adapter: HarnessAdapter,
}

/// The configuration of the agent server
#[derive(Clone, Debug)]
pub struct AgentConfig {
    /// The port on 127.0.0.1
    pub port: u16,
    /// The token of the command line tool
    pub token: String,
    /// The harness that runs requests without a harness name
    pub default_harness: String,
    /// The harnesses by name, the built-in ones first
    pub harnesses: Vec<(String, HarnessConfig)>,
    /// Additional origins that a server in dev mode accepts
    pub dev_origins: Vec<String>,
    /// How long a call waits for DashQL to hold its session
    pub call_wait: Duration,
}

impl AgentConfig {
    pub fn harness(&self, name: &str) -> Option<&HarnessConfig> {
        self.harnesses.iter().find(|(n, _)| n == name).map(|(_, h)| h)
    }
}

/// The built-in harnesses. config.json can override them by name and add its own.
/// `--` ends the options before the prompt: Claude Code's tool lists take every following argument, and a prompt
/// starting with `-` would be read as an option.
/// Run against Claude Code 2.1, opencode 1.18 and Codex 0.162.
fn default_harnesses() -> Value {
    json!({
        "claude": {
            "command": [
                "claude", "-p", "--output-format", "stream-json", "--verbose",
                "--allowedTools", "Bash(dashql agent:*)", "--disallowedTools", "Bash(dashql agent serve:*)",
                "{resume}", "--", "{prompt}",
            ],
            "resumeArgs": ["--resume", "{harnessSession}"],
            "terminalCommand": ["claude", "--resume", "{harnessSession}"],
            "adapter": "claude",
        },
        "codex": {
            "command": ["codex", "exec", "--json", "--skip-git-repo-check", "{resume}", "--", "{prompt}"],
            "resumeArgs": ["resume", "{harnessSession}"],
            "terminalCommand": ["codex", "resume", "{harnessSession}"],
            "adapter": "codex",
        },
        // The permissions of opencode runs come from the opencode.json of the working folder
        "opencode": {
            "command": ["opencode", "run", "--format", "json", "{resume}", "--", "{prompt}"],
            "resumeArgs": ["--session", "{harnessSession}"],
            "terminalCommand": ["opencode", "--session", "{harnessSession}"],
            "adapter": "opencode",
        },
    })
}

/// The folder of the configuration and the state of the agent server, dev mode keeps its own
pub fn agent_home(env: &dyn Fn(&str) -> Option<String>, dev: bool) -> PathBuf {
    if let Some(home) = env("DASHQL_AGENT_HOME").filter(|h| !h.is_empty()) {
        return home.into();
    }
    let user_home = env("HOME").or_else(|| env("USERPROFILE")).unwrap_or_default();
    PathBuf::from(user_home).join(".dashql").join(if dev { "agent-dev" } else { "agent" })
}

/// Random bytes from the operating system
pub fn random_bytes<const N: usize>() -> [u8; N] {
    let mut bytes = [0; N];
    getrandom::fill(&mut bytes).expect("the operating system has no random numbers");
    bytes
}

fn new_token() -> String {
    random_bytes::<24>().iter().map(|b| format!("{b:02x}")).collect()
}

/// Read the configuration, a missing configuration is created with a new token.
/// The folder and the file are readable by the user only.
pub fn load_config(home: &Path, env: &dyn Fn(&str) -> Option<String>, dev: bool) -> Result<AgentConfig, String> {
    create_private_dir(home)?;
    let mut stored = read_stored_config(home)?;
    if stored.get("token").and_then(Value::as_str).is_none_or(str::is_empty) {
        stored.insert("token".into(), new_token().into());
        stored.entry("port").or_insert((if dev { DEV_PORT } else { DEFAULT_PORT }).into());
        stored.entry("defaultHarness").or_insert("claude".into());
        save_config(home, &stored)?;
    }
    let mut config = parse_config(&stored, dev)?;
    if let Some(port) = env("DASHQL_AGENT_PORT") {
        config.port = port
            .parse()
            .ok()
            .filter(|p| *p != 0)
            .ok_or_else(|| format!("DASHQL_AGENT_PORT is no valid port: {port}"))?;
    }
    Ok(config)
}

fn parse_config(stored: &Map<String, Value>, dev: bool) -> Result<AgentConfig, String> {
    let port = match stored.get("port") {
        None => {
            if dev {
                DEV_PORT
            } else {
                DEFAULT_PORT
            }
        }
        Some(port) => port
            .as_u64()
            .and_then(|p| u16::try_from(p).ok())
            .filter(|p| *p != 0)
            .ok_or_else(|| format!("port is no valid port: {port}"))?,
    };
    // New built-in harnesses appear in existing configurations, config.json overrides them by name
    let mut harnesses = match default_harnesses() {
        Value::Object(map) => map,
        _ => unreachable!(),
    };
    if let Some(stored) = stored.get("harnesses") {
        let stored = stored.as_object().ok_or("harnesses must be an object")?;
        harnesses.extend(stored.clone());
    }
    let strings = |value: &Value, what: &str| -> Result<Vec<String>, String> {
        let list = value.as_array().ok_or(format!("{what} must be a list of strings"))?;
        list.iter().map(|s| s.as_str().map(str::to_string).ok_or(format!("{what} must be a list of strings"))).collect()
    };
    let harnesses = harnesses
        .iter()
        .map(|(name, harness)| {
            let what = |key: &str| format!("harnesses.{name}.{key}");
            let command = strings(&harness["command"], &what("command"))?;
            if command.is_empty() {
                return Err(format!("{} is empty", what("command")));
            }
            let optional =
                |key: &str| (!harness[key].is_null()).then(|| strings(&harness[key], &what(key))).transpose();
            let config = HarnessConfig {
                command,
                resume_args: optional("resumeArgs")?.unwrap_or_default(),
                terminal_command: optional("terminalCommand")?,
                adapter: HarnessAdapter::parse(harness["adapter"].as_str().unwrap_or("text")),
            };
            Ok((name.clone(), config))
        })
        .collect::<Result<Vec<_>, String>>()?;
    let dev_origins = match stored.get("devOrigins") {
        Some(origins) => strings(origins, "devOrigins")?,
        None => Vec::new(),
    };
    Ok(AgentConfig {
        port,
        token: stored.get("token").and_then(Value::as_str).unwrap_or_default().to_string(),
        default_harness: stored.get("defaultHarness").and_then(Value::as_str).unwrap_or("claude").to_string(),
        harnesses,
        dev_origins,
        call_wait: stored.get("callWaitMs").and_then(Value::as_u64).map_or(DEFAULT_CALL_WAIT, Duration::from_millis),
    })
}

fn read_stored_config(home: &Path) -> Result<Map<String, Value>, String> {
    let path = home.join("config.json");
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Map::new()),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    match serde_json::from_str(&text) {
        Ok(Value::Object(map)) => Ok(map),
        Ok(_) => Err(format!("{}: expected an object", path.display())),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// Change the stored configuration. Overrides from the environment are never persisted.
pub fn update_stored_config(home: &Path, patch: Map<String, Value>) -> Result<(), String> {
    let mut stored = read_stored_config(home)?;
    stored.extend(patch);
    save_config(home, &stored)
}

fn save_config(home: &Path, config: &Map<String, Value>) -> Result<(), String> {
    write_private_file(&home.join("config.json"), &(to_json_text(&Value::Object(config.clone())) + "\n"))
}

/// JSON with four spaces of indentation, as the stored files are written
pub fn to_json_text(value: &Value) -> String {
    let text = serde_json::to_string_pretty(value).expect("JSON values serialize");
    // Strings never hold a raw newline, the leading spaces of a line are its indentation
    let lines = text.lines().map(|line| {
        let content = line.trim_start_matches(' ');
        format!("{}{content}", " ".repeat(2 * (line.len() - content.len())))
    });
    lines.collect::<Vec<_>>().join("\n")
}

/// Create a folder that only the user can read
pub fn create_private_dir(dir: &Path) -> Result<(), String> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    std::os::unix::fs::DirBuilderExt::mode(&mut builder, 0o700);
    builder.create(dir).map_err(|e| format!("{}: {e}", dir.display()))
}

/// Write a file that only the user can read
pub fn write_private_file(path: &Path, text: &str) -> Result<(), String> {
    let error = |e: std::io::Error| format!("{}: {e}", path.display());
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(path).map_err(error)?;
    // The mode applies to new files only
    #[cfg(unix)]
    file.set_permissions(std::os::unix::fs::PermissionsExt::from_mode(0o600)).map_err(error)?;
    std::io::Write::write_all(&mut file, text.as_bytes()).map_err(error)
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn temp_dir(name: &str) -> PathBuf {
        let base = std::env::var_os("TEST_TMPDIR").map_or_else(std::env::temp_dir, PathBuf::from);
        let dir = base.join(format!("{name}-{}", new_token()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn creates_a_configuration_with_claude_as_default_harness() {
        let home = temp_dir("dashql-config");
        let config = load_config(&home, &no_env, false).unwrap();
        assert_eq!(config.default_harness, "claude");
        assert_eq!(config.port, DEFAULT_PORT);
        assert_eq!(config.token.len(), 48);
        assert!(config.token.chars().all(|c| c.is_ascii_hexdigit()));
        let names: Vec<_> = config.harnesses.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, ["claude", "codex", "opencode"]);
        assert_eq!(load_config(&home, &no_env, false).unwrap().token, config.token);
        // The built-in harnesses are not written, so they change with the binary
        let stored: Value = serde_json::from_str(&std::fs::read_to_string(home.join("config.json")).unwrap()).unwrap();
        assert!(stored.get("harnesses").is_none());
        assert_eq!(load_config(&temp_dir("dashql-config-dev"), &no_env, true).unwrap().port, DEV_PORT);
    }

    #[test]
    fn adds_new_built_in_harnesses_to_stored_configurations() {
        let home = temp_dir("dashql-config");
        let stored = json!({
            "port": 1234, "token": "t", "defaultHarness": "mine",
            "harnesses": { "codex": { "command": ["codex2", "{prompt}"], "adapter": "codex" }, "mine": { "command": ["mine", "{prompt}"], "adapter": "text" } },
        });
        std::fs::write(home.join("config.json"), stored.to_string()).unwrap();
        let config = load_config(&home, &no_env, false).unwrap();
        assert_eq!(config.default_harness, "mine");
        assert_eq!(config.port, 1234);
        let names: Vec<_> = config.harnesses.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, ["claude", "codex", "opencode", "mine"]);
        assert_eq!(config.harness("codex").unwrap().command, ["codex2", "{prompt}"]);
        assert_eq!(config.harness("mine").unwrap().adapter, HarnessAdapter::Text);
    }

    #[test]
    fn does_not_persist_the_port_of_the_environment() {
        let home = temp_dir("dashql-config");
        load_config(&home, &no_env, false).unwrap();
        let env = |name: &str| (name == "DASHQL_AGENT_PORT").then(|| "4000".to_string());
        assert_eq!(load_config(&home, &env, false).unwrap().port, 4000);
        update_stored_config(&home, Map::from_iter([("defaultHarness".to_string(), "codex".into())])).unwrap();
        let stored: Value = serde_json::from_str(&std::fs::read_to_string(home.join("config.json")).unwrap()).unwrap();
        assert_eq!(stored["port"], DEFAULT_PORT);
        assert_eq!(stored["defaultHarness"], "codex");
        let bad = |name: &str| (name == "DASHQL_AGENT_PORT").then(|| "70000".to_string());
        assert!(load_config(&home, &bad, false).is_err());
    }

    #[test]
    fn rejects_malformed_harnesses() {
        let home = temp_dir("dashql-config");
        std::fs::write(home.join("config.json"), r#"{"token": "t", "harnesses": {"x": {"command": "x"}}}"#).unwrap();
        assert_eq!(load_config(&home, &no_env, false).unwrap_err(), "harnesses.x.command must be a list of strings");
    }

    #[test]
    fn resolves_the_home_folder() {
        let env = |name: &str| (name == "HOME").then(|| "/home/u".to_string());
        assert_eq!(agent_home(&env, false), Path::new("/home/u/.dashql/agent"));
        assert_eq!(agent_home(&env, true), Path::new("/home/u/.dashql/agent-dev"));
        let env = |name: &str| (name == "DASHQL_AGENT_HOME").then(|| "/tmp/a".to_string());
        assert_eq!(agent_home(&env, true), Path::new("/tmp/a"));
    }
}

#[cfg(test)]
pub use tests::temp_dir;
