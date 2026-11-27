//! The shell session.

use super::arrow_renderer::ArrowRenderer;
use super::unicode::is_valid;
use super::*;
use dashql_core::catalog::Catalog;
use dashql_core::script::Script;
use dashql_parser::symbol_kind::S_SEMICOLON;
use std::collections::VecDeque;

const HISTORY_LIMIT: usize = 1000;
const WHITESPACE: &[u8] = b" \t\r\n";

/// The bytes between two offsets, empty if the range is out of bounds
fn byte_range(text: &[u8], begin: usize, end: usize) -> &[u8] {
    text.get(begin..end).unwrap_or(&[])
}

/// The bytes before an offset, all of them if the offset is past the end
fn bytes_before(text: &[u8], end: usize) -> &[u8] {
    text.get(..end).unwrap_or(text)
}

/// The bytes from an offset on, none if the offset is past the end
fn bytes_from(text: &[u8], begin: usize) -> &[u8] {
    text.get(begin..).unwrap_or(&[])
}

/// The first byte that is not in a set
fn find_first_not_of(text: &[u8], set: &[u8]) -> Option<usize> {
    text.iter().position(|c| !set.contains(c))
}

/// The last byte that is not in a set
fn find_last_not_of(text: &[u8], set: &[u8]) -> Option<usize> {
    text.iter().rposition(|c| !set.contains(c))
}

/// The first byte at or after an offset that is in a set
fn find_first_of(text: &[u8], set: &[u8], from: usize) -> Option<usize> {
    text.get(from..)?.iter().position(|c| set.contains(c)).map(|i| i + from)
}

/// The text of a record: line breaks as `\n`, without trailing line breaks
fn record_text(data: &[u8]) -> String {
    let text = String::from_utf8_lossy(data);
    text.replace("\r\n", "\n").replace('\r', "\n").trim_end_matches('\n').to_string()
}

/// The begin of the dot command of a prompt, None if the prompt is no dot command
fn command_begin(text: &[u8]) -> Option<usize> {
    let begin = find_first_not_of(text, WHITESPACE)?;
    (text.get(begin) == Some(&b'.')).then_some(begin)
}

/// The completion of the name of a dot command
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CommandCompletion {
    /// The prompt with the completed name, the prompt itself if nothing was completed
    pub text: String,
    /// The commands whose names start with the typed name, with their dots, if more than one does
    pub candidates: Vec<String>,
}

/// A suspended operation that waits for the host
#[derive(Clone, Debug)]
struct PendingEffect {
    /// The effect id that the host passes back on completion
    id: u64,
    /// The kind of the effect
    effect_type: EffectType,
}

/// A shell session
///
/// Queries and dot commands suspend once on their effect and finish when it completes. They are
/// pending effects: starting one returns its effect, completing it yields the records of its output. One effect is
/// pending at a time.
pub struct ShellSession {
    /// The script that parses prompts for the check whether they are complete
    script: Script,
    /// The width of the tables of results in characters
    columns: u32,
    /// The submitted prompts, oldest first
    history: VecDeque<String>,
    /// The history entry shown in the prompt, the history length when not browsing
    history_cursor: usize,
    /// The prompt text before browsing the history
    history_draft: String,
    /// The id of the next effect
    next_effect_id: u64,
    /// The effect that waits for the host
    pending_effect: Option<PendingEffect>,
    /// The names of the dot commands
    commands: Vec<String>,
}

impl ShellSession {
    pub fn new(catalog: &Catalog, columns: u32) -> Self {
        Self {
            script: Script::new(catalog),
            columns: columns.max(1),
            history: VecDeque::new(),
            history_cursor: 0,
            history_draft: String::new(),
            next_effect_id: 1,
            pending_effect: None,
            commands: Vec::new(),
        }
    }

    /// The width of the tables of results in characters
    pub fn columns(&self) -> u32 {
        self.columns
    }

    pub fn resize(&mut self, columns: u32) {
        self.columns = columns.max(1);
    }

    /// Register the dot commands, one name per line
    pub fn set_commands(&mut self, commands: &[u8]) -> ShellStatus {
        if !is_valid(commands) {
            return ShellStatus::InvalidArgument;
        }
        let mut parsed = Vec::new();
        let mut begin = 0;
        while begin < commands.len() {
            let end = find_first_of(commands, b"\n", begin);
            let name = byte_range(commands, begin, end.unwrap_or(commands.len()));
            if name.is_empty()
                || name.first() == Some(&b'.')
                || !name.iter().all(|&c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-')
            {
                return ShellStatus::InvalidArgument;
            }
            // The name is ASCII, the conversion does not fail
            let Ok(name) = std::str::from_utf8(name) else {
                return ShellStatus::InvalidArgument;
            };
            parsed.push(name.to_string());
            match end {
                Some(end) => begin = end + 1,
                None => break,
            }
        }
        self.commands = parsed;
        ShellStatus::Ok
    }

    /// The names of the dot commands
    pub fn commands(&self) -> &[String] {
        &self.commands
    }

    /// What a prompt is: a dot command, and whether Enter submits it
    pub fn prompt_info(&mut self, text: &[u8]) -> PromptInfo {
        let Some(begin) = find_first_not_of(text, WHITESPACE) else {
            return PromptInfo::default();
        };
        if text.get(begin) == Some(&b'.') {
            return PromptInfo { is_command: true, is_complete: find_first_of(text, b"\r\n", begin).is_none() };
        }
        PromptInfo { is_command: false, is_complete: self.is_complete_statement(text) }
    }

    /// Is the text a single statement that ends with a semicolon? Text that the local parser does not recognize but
    /// ends with a semicolon is complete as well, the remote grammar may accept it.
    fn is_complete_statement(&mut self, text: &[u8]) -> bool {
        let Ok(utf8) = std::str::from_utf8(text) else {
            return false;
        };
        if find_last_not_of(text, WHITESPACE).is_none_or(|end| text.get(end) != Some(&b';')) {
            return false;
        }
        self.script.replace_text(utf8);
        self.script.parse();
        let Some(parsed) = self.script.parsed.as_ref() else {
            return false;
        };
        let symbols = &parsed.scanned.symbols;
        // The last symbol is the end of the input, the one before it the semicolon
        if symbols.iter().rev().nth(1).is_none_or(|symbol| symbol.kind != S_SEMICOLON) {
            return false;
        }
        if !parsed.errors.is_empty() || !parsed.scanned.errors.is_empty() {
            return true;
        }
        parsed.statements.len() == 1
    }

    /// Complete the name of the dot command of a prompt that holds only the name. A single match is completed with a
    /// space after it, several are completed to their common prefix and listed.
    pub fn complete_command(&self, text: &[u8]) -> CommandCompletion {
        let unchanged = CommandCompletion { text: String::from_utf8_lossy(text).into_owned(), candidates: Vec::new() };
        let Some(begin) = command_begin(text) else {
            return unchanged;
        };
        if find_first_of(text, WHITESPACE, begin).is_some() {
            return unchanged;
        }
        let typed = bytes_from(text, begin + 1);
        let matches: Vec<&String> = self.commands.iter().filter(|c| c.as_bytes().starts_with(typed)).collect();
        let Some((first, rest)) = matches.split_first() else {
            return unchanged;
        };
        let mut completed = String::from_utf8_lossy(bytes_before(text, begin)).into_owned();
        completed.push('.');
        if rest.is_empty() {
            completed.push_str(first);
            completed.push(' ');
            return CommandCompletion { text: completed, candidates: Vec::new() };
        }
        // The names are ASCII, every byte offset is a character boundary
        let mut common = first.len();
        for name in rest {
            common = common.min(first.bytes().zip(name.bytes()).take_while(|(a, b)| a == b).count());
        }
        completed.push_str(first.get(..common).unwrap_or(""));
        CommandCompletion { text: completed, candidates: matches.iter().map(|name| format!(".{name}")).collect() }
    }

    /// The previous entry of the history for the prompt `current`, None at the oldest entry. A prompt that differs
    /// from the entry it showed was edited: browsing starts again from the newest entry with it as the draft.
    pub fn history_previous(&mut self, current: &[u8]) -> Option<String> {
        self.restart_history_if_edited(current);
        if self.history_cursor == 0 {
            return None;
        }
        if self.history_cursor == self.history.len() {
            self.history_draft = String::from_utf8_lossy(current).into_owned();
        }
        self.history_cursor -= 1;
        self.history.get(self.history_cursor).cloned()
    }

    /// The next entry of the history for the prompt `current`, the draft after the newest entry, None if the prompt
    /// shows no entry
    pub fn history_next(&mut self, current: &[u8]) -> Option<String> {
        self.restart_history_if_edited(current);
        if self.history_cursor >= self.history.len() {
            return None;
        }
        self.history_cursor += 1;
        match self.history.get(self.history_cursor) {
            Some(entry) => Some(entry.clone()),
            None => Some(std::mem::take(&mut self.history_draft)),
        }
    }

    fn restart_history_if_edited(&mut self, current: &[u8]) {
        if self.history.get(self.history_cursor).is_some_and(|entry| entry.as_bytes() != current) {
            self.reset_history_cursor();
        }
    }

    fn reset_history_cursor(&mut self) {
        self.history_cursor = self.history.len();
        self.history_draft.clear();
    }

    fn remember_prompt(&mut self, prompt: &str) {
        if self.history.back().is_none_or(|last| last != prompt) {
            self.history.push_back(prompt.to_string());
        }
        while self.history.len() > HISTORY_LIMIT {
            self.history.pop_front();
        }
        self.reset_history_cursor();
    }

    /// The history as length-prefixed (u32 little-endian) entries
    pub fn export_history(&self) -> Vec<u8> {
        let mut output = Vec::new();
        for entry in &self.history {
            output.extend_from_slice(&(entry.len() as u32).to_le_bytes());
            output.extend_from_slice(entry.as_bytes());
        }
        output
    }

    /// Replace the history with exported entries
    pub fn import_history(&mut self, data: &[u8]) -> ShellStatus {
        let mut history = VecDeque::new();
        let mut offset = 0;
        while offset < data.len() {
            let Some(&[b0, b1, b2, b3]) = data.get(offset..offset + 4) else {
                return ShellStatus::InvalidArgument;
            };
            let size = u32::from_le_bytes([b0, b1, b2, b3]) as usize;
            offset += 4;
            if size > data.len() - offset {
                return ShellStatus::InvalidArgument;
            }
            let Some(Ok(entry)) = data.get(offset..offset + size).map(std::str::from_utf8) else {
                return ShellStatus::InvalidArgument;
            };
            history.push_back(entry.to_string());
            offset += size;
        }
        while history.len() > HISTORY_LIMIT {
            history.pop_front();
        }
        self.history = history;
        self.reset_history_cursor();
        ShellStatus::Ok
    }

    /// Execute a prompt as a dot command or a query, the history remembers it
    pub fn submit(&mut self, prompt: &[u8]) -> ShellOperation {
        let Ok(text) = std::str::from_utf8(prompt) else {
            return ShellOperation::error(ShellStatus::InvalidArgument, "prompt must contain valid UTF-8");
        };
        if find_first_not_of(prompt, WHITESPACE).is_none() {
            return ShellOperation::error(ShellStatus::InvalidArgument, "prompt must not be empty");
        }
        self.remember_prompt(text);
        if let Some(begin) = command_begin(prompt) {
            let end = find_last_not_of(prompt, WHITESPACE).map_or(prompt.len(), |end| end + 1);
            return self.suspend_effect(EffectType::ExecuteCommand, byte_range(prompt, begin, end).to_vec());
        }
        if let Some(query_end) = find_last_not_of(prompt, WHITESPACE) {
            if prompt.get(query_end) == Some(&b';') {
                return self.start_query(bytes_before(prompt, query_end));
            }
        }
        self.start_query(prompt)
    }

    /// Start a query: returns the effect of the query
    pub fn start_query(&mut self, query: &[u8]) -> ShellOperation {
        if query.is_empty() {
            return ShellOperation::error(ShellStatus::InvalidArgument, "query must not be empty");
        }
        if !is_valid(query) {
            return ShellOperation::error(ShellStatus::InvalidArgument, "query must contain valid UTF-8");
        }
        self.suspend_effect(EffectType::ExecuteQuery, query.to_vec())
    }

    /// Suspend an operation on an effect, unless another effect is pending
    fn suspend_effect(&mut self, effect_type: EffectType, payload: Vec<u8>) -> ShellOperation {
        if self.pending_effect.is_some() {
            return ShellOperation::error(ShellStatus::Busy, "the shell already has an active operation");
        }
        let id = self.next_effect_id;
        self.next_effect_id += 1;
        self.pending_effect = Some(PendingEffect { id, effect_type });
        ShellOperation::pending(ShellEffect { effect_type, id, payload })
    }

    /// Resume the operation of an effect with its result. The data of a query is a `QueryResultTag` with its
    /// payload, of a command a flag byte (1 clears the records before) and the output, of an error the message.
    pub fn complete_effect(&mut self, effect_id: u64, status: EffectCompletionStatus, data: &[u8]) -> ShellOperation {
        let Some(effect) = self.pending_effect.take_if(|e| e.id == effect_id) else {
            return ShellOperation::error(ShellStatus::StaleEffect, "effect is no longer pending");
        };
        match (effect.effect_type, status) {
            (EffectType::ExecuteQuery, EffectCompletionStatus::Success) => self.query_records(data),
            (EffectType::ExecuteCommand, EffectCompletionStatus::Success) => {
                let Some((&flags, output)) = data.split_first() else {
                    return ShellOperation::error(ShellStatus::InternalError, "invalid shell command result");
                };
                let mut records = Vec::new();
                if (flags & 1) != 0 {
                    records.push(ShellRecord::new(ShellRecordKind::Clear, ""));
                }
                let text = record_text(output);
                if !text.is_empty() {
                    records.push(ShellRecord::new(ShellRecordKind::Text, text));
                }
                ShellOperation::ok(records)
            }
            (_, EffectCompletionStatus::Error) => {
                let message = record_text(data);
                let message = if message.is_empty() { "query failed".to_string() } else { message };
                ShellOperation::ok(vec![ShellRecord::new(ShellRecordKind::Error, message)])
            }
            (_, EffectCompletionStatus::Cancelled) => {
                ShellOperation::ok(vec![ShellRecord::new(ShellRecordKind::Status, "Cancelled")])
            }
        }
    }

    /// The records of a query: its status line, or a table of the first rows of its result and the status line below
    /// it. See `QueryResultTag` for the layout of the data.
    fn query_records(&self, data: &[u8]) -> ShellOperation {
        let Some((&tag, rest)) = data.split_first() else {
            return ShellOperation::error(ShellStatus::InternalError, "invalid query result");
        };
        match tag {
            t if t == QueryResultTag::Status as u8 => {
                ShellOperation::ok(vec![ShellRecord::new(ShellRecordKind::Status, record_text(rest))])
            }
            t if t == QueryResultTag::Preview as u8 => {
                let Some((length, rest)) = rest.split_first_chunk::<4>() else {
                    return ShellOperation::error(ShellStatus::InternalError, "invalid query result preview");
                };
                let Some((status, rows)) = rest.split_at_checked(u32::from_le_bytes(*length) as usize) else {
                    return ShellOperation::error(ShellStatus::InternalError, "invalid query result preview");
                };
                match ArrowRenderer::new(self.columns).render_ipc(rows) {
                    Ok(table) => {
                        let mut records = vec![ShellRecord::new(ShellRecordKind::Table, record_text(&table))];
                        let status = record_text(status);
                        if !status.is_empty() {
                            records.push(ShellRecord::new(ShellRecordKind::Status, status));
                        }
                        ShellOperation::ok(records)
                    }
                    Err(message) => ShellOperation::error(ShellStatus::InternalError, message),
                }
            }
            _ => ShellOperation::error(ShellStatus::InternalError, "invalid query result"),
        }
    }

    /// Cancel an effect
    pub fn cancel_effect(&mut self, effect_id: u64) -> ShellOperation {
        self.complete_effect(effect_id, EffectCompletionStatus::Cancelled, &[])
    }
}
