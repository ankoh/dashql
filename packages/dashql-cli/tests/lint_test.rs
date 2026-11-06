//! `dashql lint` through the binary. The tests next to the sources cover the behavior, these cover what they skip:
//! the command line of `main`, the exit code of the process, its real stdin and the invoking directory.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

fn dashql() -> Command {
    let binary = std::env::var("DASHQL_BINARY").expect("DASHQL_BINARY is set by the test target");
    let mut command = Command::new(std::env::current_dir().unwrap().join(binary));
    command.env_remove("BUILD_WORKING_DIRECTORY").env_remove("FORCE_COLOR").env("NO_COLOR", "1");
    command
}

/// A new directory with one script
fn directory(name: &str, script: &str) -> PathBuf {
    let dir = PathBuf::from(std::env::var_os("TEST_TMPDIR").expect("TEST_TMPDIR is set by the test runner")).join(name);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("a.sql"), script).unwrap();
    dir
}

fn lint_in(dir: &Path, args: &[&str]) -> Output {
    dashql().current_dir(dir).arg("lint").args(args).output().unwrap()
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

#[test]
fn exits_with_0_for_a_clean_script() {
    let output = lint_in(&directory("clean", "select 1;\n"), &["a.sql"]);
    assert_eq!(output.status.code(), Some(0));
    assert_eq!(stdout(&output), "1 file, 0 errors, 0 warnings\n");
}

#[test]
fn exits_with_1_for_a_script_with_errors() {
    let output = lint_in(&directory("error", "select 1 +;\n"), &["a.sql"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(stdout(&output).starts_with("a.sql\n"), "{}", stdout(&output));
}

#[test]
fn exits_with_2_for_a_missing_script() {
    let output = lint_in(&directory("missing", ""), &["gone.sql"]);
    assert_eq!(output.status.code(), Some(2));
    assert!(String::from_utf8_lossy(&output.stderr).contains("gone.sql"));
}

#[test]
fn reads_stdin() {
    let mut child = dashql()
        .args(["lint", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(b"select 1 +;\n").unwrap();
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(stdout(&output).starts_with("<stdin>\n"), "{}", stdout(&output));
}

#[test]
fn resolves_paths_against_the_directory_of_bazel_run() {
    let dir = directory("bazel-run", "select 1 +;\n");
    let output = dashql().env("BUILD_WORKING_DIRECTORY", &dir).args(["lint", "a.sql"]).output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(stdout(&output).starts_with("a.sql\n"), "{}", stdout(&output));
}
