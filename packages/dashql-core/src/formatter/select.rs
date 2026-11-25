//! SELECT statements.

use super::{FmtReg, Formatter, FormattingJoinPolicy, K};
use dashql_buffers::formatting::FormattingMode;
use dashql_buffers::parser::{CombineModifier, CombineOperation, Node, NodeType};
use dashql_parser::attrs;

/// The binding strength of a set operation, INTERSECT binds tighter than UNION and EXCEPT
fn combine_precedence(operation: CombineOperation) -> u8 {
    if operation == CombineOperation::INTERSECT {
        2
    } else {
        1
    }
}

impl<'a> Formatter<'a> {
    /// Does an operand of a set operation need parentheses to keep its meaning?
    ///
    /// That is the case if it has clauses that would otherwise apply to the whole combination, or if it is a
    /// set operation that binds weaker than the parent or that is the right operand of an equally strong parent.
    fn combine_input_needs_parentheses(&self, input: &'a Node, parent: CombineOperation, index: usize) -> bool {
        if input.node_type() != NodeType::OBJECT_SQL_SELECT {
            return false;
        }
        #[rustfmt::skip]
        let [order, limit, limit_all, fetch_first_row, offset, locking, ctes, operation] = attrs!(self.children(input), [
            K::SQL_SELECT_ORDER,
            K::SQL_SELECT_LIMIT,
            K::SQL_SELECT_LIMIT_ALL,
            K::SQL_SELECT_FETCH_FIRST_ROW,
            K::SQL_SELECT_OFFSET,
            K::SQL_SELECT_ROW_LOCKING,
            K::SQL_SELECT_WITH_CTES,
            K::SQL_COMBINE_OPERATION,
        ]);
        if [order, limit, limit_all, fetch_first_row, offset, locking, ctes].iter().any(Option::is_some) {
            return true;
        }
        let Some(operation) = operation else { return false };
        let (child, parent) =
            (combine_precedence(CombineOperation(super::value_u8(operation))), combine_precedence(parent));
        child < parent || (child == parent && index > 0)
    }

    /// The LIMIT of a select: `limit all`, `limit n`, `fetch first n rows with ties`, or `fetch first row only`
    /// without a count
    fn format_select_limit(
        &self,
        limit: Option<&'a Node>,
        limit_all: Option<&'a Node>,
        fetch_first_row: Option<&'a Node>,
        with_ties: bool,
    ) -> Option<FmtReg> {
        let f = &self.fmt;
        if limit_all.is_some() {
            return Some(f.text("limit all"));
        }
        if fetch_first_row.is_some() {
            return Some(f.text(if with_ties { "fetch first row with ties" } else { "fetch first row only" }));
        }
        let limit = limit?;
        Some(if with_ties {
            f.concat(&[f.text("fetch first "), self.reg(limit), f.text(" rows with ties")])
        } else {
            f.concat(&[f.text("limit "), self.reg(limit)])
        })
    }

    pub(super) fn format_select(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        #[rustfmt::skip]
        let [
            select_all, select_distinct, select_targets, select_into, select_from, select_where, select_groups,
            select_having, select_windows, select_order, select_row_locking, select_with_ctes, select_with_recursive,
            select_offset, select_limit, select_limit_all, select_sample, select_values, select_table,
            combine_operation, combine_modifier, combine_input, select_statement, group_all, group_distinct,
            with_ties, aggregation_threshold, fetch_first_row,
        ] = attrs!(self.children(node), [
                K::SQL_SELECT_ALL,
                K::SQL_SELECT_DISTINCT,
                K::SQL_SELECT_TARGETS,
                K::SQL_SELECT_INTO,
                K::SQL_SELECT_FROM,
                K::SQL_SELECT_WHERE,
                K::SQL_SELECT_GROUPS,
                K::SQL_SELECT_HAVING,
                K::SQL_SELECT_WINDOWS,
                K::SQL_SELECT_ORDER,
                K::SQL_SELECT_ROW_LOCKING,
                K::SQL_SELECT_WITH_CTES,
                K::SQL_SELECT_WITH_RECURSIVE,
                K::SQL_SELECT_OFFSET,
                K::SQL_SELECT_LIMIT,
                K::SQL_SELECT_LIMIT_ALL,
                K::SQL_SELECT_SAMPLE,
                K::SQL_SELECT_VALUES,
                K::SQL_SELECT_TABLE,
                K::SQL_COMBINE_OPERATION,
                K::SQL_COMBINE_MODIFIER,
                K::SQL_COMBINE_INPUT,
                K::SQL_SELECT_EXPRESSION_STATEMENT,
                K::SQL_SELECT_GROUP_ALL,
                K::SQL_SELECT_GROUP_DISTINCT,
                K::SQL_SELECT_LIMIT_WITH_TIES,
                K::SQL_SELECT_WITH_AGGREGATION_THRESHOLD,
                K::SQL_SELECT_FETCH_FIRST_ROW,
            ],
        );
        let with_ties = super::is_true(with_ties);

        let mut query = 0;
        if let Some(select_statement) = select_statement {
            query = self.reg(select_statement);
            if query == 0 {
                return self.format_unimplemented(node);
            }
        }
        if let (Some(combine_operation), Some(combine_input)) = (combine_operation, combine_input) {
            let op_text = match CombineOperation(super::value_u8(combine_operation)) {
                CombineOperation::UNION => "union",
                CombineOperation::INTERSECT => "intersect",
                CombineOperation::EXCEPT => "except",
                _ => return self.format_unimplemented(node),
            };
            let mod_text = match combine_modifier.map(|m| CombineModifier(super::value_u8(m))) {
                Some(CombineModifier::ALL) => " all",
                Some(CombineModifier::DISTINCT) => " distinct",
                _ => "",
            };
            let op_reg =
                if mod_text.is_empty() { f.text(op_text) } else { f.concat(&[f.text(op_text), f.text(mod_text)]) };
            let separator = f.concat(&[f.text(" "), op_reg, f.text(" ")]);
            let break_separator = f.concat(&[f.break_(), op_reg, f.break_()]);
            let mut inputs = self.array_regs(combine_input);
            if inputs.contains(&0) {
                return self.format_unimplemented(node);
            }
            // The AST does not keep the parentheses of the inputs, add those that the operands need
            let operation = CombineOperation(super::value_u8(combine_operation));
            for (i, (input, reg)) in self.children(combine_input).iter().zip(inputs.iter_mut()).enumerate() {
                if self.combine_input_needs_parentheses(input, operation, i) {
                    *reg = f.parenthesized(*reg);
                }
            }
            query = f.join(&inputs, separator, break_separator, Some(FormattingJoinPolicy::BreakAllOrNone), false);

            // ORDER BY, LIMIT, OFFSET and locking apply to the whole combination
            let mut tail = Vec::with_capacity(4);
            if let Some(select_order) = select_order {
                tail.push(f.concat(&[f.text("order by "), self.reg(select_order)]));
            }
            tail.extend(self.format_select_limit(select_limit, select_limit_all, fetch_first_row, with_ties));
            if let Some(select_offset) = select_offset {
                tail.push(f.concat(&[f.text("offset "), self.reg(select_offset)]));
            }
            if let Some(select_row_locking) = select_row_locking {
                let body = self.reg(select_row_locking);
                if body == 0 {
                    return self.format_unimplemented(node);
                }
                tail.push(body);
            }
            if !tail.is_empty() {
                tail.insert(0, query);
                query = self.space_join(&tail, self.pretty_policy(FormattingJoinPolicy::BreakAllOrNone), false);
            }
        }

        if query == 0 {
            let mut clauses = Vec::with_capacity(12);
            if let Some(select_values) = select_values {
                let values_reg = self.reg(select_values);
                if values_reg == 0 {
                    return self.format_unimplemented(node);
                }
                if self.config.mode == FormattingMode::PRETTY {
                    clauses.push(f.concat(&[f.text("values"), f.indented(f.concat(&[f.break_(), values_reg]))]));
                } else {
                    clauses.push(f.concat(&[f.text("values "), values_reg]));
                }
            }
            if let Some(select_table) = select_table {
                let table_reg = self.reg(select_table);
                if table_reg == 0 {
                    return self.format_unimplemented(select_table);
                }
                clauses.push(f.concat(&[f.text("table "), table_reg]));
            }
            // A select without targets is valid SQL, `select from t`
            let has_source = select_values.is_some() || select_table.is_some();
            let select = if aggregation_threshold.is_some() { "select with aggregation_threshold" } else { "select" };
            if select_targets.is_none_or(|t| t.children_count() == 0) && !has_source {
                let modifier = if select_distinct.is_some() {
                    " distinct"
                } else if select_all.is_some() {
                    " all"
                } else {
                    ""
                };
                clauses.push(f.concat(&[f.text(select), f.text(modifier)]));
            } else if let Some(select_targets) = select_targets {
                let body = self.reg(select_targets);
                match select_distinct.filter(|d| d.node_type() == NodeType::ARRAY) {
                    Some(select_distinct) if select_distinct.children_count() > 0 => {
                        let on_cols = self.reg(select_distinct);
                        clauses.push(f.concat(&[
                            f.text(select),
                            f.text(" distinct on "),
                            f.parenthesized(on_cols),
                            f.text(" "),
                            body,
                        ]));
                    }
                    Some(_) => clauses.push(f.concat(&[f.text(select), f.text(" distinct "), body])),
                    None if select_all.is_some() => clauses.push(f.concat(&[f.text(select), f.text(" all "), body])),
                    None => clauses.push(f.concat(&[f.text(select), f.text(" "), body])),
                }
            }
            if let Some(select_into) = select_into {
                let body = self.reg(select_into);
                if body == 0 {
                    return self.format_unimplemented(node);
                }
                clauses.push(body);
            }
            if let Some(select_from) = select_from {
                clauses.push(f.concat(&[f.text("from "), self.reg(select_from)]));
            }
            if let Some(select_where) = select_where {
                clauses.push(f.concat(&[f.text("where "), self.reg(select_where)]));
            }
            let group_by = if group_all.is_some() {
                "group by all"
            } else if group_distinct.is_some() {
                "group by distinct"
            } else {
                "group by"
            };
            match select_groups {
                Some(select_groups) => {
                    clauses.push(f.concat(&[f.text(group_by), f.text(" "), self.reg(select_groups)]))
                }
                None if group_all.is_some() => clauses.push(f.text(group_by)),
                None => {}
            }
            if let Some(select_having) = select_having {
                clauses.push(f.concat(&[f.text("having "), self.reg(select_having)]));
            }
            if let Some(select_windows) = select_windows {
                let body = self.reg(select_windows);
                if body == 0 {
                    return self.format_unimplemented(node);
                }
                clauses.push(f.concat(&[f.text("window "), body]));
            }
            if let Some(select_sample) = select_sample {
                let body = self.reg(select_sample);
                if body == 0 {
                    return self.format_unimplemented(node);
                }
                clauses.push(body);
            }
            if let Some(select_order) = select_order {
                clauses.push(f.concat(&[f.text("order by "), self.reg(select_order)]));
            }
            clauses.extend(self.format_select_limit(select_limit, select_limit_all, fetch_first_row, with_ties));
            if let Some(select_offset) = select_offset {
                clauses.push(f.concat(&[f.text("offset "), self.reg(select_offset)]));
            }
            if let Some(select_row_locking) = select_row_locking {
                let body = self.reg(select_row_locking);
                if body == 0 {
                    return self.format_unimplemented(node);
                }
                clauses.push(body);
            }

            if clauses.is_empty() {
                return self.format_unimplemented(node);
            }
            let clause_policy = self.pretty_policy(FormattingJoinPolicy::BreakAllOrNone);
            query = self.space_join(&clauses, clause_policy, false);
        }

        if let Some(select_with_ctes) = select_with_ctes {
            let cte_children = self.array_regs(select_with_ctes);
            let mut cte_regs = Vec::with_capacity(cte_children.len() * 2);
            for (i, &cte) in cte_children.iter().enumerate() {
                if i > 0 {
                    cte_regs.push(f.text(", "));
                }
                cte_regs.push(cte);
            }
            let ctes = f.concat(&cte_regs);
            let keyword = if select_with_recursive.is_some() { "with recursive " } else { "with " };
            let with_clause = f.concat(&[f.text(keyword), ctes]);
            let with_policy = self.pretty_policy(FormattingJoinPolicy::BreakAllOrNone);
            query = self.space_join(&[with_clause, query], with_policy, false);
        }
        query
    }
}
