//! Transaction control: BEGIN, START TRANSACTION, COMMIT, ROLLBACK, their aliases, savepoints and prepared
//! transactions.
//!
//! The optional `WORK` and `TRANSACTION` after a command and the optional `SAVEPOINT` before a savepoint name carry no
//! meaning, the parser drops them. The formatter writes `start transaction`, `release savepoint` and `rollback to
//! savepoint` in full and leaves out the other noise words.

use super::{value_u8, FmtReg, Formatter, K};
use dashql_buffers::parser::{Node, NodeType, TransactionCommand as C, TransactionIsolationLevel};
use dashql_parser::attrs;

impl<'a> Formatter<'a> {
    pub(super) fn format_transaction(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [command, modes, target] = attrs!(
            self.children(node),
            [K::SQL_TRANSACTION_COMMAND, K::SQL_TRANSACTION_MODES, K::SQL_TRANSACTION_TARGET]
        );
        let Some(command) = command.filter(|c| c.node_type() == NodeType::ENUM_SQL_TRANSACTION_COMMAND) else {
            return self.format_unimplemented(node);
        };
        let target = target.map(|t| self.reg_or_placeholder(t));
        let with_target = |text: &'static str, target: FmtReg| f.concat(&[f.text(text), target]);
        match (C(value_u8(command)), target) {
            (command @ (C::BEGIN | C::START), None) => {
                let mut parts = vec![f.text(if command == C::START { "start transaction" } else { "begin" })];
                if let Some(modes) = modes.filter(|m| m.children_count() > 0) {
                    parts.push(f.text(" "));
                    parts.push(self.reg_or_placeholder(modes));
                }
                f.concat(&parts)
            }
            (C::COMMIT, None) => f.text("commit"),
            (C::END, None) => f.text("end"),
            (C::ROLLBACK, None) => f.text("rollback"),
            (C::ABORT, None) => f.text("abort"),
            (C::SAVEPOINT, Some(target)) => with_target("savepoint ", target),
            (C::RELEASE, Some(target)) => with_target("release savepoint ", target),
            (C::ROLLBACK_TO, Some(target)) => with_target("rollback to savepoint ", target),
            (C::PREPARE, Some(target)) => with_target("prepare transaction ", target),
            (C::COMMIT_PREPARED, Some(target)) => with_target("commit prepared ", target),
            (C::ROLLBACK_PREPARED, Some(target)) => with_target("rollback prepared ", target),
            _ => self.format_unimplemented(node),
        }
    }

    pub(super) fn format_transaction_mode(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [isolation_level, read_only, deferrable] = attrs!(
            self.children(node),
            [K::SQL_TRANSACTION_ISOLATION_LEVEL, K::SQL_TRANSACTION_READ_ONLY, K::SQL_TRANSACTION_DEFERRABLE],
        );
        let flag = |n: &Node| n.children_begin_or_value() != 0;
        let text = match (isolation_level, read_only, deferrable) {
            (Some(level), None, None) if level.node_type() == NodeType::ENUM_SQL_TRANSACTION_ISOLATION_LEVEL => {
                match TransactionIsolationLevel(value_u8(level)) {
                    TransactionIsolationLevel::READ_UNCOMMITTED => "isolation level read uncommitted",
                    TransactionIsolationLevel::READ_COMMITTED => "isolation level read committed",
                    TransactionIsolationLevel::REPEATABLE_READ => "isolation level repeatable read",
                    TransactionIsolationLevel::SERIALIZABLE => "isolation level serializable",
                    _ => return self.format_unimplemented(node),
                }
            }
            (None, Some(read_only), None) => {
                if flag(read_only) {
                    "read only"
                } else {
                    "read write"
                }
            }
            (None, None, Some(deferrable)) => {
                if flag(deferrable) {
                    "deferrable"
                } else {
                    "not deferrable"
                }
            }
            _ => return self.format_unimplemented(node),
        };
        f.text(text)
    }
}
