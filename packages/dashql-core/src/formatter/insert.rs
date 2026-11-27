//! INSERT statements.

use super::{is_true, value_u8, FmtReg, Formatter, FormattingJoinPolicy, K};
use dashql_buffers::parser::{InsertConflictAction, Node, NodeType};
use dashql_parser::attrs;

impl<'a> Formatter<'a> {
    pub(super) fn format_insert(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [target, bulk, columns, source, default_values, on_conflict, returning, with_ctes, with_recursive] = attrs!(
            self.children(node),
            [
                K::SQL_INSERT_TARGET,
                K::SQL_INSERT_BULK,
                K::SQL_INSERT_COLUMNS,
                K::SQL_INSERT_SOURCE,
                K::SQL_INSERT_DEFAULT_VALUES,
                K::SQL_INSERT_ON_CONFLICT,
                K::SQL_INSERT_RETURNING,
                K::SQL_SELECT_WITH_CTES,
                K::SQL_SELECT_WITH_RECURSIVE,
            ],
        );
        let Some(target) = target else { return self.format_unimplemented(node) };
        if source.is_none() == default_values.is_none() {
            return self.format_unimplemented(node);
        }
        let target_reg = self.reg(target);
        if target_reg == 0 {
            return self.format_unimplemented(target);
        }

        let mut clauses = Vec::new();
        let keyword = if bulk.is_some() { "insert bulk into " } else { "insert into " };
        let mut header = f.concat(&[f.text(keyword), target_reg]);
        if let Some(columns) = columns.filter(|c| c.node_type() == NodeType::ARRAY && c.children_count() > 0) {
            let columns_reg = self.reg(columns);
            if columns_reg == 0 {
                return self.format_unimplemented(columns);
            }
            header = f.concat(&[header, f.parenthesized(columns_reg)]);
        }
        clauses.push(header);

        if let Some(source) = source {
            let source_reg = self.reg(source);
            if source_reg == 0 {
                return self.format_unimplemented(source);
            }
            clauses.push(source_reg);
        } else {
            clauses.push(f.text("default values"));
        }
        if let Some(on_conflict) = on_conflict {
            clauses.push(self.reg_or_placeholder(on_conflict));
        }

        if let Some(returning) = returning.filter(|r| r.node_type() == NodeType::ARRAY && r.children_count() > 0) {
            let returning_reg = self.reg(returning);
            if returning_reg == 0 {
                return self.format_unimplemented(returning);
            }
            clauses.push(f.concat(&[f.text("returning "), returning_reg]));
        }

        let policy = self.pretty_policy(FormattingJoinPolicy::BreakAllOrNone);
        let mut query = self.space_join(&clauses, policy, false);
        if let Some(with_ctes) = with_ctes {
            let ctes_reg = self.reg(with_ctes);
            if ctes_reg == 0 {
                return self.format_unimplemented(with_ctes);
            }
            query = self.space_join(&[self.format_with_clause(ctes_reg, with_recursive), query], policy, false);
        }
        query
    }

    /// `on conflict [(columns) [where predicate] | on constraint name] do nothing | do update set ... [where ...]`
    pub(super) fn format_insert_on_conflict(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [target, target_where, constraint, action, assignments, where_clause] = attrs!(
            self.children(node),
            [
                K::SQL_INSERT_ON_CONFLICT_TARGET,
                K::SQL_INSERT_ON_CONFLICT_TARGET_WHERE,
                K::SQL_INSERT_ON_CONFLICT_CONSTRAINT,
                K::SQL_INSERT_ON_CONFLICT_ACTION,
                K::SQL_INSERT_ON_CONFLICT_ASSIGNMENTS,
                K::SQL_INSERT_ON_CONFLICT_WHERE,
            ],
        );
        let Some(action) = action.filter(|a| a.node_type() == NodeType::ENUM_SQL_INSERT_CONFLICT_ACTION) else {
            return self.format_unimplemented(node);
        };
        let mut head = vec![f.text("on conflict")];
        if let Some(target) = target {
            head.push(f.parenthesized(self.reg_or_placeholder(target)));
        }
        if let Some(target_where) = target_where {
            head.push(f.concat(&[f.text("where "), self.reg_or_placeholder(target_where)]));
        }
        if let Some(constraint) = constraint {
            head.push(f.concat(&[f.text("on constraint "), self.reg_or_placeholder(constraint)]));
        }
        let head = self.space_join(&head, FormattingJoinPolicy::BreakOnOverflow, true);
        match (InsertConflictAction(value_u8(action)), assignments) {
            (InsertConflictAction::DO_NOTHING, None) if where_clause.is_none() => {
                self.space_join(&[head, f.text("do nothing")], FormattingJoinPolicy::BreakOnOverflow, true)
            }
            (InsertConflictAction::DO_UPDATE, Some(assignments)) => {
                let mut clauses =
                    vec![head, f.concat(&[f.text("do update set "), self.reg_or_placeholder(assignments)])];
                if let Some(where_clause) = where_clause {
                    clauses.push(f.concat(&[f.text("where "), self.reg_or_placeholder(where_clause)]));
                }
                self.space_join(&clauses, self.pretty_policy(FormattingJoinPolicy::BreakAllOrNone), false)
            }
            _ => self.format_unimplemented(node),
        }
    }

    /// `column = value` or `(column, ...) = (value, ...)`, an assignment of DO UPDATE SET
    pub(super) fn format_assignment(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [multiple, columns, value] = attrs!(
            self.children(node),
            [K::SQL_ASSIGNMENT_MULTIPLE, K::SQL_ASSIGNMENT_COLUMNS, K::SQL_ASSIGNMENT_VALUE]
        );
        let (Some(columns), Some(value)) = (columns, value) else { return self.format_unimplemented(node) };
        let columns_reg = self.reg_or_placeholder(columns);
        let value_reg = self.reg_or_placeholder(value);
        if !is_true(multiple) {
            return f.concat(&[columns_reg, f.text(" = "), value_reg]);
        }
        // An explicit row like `row(1)` prints its parentheses itself
        let value_reg = match value.node_type() {
            NodeType::OBJECT_SQL_ROW_EXPRESSION => value_reg,
            _ => f.parenthesized(value_reg),
        };
        f.concat(&[f.parenthesized(columns_reg), f.text(" = "), value_reg])
    }

    /// `column [collate c] [opclass] [asc | desc] [nulls first | last]`, a column of a conflict target
    pub(super) fn format_index_element(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name, collation, opclass, direction, null_rule] = attrs!(
            self.children(node),
            [
                K::SQL_INDEX_ELEMENT_NAME,
                K::SQL_INDEX_ELEMENT_COLLATION,
                K::SQL_INDEX_ELEMENT_OPCLASS,
                K::SQL_INDEX_ELEMENT_DIRECTION,
                K::SQL_INDEX_ELEMENT_NULL_RULE,
            ],
        );
        let Some(name) = name else { return self.format_unimplemented(node) };
        let mut parts = vec![self.reg_or_placeholder(name)];
        if let Some(collation) = collation {
            parts.push(f.concat(&[f.text("collate "), self.reg_or_placeholder(collation)]));
        }
        for part in [opclass, direction, null_rule].into_iter().flatten() {
            parts.push(self.reg_or_placeholder(part));
        }
        self.space_join(&parts, FormattingJoinPolicy::BreakAllOrNone, true)
    }

    /// Is a DEFAULT expression the value of an assignment of DO UPDATE SET, also in the values of `(a, b) = (...)` or of
    /// `(a, b) = row(...)`?
    pub(super) fn is_assignment_value(&self, node: &Node) -> bool {
        let parent = self.ast.get(node.parent() as usize);
        let in_values = |values: &Node| {
            values.node_type() == NodeType::ARRAY
                && (values.attribute_key() == K::SQL_ASSIGNMENT_VALUE
                    || (values.attribute_key() == K::SQL_ROW_EXPRESSION_VALUES
                        && self.ast.get(values.parent() as usize).is_some_and(|row| {
                            row.node_type() == NodeType::OBJECT_SQL_ROW_EXPRESSION
                                && row.attribute_key() == K::SQL_ASSIGNMENT_VALUE
                        })))
        };
        node.attribute_key() == K::SQL_ASSIGNMENT_VALUE
            || (node.attribute_key() == K::NONE && parent.is_some_and(in_values))
    }
}
