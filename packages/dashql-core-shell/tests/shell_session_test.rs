//! Tests of the shell session: what a prompt is, the history, dot commands, the effect protocol of queries and
//! commands, and the records of their output.

use dashql_core::catalog::Catalog;
use dashql_core_shell::{
    CommandCompletion, EffectCompletionStatus, EffectType, PromptInfo, ShellEffect, ShellOperation, ShellRecord,
    ShellRecordKind as Kind, ShellSession, ShellStatus,
};

const EFFECT_SUCCESS: EffectCompletionStatus = EffectCompletionStatus::Success;
const EFFECT_ERROR: EffectCompletionStatus = EffectCompletionStatus::Error;
const EFFECT_CANCELLED: EffectCompletionStatus = EffectCompletionStatus::Cancelled;

fn new_shell() -> ShellSession {
    ShellSession::new(&Catalog::new(), 80)
}

fn effect(operation: &ShellOperation) -> &ShellEffect {
    operation.effect.as_ref().expect("a pending operation has an effect")
}

fn effect_id(operation: &ShellOperation) -> u64 {
    effect(operation).id
}

fn effect_type(operation: &ShellOperation) -> EffectType {
    effect(operation).effect_type
}

fn payload(operation: &ShellOperation) -> &[u8] {
    &effect(operation).payload
}

fn record(kind: Kind, text: &str) -> ShellRecord {
    ShellRecord::new(kind, text)
}

fn history(entries: &[&str]) -> Vec<u8> {
    let mut out = Vec::new();
    for entry in entries {
        out.extend_from_slice(&(entry.len() as u32).to_le_bytes());
        out.extend_from_slice(entry.as_bytes());
    }
    out
}

fn info(is_command: bool, is_complete: bool) -> PromptInfo {
    PromptInfo { is_command, is_complete }
}

#[test]
fn columns_are_at_least_one() {
    let mut shell = new_shell();
    assert_eq!(shell.columns(), 80);
    shell.resize(0);
    assert_eq!(shell.columns(), 1);
    assert_eq!(ShellSession::new(&Catalog::new(), 0).columns(), 1);
}

#[test]
fn commands_are_validated() {
    let mut shell = new_shell();
    assert_eq!(shell.set_commands(""), ShellStatus::Ok);
    assert_eq!(shell.set_commands("help\nclear-screen\nout_2"), ShellStatus::Ok);
    assert_eq!(shell.commands(), ["help", "clear-screen", "out_2"]);
    assert_eq!(shell.set_commands("help\n"), ShellStatus::Ok);
    assert_eq!(shell.set_commands("help\n\nclear"), ShellStatus::InvalidArgument);
    assert_eq!(shell.set_commands(".help"), ShellStatus::InvalidArgument);
    assert_eq!(shell.set_commands("Help"), ShellStatus::InvalidArgument);
    assert_eq!(shell.set_commands("he lp"), ShellStatus::InvalidArgument);
    // A rejected list keeps the commands
    assert_eq!(shell.commands(), ["help"]);
}

#[test]
fn only_single_statements_with_a_semicolon_are_complete() {
    let mut shell = new_shell();
    assert_eq!(shell.prompt_info(""), info(false, false));
    assert_eq!(shell.prompt_info(" \n "), info(false, false));
    // Without a semicolon Enter adds a line
    assert_eq!(shell.prompt_info("select 1"), info(false, false));
    assert_eq!(shell.prompt_info("select 1;"), info(false, true));
    assert_eq!(shell.prompt_info("select 1;\n  "), info(false, true));
    // Several statements are not complete
    assert_eq!(shell.prompt_info("select 1; select 2;"), info(false, false));
    // A semicolon in a string or a comment ends no statement
    assert_eq!(shell.prompt_info("select ';"), info(false, false));
    assert_eq!(shell.prompt_info("select 1 -- ;"), info(false, false));
    // Syntax that the local parser rejects is complete, the remote grammar may accept it
    assert_eq!(shell.prompt_info("frobnicate the tables;"), info(false, true));
}

#[test]
fn dot_commands_are_complete_on_one_line() {
    let mut shell = new_shell();
    assert_eq!(shell.prompt_info(".help"), info(true, true));
    assert_eq!(shell.prompt_info("  .output table "), info(true, true));
    assert_eq!(shell.prompt_info(".help\nmore"), info(true, false));
    assert_eq!(shell.prompt_info("\n.help"), info(true, true));
}

#[test]
fn command_names_complete() {
    let mut shell = new_shell();
    assert_eq!(shell.set_commands("help\nhistory\noutput\nopen"), ShellStatus::Ok);
    let completion = |shell: &ShellSession, text: &str| shell.complete_command(text);
    let unchanged = |text: &str| CommandCompletion { text: text.to_string(), candidates: Vec::new() };

    // A single match is completed with a space after it
    assert_eq!(completion(&shell, ".he"), unchanged(".help "));
    assert_eq!(completion(&shell, "  .ou"), unchanged("  .output "));
    // Several matches are completed to their common prefix and listed
    assert_eq!(
        completion(&shell, ".h"),
        CommandCompletion { text: ".h".to_string(), candidates: vec![".help".to_string(), ".history".to_string()] }
    );
    assert_eq!(
        completion(&shell, "."),
        CommandCompletion {
            text: ".".to_string(),
            candidates: vec![".help".into(), ".history".into(), ".output".into(), ".open".into()],
        }
    );
    assert_eq!(completion(&shell, ".o").candidates, [".output", ".open"]);
    // Nothing to complete
    assert_eq!(completion(&shell, ".x"), unchanged(".x"));
    assert_eq!(completion(&shell, ".help "), unchanged(".help "));
    assert_eq!(completion(&shell, ".output ta"), unchanged(".output ta"));
    assert_eq!(completion(&shell, "select"), unchanged("select"));
    assert_eq!(completion(&shell, ""), unchanged(""));
}

#[test]
fn history_round_trips() {
    let mut shell = new_shell();
    assert!(shell.export_history().is_empty());
    assert_eq!(shell.import_history(&history(&["select 1", "select 2"])), ShellStatus::Ok);
    assert_eq!(shell.export_history(), history(&["select 1", "select 2"]));
    // Importing nothing clears the history
    assert_eq!(shell.import_history(b""), ShellStatus::Ok);
    assert!(shell.export_history().is_empty());
}

#[test]
fn history_steps_back_and_returns_to_the_draft() {
    let mut shell = new_shell();
    shell.import_history(&history(&["select 1", "select 2"]));
    assert_eq!(shell.history_next("draft"), None);
    assert_eq!(shell.history_previous("draft").as_deref(), Some("select 2"));
    assert_eq!(shell.history_previous("select 2").as_deref(), Some("select 1"));
    // The oldest entry stays
    assert_eq!(shell.history_previous("select 1"), None);
    assert_eq!(shell.history_next("select 1").as_deref(), Some("select 2"));
    assert_eq!(shell.history_next("select 2").as_deref(), Some("draft"));
    assert_eq!(shell.history_next("draft"), None);
    // An empty history has nothing
    let mut shell = new_shell();
    assert_eq!(shell.history_previous(""), None);
    assert_eq!(shell.history_next(""), None);
}

#[test]
fn an_edited_entry_starts_browsing_again() {
    let mut shell = new_shell();
    shell.import_history(&history(&["select 1", "select 2", "select 3"]));
    assert_eq!(shell.history_previous("").as_deref(), Some("select 3"));
    assert_eq!(shell.history_previous("select 3").as_deref(), Some("select 2"));
    // The user edited the entry: it is the draft now, browsing starts from the newest entry
    assert_eq!(shell.history_previous("select 2 + 1").as_deref(), Some("select 3"));
    assert_eq!(shell.history_next("select 3").as_deref(), Some("select 2 + 1"));
    // Edited after stepping back, the next step forward has nothing
    assert_eq!(shell.history_previous("select 2 + 1").as_deref(), Some("select 3"));
    assert_eq!(shell.history_next("select 3 + 1"), None);
}

#[test]
fn submitting_ends_browsing() {
    let mut shell = new_shell();
    shell.import_history(&history(&["select 1", "select 2"]));
    assert_eq!(shell.history_previous("").as_deref(), Some("select 2"));
    assert_eq!(shell.history_previous("select 2").as_deref(), Some("select 1"));
    let operation = shell.submit("select 1");
    shell.cancel_effect(effect_id(&operation));
    assert_eq!(shell.history_previous("").as_deref(), Some("select 1"));
    assert_eq!(shell.history_previous("select 1").as_deref(), Some("select 2"));
}

#[test]
fn invalid_history_is_rejected_and_keeps_the_old_one() {
    let mut shell = new_shell();
    shell.import_history(&history(&["keep"]));
    // A truncated length header
    assert_eq!(shell.import_history(&[1, 0]), ShellStatus::InvalidArgument);
    // An entry longer than the data
    let mut too_long = 100u32.to_le_bytes().to_vec();
    too_long.extend_from_slice(b"abc");
    assert_eq!(shell.import_history(&too_long), ShellStatus::InvalidArgument);
    // Invalid UTF-8
    let mut invalid = 2u32.to_le_bytes().to_vec();
    invalid.extend_from_slice(&[0xff, 0xfe]);
    assert_eq!(shell.import_history(&invalid), ShellStatus::InvalidArgument);
    assert_eq!(shell.export_history(), history(&["keep"]));
}

#[test]
fn history_keeps_the_latest_thousand_entries() {
    let mut shell = new_shell();
    let entries: Vec<String> = (0..1005).map(|i| format!("select {i}")).collect();
    let refs: Vec<&str> = entries.iter().map(String::as_str).collect();
    assert_eq!(shell.import_history(&history(&refs)), ShellStatus::Ok);
    assert_eq!(shell.export_history(), history(&refs[5..]));

    // Submitting trims the oldest entry
    assert_eq!(shell.submit("select new").status, ShellStatus::Pending);
    assert_eq!(shell.export_history(), history(&[&refs[6..], &["select new"]].concat()));
}

#[test]
fn submitting_remembers_distinct_prompts_once() {
    let mut shell = new_shell();
    let first = shell.submit("select 1");
    assert_eq!(first.status, ShellStatus::Pending);
    assert_eq!(shell.complete_effect(effect_id(&first), EFFECT_CANCELLED, &[]).status, ShellStatus::Ok);
    let second = shell.submit("select 1");
    assert_eq!(shell.complete_effect(effect_id(&second), EFFECT_CANCELLED, &[]).status, ShellStatus::Ok);
    assert_eq!(shell.export_history(), history(&["select 1"]));
}

#[test]
fn empty_prompts_cannot_be_submitted() {
    let mut shell = new_shell();
    let operation = shell.submit("");
    assert_eq!(operation.status, ShellStatus::InvalidArgument);
    assert_eq!(operation.message, "prompt must not be empty");
    assert_eq!(shell.submit(" \n").status, ShellStatus::InvalidArgument);
    assert_eq!(shell.start_query("").status, ShellStatus::InvalidArgument);
    // Nothing was remembered
    assert!(shell.export_history().is_empty());
}

#[test]
fn queries_lose_their_semicolon() {
    let mut shell = new_shell();
    let operation = shell.submit("select 1;\n");
    assert_eq!(effect_type(&operation), EffectType::ExecuteQuery);
    assert_eq!(payload(&operation), b"select 1");
    shell.cancel_effect(effect_id(&operation));
    let operation = shell.submit("select 2");
    assert_eq!(payload(&operation), b"select 2");
}

#[test]
fn dot_commands_suspend_on_a_command_effect() {
    let mut shell = new_shell();
    let operation = shell.submit("  .tables now \n");
    assert_eq!(operation.status, ShellStatus::Pending);
    assert_eq!(effect_type(&operation), EffectType::ExecuteCommand);
    assert_eq!(payload(&operation), b".tables now");

    // The first byte of the result is the flags, the output is a text record without its trailing line break
    let result = shell.complete_effect(effect_id(&operation), EFFECT_SUCCESS, b"\x00line 1\r\nline 2\r\n");
    assert_eq!(result.status, ShellStatus::Ok);
    assert_eq!(result.records, [record(Kind::Text, "line 1\nline 2")]);

    // A command without output has no record
    let operation = shell.submit(".timer on");
    let result = shell.complete_effect(effect_id(&operation), EFFECT_SUCCESS, b"\x00");
    assert_eq!(result.records, []);
}

#[test]
fn command_results_can_clear_the_records() {
    let mut shell = new_shell();
    let operation = shell.submit(".clear");
    let result = shell.complete_effect(effect_id(&operation), EFFECT_SUCCESS, b"\x01");
    assert_eq!(result.records, [record(Kind::Clear, "")]);
    let operation = shell.submit(".clear");
    let result = shell.complete_effect(effect_id(&operation), EFFECT_SUCCESS, b"\x01cleared\n");
    assert_eq!(result.records, [record(Kind::Clear, ""), record(Kind::Text, "cleared")]);
}

#[test]
fn empty_command_results_are_internal_errors() {
    let mut shell = new_shell();
    let operation = shell.submit(".x");
    let result = shell.complete_effect(effect_id(&operation), EFFECT_SUCCESS, b"");
    assert_eq!(result.status, ShellStatus::InternalError);
    assert_eq!(result.message, "invalid shell command result");
}

#[test]
fn queries_suspend_on_a_query_effect() {
    let mut shell = new_shell();
    let operation = shell.start_query("select 1");
    assert_eq!(operation.status, ShellStatus::Pending);
    assert_eq!(effect_type(&operation), EffectType::ExecuteQuery);
    assert_eq!(payload(&operation), b"select 1");

    // Only one operation at a time
    let busy = shell.start_query("select 2");
    assert_eq!(busy.status, ShellStatus::Busy);
    assert_eq!(busy.message, "the shell already has an active operation");
    // Also for dot commands
    assert_eq!(shell.submit(".tables").status, ShellStatus::Busy);
}

#[test]
fn effect_ids_are_unique() {
    let mut shell = new_shell();
    let first = shell.start_query("select 1");
    shell.complete_effect(effect_id(&first), EFFECT_CANCELLED, &[]);
    let second = shell.start_query("select 2");
    assert_ne!(effect_id(&first), effect_id(&second));
}

#[test]
fn completing_unknown_effects_is_stale() {
    let mut shell = new_shell();
    let result = shell.complete_effect(42, EFFECT_SUCCESS, &[]);
    assert_eq!(result.status, ShellStatus::StaleEffect);
    let operation = shell.start_query("select 1");
    let id = effect_id(&operation);
    assert_eq!(shell.cancel_effect(id + 1).status, ShellStatus::StaleEffect);
    // Effects complete once
    assert_eq!(shell.cancel_effect(id).status, ShellStatus::Ok);
    assert_eq!(shell.cancel_effect(id).status, ShellStatus::StaleEffect);
}

#[test]
fn invalid_completion_statuses_are_rejected() {
    // The wasm module rejects statuses that are not an `EffectCompletionStatus` before they reach the session
    assert_eq!(EffectCompletionStatus::from_u32(7), None);
    assert_eq!(EffectCompletionStatus::from_u32(2), Some(EffectCompletionStatus::Cancelled));
}

#[test]
fn failed_and_cancelled_effects_are_records() {
    let mut shell = new_shell();
    let operation = shell.start_query("select 1");
    let result = shell.complete_effect(effect_id(&operation), EFFECT_ERROR, b"relation does not exist\r\n");
    assert_eq!(result.status, ShellStatus::Ok);
    assert_eq!(result.records, [record(Kind::Error, "relation does not exist")]);

    let operation = shell.start_query("select 1");
    let result = shell.complete_effect(effect_id(&operation), EFFECT_ERROR, b"");
    assert_eq!(result.records, [record(Kind::Error, "query failed")]);

    let operation = shell.submit(".fail");
    let result = shell.complete_effect(effect_id(&operation), EFFECT_ERROR, b"unknown command: .fail");
    assert_eq!(result.records, [record(Kind::Error, "unknown command: .fail")]);

    let operation = shell.start_query("select 1");
    let result = shell.cancel_effect(effect_id(&operation));
    assert_eq!(result.records, [record(Kind::Status, "Cancelled")]);
}
