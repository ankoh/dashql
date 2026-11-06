//! `dashql lint`: lints SQL files on disk with the native dashql-core

use crate::inputs;
use crate::lint::{Linter, Severity};
use crate::report::{format_file, format_summary, format_timings, Style};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

const USAGE: &str = "Usage:
  dashql lint [options] <file.sql|dir|->...
      Scans, parses and analyzes the scripts with dashql-core and prints the scripts with diagnostics.
      --schema <file.sql>      Schema script (CREATE TABLE ...) to resolve names against, can be repeated
      --debug                  Show where the time goes

Directories are searched recursively for *.sql files, - reads a script from stdin.
Exits with 0 without errors (warnings are fine), 1 with errors and 2 on usage or I/O errors.";

/// The arguments of `lint`
#[derive(Debug, Default, PartialEq, Eq)]
struct Args {
    /// The schema scripts passed with `--schema`
    schemas: Vec<String>,
    /// The files, directories or `-` to lint
    paths: Vec<String>,
    /// Print timings with `--debug`
    debug: bool,
    /// Print the usage with `-h` or `--help`
    help: bool,
}

fn parse_args(args: &[String]) -> Result<Args, String> {
    let mut out = Args::default();
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--schema" => out.schemas.push(args.next().ok_or("option --schema needs a file")?.clone()),
            "--debug" => out.debug = true,
            "-h" | "--help" => out.help = true,
            "--" => out.paths.extend(args.by_ref().cloned()),
            a if a.starts_with("--schema=") => out.schemas.push(a["--schema=".len()..].to_string()),
            a if a.starts_with('-') && a != inputs::STDIN => return Err(format!("unknown option {a}")),
            a => out.paths.push(a.to_string()),
        }
    }
    Ok(out)
}

/// What `lint` takes from the process
struct Process<'a> {
    /// The invoking directory, see `inputs::working_directory`
    cwd: std::io::Result<PathBuf>,
    /// Read for the path `-`
    stdin: &'a mut dyn Read,
    /// The diagnostics and the summary
    stdout: &'a mut dyn Write,
    /// The usage and the errors of the run
    stderr: &'a mut dyn Write,
    /// The style of the diagnostics
    style: Style,
}

fn lint(args: Args, process: &mut Process) -> Result<u8, String> {
    let style = process.style;
    let cwd = process.cwd.as_ref().map_err(|e| format!("working directory: {e}"))?;
    let schemas = inputs::read_inputs(&args.schemas, cwd, process.stdin)?;
    let inputs = inputs::read_inputs(&args.paths, cwd, process.stdin)?;
    let stdout = &mut *process.stdout;
    let mut write = |text: String| writeln!(stdout, "{text}").map_err(|e| format!("stdout: {e}"));

    let start = Instant::now();
    let mut linter = Linter::new();
    // Schemas come first, so that the scripts find their tables
    let schema_diagnostics = schemas.iter().map(|schema| linter.add_schema(schema)).collect::<Vec<_>>();
    let diagnostics = schema_diagnostics.into_iter().chain(inputs.iter().map(|input| linter.lint(input)));
    let (mut errors, mut warnings) = (0, 0);
    for (input, diagnostics) in schemas.iter().chain(&inputs).zip(diagnostics.collect::<Vec<_>>()) {
        if diagnostics.is_empty() {
            continue;
        }
        for d in &diagnostics {
            match d.severity {
                Severity::Error => errors += 1,
                Severity::Warning => warnings += 1,
            }
        }
        write(format!("{}\n", format_file(&input.id, &input.text, &diagnostics, style)))?;
    }
    if args.debug {
        write(format!("{}\n", format_timings(start.elapsed(), style)))?;
    }
    write(format_summary(schemas.len() + inputs.len(), errors, warnings, style))?;
    // Warnings alone do not fail
    Ok(if errors > 0 { 1 } else { 0 })
}

/// Run `lint` and return the exit code
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
        Ok(args) => args,
        Err(e) => {
            let _ = writeln!(process.stderr, "error: {e}\n\n{USAGE}");
            return 2;
        }
    };
    lint(args, process).unwrap_or_else(|e| {
        let _ = writeln!(process.stderr, "error: {e}");
        2
    })
}

/// Run `dashql lint` with the arguments after `lint`
pub fn main(args: &[String]) -> ExitCode {
    ExitCode::from(run(
        args,
        &mut Process {
            cwd: inputs::working_directory(),
            stdin: &mut std::io::stdin(),
            stdout: &mut std::io::stdout().lock(),
            stderr: &mut std::io::stderr().lock(),
            style: Style::for_stdout(),
        },
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent::config::temp_dir;
    use std::path::Path;

    fn parse(args: &[&str]) -> Result<Args, String> {
        parse_args(&args.iter().map(|a| a.to_string()).collect::<Vec<_>>())
    }

    #[test]
    fn parses_options_and_paths() {
        assert_eq!(
            parse(&["--schema", "s.sql", "a.sql", "--schema=t.sql", "-", "--debug", "--", "--odd.sql"]),
            Ok(Args {
                schemas: vec!["s.sql".into(), "t.sql".into()],
                paths: vec!["a.sql".into(), "-".into(), "--odd.sql".into()],
                debug: true,
                help: false,
            })
        );
        assert_eq!(parse(&["--schema"]), Err("option --schema needs a file".into()));
        assert_eq!(parse(&["--bogus"]), Err("unknown option --bogus".into()));
    }

    #[test]
    fn asks_for_help_with_both_spellings() {
        assert!(parse(&["-h"]).unwrap().help);
        assert!(parse(&["--help"]).unwrap().help);
        assert!(!parse(&["a.sql"]).unwrap().help);
    }

    const SCHEMA: &str = "create table orders (id integer);\n";
    const QUERY: &str = "select id from orders, items;\n";

    /// The result of a run
    struct Output {
        code: u8,
        stdout: String,
        stderr: String,
    }

    /// A directory with the given files
    fn files(files: &[(&str, &str)]) -> PathBuf {
        let root = temp_dir("dashql-cli-lint");
        for (name, text) in files {
            let path = root.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }
        root
    }

    fn run_with(cwd: std::io::Result<PathBuf>, args: &[&str], stdin: &str) -> Output {
        let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        let code = run(
            &args,
            &mut Process {
                cwd,
                stdin: &mut stdin.as_bytes(),
                stdout: &mut stdout,
                stderr: &mut stderr,
                style: Style { colors: false },
            },
        );
        Output { code, stdout: String::from_utf8(stdout).unwrap(), stderr: String::from_utf8(stderr).unwrap() }
    }

    fn run_in(cwd: &Path, args: &[&str]) -> Output {
        run_with(Ok(cwd.to_path_buf()), args, "")
    }

    #[test]
    fn passes_a_clean_script_and_prints_only_the_summary() {
        let root = files(&[("a.sql", "select 1;\n")]);
        let output = run_in(&root, &["a.sql"]);
        assert_eq!(output.code, 0);
        assert_eq!(output.stdout, "1 file, 0 errors, 0 warnings\n");
        assert_eq!(output.stderr, "");
    }

    #[test]
    fn fails_with_exit_code_1_and_shows_the_error_in_its_line() {
        let root = files(&[("a.sql", "select 1;\nselect 1 +;\n")]);
        let output = run_in(&root, &["a.sql"]);
        assert_eq!(output.code, 1);
        assert_eq!(
            output.stdout,
            "a.sql\n  2:11  error    parse    syntax error, unexpected SEMICOLON\n        │ select 1 +;\n        │           ^\n\n1 file, 1 error, 0 warnings\n"
        );
        assert_eq!(output.stderr, "");
    }

    #[test]
    fn passes_with_warnings_alone_and_shows_them() {
        let root = files(&[("a.sql", "/* @vis vegalite */\nselect 1 as value;\n")]);
        let output = run_in(&root, &["a.sql"]);
        assert_eq!(output.code, 0, "{}", output.stdout);
        assert!(output.stdout.starts_with("a.sql\n"), "{}", output.stdout);
        assert!(output.stdout.contains("warning  analyze  @vis vegalite needs a Vega-Lite spec"), "{}", output.stdout);
        assert!(output.stdout.ends_with("1 file, 0 errors, 1 warning\n"), "{}", output.stdout);
    }

    #[test]
    fn prints_only_the_scripts_with_diagnostics_and_counts_all_of_them() {
        let root = files(&[("bad1.sql", "select 1 +;\n"), ("good.sql", "select 1;\n"), ("bad2.sql", "select 2 +;\n")]);
        let output = run_in(&root, &["."]);
        assert_eq!(output.code, 1);
        assert!(output.stdout.contains("bad1.sql\n"), "{}", output.stdout);
        assert!(output.stdout.contains("bad2.sql\n"), "{}", output.stdout);
        assert!(!output.stdout.contains("good.sql"), "{}", output.stdout);
        assert!(output.stdout.ends_with("3 files, 2 errors, 0 warnings\n"), "{}", output.stdout);
    }

    #[test]
    fn passes_a_directory_without_scripts() {
        let root = files(&[("notes.txt", "")]);
        let output = run_in(&root, &["."]);
        assert_eq!(output.code, 0);
        assert_eq!(output.stdout, "0 files, 0 errors, 0 warnings\n");
    }

    #[test]
    fn reads_a_script_from_stdin() {
        let root = files(&[]);
        let output = run_with(Ok(root.clone()), &["-"], "select 1 +;\n");
        assert_eq!(output.code, 1);
        assert!(output.stdout.starts_with("<stdin>\n"), "{}", output.stdout);
        assert!(output.stdout.contains("select 1 +;"), "{}", output.stdout);
    }

    #[test]
    fn resolves_names_only_against_the_schemas() {
        let schema_of_both = "create table orders (id integer);\ncreate table items (id integer);\n";
        let root = files(&[("schema.sql", schema_of_both), ("q.sql", QUERY)]);
        // id is ambiguous once both tables are known
        let output = run_in(&root, &["--schema", "schema.sql", "q.sql"]);
        assert_eq!(output.code, 1, "{}", output.stdout);
        assert!(output.stdout.starts_with("q.sql\n"), "{}", output.stdout);
        assert!(output.stdout.ends_with("2 files, 1 error, 0 warnings\n"), "{}", output.stdout);
        // Without them the query has no ambiguous column
        assert_eq!(run_in(&root, &["q.sql"]).stdout, "1 file, 0 errors, 0 warnings\n");
    }

    #[test]
    fn loads_the_schemas_before_the_scripts_wherever_they_are_named() {
        let root = files(&[("orders.sql", SCHEMA), ("items.sql", "create table items (id integer);\n"), ("q.sql", QUERY)]);
        let output = run_in(&root, &["q.sql", "--schema=orders.sql", "--schema", "items.sql"]);
        assert_eq!(output.code, 1, "{}", output.stdout);
        assert!(output.stdout.ends_with("3 files, 1 error, 0 warnings\n"), "{}", output.stdout);
    }

    #[test]
    fn reports_the_errors_of_a_schema_and_does_not_load_it() {
        let root = files(&[("schema.sql", "create table orders (id integer"), ("q.sql", QUERY)]);
        let output = run_in(&root, &["--schema", "schema.sql", "q.sql"]);
        assert_eq!(output.code, 1, "{}", output.stdout);
        assert!(output.stdout.starts_with("schema.sql\n"), "{}", output.stdout);
        assert!(!output.stdout.contains("q.sql"), "{}", output.stdout);
    }

    #[test]
    fn prints_timings_with_debug_only() {
        let root = files(&[("a.sql", "select 1;\n")]);
        let timings = "dashql-core  scan, parse and analyze ";
        assert!(run_in(&root, &["--debug", "a.sql"]).stdout.starts_with(timings));
        assert!(!run_in(&root, &["a.sql"]).stdout.contains(timings));
    }

    #[test]
    fn prints_the_usage_to_stdout_when_asked() {
        let output = run_in(Path::new("/"), &["--help", "ignored.sql"]);
        assert_eq!(output.code, 0);
        assert_eq!(output.stdout, format!("{USAGE}\n"));
        assert_eq!(output.stderr, "");
    }

    #[test]
    fn prints_the_usage_to_stderr_without_paths() {
        let output = run_in(Path::new("/"), &["--debug"]);
        assert_eq!(output.code, 2);
        assert_eq!(output.stdout, "");
        assert_eq!(output.stderr, format!("{USAGE}\n"));
    }

    #[test]
    fn prints_the_usage_after_an_unknown_option() {
        let output = run_in(Path::new("/"), &["--bogus", "a.sql"]);
        assert_eq!(output.code, 2);
        assert_eq!(output.stdout, "");
        assert_eq!(output.stderr, format!("error: unknown option --bogus\n\n{USAGE}\n"));
    }

    #[test]
    fn fails_with_exit_code_2_on_a_missing_script_or_schema() {
        let root = files(&[("a.sql", "select 1;\n")]);
        for args in [&["missing.sql"][..], &["a.sql", "missing.sql"][..], &["--schema", "missing.sql", "a.sql"][..]] {
            let output = run_in(&root, args);
            assert_eq!(output.code, 2, "{args:?}");
            // Nothing was linted, there is no summary that could pass for a clean run
            assert_eq!(output.stdout, "", "{args:?}");
            assert!(output.stderr.starts_with(&format!("error: {}: ", root.join("missing.sql").display())), "{}", output.stderr);
        }
    }

    #[test]
    fn fails_with_exit_code_2_without_a_working_directory() {
        let output = run_with(Err(std::io::Error::other("gone")), &["a.sql"], "");
        assert_eq!(output.code, 2);
        assert_eq!(output.stderr, "error: working directory: gone\n");
        // Asking for the usage does not need one
        assert_eq!(run_with(Err(std::io::Error::other("gone")), &["--help"], "").code, 0);
    }

    #[test]
    fn fails_with_exit_code_2_when_stdout_is_closed() {
        struct Closed;
        impl Write for Closed {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::Error::other("closed"))
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let root = files(&[("a.sql", "select 1;\n")]);
        let mut stderr = Vec::new();
        let code = run(
            &["a.sql".to_string()],
            &mut Process {
                cwd: Ok(root),
                stdin: &mut &b""[..],
                stdout: &mut Closed,
                stderr: &mut stderr,
                style: Style { colors: false },
            },
        );
        assert_eq!(code, 2);
        assert_eq!(String::from_utf8(stderr).unwrap(), "error: stdout: closed\n");
    }
}
