//! dashql: the command line tool of DashQL.
//! `dashql agent` reaches the DashQL session that is open in the browser or the desktop app through the local agent
//! server, which `dashql agent serve` runs. `dashql lint` lints SQL files on disk with the native dashql-core.

mod agent;
mod inputs;
mod lint;
mod lint_files;
mod report;

use agent::client::{self, CliEnvironment, EXIT_FAILED, EXIT_OK, EXIT_USAGE};
use agent::config::{agent_home, load_config};
use agent::server::{log_line, AgentServer, AgentServerOptions, AGENT_RUN_ENV};
use std::io::Write;
use std::process::ExitCode;

const USAGE: &str = "Usage: dashql <command> [options]

Commands:
  agent <command>                     Work with the DashQL session that is open in the browser or the desktop app,
                                      through the local agent server, see dashql agent --help
  lint <file.sql|dir|->...            Lint SQL files on disk with dashql-core, see dashql lint --help";

fn env_var(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

/// Run the agent server in the foreground until it is interrupted, or until stdin closes with exit_with_stdin.
/// DashQL.app holds the other end of stdin, so the server stops with the app even when the app crashes.
fn serve(exit_with_stdin: bool) -> ExitCode {
    // An agent in a harness run may not start a server, whatever its harness allows
    if env_var(AGENT_RUN_ENV).is_some() {
        eprintln!("dashql agent serve cannot run inside an agent run");
        return ExitCode::from(EXIT_USAGE);
    }
    let home = agent_home(&env_var);
    let config = match load_config(&home, &env_var) {
        Ok(config) => config,
        Err(e) => {
            eprintln!("Cannot read the agent configuration: {e}");
            return ExitCode::from(EXIT_USAGE);
        }
    };
    let runtime = match tokio::runtime::Builder::new_current_thread().enable_all().build() {
        Ok(runtime) => runtime,
        Err(e) => {
            eprintln!("Cannot start the agent server: {e}");
            return ExitCode::from(EXIT_FAILED);
        }
    };
    runtime.block_on(async {
        let port = config.port;
        let mut options = AgentServerOptions::new(config, home);
        // Harness runs call this executable as dashql
        options.cli = std::env::current_exe().ok();
        options.log = true;
        let server = match AgentServer::listen(options).await {
            Ok(server) => server,
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                eprintln!(
                    "Port {port} is taken. Is DashQL already running? Set DASHQL_AGENT_PORT to use another port."
                );
                return ExitCode::from(EXIT_FAILED);
            }
            Err(e) => {
                eprintln!("Cannot start the agent server: {e}");
                return ExitCode::from(EXIT_FAILED);
            }
        };
        let stdin_closed = async {
            if !exit_with_stdin {
                return std::future::pending().await;
            }
            let (closed, on_closed) = tokio::sync::oneshot::channel::<()>();
            std::thread::spawn(move || {
                let _ = std::io::copy(&mut std::io::stdin(), &mut std::io::sink());
                let _ = closed.send(());
            });
            let _ = on_closed.await;
        };
        tokio::select! {
            _ = shutdown_signal() => log_line("Stopping: received a stop signal"),
            _ = stdin_closed => log_line("Stopping: stdin closed"),
        }
        server.close().await;
        ExitCode::from(EXIT_OK)
    })
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        if let Ok(mut terminate) = signal(SignalKind::terminate()) {
            tokio::select! {
                _ = tokio::signal::ctrl_c() => {}
                _ = terminate.recv() => {}
            }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}

/// Run `dashql agent` with the arguments after `agent`
fn agent(argv: &[String]) -> ExitCode {
    let options = match client::parse_args(argv) {
        Ok(options) => options,
        Err(e) => {
            eprintln!("{e}\n\n{}", client::usage());
            return ExitCode::from(EXIT_USAGE);
        }
    };
    if options.help || options.positionals.first().map(String::as_str) == Some("help") {
        println!("{}", client::usage());
        return ExitCode::SUCCESS;
    }
    if options.positionals == ["serve"] {
        return serve(options.exit_with_stdin);
    }
    let config = match load_config(&agent_home(&env_var), &env_var) {
        Ok(config) => config,
        Err(e) => {
            eprintln!("Cannot read the agent configuration: {e}");
            return ExitCode::from(EXIT_USAGE);
        }
    };
    let read_file = |file: &str| {
        let path = inputs::working_directory().map_err(|e| format!("working directory: {e}"))?.join(file);
        std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))
    };
    let write_file = |file: &str, bytes: &[u8]| {
        let path = inputs::working_directory().map_err(|e| format!("working directory: {e}"))?.join(file);
        std::fs::write(&path, bytes).map_err(|e| format!("{}: {e}", path.display()))
    };
    let output = client::run_cli(
        &options,
        &CliEnvironment {
            session: env_var("DASHQL_SESSION"),
            read_stdin: &|| std::io::read_to_string(std::io::stdin()),
            read_file: &read_file,
            write_file: &write_file,
            request: &|method, path, body| client::request(&config, method, path, body),
        },
    );
    let _ = std::io::stdout().write_all(output.stdout.as_bytes());
    let _ = std::io::stderr().write_all(output.stderr.as_bytes());
    ExitCode::from(output.exit_code)
}

fn main() -> ExitCode {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    match argv.first().map(String::as_str) {
        Some("agent") => agent(&argv[1..]),
        Some("lint") => lint_files::main(&argv[1..]),
        Some("help" | "-h" | "--help") => {
            println!("{USAGE}");
            ExitCode::SUCCESS
        }
        Some(command) => {
            eprintln!("Unknown command: {command}\n\n{USAGE}");
            ExitCode::from(EXIT_USAGE)
        }
        None => {
            eprintln!("{USAGE}");
            ExitCode::from(EXIT_USAGE)
        }
    }
}
