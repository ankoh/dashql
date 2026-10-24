//! A shell with its catalog, held like the wasm module holds them: the catalog is passed to every call
//! that reads or publishes catalog state, and dropping the shell detaches its session relations.

use dashql_core::catalog::Catalog;
use dashql_core_shell::{CompletionCandidate, Shell, ShellOperation, ShellStatus, TerminalOutput};
use std::cell::RefCell;
use std::rc::Rc;

/// The catalog shared by the shells and scripts of a test
pub type SharedCatalog = Rc<RefCell<Catalog>>;

/// A shell with its catalog
pub struct TestShell {
    /// The catalog of the shell
    catalog: SharedCatalog,
    /// The shell
    shell: Shell,
}

#[allow(dead_code)]
impl TestShell {
    pub fn new(catalog: &SharedCatalog, terminal_columns: u32, auto_qualify_non_default_database_tables: bool) -> Self {
        let shell = Shell::new(&catalog.borrow(), terminal_columns, auto_qualify_non_default_database_tables);
        Self { catalog: catalog.clone(), shell }
    }

    pub fn catalog(&self) -> &SharedCatalog {
        &self.catalog
    }

    pub fn set_session_relations(&mut self, enabled: bool) -> ShellStatus {
        self.shell.set_session_relations(&mut self.catalog.borrow_mut(), enabled)
    }

    pub fn prompt_complete(&mut self, limit: usize) -> Result<Vec<CompletionCandidate>, ShellStatus> {
        self.shell.prompt_complete(&self.catalog.borrow(), limit)
    }

    pub fn prompt_submit(&mut self) -> ShellOperation {
        self.shell.prompt_submit(&self.catalog.borrow())
    }

    pub fn terminal_consume(&mut self, key: u32, text: &[u8]) -> TerminalOutput {
        self.shell.terminal_consume(&self.catalog.borrow(), key, text)
    }

    pub fn start_query(&mut self, query: &[u8]) -> ShellOperation {
        self.shell.start_query(&self.catalog.borrow(), query)
    }

    pub fn complete_effect(&mut self, effect_id: u64, completion_status: u32, data: &[u8]) -> ShellOperation {
        self.shell.complete_effect(&mut self.catalog.borrow_mut(), effect_id, completion_status, data)
    }

    pub fn cancel_effect(&mut self, effect_id: u64) -> ShellOperation {
        self.shell.cancel_effect(&mut self.catalog.borrow_mut(), effect_id)
    }
}

impl std::ops::Deref for TestShell {
    type Target = Shell;

    fn deref(&self) -> &Shell {
        &self.shell
    }
}

impl std::ops::DerefMut for TestShell {
    fn deref_mut(&mut self) -> &mut Shell {
        &mut self.shell
    }
}

impl Drop for TestShell {
    fn drop(&mut self) {
        self.shell.detach(&mut self.catalog.borrow_mut());
    }
}
