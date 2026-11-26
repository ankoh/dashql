//! The command line of `dashql`: the session file, the command and its arguments as the JSON of a call. The arguments
//! are only typed here, the page checks their values and fills in the defaults.

use crate::commands;
use serde_json::{json, Map, Value};

/// Where the text of `edit` comes from
#[derive(Debug, PartialEq, Eq)]
pub enum Input {
    File(String),
    Stdin,
}

/// A call of a command of the page
#[derive(Debug, PartialEq)]
pub struct Call {
    pub command: &'static str,
    pub args: Value,
    pub input: Option<Input>,
}

/// What the command line asks for
#[derive(Debug, PartialEq)]
pub enum Invocation {
    Help,
    Guide,
    /// A call of the page with the session file that names it
    Call {
        session: String,
        call: Call,
    },
}

/// The options and positional arguments after a command
struct Parsed {
    positional: Vec<String>,
    options: Vec<(String, Option<String>)>,
}

/// Split the arguments of a command into positional ones and options, `takes_value` tells the options with a value
fn split(args: &[String], takes_value: &[&str], flags: &[&str]) -> Result<Parsed, String> {
    let mut parsed = Parsed { positional: Vec::new(), options: Vec::new() };
    let mut args = args.iter();
    while let Some(arg) = args.next() {
        if arg == "--" {
            parsed.positional.extend(args.by_ref().cloned());
            break;
        }
        if !arg.starts_with("--") || arg.len() == 2 {
            if arg.starts_with('-') && arg.len() > 1 {
                return Err(format!("unknown option {arg}"));
            }
            parsed.positional.push(arg.clone());
            continue;
        }
        let (name, inline) = match arg.split_once('=') {
            Some((name, value)) => (name, Some(value.to_string())),
            None => (arg.as_str(), None),
        };
        if takes_value.contains(&name) {
            let value = match inline {
                Some(value) => value,
                None => args.next().cloned().ok_or_else(|| format!("option {name} needs a value"))?,
            };
            parsed.options.push((name.to_string(), Some(value)));
        } else if flags.contains(&name) {
            if inline.is_some() {
                return Err(format!("option {name} takes no value"));
            }
            parsed.options.push((name.to_string(), None));
        } else {
            return Err(format!("unknown option {name}"));
        }
    }
    Ok(parsed)
}

impl Parsed {
    /// The value of an option that may be given once
    fn value(&self, name: &str) -> Result<Option<&str>, String> {
        let mut values = self.options.iter().filter(|(n, _)| n == name);
        let first = values.next().and_then(|(_, value)| value.as_deref());
        if values.next().is_some() {
            return Err(format!("option {name} is given twice"));
        }
        Ok(first)
    }

    /// Is a flag set?
    fn flag(&self, name: &str) -> bool {
        self.options.iter().any(|(n, _)| n == name)
    }

    /// The one script that a command takes
    fn script(&self) -> Result<String, String> {
        match self.positional.as_slice() {
            [script] => Ok(script.clone()),
            [] => Err("missing the script".into()),
            [_, extra, ..] => Err(format!("unexpected argument {extra}")),
        }
    }

    /// No positional arguments
    fn none(&self) -> Result<(), String> {
        match self.positional.first() {
            Some(extra) => Err(format!("unexpected argument {extra}")),
            None => Ok(()),
        }
    }
}

/// The number of an option
fn number(name: &str, value: &str) -> Result<u64, String> {
    value.parse::<u64>().map_err(|_| format!("option {name} takes a number"))
}

/// The call of a command with its arguments
fn call(name: &'static str, args: &[String]) -> Result<Call, String> {
    let call = |args: Value| Call { command: name, args, input: None };
    match name {
        "scripts" => {
            split(args, &[], &[])?.none()?;
            Ok(call(json!({})))
        }
        "read" | "lint" | "format" => Ok(call(json!({ "script": split(args, &[], &[])?.script()? }))),
        "edit" => {
            let parsed = split(args, &["--file", "--connection"], &[])?;
            let mut out = Map::new();
            out.insert("script".into(), parsed.script()?.into());
            if let Some(connection) = parsed.value("--connection")? {
                out.insert("connection".into(), connection.into());
            }
            let input = match parsed.value("--file")? {
                Some(file) => Input::File(file.to_string()),
                None => Input::Stdin,
            };
            Ok(Call { command: name, args: Value::Object(out), input: Some(input) })
        }
        "move" => {
            let parsed = split(args, &["--before", "--after"], &["--first", "--last"])?;
            let mut out = Map::new();
            out.insert("script".into(), parsed.script()?.into());
            for option in ["--before", "--after"] {
                if let Some(script) = parsed.value(option)? {
                    out.insert(option.trim_start_matches('-').into(), script.into());
                }
            }
            for option in ["--first", "--last"] {
                if parsed.flag(option) {
                    out.insert(option.trim_start_matches('-').into(), true.into());
                }
            }
            Ok(call(Value::Object(out)))
        }
        "catalog" => {
            let parsed = split(args, &[], &[])?;
            match parsed.positional.as_slice() {
                [] => Ok(call(json!({}))),
                [connection] => Ok(call(json!({ "connection": connection }))),
                [_, extra, ..] => Err(format!("unexpected argument {extra}")),
            }
        }
        "run" => {
            let parsed = split(args, &["--rows"], &["--refresh"])?;
            let mut out = Map::new();
            out.insert("scripts".into(), parsed.positional.clone().into());
            out.insert("refresh".into(), parsed.flag("--refresh").into());
            if let Some(rows) = parsed.value("--rows")? {
                out.insert("rows".into(), number("--rows", rows)?.into());
            }
            Ok(call(Value::Object(out)))
        }
        "vis" => {
            let parsed = split(args, &["--width", "--height"], &["--refresh"])?;
            let mut out = Map::new();
            out.insert("script".into(), parsed.script()?.into());
            for option in ["--width", "--height"] {
                if let Some(size) = parsed.value(option)? {
                    out.insert(option.trim_start_matches('-').into(), number(option, size)?.into());
                }
            }
            out.insert("refresh".into(), parsed.flag("--refresh").into());
            Ok(call(Value::Object(out)))
        }
        _ => Err(format!("unknown command {name}")),
    }
}

/// Parse the command line after the name of the program
pub fn parse(args: &[String]) -> Result<Invocation, String> {
    if args.iter().any(|arg| arg == "-h" || arg == "--help") {
        return Ok(Invocation::Help);
    }
    let mut session = None;
    let mut rest = args;
    // The options of dashql come before the command
    loop {
        match rest {
            [flag, value, tail @ ..] if flag == "--session" => {
                session = Some(value.clone());
                rest = tail;
            }
            [flag, tail @ ..] if flag.starts_with("--session=") => {
                session = flag.strip_prefix("--session=").map(str::to_string);
                rest = tail;
            }
            [flag] if flag == "--session" => return Err("option --session needs a file".into()),
            _ => break,
        }
    }
    let Some((name, args)) = rest.split_first() else {
        return Err("missing the command".into());
    };
    if name.starts_with('-') {
        return Err(format!("unknown option {name}"));
    }
    let Some(command) = commands::command(name) else {
        return Err(format!("unknown command {name}"));
    };
    match command.name {
        "help" => Ok(Invocation::Help),
        "guide" => match args.first() {
            Some(extra) => Err(format!("unexpected argument {extra}")),
            None => Ok(Invocation::Guide),
        },
        name => {
            let call = call(name, args)?;
            let session = session.ok_or("missing --session <file>, DashQL passes it to the dashql of the agent")?;
            Ok(Invocation::Call { session, call })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse_line(line: &str) -> Result<Invocation, String> {
        let args: Vec<String> = line.split_whitespace().map(str::to_string).collect();
        parse(&args)
    }

    fn call_of(line: &str) -> Call {
        match parse_line(&format!("--session s.json {line}")) {
            Ok(Invocation::Call { session, call }) => {
                assert_eq!(session, "s.json");
                call
            }
            other => panic!("{line}: {other:?}"),
        }
    }

    fn args_of(line: &str) -> Value {
        call_of(line).args
    }

    fn error_of(line: &str) -> String {
        match parse_line(&format!("--session s.json {line}")) {
            Err(error) => error,
            other => panic!("{line}: {other:?}"),
        }
    }

    #[test]
    fn parses_help_and_guide_without_a_session() {
        assert_eq!(parse_line("help"), Ok(Invocation::Help));
        assert_eq!(parse_line("--help"), Ok(Invocation::Help));
        assert_eq!(parse_line("run -h"), Ok(Invocation::Help));
        assert_eq!(parse_line("guide"), Ok(Invocation::Guide));
        assert_eq!(parse_line("--session s.json guide"), Ok(Invocation::Guide));
        assert_eq!(parse_line("guide x"), Err("unexpected argument x".into()));
    }

    #[test]
    fn needs_a_session_for_the_calls() {
        assert!(parse_line("scripts").unwrap_err().starts_with("missing --session"));
        assert_eq!(parse_line("--session"), Err("option --session needs a file".into()));
        assert!(
            matches!(parse_line("--session=a.json scripts"), Ok(Invocation::Call { session, .. }) if session == "a.json")
        );
    }

    #[test]
    fn parses_the_arguments_of_every_command() {
        assert_eq!(args_of("scripts"), json!({}));
        assert_eq!(args_of("read orders"), json!({"script": "orders"}));
        assert_eq!(args_of("lint orders.sql"), json!({"script": "orders.sql"}));
        assert_eq!(args_of("format orders"), json!({"script": "orders"}));
        assert_eq!(args_of("catalog"), json!({}));
        assert_eq!(args_of("catalog trino"), json!({"connection": "trino"}));
        assert_eq!(args_of("move a --after b"), json!({"script": "a", "after": "b"}));
        assert_eq!(args_of("move a --before=b"), json!({"script": "a", "before": "b"}));
        assert_eq!(args_of("move a --first"), json!({"script": "a", "first": true}));
        assert_eq!(args_of("move a --last"), json!({"script": "a", "last": true}));
        assert_eq!(args_of("run"), json!({"scripts": [], "refresh": false}));
        assert_eq!(args_of("run a b --refresh --rows 0"), json!({"scripts": ["a", "b"], "refresh": true, "rows": 0}));
        assert_eq!(args_of("run --rows=10000 a"), json!({"scripts": ["a"], "refresh": false, "rows": 10000}));
        assert_eq!(args_of("vis a"), json!({"script": "a", "refresh": false}));
        assert_eq!(
            args_of("vis a --width 400 --height=300 --refresh"),
            json!({"script": "a", "width": 400, "height": 300, "refresh": true})
        );
    }

    #[test]
    fn takes_the_text_of_edit_from_a_file_or_stdin() {
        let call = call_of("edit orders --file input/orders.sql --connection c1");
        assert_eq!(call.command, "edit");
        assert_eq!(call.args, json!({"script": "orders", "connection": "c1"}));
        assert_eq!(call.input, Some(Input::File("input/orders.sql".into())));
        let call = call_of("edit orders");
        assert_eq!(call.args, json!({"script": "orders"}));
        assert_eq!(call.input, Some(Input::Stdin));
        assert_eq!(call_of("read orders").input, None);
    }

    #[test]
    fn rejects_bad_command_lines() {
        assert_eq!(parse_line(""), Err("missing the command".into()));
        assert_eq!(parse_line("--session s.json"), Err("missing the command".into()));
        assert_eq!(error_of("connect"), "unknown command connect");
        assert_eq!(error_of("result orders"), "unknown command result");
        assert_eq!(error_of("--verbose scripts"), "unknown option --verbose");
        assert_eq!(error_of("scripts extra"), "unexpected argument extra");
        assert_eq!(error_of("read"), "missing the script");
        assert_eq!(error_of("read a b"), "unexpected argument b");
        assert_eq!(error_of("read a -x"), "unknown option -x");
        assert_eq!(error_of("edit a --file"), "option --file needs a value");
        assert_eq!(error_of("edit a --file x --file y"), "option --file is given twice");
        assert_eq!(error_of("edit a --bogus"), "unknown option --bogus");
        // The page checks the values, e.g. that move names one place
        assert_eq!(args_of("move a --first --last"), json!({"script": "a", "first": true, "last": true}));
        assert_eq!(error_of("catalog a b"), "unexpected argument b");
        assert_eq!(args_of("run --rows 10001"), json!({"scripts": [], "refresh": false, "rows": 10001}));
        assert_eq!(error_of("run --rows x"), "option --rows takes a number");
        assert_eq!(error_of("run --refresh=1"), "option --refresh takes no value");
        assert_eq!(error_of("vis a --width x"), "option --width takes a number");
        assert_eq!(error_of("vis"), "missing the script");
    }

    #[test]
    fn takes_arguments_after_a_double_dash_as_scripts() {
        assert_eq!(args_of("run -- --odd"), json!({"scripts": ["--odd"], "refresh": false}));
    }
}
