//! The wasm-bindgen API of the shell. It drives a `ShellSession` and checks the integer keys and completion
//! statuses at the boundary.
//!
//! A shell takes a `Catalog` of this module, so it can share the catalog of a connection with the scripts on it.
//! Nothing here reaches a database: a query leaves as an effect, and the host decides where it runs.
//!
//! Keys, completion statuses and statuses are the numbers of the TypeScript enums in
//! `packages/dashql-app/src/shell/api.ts` (`DashQLShellPromptInput`, `DashQLShellEffectCompletionStatus`,
//! `DashQLShellStatus`). Results carry the status instead of throwing, except `completePrompt`, which throws when
//! the completion fails.

use crate::{Catalog, SharedCatalog};
use dashql_core_shell::{
    CompletionCandidate, EffectCompletionStatus, PromptInputAction, PromptInputKey, PromptSnapshot, ShellOperation as CoreOperation,
    ShellSession, ShellStatus, TerminalCompletionList, TerminalOutput,
};
use wasm_bindgen::prelude::*;

/// A prompt after an input
#[wasm_bindgen]
pub struct ShellPromptResult {
    /// The core prompt snapshot
    inner: PromptSnapshot,
}

#[wasm_bindgen]
impl ShellPromptResult {
    /// The `DashQLShellStatus`
    #[wasm_bindgen(getter)]
    pub fn status(&self) -> u32 {
        self.inner.status as u32
    }

    /// The prompt revision, bumped by every edit
    #[wasm_bindgen(getter)]
    pub fn revision(&self) -> u64 {
        self.inner.revision
    }

    /// The UTF-8 byte offset of the cursor
    #[wasm_bindgen(getter, js_name = cursorByteOffset)]
    pub fn cursor_byte_offset(&self) -> u32 {
        self.inner.cursor_byte_offset
    }

    #[wasm_bindgen(getter)]
    pub fn text(&self) -> String {
        self.inner.text.clone()
    }

    /// The error message if the status is not OK
    #[wasm_bindgen(getter)]
    pub fn message(&self) -> String {
        self.inner.message.clone()
    }

    /// The `DashQLShellPromptAction`
    #[wasm_bindgen(getter)]
    pub fn action(&self) -> u32 {
        self.inner.action as u32
    }
}

/// Terminal output
#[wasm_bindgen]
pub struct ShellTerminalResult {
    /// The core terminal output
    inner: TerminalOutput,
}

#[wasm_bindgen]
impl ShellTerminalResult {
    /// The `DashQLShellStatus`
    #[wasm_bindgen(getter)]
    pub fn status(&self) -> u32 {
        self.inner.status as u32
    }

    /// The `DashQLShellPromptAction`
    #[wasm_bindgen(getter)]
    pub fn action(&self) -> u32 {
        self.inner.action as u32
    }

    /// The VT100 output, or the error message if the status is not OK
    #[wasm_bindgen(getter)]
    pub fn data(&self) -> String {
        String::from_utf8_lossy(&self.inner.data).into_owned()
    }
}

/// The result of an operation: rendered output, an effect or an error
#[wasm_bindgen]
pub struct ShellOperation {
    /// The core operation result
    inner: CoreOperation,
}

impl ShellOperation {
    fn effect_header(&self) -> Option<(u32, u64)> {
        if self.inner.status != dashql_core_shell::ShellStatus::Pending || self.inner.data.len() < 16 {
            return None;
        }
        let data = &self.inner.data;
        Some((u32::from_le_bytes(data[4..8].try_into().unwrap()), u64::from_le_bytes(data[8..16].try_into().unwrap())))
    }
}

#[wasm_bindgen]
impl ShellOperation {
    /// The `DashQLShellStatus`, `PENDING` if the operation waits for an effect
    #[wasm_bindgen(getter)]
    pub fn status(&self) -> u32 {
        self.inner.status as u32
    }

    /// The data as text (output or error message)
    #[wasm_bindgen(getter)]
    pub fn text(&self) -> String {
        String::from_utf8_lossy(&self.inner.data).into_owned()
    }

    /// The effect type of a pending operation (`DashQLShellEffectType`)
    #[wasm_bindgen(getter, js_name = effectType)]
    pub fn effect_type(&self) -> Option<u32> {
        self.effect_header().map(|(t, _)| t)
    }

    /// The effect id of a pending operation
    #[wasm_bindgen(getter, js_name = effectId)]
    pub fn effect_id(&self) -> Option<u64> {
        self.effect_header().map(|(_, id)| id)
    }

    /// The effect payload of a pending operation: the query or the dot command
    #[wasm_bindgen(getter, js_name = effectPayload)]
    pub fn effect_payload(&self) -> Option<String> {
        self.effect_header().map(|_| String::from_utf8_lossy(&self.inner.data[16..]).into_owned())
    }
}

/// A completion candidate
#[wasm_bindgen]
pub struct ShellCompletionCandidate {
    /// The core completion candidate
    inner: CompletionCandidate,
}

#[wasm_bindgen]
impl ShellCompletionCandidate {
    #[wasm_bindgen(getter, js_name = displayText)]
    pub fn display_text(&self) -> String {
        self.inner.display_text.clone()
    }

    #[wasm_bindgen(getter, js_name = completionText)]
    pub fn completion_text(&self) -> String {
        self.inner.completion_text.clone()
    }

    /// The UTF-8 byte offset of the replaced text
    #[wasm_bindgen(getter, js_name = targetOffset)]
    pub fn target_offset(&self) -> u32 {
        self.inner.target_offset
    }

    /// The UTF-8 byte length of the replaced text
    #[wasm_bindgen(getter, js_name = targetLength)]
    pub fn target_length(&self) -> u32 {
        self.inner.target_length
    }
}

/// The completion list that the host shows over the terminal
#[wasm_bindgen]
pub struct ShellCompletionList {
    /// The core completion list
    inner: TerminalCompletionList,
}

#[wasm_bindgen]
impl ShellCompletionList {
    /// Changes when the candidates change, `terminalCompletionBuffer` only has to be read then
    #[wasm_bindgen(getter)]
    pub fn revision(&self) -> u64 {
        self.inner.revision
    }

    /// The index of the selected candidate
    #[wasm_bindgen(getter)]
    pub fn selection(&self) -> u32 {
        self.inner.selection
    }

    /// The index of the selected catalog object of the selected candidate
    #[wasm_bindgen(getter)]
    pub fn variant(&self) -> u32 {
        self.inner.variant
    }

    /// The terminal column of the start of the replaced text
    #[wasm_bindgen(getter, js_name = anchorColumn)]
    pub fn anchor_column(&self) -> u32 {
        self.inner.anchor_column
    }
}

fn prompt(inner: PromptSnapshot) -> ShellPromptResult {
    ShellPromptResult { inner }
}

fn terminal(inner: TerminalOutput) -> ShellTerminalResult {
    ShellTerminalResult { inner }
}

fn operation(inner: CoreOperation) -> ShellOperation {
    ShellOperation { inner }
}

/// A prompt result for an input key that is not a `DashQLShellPromptInput`
fn invalid_prompt(message: &str) -> ShellPromptResult {
    prompt(PromptSnapshot {
        status: ShellStatus::InvalidArgument,
        revision: 0,
        cursor_byte_offset: 0,
        text: String::new(),
        message: message.to_string(),
        action: PromptInputAction::None,
    })
}

/// A terminal result for an input key that is not a `DashQLShellPromptInput`
fn invalid_terminal(message: &str) -> ShellTerminalResult {
    terminal(TerminalOutput {
        status: ShellStatus::InvalidArgument,
        action: PromptInputAction::None,
        data: message.as_bytes().to_vec(),
    })
}

/// A shell session on a catalog
#[wasm_bindgen]
pub struct Shell {
    /// The catalog of the shell
    catalog: SharedCatalog,
    /// The shell session
    inner: ShellSession,
}

#[wasm_bindgen]
impl Shell {
    /// Create a shell on a catalog for a terminal width
    #[wasm_bindgen(constructor)]
    pub fn new(catalog: &Catalog, terminal_columns: u32, auto_qualify_non_default_database_tables: bool) -> Shell {
        let shared = catalog.shared();
        let inner = ShellSession::new(&shared.borrow(), terminal_columns, auto_qualify_non_default_database_tables);
        Shell {
            catalog: shared,
            inner,
        }
    }

    pub fn resize(&mut self, terminal_columns: u32) {
        self.inner.resize(terminal_columns);
    }

    /// The color of the terminal prompt as 0xRRGGBB, bold in the default foreground color if undefined
    #[wasm_bindgen(js_name = setTerminalPromptColor)]
    pub fn set_terminal_prompt_color(&mut self, rgb: Option<u32>) {
        self.inner.set_terminal_prompt_color(rgb.map(|rgb| [(rgb >> 16) as u8, (rgb >> 8) as u8, rgb as u8]));
    }

    /// The `KeywordCase` of completions (1 is upper case)
    #[wasm_bindgen(js_name = setKeywordCase)]
    pub fn set_keyword_case(&mut self, keyword_case: u32) {
        self.inner.set_keyword_case(keyword_case);
    }

    /// Register dot commands, one name per line, returns the status
    #[wasm_bindgen(js_name = setCommands)]
    pub fn set_commands(&mut self, commands: &str) -> u32 {
        self.inner.set_commands(commands.as_bytes()) as u32
    }

    #[wasm_bindgen(js_name = setPrompt)]
    pub fn set_prompt(&mut self, text: &str) -> ShellPromptResult {
        prompt(self.inner.set_prompt(text.as_bytes()))
    }

    #[wasm_bindgen(js_name = insertPrompt)]
    pub fn insert_prompt(&mut self, text: &str) -> ShellPromptResult {
        prompt(self.inner.insert_prompt(text.as_bytes()))
    }

    #[wasm_bindgen(js_name = movePromptLeft)]
    pub fn move_prompt_left(&mut self) -> ShellPromptResult {
        prompt(self.inner.move_prompt_left())
    }

    #[wasm_bindgen(js_name = movePromptRight)]
    pub fn move_prompt_right(&mut self) -> ShellPromptResult {
        prompt(self.inner.move_prompt_right())
    }

    #[wasm_bindgen(js_name = deletePromptBackward)]
    pub fn delete_prompt_backward(&mut self) -> ShellPromptResult {
        prompt(self.inner.delete_prompt_backward())
    }

    #[wasm_bindgen(js_name = deletePromptForward)]
    pub fn delete_prompt_forward(&mut self) -> ShellPromptResult {
        prompt(self.inner.delete_prompt_forward())
    }

    /// Complete at the cursor, throws if the completion fails
    #[wasm_bindgen(js_name = completePrompt)]
    pub fn complete_prompt(&mut self, limit: usize) -> Result<Vec<ShellCompletionCandidate>, JsError> {
        match self.inner.complete_prompt(limit, &self.catalog.borrow()) {
            Ok(candidates) => Ok(candidates.into_iter().map(|inner| ShellCompletionCandidate { inner }).collect()),
            Err(_) => Err(JsError::new("failed to complete shell prompt")),
        }
    }

    #[wasm_bindgen(js_name = applyCompletion)]
    pub fn apply_completion(&mut self, display_text: &str, completion_text: &str, target_offset: u32, target_length: u32) -> ShellPromptResult {
        prompt(self.inner.apply_completion_bytes(display_text.as_bytes(), completion_text.as_bytes(), target_offset, target_length))
    }

    /// Consume a `DashQLShellPromptInput` with its text
    #[wasm_bindgen(js_name = consumePromptInput)]
    pub fn consume_prompt_input(&mut self, key: u32, text: &str) -> ShellPromptResult {
        match PromptInputKey::from_u32(key) {
            Some(key) => prompt(self.inner.consume_prompt_input(key, text.as_bytes())),
            None => invalid_prompt("invalid prompt input"),
        }
    }

    #[wasm_bindgen(js_name = submitPrompt)]
    pub fn submit_prompt(&mut self) -> ShellOperation {
        operation(self.inner.submit_prompt(&self.catalog.borrow()))
    }

    #[wasm_bindgen(js_name = openTerminal)]
    pub fn open_terminal(&mut self, prompt: &str) -> ShellTerminalResult {
        terminal(self.inner.open_terminal(prompt.as_bytes()))
    }

    /// Consume a `DashQLShellPromptInput` with its text
    #[wasm_bindgen(js_name = consumeTerminalInput)]
    pub fn consume_terminal_input(&mut self, key: u32, text: &str) -> ShellTerminalResult {
        match PromptInputKey::from_u32(key) {
            Some(key) => terminal(self.inner.consume_terminal_input(key, text.as_bytes(), &self.catalog.borrow())),
            None => invalid_terminal("invalid terminal input"),
        }
    }

    /// The completion list that the host shows over the terminal, undefined if there is none
    #[wasm_bindgen(js_name = terminalCompletionList)]
    pub fn terminal_completion_list(&self) -> Option<ShellCompletionList> {
        self.inner.terminal_completion_list().map(|inner| ShellCompletionList { inner })
    }

    /// The packed `Completion` of the completion list, undefined if there is none
    #[wasm_bindgen(js_name = terminalCompletionBuffer)]
    pub fn terminal_completion_buffer(&self) -> Option<Vec<u8>> {
        let completion = self.inner.terminal_completion_buffer()?;
        let mut builder = flatbuffers::FlatBufferBuilder::new();
        let packed = completion.pack(&mut builder);
        builder.finish(packed, None);
        Some(builder.finished_data().to_vec())
    }

    #[wasm_bindgen(js_name = finishTerminalQuery)]
    pub fn finish_terminal_query(&mut self, output: &str, error: bool) -> ShellTerminalResult {
        terminal(self.inner.finish_terminal_query(output.as_bytes(), error))
    }

    #[wasm_bindgen(js_name = renderTerminalQueryProgress)]
    pub fn render_terminal_query_progress(&mut self, message: &str, advance_frame: bool) -> ShellTerminalResult {
        terminal(self.inner.render_terminal_query_progress(message.as_bytes(), advance_frame))
    }

    #[wasm_bindgen(js_name = clearTerminalQueryProgress)]
    pub fn clear_terminal_query_progress(&mut self) -> ShellTerminalResult {
        terminal(self.inner.clear_terminal_query_progress())
    }

    #[wasm_bindgen(js_name = renderTerminalStatus)]
    pub fn render_terminal_status(&mut self, message: &str) -> ShellTerminalResult {
        terminal(self.inner.render_terminal_status(message.as_bytes()))
    }

    /// The history as length-prefixed (u32 little-endian) UTF-8 entries
    #[wasm_bindgen(js_name = exportHistory)]
    pub fn export_history(&self) -> Vec<u8> {
        self.inner.export_history()
    }

    /// Replace the history with exported entries, returns the status
    #[wasm_bindgen(js_name = importHistory)]
    pub fn import_history(&mut self, data: &[u8]) -> u32 {
        self.inner.import_history(data) as u32
    }

    #[wasm_bindgen(js_name = startQuery)]
    pub fn start_query(&mut self, query: &str) -> ShellOperation {
        operation(self.inner.start_query(query.as_bytes(), &self.catalog.borrow()))
    }

    /// Finish an effect with a `DashQLShellEffectCompletionStatus` and its data (Arrow IPC for queries, a flag
    /// byte and the output for dot commands, the message for errors)
    #[wasm_bindgen(js_name = completeEffect)]
    pub fn complete_effect(&mut self, effect_id: u64, completion_status: u32, data: &[u8]) -> ShellOperation {
        match EffectCompletionStatus::from_u32(completion_status) {
            Some(status) => operation(self.inner.complete_effect(effect_id, status, data)),
            None => operation(CoreOperation::new(ShellStatus::InvalidArgument, "invalid effect completion")),
        }
    }

    #[wasm_bindgen(js_name = cancelEffect)]
    pub fn cancel_effect(&mut self, effect_id: u64) -> ShellOperation {
        operation(self.inner.cancel_effect(effect_id))
    }
}
