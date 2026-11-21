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
    pub(super) fn format_transaction_command(&self, node: &'a Node) -> FmtReg {
        let text = match C(value_u8(node)) {
            C::BEGIN => "begin",
            C::START => "start",
            C::COMMIT => "commit",
            C::END => "end",
            C::ROLLBACK => "rollback",
            C::ABORT => "abort",
            C::SAVEPOINT => "savepoint",
            C::RELEASE => "release",
            C::PREPARE => "prepare",
            _ => return self.format_unimplemented(node),
        };
        self.fmt.text(text)
    }

    pub(super) fn format_transaction_isolation_level(&self, node: &'a Node) -> FmtReg {
        let text = match TransactionIsolationLevel(value_u8(node)) {
            TransactionIsolationLevel::READ_UNCOMMITTED => "read uncommitted",
            TransactionIsolationLevel::READ_COMMITTED => "read committed",
            TransactionIsolationLevel::REPEATABLE_READ => "repeatable read",
            TransactionIsolationLevel::SERIALIZABLE => "serializable",
            _ => return self.format_unimplemented(node),
        };
        self.fmt.text(text)
    }

    pub(super) fn format_transaction(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [command, modes, target, prepared] = attrs!(
            self.children(node),
            [
                K::SQL_TRANSACTION_COMMAND,
                K::SQL_TRANSACTION_MODES,
                K::SQL_TRANSACTION_TARGET,
                K::SQL_TRANSACTION_PREPARED
            ],
        );
        let Some(command) = command.filter(|c| c.node_type() == NodeType::ENUM_SQL_TRANSACTION_COMMAND) else {
            return self.format_unimplemented(node);
        };
        let command_value = C(value_u8(command));
        let command_reg = self.reg_or_placeholder(command);
        let target_reg = target.map(|t| self.reg_or_placeholder(t));
        let prepared = prepared.is_some_and(|p| p.children_begin_or_value() != 0);
        match (command_value, target_reg) {
            (C::BEGIN | C::START, None) => {
                let mut parts = vec![command_reg];
                if command_value == C::START {
                    parts.push(f.text(" transaction"));
                }
                if let Some(modes) = modes.filter(|m| m.children_count() > 0) {
                    parts.push(f.text(" "));
                    parts.push(self.reg_or_placeholder(modes));
                }
                f.concat(&parts)
            }
            (C::COMMIT | C::END | C::ROLLBACK | C::ABORT, None) => command_reg,
            (C::PREPARE, Some(target)) => f.concat(&[command_reg, f.text(" transaction "), target]),
            (C::COMMIT | C::ROLLBACK, Some(target)) if prepared => {
                f.concat(&[command_reg, f.text(" prepared "), target])
            }
            (C::ROLLBACK, Some(target)) => f.concat(&[command_reg, f.text(" to savepoint "), target]),
            (C::SAVEPOINT, Some(target)) => f.concat(&[command_reg, f.text(" "), target]),
            (C::RELEASE, Some(target)) => f.concat(&[command_reg, f.text(" savepoint "), target]),
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
        match (isolation_level, read_only, deferrable) {
            (Some(level), None, None) => f.concat(&[f.text("isolation level "), self.reg_or_placeholder(level)]),
            (None, Some(read_only), None) => f.text(if flag(read_only) { "read only" } else { "read write" }),
            (None, None, Some(deferrable)) => f.text(if flag(deferrable) { "deferrable" } else { "not deferrable" }),
            _ => self.format_unimplemented(node),
        }
    }
}
