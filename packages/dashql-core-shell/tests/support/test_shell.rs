//! A shell session with its catalog, held like the wasm module holds them: the catalog is passed to every call
//! that reads or publishes catalog state, and dropping the shell detaches its session relations.

use dashql_core::catalog::Catalog;
use dashql_core_shell::{CompletionCandidate, EffectCompletionStatus, PromptInputKey, ShellOperation, ShellSession, TerminalOutput};
use std::cell::RefCell;
use std::rc::Rc;

/// The catalog shared by the shells and scripts of a test
pub type SharedCatalog = Rc<RefCell<Catalog>>;

/// A shell session with its catalog
pub struct TestShell {
    /// The catalog of the shell
    catalog: SharedCatalog,
    /// The shell session
    session: ShellSession,
}

#[allow(dead_code)]
impl TestShell {
    pub fn new(catalog: &SharedCatalog, terminal_columns: u32, auto_qualify_non_default_database_tables: bool) -> Self {
        let session = ShellSession::new(&catalog.borrow(), terminal_columns, auto_qualify_non_default_database_tables);
        Self { catalog: catalog.clone(), session }
    }

    pub fn catalog(&self) -> &SharedCatalog {
        &self.catalog
    }

    pub fn set_track_session_relations(&mut self, enabled: bool) {
        self.session.set_track_session_relations(enabled, &mut self.catalog.borrow_mut())
    }

    pub fn complete_prompt(&mut self, limit: usize) -> Result<Vec<CompletionCandidate>, String> {
        self.session.complete_prompt(limit, &self.catalog.borrow())
    }

    pub fn submit_prompt(&mut self) -> ShellOperation {
        self.session.submit_prompt(&self.catalog.borrow())
    }

    pub fn consume_terminal_input(&mut self, key: PromptInputKey, text: &[u8]) -> TerminalOutput {
        self.session.consume_terminal_input(key, text, &self.catalog.borrow())
    }

    pub fn start_query(&mut self, query: &[u8]) -> ShellOperation {
        self.session.start_query(query, &self.catalog.borrow())
    }

    pub fn complete_effect(&mut self, effect_id: u64, status: EffectCompletionStatus, data: &[u8]) -> ShellOperation {
        self.session.complete_effect(effect_id, status, data, &mut self.catalog.borrow_mut())
    }

    pub fn cancel_effect(&mut self, effect_id: u64) -> ShellOperation {
        self.session.cancel_effect(effect_id, &mut self.catalog.borrow_mut())
    }
}

impl std::ops::Deref for TestShell {
    type Target = ShellSession;

    fn deref(&self) -> &ShellSession {
        &self.session
    }
}

impl std::ops::DerefMut for TestShell {
    fn deref_mut(&mut self) -> &mut ShellSession {
        &mut self.session
    }
}

impl Drop for TestShell {
    fn drop(&mut self) {
        self.session.detach(&mut self.catalog.borrow_mut());
    }
}
