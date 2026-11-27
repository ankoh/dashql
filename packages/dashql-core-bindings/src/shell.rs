//! The wasm-bindgen API of the shell. It drives a `ShellSession` and checks the completion statuses at the boundary.
//!
//! A shell takes a `Catalog` of this module, it parses its prompts with a script on it. Nothing here reaches a
//! database: a query leaves as an effect, and the host decides where it runs.
//!
//! Completion statuses, statuses and record kinds are the numbers of the TypeScript enums in
//! `packages/dashql-app/src/shell/terminal/api.ts` (`DashQLShellEffectCompletionStatus`, `DashQLShellStatus`,
//! `DashQLShellRecordKind`). Results carry the status instead of throwing.

use crate::Catalog;
use dashql_core_shell::{
    CommandCompletion, EffectCompletionStatus, PromptInfo, ShellOperation as CoreOperation, ShellSession, ShellStatus,
};
use wasm_bindgen::prelude::*;

/// What a prompt is
#[wasm_bindgen]
pub struct ShellPromptInfo {
    /// The core prompt info
    inner: PromptInfo,
}

#[wasm_bindgen]
impl ShellPromptInfo {
    /// Is the prompt a dot command?
    #[wasm_bindgen(getter, js_name = isCommand)]
    pub fn is_command(&self) -> bool {
        self.inner.is_command
    }

    /// Does Enter submit the prompt?
    #[wasm_bindgen(getter, js_name = isComplete)]
    pub fn is_complete(&self) -> bool {
        self.inner.is_complete
    }
}

/// The completion of the name of a dot command
#[wasm_bindgen]
pub struct ShellCommandCompletion {
    /// The core completion
    inner: CommandCompletion,
}

#[wasm_bindgen]
impl ShellCommandCompletion {
    /// The prompt with the completed name
    #[wasm_bindgen(getter)]
    pub fn text(&self) -> String {
        self.inner.text.clone()
    }

    /// The matching commands with their dots, if more than one matches
    #[wasm_bindgen(getter)]
    pub fn candidates(&self) -> Vec<String> {
        self.inner.candidates.clone()
    }
}

/// The result of an operation: the records of its output, an effect or an error
#[wasm_bindgen]
pub struct ShellOperation {
    /// The core operation result
    inner: CoreOperation,
}

#[wasm_bindgen]
impl ShellOperation {
    /// The `DashQLShellStatus`, `PENDING` if the operation waits for an effect
    #[wasm_bindgen(getter)]
    pub fn status(&self) -> u32 {
        self.inner.status as u32
    }

    /// The error message if the status is neither OK nor pending
    #[wasm_bindgen(getter)]
    pub fn message(&self) -> String {
        self.inner.message.clone()
    }

    /// The `DashQLShellRecordKind` of every record of the output
    #[wasm_bindgen(getter, js_name = recordKinds)]
    pub fn record_kinds(&self) -> Vec<u32> {
        self.inner.records.iter().map(|record| record.kind as u32).collect()
    }

    /// The text of every record of the output
    #[wasm_bindgen(getter, js_name = recordTexts)]
    pub fn record_texts(&self) -> Vec<String> {
        self.inner.records.iter().map(|record| record.text.clone()).collect()
    }

    /// The effect type of a pending operation (`DashQLShellEffectType`)
    #[wasm_bindgen(getter, js_name = effectType)]
    pub fn effect_type(&self) -> Option<u32> {
        self.inner.effect.as_ref().map(|e| e.effect_type as u32)
    }

    /// The effect id of a pending operation
    #[wasm_bindgen(getter, js_name = effectId)]
    pub fn effect_id(&self) -> Option<u64> {
        self.inner.effect.as_ref().map(|e| e.id)
    }

    /// The effect payload of a pending operation: the query or the dot command
    #[wasm_bindgen(getter, js_name = effectPayload)]
    pub fn effect_payload(&self) -> Option<String> {
        self.inner.effect.as_ref().map(|e| String::from_utf8_lossy(&e.payload).into_owned())
    }
}

fn operation(inner: CoreOperation) -> ShellOperation {
    ShellOperation { inner }
}

/// A shell session on a catalog
#[wasm_bindgen]
pub struct Shell {
    /// The shell session
    inner: ShellSession,
}

#[wasm_bindgen]
impl Shell {
    /// Create a shell on a catalog, its tables of results are `columns` characters wide
    #[wasm_bindgen(constructor)]
    pub fn new(catalog: &Catalog, columns: u32) -> Shell {
        let shared = catalog.shared();
        let inner = ShellSession::new(&shared.borrow(), columns);
        Shell { inner }
    }

    /// The width of the tables of results in characters
    pub fn resize(&mut self, columns: u32) {
        self.inner.resize(columns);
    }

    /// Register dot commands, one name per line, returns the status
    #[wasm_bindgen(js_name = setCommands)]
    pub fn set_commands(&mut self, commands: &str) -> u32 {
        self.inner.set_commands(commands.as_bytes()) as u32
    }

    /// What a prompt is: a dot command, and whether Enter submits it
    #[wasm_bindgen(js_name = promptInfo)]
    pub fn prompt_info(&mut self, text: &str) -> ShellPromptInfo {
        ShellPromptInfo { inner: self.inner.prompt_info(text.as_bytes()) }
    }

    /// Complete the name of the dot command of a prompt
    #[wasm_bindgen(js_name = completeCommand)]
    pub fn complete_command(&self, text: &str) -> ShellCommandCompletion {
        ShellCommandCompletion { inner: self.inner.complete_command(text.as_bytes()) }
    }

    /// The previous entry of the history for the prompt, undefined at the oldest entry
    #[wasm_bindgen(js_name = historyPrevious)]
    pub fn history_previous(&mut self, text: &str) -> Option<String> {
        self.inner.history_previous(text.as_bytes())
    }

    /// The next entry of the history for the prompt, the draft after the newest one, undefined if the prompt shows no
    /// entry
    #[wasm_bindgen(js_name = historyNext)]
    pub fn history_next(&mut self, text: &str) -> Option<String> {
        self.inner.history_next(text.as_bytes())
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

    /// Execute a prompt as a dot command or a query
    pub fn submit(&mut self, prompt: &str) -> ShellOperation {
        operation(self.inner.submit(prompt.as_bytes()))
    }

    #[wasm_bindgen(js_name = startQuery)]
    pub fn start_query(&mut self, query: &str) -> ShellOperation {
        operation(self.inner.start_query(query.as_bytes()))
    }

    /// Finish an effect with a `DashQLShellEffectCompletionStatus` and its data (for queries a `QueryResultTag` and a
    /// status line or a preview of the result, a flag byte and the output for dot commands, the message for errors)
    #[wasm_bindgen(js_name = completeEffect)]
    pub fn complete_effect(&mut self, effect_id: u64, completion_status: u32, data: &[u8]) -> ShellOperation {
        match EffectCompletionStatus::from_u32(completion_status) {
            Some(status) => operation(self.inner.complete_effect(effect_id, status, data)),
            None => operation(CoreOperation::error(ShellStatus::InvalidArgument, "invalid effect completion")),
        }
    }

    #[wasm_bindgen(js_name = cancelEffect)]
    pub fn cancel_effect(&mut self, effect_id: u64) -> ShellOperation {
        operation(self.inner.cancel_effect(effect_id))
    }
}
