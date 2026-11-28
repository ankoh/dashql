//! The shell session.

use super::arrow_renderer::ArrowRenderer;
use super::*;
use dashql_core::catalog::Catalog;
use dashql_core::script::Script;
use dashql_parser::symbol_kind::S_SEMICOLON;
use std::collections::VecDeque;

const HISTORY_LIMIT: usize = 1000;
/// The whitespace around a prompt
const WHITESPACE: &[char] = &[' ', '\t', '\r', '\n'];

/// The text of a record: line breaks as `\n`, without trailing line breaks
fn record_text(data: &[u8]) -> String {
    let text = String::from_utf8_lossy(data);
    text.replace("\r\n", "\n").replace('\r', "\n").trim_end_matches('\n').to_string()
}

/// The dot command of a prompt from its dot on, None if the prompt is no dot command
fn command_of(text: &str) -> Option<&str> {
    Some(text.trim_start_matches(WHITESPACE)).filter(|command| command.starts_with('.'))
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
    pub fn set_commands(&mut self, commands: &str) -> ShellStatus {
        let mut parsed = Vec::new();
        if !commands.is_empty() {
            for name in commands.strip_suffix('\n').unwrap_or(commands).split('\n') {
                let valid = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-';
                if name.is_empty() || !name.chars().all(valid) {
                    return ShellStatus::InvalidArgument;
                }
                parsed.push(name.to_string());
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
    pub fn prompt_info(&mut self, text: &str) -> PromptInfo {
        if text.trim_start_matches(WHITESPACE).is_empty() {
            return PromptInfo::default();
        }
        if let Some(command) = command_of(text) {
            return PromptInfo { is_command: true, is_complete: !command.contains(['\r', '\n']) };
        }
        PromptInfo { is_command: false, is_complete: self.is_complete_statement(text) }
    }

    /// Is the text a single statement that ends with a semicolon? Text that the local parser does not recognize but
    /// ends with a semicolon is complete as well, the remote grammar may accept it.
    fn is_complete_statement(&mut self, text: &str) -> bool {
        if !text.trim_end_matches(WHITESPACE).ends_with(';') {
            return false;
        }
        self.script.replace_text(text);
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
    pub fn complete_command(&self, text: &str) -> CommandCompletion {
        let unchanged = CommandCompletion { text: text.to_string(), candidates: Vec::new() };
        let Some(command) = command_of(text) else {
            return unchanged;
        };
        if command.contains(WHITESPACE) {
            return unchanged;
        }
        let typed = command.strip_prefix('.').unwrap_or(command);
        let matches: Vec<&String> = self.commands.iter().filter(|c| c.starts_with(typed)).collect();
        let Some((first, rest)) = matches.split_first() else {
            return unchanged;
        };
        let mut completed = text.strip_suffix(command).unwrap_or_default().to_string();
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
    pub fn history_previous(&mut self, current: &str) -> Option<String> {
        self.restart_history_if_edited(current);
        if self.history_cursor == 0 {
            return None;
        }
        if self.history_cursor == self.history.len() {
            self.history_draft = current.to_string();
        }
        self.history_cursor -= 1;
        self.history.get(self.history_cursor).cloned()
    }

    /// The next entry of the history for the prompt `current`, the draft after the newest entry, None if the prompt
    /// shows no entry
    pub fn history_next(&mut self, current: &str) -> Option<String> {
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

    fn restart_history_if_edited(&mut self, current: &str) {
        if self.history.get(self.history_cursor).is_some_and(|entry| entry != current) {
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
    pub fn submit(&mut self, prompt: &str) -> ShellOperation {
        if prompt.trim_start_matches(WHITESPACE).is_empty() {
            return ShellOperation::error(ShellStatus::InvalidArgument, "prompt must not be empty");
        }
        self.remember_prompt(prompt);
        if let Some(command) = command_of(prompt) {
            let command = command.trim_end_matches(WHITESPACE);
            return self.suspend_effect(EffectType::ExecuteCommand, command.as_bytes().to_vec());
        }
        match prompt.trim_end_matches(WHITESPACE).strip_suffix(';') {
            Some(query) => self.start_query(query),
            None => self.start_query(prompt),
        }
    }

    /// Start a query: returns the effect of the query
    pub fn start_query(&mut self, query: &str) -> ShellOperation {
        if query.is_empty() {
            return ShellOperation::error(ShellStatus::InvalidArgument, "query must not be empty");
        }
        self.suspend_effect(EffectType::ExecuteQuery, query.as_bytes().to_vec())
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
                        let mut records = vec![ShellRecord::new(ShellRecordKind::Table, record_text(table.as_bytes()))];
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
