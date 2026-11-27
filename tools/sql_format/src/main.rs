//! `sql_format`: pretty prints SQL files on disk with the native dashql-core, as the editor of DashQL formats a script.
//! The format gates of the example snippets run it, see docs/agents/core_sql_formatting.md.
//!
//!   bazel run //tools/sql_format -- --write examples/snippets/hyper

use dashql_buffers::formatting::{FormattingConfigT, FormattingDialect, FormattingMode, KeywordCase};
use dashql_core::formatter::Formatter;
use dashql_parser::parser::parse;
use dashql_parser::scanner::scan;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;

const USAGE: &str = "Usage:
  sql_format [options] <file.sql|dir|->...
      Pretty prints the scripts with dashql-core, to stdout by default.
      --write                  Rewrite the files in place
      --check                  Print the files that are not formatted, change nothing
      --dialect <name>         The dialect of the scripts: hyper (default) or trino

Directories are searched recursively for *.sql files, - reads a script from stdin.
A script with errors, or with a statement the formatter doesn't know, is reported and stays as it is.
Exits with 0 if all scripts could be formatted (with --check: are formatted), 1 otherwise and 2 on usage or I/O errors.";

/// The path that reads a script from stdin
const STDIN: &str = "-";
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

/// Parse a dialect, unlike `parse_formatting_dialect` of the core an unknown name is an error
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
            a if a.starts_with('-') && a != STDIN => return Err(format!("unknown option {a}")),
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

/// The *.sql files under a directory, recursively in path order. Links to directories are not followed.
fn sql_files(dir: &Path, out: &mut Vec<PathBuf>) -> std::io::Result<()> {
    let mut entries = std::fs::read_dir(dir)?.collect::<std::io::Result<Vec<_>>>()?;
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        if entry.file_type()?.is_dir() {
            sql_files(&path, out)?;
        } else if path.extension().is_some_and(|e| e.eq_ignore_ascii_case("sql")) {
            out.push(path);
        }
    }
    Ok(())
}

/// The scripts of the paths, each with its path: files, the *.sql files of directories, and stdin for `-`
fn read_inputs(paths: &[String], stdin: &mut dyn Read) -> Result<Vec<(PathBuf, String)>, String> {
    let mut inputs = Vec::new();
    for path in paths {
        if path == STDIN {
            let mut bytes = Vec::new();
            stdin.read_to_end(&mut bytes).map_err(|e| format!("stdin: {e}"))?;
            inputs.push((PathBuf::from(STDIN), String::from_utf8_lossy(&bytes).into_owned()));
            continue;
        }
        let path = Path::new(path);
        let mut files = Vec::new();
        if path.is_dir() {
            sql_files(path, &mut files).map_err(|e| format!("{}: {e}", path.display()))?;
        } else {
            files.push(path.to_path_buf());
        }
        for file in files {
            let bytes = std::fs::read(&file).map_err(|e| format!("{}: {e}", file.display()))?;
            inputs.push((file, String::from_utf8_lossy(&bytes).into_owned()));
        }
    }
    Ok(inputs)
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

fn format_files(
    args: Args,
    stdin: &mut dyn Read,
    stdout: &mut dyn Write,
    stderr: &mut dyn Write,
) -> Result<u8, String> {
    let inputs = read_inputs(&args.paths, stdin)?;
    let (mut failed, mut changed) = (0, 0);
    for (path, text) in &inputs {
        match format_script(text, args.dialect) {
            Err(e) => {
                failed += 1;
                writeln!(stderr, "{}: {e}", path.display()).map_err(|e| format!("stderr: {e}"))?;
            }
            Ok(formatted) if args.output == Output::Print => {
                write!(stdout, "{formatted}").map_err(|e| format!("stdout: {e}"))?
            }
            Ok(formatted) if formatted != *text => {
                // --write takes no stdin
                if args.output == Output::Write {
                    std::fs::write(path, &formatted).map_err(|e| format!("{}: {e}", path.display()))?;
                }
                changed += 1;
                writeln!(stdout, "{}", path.display()).map_err(|e| format!("stdout: {e}"))?;
            }
            Ok(_) => {}
        }
    }
    let files = if inputs.len() == 1 { "file" } else { "files" };
    let summary = match args.output {
        Output::Print => None,
        Output::Write => Some("rewritten"),
        Output::Check => Some("not formatted"),
    };
    if let Some(summary) = summary {
        writeln!(stdout, "{} {files}, {changed} {summary}, {failed} failed", inputs.len())
            .map_err(|e| format!("stdout: {e}"))?;
    }
    let unformatted = args.output == Output::Check && changed > 0;
    Ok(if failed > 0 || unformatted { 1 } else { 0 })
}

/// Run `format` and return the exit code
fn run(args: &[String], stdin: &mut dyn Read, stdout: &mut dyn Write, stderr: &mut dyn Write) -> u8 {
    // A closed stderr or stdout leaves nothing to report the failure on
    let args = match parse_args(args) {
        Ok(args) if args.help => {
            let _ = writeln!(stdout, "{USAGE}");
            return 0;
        }
        Ok(args) if args.paths.is_empty() => {
            let _ = writeln!(stderr, "{USAGE}");
            return 2;
        }
        Ok(args) if args.output == Output::Write && args.paths.iter().any(|p| p == STDIN) => {
            let _ = writeln!(stderr, "error: --write needs files, not stdin\n\n{USAGE}");
            return 2;
        }
        Ok(args) => args,
        Err(e) => {
            let _ = writeln!(stderr, "error: {e}\n\n{USAGE}");
            return 2;
        }
    };
    format_files(args, stdin, stdout, stderr).unwrap_or_else(|e| {
        let _ = writeln!(stderr, "error: {e}");
        2
    })
}

fn main() -> ExitCode {
    // Under `bazel run` the process runs in the runfiles tree, the paths are relative to the invoking directory
    if let Some(dir) = std::env::var_os("BUILD_WORKING_DIRECTORY") {
        if let Err(e) = std::env::set_current_dir(&dir) {
            eprintln!("error: working directory: {e}");
            return ExitCode::from(2);
        }
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    ExitCode::from(run(&args, &mut std::io::stdin(), &mut std::io::stdout().lock(), &mut std::io::stderr().lock()))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The result of a run
    struct Result {
        code: u8,
        stdout: String,
        stderr: String,
    }

    /// A new folder with the given files
    fn files(files: &[(&str, &str)]) -> PathBuf {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::var_os("TEST_TMPDIR").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
        let root = root.join(format!("sql-format-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::SeqCst)));
        let _ = std::fs::remove_dir_all(&root);
        for (name, text) in files {
            let path = root.join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    fn run_with(args: &[&str], stdin: &str) -> Result {
        let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
        let args: Vec<String> = args.iter().map(|a| a.to_string()).collect();
        let code = run(&args, &mut stdin.as_bytes(), &mut stdout, &mut stderr);
        Result { code, stdout: String::from_utf8(stdout).unwrap(), stderr: String::from_utf8(stderr).unwrap() }
    }

    #[test]
    fn prints_writes_and_checks_the_scripts_of_a_directory() {
        let root = files(&[("b.sql", "select 1;\n"), ("a.SQL", "SELECT  1"), ("sub/c.sql", "SELECT 2"), ("x.txt", "")]);
        let dir = root.display().to_string();
        let (a, c) = (root.join("a.SQL").display().to_string(), root.join("sub/c.sql").display().to_string());
        let printed = run_with(&[&a], "");
        assert_eq!((printed.code, printed.stdout.as_str(), printed.stderr.as_str()), (0, "select 1;\n", ""));
        let checked = run_with(&["--check", &dir], "");
        assert_eq!((checked.code, checked.stdout), (1, format!("{a}\n{c}\n3 files, 2 not formatted, 0 failed\n")));
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "SELECT  1");
        let written = run_with(&["--write", &dir], "");
        assert_eq!((written.code, written.stdout), (0, format!("{a}\n{c}\n3 files, 2 rewritten, 0 failed\n")));
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "select 1;\n");
        assert_eq!(run_with(&["--check", &dir], "").code, 0);
    }

    #[test]
    fn formats_stdin_in_the_dialect_of_the_scripts() {
        let script = "select cast(a as array(integer));\n";
        let hyper = run_with(&["-"], script);
        assert_eq!((hyper.code, hyper.stdout.as_str()), (0, "select cast(a as integer[]);\n"));
        let trino = run_with(&["--dialect", "trino", "-"], script);
        assert_eq!((trino.code, trino.stdout.as_str()), (0, "select cast(a as array(integer));\n"));
        assert_eq!(run_with(&["--dialect=trino", "-"], script).stdout, trino.stdout);
    }

    #[test]
    fn keeps_a_script_with_errors() {
        let root = files(&[("a.sql", "select 1 +;\n"), ("b.sql", "SELECT  1")]);
        let output = run_with(&["--write", &root.display().to_string()], "");
        assert_eq!(output.code, 1);
        let a = root.join("a.sql").display().to_string();
        assert!(output.stderr.starts_with(&format!("{a}: syntax error")), "{}", output.stderr);
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "select 1 +;\n");
        // The other scripts are still formatted
        assert_eq!(std::fs::read_to_string(root.join("b.sql")).unwrap(), "select 1;\n");
    }

    #[test]
    fn rejects_bad_command_lines() {
        for args in [
            &[][..],
            &["--bogus", "a.sql"][..],
            &["--write", "--check", "a.sql"][..],
            &["--write", "-"][..],
            &["--dialect", "x", "a.sql"][..],
            &["a.sql", "--dialect"][..],
        ] {
            let output = run_with(args, "");
            assert_eq!(output.code, 2, "{args:?}");
            assert!(output.stderr.ends_with(&format!("{USAGE}\n")), "{args:?}: {}", output.stderr);
        }
        let gone = files(&[]).join("gone.sql").display().to_string();
        assert_eq!(run_with(&[&gone], "").code, 2);
        assert_eq!(run_with(&["--help"], "").stdout, format!("{USAGE}\n"));
    }
}
