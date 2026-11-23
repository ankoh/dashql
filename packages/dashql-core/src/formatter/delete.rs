//! DELETE statements.

use super::{FmtReg, Formatter, FormattingJoinPolicy, K};
use dashql_buffers::parser::Node;
use dashql_parser::attrs;

impl<'a> Formatter<'a> {
    pub(super) fn format_delete(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [target, using_clause, where_clause, returning, with_ctes, with_recursive] = attrs!(
            self.children(node),
            [
                K::SQL_DELETE_TARGET,
                K::SQL_DELETE_USING,
                K::SQL_DELETE_WHERE,
                K::SQL_DELETE_RETURNING,
                K::SQL_SELECT_WITH_CTES,
                K::SQL_SELECT_WITH_RECURSIVE,
            ],
        );
        let Some(target) = target.filter(|t| self.reg(t) != 0) else { return self.format_unimplemented(node) };

        let mut clauses = Vec::new();
        if let Some(with_ctes) = with_ctes {
            if self.reg(with_ctes) == 0 {
                return self.format_unimplemented(with_ctes);
            }
            let keyword = if with_recursive.is_some() { "with recursive " } else { "with " };
            clauses.push(f.concat(&[f.text(keyword), self.reg(with_ctes)]));
        }
        clauses.push(f.concat(&[f.text("delete from "), self.reg(target)]));
        for (child, keyword) in [(using_clause, "using "), (where_clause, "where "), (returning, "returning ")] {
            let Some(child) = child else { continue };
            if self.reg(child) == 0 {
                return self.format_unimplemented(child);
            }
            clauses.push(f.concat(&[f.text(keyword), self.reg(child)]));
        }
        let policy = self.pretty_policy(FormattingJoinPolicy::BreakAllOrNone);
        self.space_join(&clauses, policy, false)
    }

    /// `current of c`, the row of a cursor in `where current of c`
    pub(super) fn format_current_of(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name] = attrs!(self.children(node), [K::SQL_CURRENT_OF_NAME]);
        let Some(name) = name else { return self.format_unimplemented(node) };
        f.concat(&[f.text("current of "), self.reg_or_placeholder(name)])
    }
}
