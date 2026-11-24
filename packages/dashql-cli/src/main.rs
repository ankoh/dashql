//! `dashql`, the commands of an agent that DashQL runs for a question. Every command but `guide` is a call of the page
//! of the workbook: the binary sends it to the server of the app that the session file names and prints the answer.
//! See docs/design/agent_integration.md.

mod args;
mod call;
mod commands;
mod guide;
mod session;

use args::{Input, Invocation};
use serde_json::json;
use std::io::{IsTerminal, Read, Write};
use std::process::ExitCode;

/// The command succeeded
pub const EXIT_OK: u8 = 0;
/// The command failed
pub const EXIT_FAILED: u8 = 1;
/// A usage error, or DashQL runs no question on the workbook
pub const EXIT_USAGE: u8 = 2;

/// What a run takes from the process
struct Process<'a> {
    stdin: &'a mut dyn Read,
    /// Is stdin a terminal? Then `edit` has no text
    stdin_is_terminal: bool,
    stdout: &'a mut dyn Write,
    stderr: &'a mut dyn Write,
}

/// The text of `edit`
fn read_input(input: &Input, process: &mut Process) -> Result<String, String> {
    let bytes = match input {
        Input::File(path) => std::fs::read(path).map_err(|e| format!("{path}: {e}"))?,
        Input::Stdin if process.stdin_is_terminal => {
            return Err("pass the text with --file <file> or on stdin".into());
        }
        Input::Stdin => {
            let mut bytes = Vec::new();
            process.stdin.read_to_end(&mut bytes).map_err(|e| format!("stdin: {e}"))?;
            bytes
        }
    };
    String::from_utf8(bytes).map_err(|_| "the text is no UTF-8".to_string())
}

/// Run the command line, returns the exit code
fn run(args: &[String], process: &mut Process) -> u8 {
    // A closed stdout or stderr leaves nothing to report on
    let (session, call) = match args::parse(args) {
        Ok(Invocation::Help) => {
            let _ = write!(process.stdout, "{}", commands::usage());
            return EXIT_OK;
        }
        Ok(Invocation::Guide) => {
            let _ = writeln!(process.stdout, "{}", guide::GUIDE);
            return EXIT_OK;
        }
        Ok(Invocation::Call { session, call }) => (session, call),
        Err(e) => {
            let _ = write!(process.stderr, "error: {e}\n\n{}", commands::usage());
            return EXIT_USAGE;
        }
    };
    let session = match session::read_session(&session) {
        Ok(session) => session,
        Err(e) => {
            let _ = writeln!(process.stderr, "error: {e}");
            return EXIT_USAGE;
        }
    };
    let input = match call.input.as_ref().map(|input| read_input(input, process)).transpose() {
        Ok(input) => input,
        Err(e) => {
            let _ = writeln!(process.stderr, "error: {e}");
            return EXIT_USAGE;
        }
    };
    let body = json!({
        "workbookId": session.workbook_id,
        "command": call.command,
        "args": call.args,
        "input": input,
    })
    .to_string();
    call::send(&session, body.as_bytes(), &mut call::Output { stdout: process.stdout, stderr: process.stderr })
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let stdin = std::io::stdin();
    let stdin_is_terminal = stdin.is_terminal();
    ExitCode::from(run(
        &args,
        &mut Process {
            stdin: &mut stdin.lock(),
            stdin_is_terminal,
            stdout: &mut std::io::stdout().lock(),
            stderr: &mut std::io::stderr().lock(),
        },
    ))
}

#[cfg(test)]
mod tests;
