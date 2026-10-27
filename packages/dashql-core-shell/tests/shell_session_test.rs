//! Tests of the shell session: input validation, readline editing, history, dot commands and the
//! effect protocol of queries and commands.

use dashql_core::catalog::Catalog;
use dashql_core_shell::vt100;
use dashql_core_shell::{EffectCompletionStatus, PromptInputAction, PromptInputKey as Key, ShellStatus, TerminalOutput};

#[path = "support/test_shell.rs"]
mod support;
use support::{SharedCatalog, TestShell as Shell};
use std::cell::RefCell;
use std::rc::Rc;

const EFFECT_SUCCESS: EffectCompletionStatus = EffectCompletionStatus::Success;
const EFFECT_ERROR: EffectCompletionStatus = EffectCompletionStatus::Error;
const EFFECT_CANCELLED: EffectCompletionStatus = EffectCompletionStatus::Cancelled;
/// The size of the header of an effect envelope
const ENVELOPE_HEADER: usize = 16;

fn new_shell(columns: u32) -> Shell {
    let catalog: SharedCatalog = Rc::new(RefCell::new(Catalog::new()));
    Shell::new(&catalog, columns, false)
}

fn text(output: &TerminalOutput) -> String {
    String::from_utf8_lossy(&output.data).into_owned()
}

fn consume(shell: &mut Shell, key: Key, input: &str) -> TerminalOutput {
    shell.consume_terminal_input(key, input.as_bytes())
}

fn effect_id(data: &[u8]) -> u64 {
    u64::from_le_bytes(data[8..16].try_into().unwrap())
}

fn effect_type(data: &[u8]) -> u32 {
    u32::from_le_bytes(data[4..8].try_into().unwrap())
}

fn history(entries: &[&str]) -> Vec<u8> {
    let mut out = Vec::new();
    for entry in entries {
        out.extend_from_slice(&(entry.len() as u32).to_le_bytes());
        out.extend_from_slice(entry.as_bytes());
    }
    out
}

#[test]
fn accessors_expose_the_session() {
    let mut shell = new_shell(80);
    assert_eq!(shell.set_prompt(b"select 1").status, ShellStatus::Ok);
    assert_eq!(shell.prompt().text(), "select 1");
    shell.prompt_mut().set_text(b"select 2");
    assert_eq!(shell.prompt().text(), "select 2");
    assert_eq!(shell.terminal_action(), PromptInputAction::None);
    assert_eq!(shell.catalog().borrow().entries_ranked().count(), 0);
}

#[test]
fn commands_are_validated() {
    let mut shell = new_shell(80);
    assert_eq!(shell.set_commands(b""), ShellStatus::Ok);
    assert_eq!(shell.set_commands(b"help\nclear-screen\nout_2"), ShellStatus::Ok);
    assert_eq!(shell.set_commands(b"help\n"), ShellStatus::Ok);
    assert_eq!(shell.set_commands(b"help\n\nclear"), ShellStatus::InvalidArgument);
    assert_eq!(shell.set_commands(b".help"), ShellStatus::InvalidArgument);
    assert_eq!(shell.set_commands(b"Help"), ShellStatus::InvalidArgument);
    assert_eq!(shell.set_commands(b"he lp"), ShellStatus::InvalidArgument);
    assert_eq!(shell.set_commands(b"\xff"), ShellStatus::InvalidArgument);
}

#[test]
fn registered_commands_are_highlighted_in_bold() {
    let mut shell = new_shell(80);
    assert_eq!(shell.set_commands(b"help"), ShellStatus::Ok);
    shell.open_terminal(b"");
    let output = text(&consume(&mut shell, Key::Text, ".help me"));
    assert!(output.contains(&format!("{}.help{}", vt100::BOLD, vt100::RESET_ATTRIBUTES)), "{output:?}");

    // An unregistered command is not bold
    let mut shell = new_shell(80);
    shell.open_terminal(b"");
    let output = text(&consume(&mut shell, Key::Text, ".help"));
    assert!(!output.contains(&format!("{}.help", vt100::BOLD)), "{output:?}");
}

#[test]
fn prompt_rejects_invalid_utf8() {
    let mut shell = new_shell(80);
    let prompt = shell.set_prompt(b"\xff");
    assert_eq!(prompt.status, ShellStatus::InvalidArgument);
    assert_eq!(prompt.message, "prompt must contain valid UTF-8");
    let prompt = shell.insert_prompt(b"");
    assert_eq!(prompt.status, ShellStatus::InvalidArgument);
    assert_eq!(prompt.message, "prompt insertion must contain valid non-empty UTF-8");
    assert_eq!(shell.insert_prompt(b"\xc3").status, ShellStatus::InvalidArgument);
    let prompt = shell.consume_prompt_input(Key::Text, b"");
    assert_eq!(prompt.status, ShellStatus::InvalidArgument);
    assert_eq!(prompt.message, "prompt input must contain valid non-empty UTF-8");
    // The prompt is unchanged
    assert_eq!(shell.consume_prompt_input(Key::Text, b"ok").text, "ok");
}

#[test]
fn unknown_keys_are_rejected() {
    // The wasm module rejects keys that are not a `PromptInputKey` before they reach the session
    assert_eq!(Key::from_u32(999), None);
    assert_eq!(Key::from_u32(Key::Text as u32), Some(Key::Text));
}

#[test]
fn deletes_around_the_cursor() {
    let mut shell = new_shell(80);
    shell.set_prompt(b"abcd");
    shell.move_prompt_left();
    assert_eq!(shell.delete_prompt_backward().text, "abd");
    assert_eq!(shell.delete_prompt_forward().text, "ab");
    shell.move_prompt_left();
    assert_eq!(shell.move_prompt_right().cursor_byte_offset, 2);
    assert_eq!(shell.consume_prompt_input(Key::Left, b"").cursor_byte_offset, 1);
    assert_eq!(shell.consume_prompt_input(Key::Delete, b"").text, "a");
    assert_eq!(shell.consume_prompt_input(Key::Backspace, b"").text, "");
}

#[test]
fn moves_by_words_and_kills_lines() {
    let mut shell = new_shell(80);
    shell.set_prompt(b"alpha beta gamma");
    assert_eq!(shell.consume_prompt_input(Key::WordLeft, b"").cursor_byte_offset, 11);
    assert_eq!(shell.consume_prompt_input(Key::WordLeft, b"").cursor_byte_offset, 6);
    assert_eq!(shell.consume_prompt_input(Key::WordRight, b"").cursor_byte_offset, 10);

    shell.consume_prompt_input(Key::LineStart, b"");
    shell.consume_prompt_input(Key::WordRight, b"");
    // Kill to the end of the line and yank it back
    assert_eq!(shell.consume_prompt_input(Key::KillLine, b"").text, "alpha");
    assert_eq!(shell.consume_prompt_input(Key::Yank, b"").text, "alpha beta gamma");
    // Kill to the start of the line
    shell.consume_prompt_input(Key::WordLeft, b"");
    assert_eq!(shell.consume_prompt_input(Key::BackwardKillLine, b"").text, "gamma");
    assert_eq!(shell.consume_prompt_input(Key::Yank, b"").text, "alpha beta gamma");
}

#[test]
fn transposes_characters() {
    let mut shell = new_shell(80);
    shell.set_prompt(b"abc");
    assert_eq!(shell.consume_prompt_input(Key::Transpose, b"").text, "acb");
    // Nothing to transpose at the start
    shell.consume_prompt_input(Key::Start, b"");
    assert_eq!(shell.consume_prompt_input(Key::Transpose, b"").text, "acb");
}

#[test]
fn cancel_clears_the_prompt() {
    let mut shell = new_shell(80);
    shell.set_prompt(b"select 1");
    let prompt = shell.consume_prompt_input(Key::Cancel, b"");
    assert_eq!(prompt.text, "");
    assert_eq!(prompt.action, PromptInputAction::None);
}

#[test]
fn force_submit_needs_text() {
    let mut shell = new_shell(80);
    assert_eq!(shell.consume_prompt_input(Key::ForceSubmit, b"").action, PromptInputAction::None);
    shell.set_prompt(b"select 1");
    assert_eq!(shell.consume_prompt_input(Key::ForceSubmit, b"").action, PromptInputAction::Submit);
}

#[test]
fn enter_submits_only_complete_prompts() {
    let mut shell = new_shell(80);
    shell.set_prompt(b"select 1");
    // Without a semicolon Enter adds a line
    let prompt = shell.consume_prompt_input(Key::Enter, b"");
    assert_eq!(prompt.action, PromptInputAction::None);
    assert_eq!(prompt.text, "select 1\n");

    let mut shell = new_shell(80);
    shell.set_prompt(b"select 1;");
    assert_eq!(shell.consume_prompt_input(Key::Enter, b"").action, PromptInputAction::Submit);

    // A dot command is complete on a single line
    let mut shell = new_shell(80);
    shell.set_prompt(b" .help");
    assert_eq!(shell.consume_prompt_input(Key::Enter, b"").action, PromptInputAction::Submit);
    let mut shell = new_shell(80);
    shell.set_prompt(b".help\nmore");
    assert_eq!(shell.consume_prompt_input(Key::Enter, b"").action, PromptInputAction::None);

    // Several statements are not complete
    let mut shell = new_shell(80);
    shell.set_prompt(b"select 1; select 2;");
    assert_eq!(shell.consume_prompt_input(Key::Enter, b"").action, PromptInputAction::None);
}

#[test]
fn applies_completions_from_the_c_abi() {
    let mut shell = new_shell(80);
    shell.set_prompt(b"select * from fo");
    let prompt = shell.apply_completion_bytes(b"foo", b"foo", 14, 2);
    assert_eq!(prompt.status, ShellStatus::Ok);
    assert_eq!(prompt.text, "select * from foo");

    let prompt = shell.apply_completion_bytes(b"foo", b"\xff", 14, 2);
    assert_eq!(prompt.status, ShellStatus::InvalidArgument);
    assert_eq!(prompt.message, "completion target is not on prompt boundaries");

    // Outside of the prompt
    let prompt = shell.apply_completion_bytes(b"x", b"x", 100, 2);
    assert_eq!(prompt.status, ShellStatus::InvalidArgument);
    assert_eq!(prompt.text, "select * from foo");
}

#[test]
fn history_round_trips() {
    let mut shell = new_shell(80);
    assert!(shell.export_history().is_empty());
    assert_eq!(shell.import_history(&history(&["select 1", "select 2"])), ShellStatus::Ok);
    assert_eq!(shell.export_history(), history(&["select 1", "select 2"]));
    let prompt = shell.consume_prompt_input(Key::HistoryPrevious, b"");
    assert_eq!(prompt.text, "select 2");
    let prompt = shell.consume_prompt_input(Key::HistoryPrevious, b"");
    assert_eq!(prompt.text, "select 1");
    assert_eq!(shell.consume_prompt_input(Key::HistoryNext, b"").text, "select 2");
    // Importing nothing clears the history
    assert_eq!(shell.import_history(b""), ShellStatus::Ok);
    assert!(shell.export_history().is_empty());
}

#[test]
fn invalid_history_is_rejected_and_keeps_the_old_one() {
    let mut shell = new_shell(80);
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
    let mut shell = new_shell(80);
    let entries: Vec<String> = (0..1005).map(|i| format!("select {i}")).collect();
    let refs: Vec<&str> = entries.iter().map(String::as_str).collect();
    assert_eq!(shell.import_history(&history(&refs)), ShellStatus::Ok);
    assert_eq!(shell.export_history(), history(&refs[5..]));

    // Submitting trims the oldest entry
    shell.set_prompt(b"select new");
    assert_eq!(shell.submit_prompt().status, ShellStatus::Pending);
    let exported = shell.export_history();
    assert_eq!(exported, history(&[&refs[6..], &["select new"]].concat()));
}

#[test]
fn submitting_remembers_distinct_prompts_once() {
    let mut shell = new_shell(80);
    shell.set_prompt(b"select 1");
    let first = shell.submit_prompt();
    assert_eq!(first.status, ShellStatus::Pending);
    assert_eq!(shell.complete_effect(effect_id(&first.data), EFFECT_CANCELLED, &[]).status, ShellStatus::Ok);
    shell.set_prompt(b"select 1");
    let second = shell.submit_prompt();
    assert_eq!(shell.complete_effect(effect_id(&second.data), EFFECT_CANCELLED, &[]).status, ShellStatus::Ok);
    assert_eq!(shell.export_history(), history(&["select 1"]));
}

#[test]
fn empty_prompts_cannot_be_submitted() {
    let mut shell = new_shell(80);
    let operation = shell.submit_prompt();
    assert_eq!(operation.status, ShellStatus::InvalidArgument);
    assert_eq!(String::from_utf8_lossy(&operation.data), "query must not be empty");
    let operation = shell.start_query(b"");
    assert_eq!(operation.status, ShellStatus::InvalidArgument);
}

#[test]
fn dot_commands_suspend_on_a_command_effect() {
    let mut shell = new_shell(80);
    shell.set_prompt(b"  .tables now ");
    let operation = shell.submit_prompt();
    assert_eq!(operation.status, ShellStatus::Pending);
    assert_eq!(effect_type(&operation.data), 2);
    assert_eq!(&operation.data[ENVELOPE_HEADER..], b".tables now ");

    // The first byte of the result tells the terminal to clear
    let id = effect_id(&operation.data);
    let result = shell.complete_effect(id, EFFECT_SUCCESS, b"\x00output");
    assert_eq!(result.status, ShellStatus::Ok);
    assert_eq!(result.data, b"output");
}

#[test]
fn command_results_can_clear_the_terminal() {
    let mut shell = new_shell(80);
    shell.open_terminal(b"");
    consume(&mut shell, Key::Text, ".clear");
    let output = consume(&mut shell, Key::Enter, "");
    assert_eq!(output.action, PromptInputAction::Submit);
    let operation = shell.submit_prompt();
    let result = shell.complete_effect(effect_id(&operation.data), EFFECT_SUCCESS, b"\x01ignored");
    assert_eq!(result.status, ShellStatus::Ok);
    let finished = shell.finish_terminal_query(&result.data, false);
    let finished = text(&finished);
    assert!(finished.contains(vt100::CLEAR_SCREEN), "{finished:?}");
    assert!(!finished.contains("ignored\r\n"), "{finished:?}");
    // Only the next result is cleared
    let finished = text(&shell.finish_terminal_query(b"after", false));
    assert!(!finished.contains(vt100::CLEAR_SCREEN));
    assert!(finished.contains("after"));
}

#[test]
fn empty_command_results_are_internal_errors() {
    let mut shell = new_shell(80);
    shell.set_prompt(b".x");
    let operation = shell.submit_prompt();
    let result = shell.complete_effect(effect_id(&operation.data), EFFECT_SUCCESS, b"");
    assert_eq!(result.status, ShellStatus::InternalError);
    assert_eq!(String::from_utf8_lossy(&result.data), "invalid shell command result");
}

#[test]
fn queries_suspend_on_a_query_effect() {
    let mut shell = new_shell(80);
    let operation = shell.start_query(b"select 1");
    assert_eq!(operation.status, ShellStatus::Pending);
    assert_eq!(effect_type(&operation.data), 1);
    assert_eq!(u32::from_le_bytes(operation.data[0..4].try_into().unwrap()), 1);
    assert_eq!(&operation.data[ENVELOPE_HEADER..], b"select 1");

    // Only one operation at a time
    let busy = shell.start_query(b"select 2");
    assert_eq!(busy.status, ShellStatus::Busy);
    assert_eq!(String::from_utf8_lossy(&busy.data), "the shell already has an active operation");
}

#[test]
fn effect_ids_are_unique() {
    let mut shell = new_shell(80);
    let first = shell.start_query(b"select 1");
    shell.complete_effect(effect_id(&first.data), EFFECT_CANCELLED, &[]);
    let second = shell.start_query(b"select 2");
    assert_ne!(effect_id(&first.data), effect_id(&second.data));
}

#[test]
fn queries_reject_invalid_input() {
    let mut shell = new_shell(80);
    let operation = shell.start_query(b"select \xff");
    assert_eq!(operation.status, ShellStatus::InternalError);
    assert_eq!(String::from_utf8_lossy(&operation.data), "rope input must contain valid UTF-8");
    // A rejected query leaves the shell free
    assert_eq!(shell.start_query(b"select 1").status, ShellStatus::Pending);
}

#[test]
fn completing_unknown_effects_is_stale() {
    let mut shell = new_shell(80);
    let result = shell.complete_effect(42, EFFECT_SUCCESS, &[]);
    assert_eq!(result.status, ShellStatus::StaleEffect);
    let operation = shell.start_query(b"select 1");
    let id = effect_id(&operation.data);
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
fn failed_and_cancelled_effects_render_messages() {
    let mut shell = new_shell(80);
    let operation = shell.start_query(b"select 1");
    let result = shell.complete_effect(effect_id(&operation.data), EFFECT_ERROR, b"relation does not exist");
    assert_eq!(result.status, ShellStatus::Ok);
    assert_eq!(String::from_utf8_lossy(&result.data), "relation does not exist");

    let operation = shell.start_query(b"select 1");
    let result = shell.complete_effect(effect_id(&operation.data), EFFECT_ERROR, b"");
    assert_eq!(String::from_utf8_lossy(&result.data), "query failed");

    let operation = shell.start_query(b"select 1");
    let result = shell.cancel_effect(effect_id(&operation.data));
    assert_eq!(String::from_utf8_lossy(&result.data), "Cancelled");
}

#[test]
fn invalid_arrow_results_are_reported() {
    let mut shell = new_shell(80);
    let operation = shell.start_query(b"select 1");
    let result = shell.complete_effect(effect_id(&operation.data), EFFECT_SUCCESS, b"not arrow");
    assert_eq!(result.status, ShellStatus::ArrowError);
    assert!(!result.data.is_empty());
}

#[test]
fn terminal_prompt_is_validated() {
    let mut shell = new_shell(80);
    let output = shell.open_terminal(b"\xff");
    assert_eq!(output.status, ShellStatus::InvalidArgument);
    assert_eq!(text(&output), "terminal prompt must contain valid UTF-8");
    let output = shell.open_terminal(&vec![b'a'; 257]);
    assert_eq!(output.status, ShellStatus::InvalidArgument);
    assert_eq!(text(&output), "terminal prompt is too long");
    let output = shell.open_terminal(&vec![b'a'; 256]);
    assert_eq!(output.status, ShellStatus::Ok);
    // A prompt without a marker is as wide as its text
    assert!(text(&shell.open_terminal(b"abc")).contains("abc"));
}

#[test]
fn terminal_exit_and_cancel() {
    let mut shell = new_shell(80);
    shell.open_terminal(b"> ");
    let output = consume(&mut shell, Key::Eof, "");
    assert_eq!(output.action, PromptInputAction::Exit);
    assert!(text(&output).contains(vt100::ENABLE_AUTO_WRAP));

    let mut shell = new_shell(80);
    shell.open_terminal(b"> ");
    consume(&mut shell, Key::Text, "select");
    let output = consume(&mut shell, Key::Cancel, "");
    assert_eq!(output.status, ShellStatus::Ok);
    assert_eq!(output.action, PromptInputAction::None);
    let rendered = text(&output);
    assert!(rendered.contains("^C"), "{rendered:?}");
    assert_eq!(shell.prompt().text(), "");
}

#[test]
fn terminal_force_submit_and_invalid_text() {
    let mut shell = new_shell(80);
    shell.open_terminal(b"> ");
    let output = shell.consume_terminal_input(Key::Text, b"\xff");
    assert_eq!(output.status, ShellStatus::InvalidArgument);
    consume(&mut shell, Key::Text, "select 1");
    let output = consume(&mut shell, Key::ForceSubmit, "");
    assert_eq!(output.status, ShellStatus::Ok);
    assert_eq!(output.action, PromptInputAction::Submit);
}

#[test]
fn terminal_applies_a_single_completion_on_tab() {
    let mut shell = new_shell(80);
    shell.open_terminal(b"> ");
    consume(&mut shell, Key::Text, "selec");
    let output = consume(&mut shell, Key::Tab, "");
    assert_eq!(output.status, ShellStatus::Ok);
    assert_eq!(shell.prompt().text(), "select");
}

#[test]
fn terminal_edits_by_word_and_line() {
    let mut shell = new_shell(80);
    shell.open_terminal(b"> ");
    consume(&mut shell, Key::Text, "select a from t");
    assert_eq!(consume(&mut shell, Key::WordLeft, "").status, ShellStatus::Ok);
    assert_eq!(consume(&mut shell, Key::WordRight, "").status, ShellStatus::Ok);
    consume(&mut shell, Key::KillLine, "");
    assert_eq!(consume(&mut shell, Key::Transpose, "").status, ShellStatus::Ok);
    consume(&mut shell, Key::Delete, "");
    assert_eq!(consume(&mut shell, Key::BackwardKillLine, "").status, ShellStatus::Ok);
    assert_eq!(shell.prompt().text(), "");
}

#[test]
fn long_prompts_wrap_at_the_terminal_width() {
    let mut shell = new_shell(10);
    shell.open_terminal(b"> ");
    let output = consume(&mut shell, Key::Text, "select 1 + 2 + 3 + 4 + 5");
    let rendered = text(&output);
    assert!(rendered.contains(vt100::CARRIAGE_RETURN), "{rendered:?}");
    assert_eq!(output.status, ShellStatus::Ok);
    shell.resize(40);
    assert_eq!(consume(&mut shell, Key::End, "").status, ShellStatus::Ok);
}

#[test]
fn query_progress_shows_a_spinner() {
    let mut shell = new_shell(80);
    let first = text(&shell.render_terminal_query_progress(b"", false));
    assert!(first.contains("Executing query"), "{first:?}");
    assert!(first.starts_with(vt100::DISABLE_AUTO_WRAP));
    // Advancing changes the spinner frame and keeps the message
    let second = text(&shell.render_terminal_query_progress(b"", true));
    assert!(second.contains("Executing query"));
    assert_ne!(first, second);
    // A new message replaces the old one, control characters are dropped
    let third = text(&shell.render_terminal_query_progress(b"Fetching\x01 rows", false));
    assert!(third.contains("Fetching rows"), "{third:?}");
    // Escape sequences cut the message
    let fourth = text(&shell.render_terminal_query_progress(b"Done\x1b[31m red", false));
    assert!(fourth.contains("Done") && !fourth.contains("red"), "{fourth:?}");

    let cleared = shell.clear_terminal_query_progress();
    assert_eq!(cleared.status, ShellStatus::Ok);
    assert!(text(&cleared).contains(vt100::ERASE_ENTIRE_LINE));
    // Nothing to clear anymore
    assert!(shell.clear_terminal_query_progress().data.is_empty());
    let restarted = text(&shell.render_terminal_query_progress(b"", false));
    assert!(restarted.contains("Executing query"));
}

#[test]
fn query_progress_rejects_invalid_utf8() {
    let mut shell = new_shell(80);
    let output = shell.render_terminal_query_progress(b"\xff", false);
    assert_eq!(output.status, ShellStatus::InvalidArgument);
    assert_eq!(text(&output), "terminal query progress must contain valid UTF-8");
}

#[test]
fn query_progress_is_truncated_to_the_terminal_width() {
    let mut shell = new_shell(12);
    let output = text(&shell.render_terminal_query_progress(b"a very long progress message", false));
    assert!(!output.contains("progress message"), "{output:?}");
}

#[test]
fn finished_queries_print_output_and_a_fresh_prompt() {
    let mut shell = new_shell(80);
    shell.open_terminal(b"> ");
    consume(&mut shell, Key::Text, "select 1;");
    shell.render_terminal_query_progress(b"", false);
    let output = shell.finish_terminal_query(b"result", false);
    assert_eq!(output.status, ShellStatus::Ok);
    let rendered = text(&output);
    assert!(rendered.contains("result\r\n"), "{rendered:?}");
    assert!(!rendered.contains(vt100::FOREGROUND_RED));
    assert_eq!(shell.prompt().text(), "");

    let output = shell.finish_terminal_query(b"boom", true);
    let rendered = text(&output);
    assert!(rendered.contains(&format!("{}boom{}", vt100::FOREGROUND_RED, vt100::RESET_ATTRIBUTES)), "{rendered:?}");
}

#[test]
fn terminal_status_renders_a_message() {
    let mut shell = new_shell(80);
    shell.open_terminal(b"> ");
    let output = shell.render_terminal_status(b"connected");
    assert_eq!(output.status, ShellStatus::Ok);
    assert!(text(&output).contains("connected"));
}

#[test]
fn session_relations_can_be_toggled() {
    let mut shell = new_shell(80);
    shell.set_track_session_relations(true);
    // Enabling twice is a no-op
    shell.set_track_session_relations(true);
    shell.set_track_session_relations(false);
    shell.set_track_session_relations(false);
}

#[test]
fn keyword_case_applies_to_completions() {
    let mut shell = new_shell(80);
    shell.set_prompt(b"sel");
    let lower: Vec<_> = shell.complete_prompt(50).unwrap().into_iter().map(|c| c.completion_text).collect();
    shell.set_keyword_case(1);
    let upper: Vec<_> = shell.complete_prompt(50).unwrap().into_iter().map(|c| c.completion_text).collect();
    assert!(lower.iter().any(|c| c == "select"), "{lower:?}");
    assert!(upper.iter().any(|c| c == "SELECT"), "{upper:?}");
}
