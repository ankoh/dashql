//! `dashql format`: pretty prints SQL files on disk with the native dashql-core

use crate::inputs;
use dashql_buffers::formatting::{FormattingConfigT, FormattingDialect, FormattingMode, KeywordCase};
use dashql_core::formatter::Formatter;
use dashql_parser::parser::parse;
use dashql_parser::scanner::scan;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;

const USAGE: &str = "Usage:
  dashql format [options] <file.sql|dir|->...
      Pretty prints the scripts with dashql-core, to stdout by default.
      --write                  Rewrite the files in place
      --check                  Print the files that are not formatted, change nothing
      --dialect <name>         The dialect of the scripts: hyper (default) or trino

Directories are searched recursively for *.sql files, - reads a script from stdin.
A script with errors, or with a statement the formatter doesn't know, is reported and stays as it is.
Exits with 0 if all scripts could be formatted (with --check: are formatted), 1 otherwise and 2 on usage or I/O errors.";

/// The line width of the formatted scripts
const MAX_WIDTH: u32 = 120;
/// The indentation of the formatted scripts, the one of the app
const INDENTATION_WIDTH: u32 = 4;

/// What happens to the formatted scripts
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
enum Output {
    #[default]
    Print,
    Write,
    Check,
}

/// The arguments of `format`
#[derive(Debug, PartialEq, Eq)]
struct Args {
    /// The files, directories or `-` to format
    paths: Vec<String>,
    /// What happens to the formatted scripts
    output: Output,
    /// The dialect of the scripts
    dialect: FormattingDialect,
    /// Print the usage with `-h` or `--help`
    help: bool,
}

fn parse_dialect(name: &str) -> Result<FormattingDialect, String> {
    match name {
        "hyper" => Ok(FormattingDialect::HYPER),
        "trino" => Ok(FormattingDialect::TRINO),
        _ => Err(format!("unknown dialect {name}")),
    }
}

fn parse_args(args: &[String]) -> Result<Args, String> {
    let mut out = Args { paths: Vec::new(), output: Output::Print, dialect: FormattingDialect::HYPER, help: false };
    let mut args = args.iter();
    let mut output = None;
    while let Some(arg) = args.next() {
        let selected = match arg.as_str() {
            "--write" => Output::Write,
            "--check" => Output::Check,
            "-h" | "--help" => {
                out.help = true;
                continue;
            }
            "--dialect" => {
                out.dialect = parse_dialect(args.next().ok_or("option --dialect needs a name")?)?;
                continue;
            }
            a if a.starts_with("--dialect=") => {
                out.dialect = parse_dialect(&a["--dialect=".len()..])?;
                continue;
            }
            "--" => {
                out.paths.extend(args.by_ref().cloned());
                continue;
            }
            a if a.starts_with('-') && a != inputs::STDIN => return Err(format!("unknown option {a}")),
            a => {
                out.paths.push(a.to_string());
                continue;
            }
        };
        if output.is_some_and(|o| o != selected) {
            return Err("options --write and --check exclude each other".into());
        }
        output = Some(selected);
    }
    out.output = output.unwrap_or_default();
    Ok(out)
}

/// Format a script, with a line break at its end. A script with errors isn't formatted, and neither is one that the
/// formatter can't print completely or that doesn't parse afterwards: the output would replace the script.
fn format_script(text: &str, dialect: FormattingDialect) -> Result<String, String> {
    let parsed = parse(Arc::new(scan(text, 0, 0)));
    let error = parsed.scanned.errors.first().map(|e| &e.message).or(parsed.errors.first().map(|e| &e.message));
    if let Some(message) = error {
        return Err(message.clone());
    }
    let mut config = FormattingConfigT::default();
    config.dialect = dialect;
    config.mode = FormattingMode::PRETTY;
    config.max_width = MAX_WIDTH;
    config.indentation_width = INDENTATION_WIDTH;
    config.keyword_case = KeywordCase::LOWER;
    let mut formatter = Formatter::new(&parsed);
    let mut formatted = formatter.format(&config);
    if !formatter.is_fully_formatted() {
        return Err("the formatter doesn't know all of the script".into());
    }
    let reparsed = parse(Arc::new(scan(&formatted, 0, 0)));
    if !reparsed.errors.is_empty() || !reparsed.scanned.errors.is_empty() {
        return Err("the formatted script doesn't parse".into());
    }
    formatted.truncate(formatted.trim_end().len());
    formatted.push('\n');
    Ok(formatted)
}

/// What `format` takes from the process
struct Process<'a> {
    /// The invoking directory, see `inputs::working_directory`
    cwd: std::io::Result<PathBuf>,
    /// Read for the path `-`
    stdin: &'a mut dyn Read,
    /// The scripts, the files that changed and the summary
    stdout: &'a mut dyn Write,
    /// The usage and the errors of the run
    stderr: &'a mut dyn Write,
}

fn format_files(args: Args, process: &mut Process) -> Result<u8, String> {
    let cwd = process.cwd.as_ref().map_err(|e| format!("working directory: {e}"))?;
    let inputs = inputs::read_inputs(&args.paths, cwd, process.stdin)?;
    let stdout = &mut *process.stdout;
    let mut write = |text: &str| write!(stdout, "{text}").map_err(|e| format!("stdout: {e}"));
    let (mut failed, mut changed) = (0, 0);
    for input in &inputs {
        let formatted = match format_script(&input.text, args.dialect) {
            Ok(formatted) => formatted,
            Err(e) => {
                failed += 1;
                writeln!(process.stderr, "{}: {e}", input.id).map_err(|e| format!("stderr: {e}"))?;
                continue;
            }
        };
        match args.output {
            Output::Print => write(&formatted)?,
            _ if formatted == input.text => {}
            Output::Write => {
                // Stdin has no file to write to
                if input.id != "<stdin>" {
                    let path = cwd.join(&input.id);
                    std::fs::write(&path, &formatted).map_err(|e| format!("{}: {e}", path.display()))?;
                }
                changed += 1;
                write(&format!("{}\n", input.id))?;
            }
            Output::Check => {
                changed += 1;
                write(&format!("{}\n", input.id))?;
            }
        }
    }
    let files = if inputs.len() == 1 { "file" } else { "files" };
    match args.output {
        Output::Print => {}
        Output::Write => write(&format!("{} {files}, {changed} rewritten, {failed} failed\n", inputs.len()))?,
        Output::Check => write(&format!("{} {files}, {changed} not formatted, {failed} failed\n", inputs.len()))?,
    }
    let unformatted = args.output == Output::Check && changed > 0;
    Ok(if failed > 0 || unformatted { 1 } else { 0 })
}

/// Run `format` and return the exit code
fn run(args: &[String], process: &mut Process) -> u8 {
    // A closed stderr or stdout leaves nothing to report the failure on
    let args = match parse_args(args) {
        Ok(args) if args.help => {
            let _ = writeln!(process.stdout, "{USAGE}");
            return 0;
        }
        Ok(args) if args.paths.is_empty() => {
            let _ = writeln!(process.stderr, "{USAGE}");
            return 2;
        }
        Ok(args) if args.output == Output::Write && args.paths.iter().any(|p| p == inputs::STDIN) => {
            let _ = writeln!(process.stderr, "error: --write needs files, not stdin\n\n{USAGE}");
            return 2;
        }
        Ok(args) => args,
        Err(e) => {
            let _ = writeln!(process.stderr, "error: {e}\n\n{USAGE}");
            return 2;
        }
    };
    format_files(args, process).unwrap_or_else(|e| {
        let _ = writeln!(process.stderr, "error: {e}");
        2
    })
}

/// Run `dashql format` with the arguments after `format`
pub fn main(args: &[String]) -> ExitCode {
    ExitCode::from(run(
        args,
        &mut Process {
            cwd: inputs::working_directory(),
            stdin: &mut std::io::stdin(),
            stdout: &mut std::io::stdout().lock(),
            stderr: &mut std::io::stderr().lock(),
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::config::temp_dir;
    use std::path::Path;

    /// The result of a run
    struct Result {
        code: u8,
        stdout: String,
        stderr: String,
    }

    /// A directory with the given files
    fn files(files: &[(&str, &str)]) -> PathBuf {
        let root = temp_dir("dashql-cli-format");
        for (name, text) in files {
            std::fs::write(root.join(name), text).unwrap();
        }
        root
    }

    fn run_with(cwd: &Path, args: &[&str], stdin: &str) -> Result {
        let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        let code = run(
            &args,
            &mut Process {
                cwd: Ok(cwd.to_path_buf()),
                stdin: &mut stdin.as_bytes(),
                stdout: &mut stdout,
                stderr: &mut stderr,
            },
        );
        Result { code, stdout: String::from_utf8(stdout).unwrap(), stderr: String::from_utf8(stderr).unwrap() }
    }

    #[test]
    fn prints_a_script_and_leaves_the_file() {
        let root = files(&[("a.sql", "SELECT  1")]);
        let output = run_with(&root, &["a.sql"], "");
        assert_eq!((output.code, output.stdout.as_str(), output.stderr.as_str()), (0, "select 1;\n", ""));
        assert_eq!(std::fs::read_to_string(root.join("a.sql")).unwrap(), "SELECT  1");
    }

    #[test]
    fn formats_a_script_from_stdin() {
        let output = run_with(Path::new("/"), &["-"], "CALL t.f(a=>1)");
        assert_eq!((output.code, output.stdout.as_str()), (0, "call t.f (a => 1);\n"));
    }

    #[test]
    fn formats_in_the_dialect_of_the_scripts() {
        let script = "select cast(a as array(integer));\n";
        let hyper = run_with(Path::new("/"), &["-"], script);
        assert_eq!((hyper.code, hyper.stdout.as_str()), (0, "select cast(a as integer[]);\n"));
        let trino = run_with(Path::new("/"), &["--dialect", "trino", "-"], script);
        assert_eq!((trino.code, trino.stdout.as_str()), (0, "select cast(a as array(integer));\n"));
        assert_eq!(run_with(Path::new("/"), &["--dialect=trino", "-"], script).stdout, trino.stdout);
    }

    #[test]
    fn writes_only_the_files_that_change() {
        let root = files(&[("a.sql", "SELECT  1"), ("b.sql", "select 1;\n")]);
        let output = run_with(&root, &["--write", "."], "");
        assert_eq!((output.code, output.stdout.as_str()), (0, "a.sql\n2 files, 1 rewritten, 0 failed\n"));
        assert_eq!(std::fs::read_to_string(root.join("a.sql")).unwrap(), "select 1;\n");
    }

    #[test]
    fn checks_without_writing() {
        let root = files(&[("a.sql", "SELECT  1"), ("b.sql", "select 1;\n")]);
        let output = run_with(&root, &["--check", "."], "");
        assert_eq!((output.code, output.stdout.as_str()), (1, "a.sql\n2 files, 1 not formatted, 0 failed\n"));
        assert_eq!(std::fs::read_to_string(root.join("a.sql")).unwrap(), "SELECT  1");
        assert_eq!(run_with(&root, &["--check", "b.sql"], "").code, 0);
    }

    #[test]
    fn keeps_a_script_with_errors() {
        let root = files(&[("a.sql", "select 1 +;\n"), ("b.sql", "SELECT  1")]);
        let output = run_with(&root, &["--write", "."], "");
        assert_eq!(output.code, 1);
        assert!(output.stderr.starts_with("a.sql: syntax error"), "{}", output.stderr);
        assert_eq!(std::fs::read_to_string(root.join("a.sql")).unwrap(), "select 1 +;\n");
        // The other scripts are still formatted
        assert_eq!(std::fs::read_to_string(root.join("b.sql")).unwrap(), "select 1;\n");
    }

    #[test]
    fn keeps_a_script_the_formatter_cannot_print() {
        let root = files(&[("a.sql", "select somefunc(default);\n")]);
        let output = run_with(&root, &["--write", "a.sql"], "");
        assert_eq!(output.code, 1);
        assert_eq!(output.stderr, "a.sql: the formatter doesn't know all of the script\n");
        assert_eq!(std::fs::read_to_string(root.join("a.sql")).unwrap(), "select somefunc(default);\n");
    }

    #[test]
    fn rejects_bad_command_lines() {
        let root = files(&[]);
        for args in [&[][..], &["--bogus", "a.sql"][..], &["--write", "--check", "a.sql"][..], &["--write", "-"][..], &["--dialect", "x", "a.sql"][..], &["a.sql", "--dialect"][..]] {
            let output = run_with(&root, args, "");
            assert_eq!(output.code, 2, "{args:?}");
            assert!(output.stderr.ends_with(&format!("{USAGE}\n")), "{args:?}: {}", output.stderr);
        }
        assert_eq!(run_with(&root, &["gone.sql"], "").code, 2);
        assert_eq!(run_with(&root, &["--help"], "").stdout, format!("{USAGE}\n"));
    }
}
