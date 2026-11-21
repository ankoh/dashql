//! Transaction control: BEGIN, START TRANSACTION, COMMIT, ROLLBACK, their aliases, savepoints and prepared
//! transactions.
//!
//! The optional `WORK` and `TRANSACTION` after a command and the optional `SAVEPOINT` before a savepoint name carry no
//! meaning, the parser drops them. The formatter writes `start transaction`, `release savepoint` and `rollback to
//! savepoint` in full and leaves out the other noise words.

use super::{FmtReg, Formatter, K};
use dashql_buffers::parser::{Node, NodeType};
use dashql_parser::attrs;

impl<'a> Formatter<'a> {
    /// The canonical text of a keyword name, the command of a transaction statement or an isolation level
    pub(super) fn format_keyword_name(&self, node: &'a Node) -> FmtReg {
        let name: &'a str = &self.parsed.scanned.names.get(node.children_begin_or_value()).text;
        self.fmt.text(name)
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
        let Some(command) = command.filter(|c| c.node_type() == NodeType::NAME) else {
            return self.format_unimplemented(node);
        };
        let command_text = self.parsed.scanned.names.get(command.children_begin_or_value()).text.as_str();
        let command_reg = self.reg_or_placeholder(command);
        let target_reg = target.map(|t| self.reg_or_placeholder(t));
        let prepared = prepared.is_some_and(|p| p.children_begin_or_value() != 0);
        match (command_text, target_reg) {
            ("begin" | "start", None) => {
                let mut parts = vec![command_reg];
                if command_text == "start" {
                    parts.push(f.text(" transaction"));
                }
                if let Some(modes) = modes.filter(|m| m.children_count() > 0) {
                    parts.push(f.text(" "));
                    parts.push(self.reg_or_placeholder(modes));
                }
                f.concat(&parts)
            }
            ("commit" | "end" | "rollback" | "abort", None) => command_reg,
            ("prepare", Some(target)) => f.concat(&[command_reg, f.text(" transaction "), target]),
            ("commit" | "rollback", Some(target)) if prepared => f.concat(&[command_reg, f.text(" prepared "), target]),
            ("rollback", Some(target)) => f.concat(&[command_reg, f.text(" to savepoint "), target]),
            ("savepoint", Some(target)) => f.concat(&[command_reg, f.text(" "), target]),
            ("release", Some(target)) => f.concat(&[command_reg, f.text(" savepoint "), target]),
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
