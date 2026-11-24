//! UPDATE and MERGE statements.
//!
//! `when not matched` and `when not matched by target` are the same, the formatter writes the short form.

use super::{value_u8, FmtReg, Formatter, FormattingJoinPolicy, K};
use dashql_buffers::parser::{MergeAction, MergeMatch, Node, NodeType};
use dashql_parser::attrs;

impl<'a> Formatter<'a> {
    /// The WITH clause of a statement with common table expressions, `None` without them
    fn format_with_clause(&self, ctes: Option<&'a Node>, recursive: Option<&'a Node>) -> Option<FmtReg> {
        let f = &self.fmt;
        let ctes = ctes?;
        let keyword = if recursive.is_some() { "with recursive " } else { "with " };
        Some(f.concat(&[f.text(keyword), self.reg_or_placeholder(ctes)]))
    }

    pub(super) fn format_update(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [target, assignments, from, where_clause, returning, with_ctes, with_recursive] = attrs!(
            self.children(node),
            [
                K::SQL_UPDATE_TARGET,
                K::SQL_UPDATE_ASSIGNMENTS,
                K::SQL_UPDATE_FROM,
                K::SQL_UPDATE_WHERE,
                K::SQL_UPDATE_RETURNING,
                K::SQL_SELECT_WITH_CTES,
                K::SQL_SELECT_WITH_RECURSIVE,
            ]
        );
        let (Some(target), Some(assignments)) = (target, assignments) else { return self.format_unimplemented(node) };
        let mut clauses: Vec<FmtReg> = self.format_with_clause(with_ctes, with_recursive).into_iter().collect();
        clauses.push(f.concat(&[f.text("update "), self.reg_or_placeholder(target)]));
        clauses.push(f.concat(&[f.text("set "), self.reg_or_placeholder(assignments)]));
        for (child, keyword) in [(from, "from "), (where_clause, "where "), (returning, "returning ")] {
            if let Some(child) = child {
                clauses.push(f.concat(&[f.text(keyword), self.reg_or_placeholder(child)]));
            }
        }
        self.space_join(&clauses, self.pretty_policy(FormattingJoinPolicy::BreakAllOrNone), false)
    }

    pub(super) fn format_merge(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [target, source, condition, clauses, returning, with_ctes, with_recursive] = attrs!(
            self.children(node),
            [
                K::SQL_MERGE_TARGET,
                K::SQL_MERGE_SOURCE,
                K::SQL_MERGE_CONDITION,
                K::SQL_MERGE_CLAUSES,
                K::SQL_MERGE_RETURNING,
                K::SQL_SELECT_WITH_CTES,
                K::SQL_SELECT_WITH_RECURSIVE,
            ]
        );
        let (Some(target), Some(source), Some(condition), Some(when_clauses)) = (target, source, condition, clauses)
        else {
            return self.format_unimplemented(node);
        };
        let mut clauses: Vec<FmtReg> = self.format_with_clause(with_ctes, with_recursive).into_iter().collect();
        clauses.push(f.concat(&[f.text("merge into "), self.reg_or_placeholder(target)]));
        clauses.push(f.concat(&[f.text("using "), self.reg_or_placeholder(source)]));
        clauses.push(f.concat(&[f.text("on "), self.reg_or_placeholder(condition)]));
        // Every WHEN clause is a clause of the statement
        clauses.extend(self.children(when_clauses).iter().map(|c| self.reg_or_placeholder(c)));
        if let Some(returning) = returning {
            clauses.push(f.concat(&[f.text("returning "), self.reg_or_placeholder(returning)]));
        }
        self.space_join(&clauses, self.pretty_policy(FormattingJoinPolicy::BreakAllOrNone), false)
    }

    /// `when matched and x > 0 then update set ...`
    pub(super) fn format_merge_when_clause(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [kind, condition, action] = attrs!(
            self.children(node),
            [K::SQL_MERGE_WHEN_CLAUSE_KIND, K::SQL_MERGE_WHEN_CLAUSE_CONDITION, K::SQL_MERGE_WHEN_CLAUSE_ACTION]
        );
        let (Some(kind), Some(action)) = (kind, action) else { return self.format_unimplemented(node) };
        let keyword = match MergeMatch(value_u8(kind)) {
            MergeMatch::MATCHED => "when matched",
            MergeMatch::NOT_MATCHED_BY_SOURCE => "when not matched by source",
            MergeMatch::NOT_MATCHED_BY_TARGET => "when not matched",
            _ => return self.format_unimplemented(node),
        };
        let mut head = vec![f.text(keyword)];
        if let Some(condition) = condition {
            head.push(f.text(" and "));
            head.push(self.reg_or_placeholder(condition));
        }
        head.push(f.text(" then"));
        self.space_join(&[f.concat(&head), self.reg_or_placeholder(action)], FormattingJoinPolicy::BreakAllOrNone, true)
    }

    /// `update set ...`, `delete`, `insert (a) values (1)` or `do nothing`
    pub(super) fn format_merge_action(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [kind, assignments, columns, values] = attrs!(
            self.children(node),
            [
                K::SQL_MERGE_ACTION_KIND,
                K::SQL_MERGE_ACTION_TARGET,
                K::SQL_MERGE_ACTION_COLUMNS,
                K::SQL_MERGE_ACTION_VALUES
            ]
        );
        let Some(kind) = kind else { return self.format_unimplemented(node) };
        match (MergeAction(value_u8(kind)), assignments, values) {
            (MergeAction::UPDATE, Some(assignments), None) => {
                f.concat(&[f.text("update set "), self.reg_or_placeholder(assignments)])
            }
            (MergeAction::DELETE, None, None) => f.text("delete"),
            (MergeAction::DO_NOTHING, None, None) => f.text("do nothing"),
            (MergeAction::INSERT, None, Some(values)) => {
                let mut parts = vec![f.text("insert ")];
                if let Some(columns) = columns {
                    parts.push(f.parenthesized_list(self.reg_or_placeholder(columns)));
                    parts.push(f.text(" "));
                }
                parts.push(f.text("values "));
                parts.push(f.parenthesized_list(self.reg_or_placeholder(values)));
                f.concat(&parts)
            }
            _ => self.format_unimplemented(node),
        }
    }

    /// Is a DEFAULT expression a value that a WHEN clause of MERGE inserts?
    pub(super) fn is_merge_insert_value(&self, node: &Node) -> bool {
        node.attribute_key() == K::NONE
            && self.ast.get(node.parent() as usize).is_some_and(|values| {
                values.node_type() == NodeType::ARRAY && values.attribute_key() == K::SQL_MERGE_ACTION_VALUES
            })
    }
}
