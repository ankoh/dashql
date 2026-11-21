//! Transaction control within a script.
//!
//! ```sql
//! begin;
//! insert into items values (1);
//! savepoint checkpoint;
//! delete from items where id = 1;
//! rollback to savepoint checkpoint;
//! commit;
//! ```
//!
//! A transaction begins and ends in the same script. Scripts are the units that run on connections: the script between
//! a BEGIN in one script and its COMMIT in another may run on another connection, run in another order or not run at
//! all, and a run of one script would leave its transaction open. So a statement that ends a transaction needs a BEGIN
//! before it in its script, a BEGIN needs a statement that ends it, and a savepoint lives in the transaction of its
//! script. `COMMIT PREPARED` and `ROLLBACK PREPARED` finish a transaction that `PREPARE TRANSACTION` handed over, they
//! stand alone.
//!
//! A script with syntax errors is not checked, a statement that doesn't parse might be the one that begins or ends a
//! transaction. The blocks are still recorded, the planner orders their statements.

use super::state::AnalysisState;
use dashql_buffers::analyzer::{AnalyzerErrorSeverity, AnalyzerErrorType};
use dashql_buffers::parser::{AttributeKey as K, Node, NodeType, StatementType, TransactionCommand};
use dashql_parser::attrs;
use dashql_parser::names::NameId;

/// A transaction of a script, from the statement that begins it to the one that ends it
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TransactionBlock {
    /// The statement that begins the transaction
    pub begin: u32,
    /// The statement that ends it, None if the script doesn't end it
    pub end: Option<u32>,
}

impl TransactionBlock {
    /// Is a statement part of the transaction? A transaction that the script doesn't end lasts until its end.
    pub fn contains(&self, statement_id: u32) -> bool {
        statement_id >= self.begin && self.end.is_none_or(|end| statement_id <= end)
    }
}

/// What a transaction control statement does
enum Command {
    Begin,
    /// Ends the transaction, with the verb of the error without a transaction
    End(&'static str),
    Savepoint(Option<NameId>),
    /// RELEASE drops the savepoint and the later ones, ROLLBACK TO the later ones
    ToSavepoint {
        name: Option<NameId>,
        release: bool,
    },
    /// COMMIT PREPARED and ROLLBACK PREPARED
    Standalone,
}

/// Find the transactions of a script and flag the transaction control statements without counterpart
pub(super) fn analyze(state: &mut AnalysisState) {
    let parsed = state.parsed;
    let check = parsed.errors.is_empty();
    let mut errors: Vec<(u32, String)> = Vec::new();
    let mut blocks: Vec<TransactionBlock> = Vec::new();
    // The open transaction and its savepoints
    let mut open: Option<u32> = None;
    let mut savepoints: Vec<NameId> = Vec::new();
    for (statement_id, statement) in parsed.statements.iter().enumerate() {
        let statement_id = statement_id as u32;
        if statement.statement_type != StatementType::TRANSACTION {
            continue;
        }
        let Some(root) = parsed.nodes.get(statement.root as usize) else { continue };
        let Some(command) = read_command(state, root) else { continue };
        match command {
            Command::Begin => {
                if open.is_some() {
                    errors.push((statement.root, "a transaction is already open in this script".into()));
                } else {
                    open = Some(statement_id);
                    savepoints.clear();
                }
            }
            Command::End(verb) => match open.take() {
                Some(begin) => blocks.push(TransactionBlock { begin, end: Some(statement_id) }),
                None => errors.push((statement.root, format!("no transaction to {verb}, begin it in this script"))),
            },
            Command::Savepoint(name) => {
                if open.is_none() {
                    errors.push((statement.root, "no transaction for the savepoint, begin it in this script".into()));
                } else if let Some(name) = name {
                    savepoints.push(name);
                }
            }
            Command::ToSavepoint { name, release } => {
                if open.is_none() {
                    errors.push((statement.root, "no transaction for the savepoint, begin it in this script".into()));
                    continue;
                }
                let Some(name) = name else { continue };
                // The latest savepoint of the name counts
                match savepoints.iter().rposition(|&n| n == name) {
                    Some(i) => savepoints.truncate(if release { i } else { i + 1 }),
                    None => errors.push((
                        statement.root,
                        format!("no savepoint {} in this transaction", state.out.name_text(name)),
                    )),
                }
            }
            Command::Standalone => {}
        }
    }
    if let Some(begin) = open {
        blocks.push(TransactionBlock { begin, end: None });
        if let Some(statement) = parsed.statements.get(begin as usize) {
            errors.push((statement.root, "the transaction is not ended in this script, commit or roll it back".into()));
        }
    }
    state.out.transactions = blocks;
    if check {
        errors.sort_by_key(|(node, _)| *node);
        for (node, message) in errors {
            state.add_error(
                AnalyzerErrorType::UNMATCHED_TRANSACTION_CONTROL,
                AnalyzerErrorSeverity::ERROR,
                node,
                message,
            );
        }
    }
}

/// Read the command of a transaction control statement
fn read_command(state: &AnalysisState, root: &Node) -> Option<Command> {
    let parsed = state.parsed;
    let [command, target, prepared] = attrs!(
        parsed.children(root),
        [K::SQL_TRANSACTION_COMMAND, K::SQL_TRANSACTION_TARGET, K::SQL_TRANSACTION_PREPARED]
    );
    let command = command.filter(|c| c.node_type() == NodeType::ENUM_SQL_TRANSACTION_COMMAND)?;
    let command = TransactionCommand(u8::try_from(command.children_begin_or_value()).ok()?);
    let name = target.filter(|t| t.node_type() == NodeType::NAME).map(|t| t.children_begin_or_value());
    let prepared = prepared.is_some_and(|p| p.children_begin_or_value() != 0);
    Some(match (command, target.is_some(), prepared) {
        (TransactionCommand::PREPARE, _, _) => Command::End("prepare"),
        (_, _, true) => Command::Standalone,
        (TransactionCommand::BEGIN | TransactionCommand::START, _, _) => Command::Begin,
        (TransactionCommand::COMMIT | TransactionCommand::END, false, _) => Command::End("commit"),
        (TransactionCommand::ROLLBACK | TransactionCommand::ABORT, false, _) => Command::End("roll back"),
        (TransactionCommand::ROLLBACK, true, _) => Command::ToSavepoint { name, release: false },
        (TransactionCommand::RELEASE, _, _) => Command::ToSavepoint { name, release: true },
        (TransactionCommand::SAVEPOINT, _, _) => Command::Savepoint(name),
        _ => return None,
    })
}
