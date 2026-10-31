//! Executes the formatted SQL of the formatter snapshots in Hyper.
//!
//! Every formatter case with a `hyper` validation block gets a fresh database: the setup script runs
//! first, then the formatted output of every expectation of the dialect, split into statements at
//! top-level semicolons. The formatted output must equal the snapshot before it runs.
//!
//! Hyper ships only a C++ SDK, `//packages/hyper-api:hyper_ffi_rs` reaches it through a C ABI.

use dashql_core::formatter::{formatting_mode_to_string, Formatter};
use dashql_parser::parser::parse;
use dashql_parser::scanner::scan;
use dashql_snapshots::formatter::{load_formatter_cases, DialectExpectations};
use dashql_snapshots::{run, Arguments, Failed, Trial};
use hyper_ffi::{hyper_process, HyperProcess, TemporaryDatabase};
use std::sync::{Arc, OnceLock};

fn check(
    process: &OnceLock<HyperProcess>,
    database_name: &str,
    input: &str,
    dialects: &[DialectExpectations],
) -> Result<(), String> {
    let parsed = parse(Arc::new(scan(input, 0, 2)));
    let mut formatter = Formatter::new(&parsed);
    for dialect in dialects.iter().filter(|d| !d.skip) {
        let Some(validation) = dialect.validation.as_ref().filter(|_| dialect.dialect == "hyper") else { continue };
        let database = TemporaryDatabase::new(database_name);
        let setup_failed = |e: String| format!("Dialect {}: Hyper setup failed: {e}", dialect.dialect);
        let mut connection = hyper_process(process, "dashql-formatter-validation").connect(&database.path).map_err(setup_failed)?;
        connection.execute_script(&validation.setup).map_err(setup_failed)?;

        for (i, expectation) in dialect.expectations.iter().enumerate() {
            let label = format!(
                "Dialect {} expectation {} (mode={})",
                dialect.dialect,
                i,
                formatting_mode_to_string(expectation.config.mode)
            );
            let formatted = formatter.format(&expectation.config);
            if formatted.is_empty() {
                return Err(format!("{label}: output must not be empty"));
            }
            if formatted != expectation.formatted {
                return Err(format!("{label}\nexpected:\n{}\nactual:\n{formatted}", expectation.formatted));
            }
            connection.execute_script(&formatted).map_err(|e| format!("{label}: Hyper execution failed: {e}"))?;
        }
    }
    Ok(())
}

fn main() {
    let args = Arguments::from_args();
    let cases = load_formatter_cases().unwrap_or_else(|e| panic!("cannot load formatter snapshots: {e}"));
    let process = Arc::new(OnceLock::new());
    let mut trials = Vec::new();
    for case in cases.into_iter().filter(|c| c.validation("hyper").is_some()) {
        let process = process.clone();
        let database_name = format!("{}.{}", case.case.file, case.case.name);
        trials.push(Trial::test(case.case.trial_name(), move || {
            check(&process, &database_name, &case.input, &case.dialects).map_err(Failed::from)
        }));
    }
    println!("{} formatter cases with a hyper validation", trials.len());
    let conclusion = run(&args, trials);
    // The trials are dropped, stop Hyper before exiting
    drop(Arc::try_unwrap(process).ok().and_then(OnceLock::into_inner));
    conclusion.exit();
}
