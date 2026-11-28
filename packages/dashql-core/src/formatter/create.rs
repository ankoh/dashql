//! CREATE, DROP and ALTER of tables, views, schemas and functions, ATTACH, SET and RESET statements.

use super::{FmtReg, Formatter, FormattingJoinPolicy, K};
use dashql_buffers::parser::{
    FunctionOption, FunctionParameterMode, Node, NodeType, OnCommitOption, SessionParameter, TableLikeOption, TempType,
    ZoneValueType,
};
use dashql_parser::attrs;

impl<'a> Formatter<'a> {
    pub(super) fn format_temp_type(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        match TempType(super::value_u8(node)) {
            TempType::DEFAULT | TempType::LOCAL => f.text("temporary"),
            TempType::GLOBAL => f.text("global temporary"),
            TempType::UNLOGGED => f.text("unlogged"),
            TempType::NONE => f.empty(),
            _ => self.format_unimplemented(node),
        }
    }

    pub(super) fn format_on_commit_option(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        match OnCommitOption(super::value_u8(node)) {
            OnCommitOption::DROP => f.text("on commit drop"),
            OnCommitOption::DELETE_ROWS => f.text("on commit delete rows"),
            OnCommitOption::PRESERVE_ROWS => f.text("on commit preserve rows"),
            OnCommitOption::NOOP => f.empty(),
            _ => self.format_unimplemented(node),
        }
    }

    pub(super) fn format_create(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name, elements, if_not_exists, temp, options, on_commit] = attrs!(
            self.children(node),
            [
                K::SQL_CREATE_TABLE_NAME,
                K::SQL_CREATE_TABLE_ELEMENTS,
                K::SQL_CREATE_TABLE_IF_NOT_EXISTS,
                K::SQL_CREATE_TABLE_TEMP,
                K::SQL_CREATE_TABLE_OPTIONS,
                K::SQL_CREATE_TABLE_ON_COMMIT,
            ],
        );
        let Some(name) = name else { return self.format_unimplemented(node) };

        let mut header_parts = vec![f.text("create ")];
        if let Some(temp) = temp {
            header_parts.push(self.reg(temp));
            header_parts.push(f.text(" "));
        }
        header_parts.push(f.text("table "));
        if if_not_exists.is_some() {
            header_parts.push(f.text("if not exists "));
        }
        header_parts.push(self.reg(name));
        let header = f.concat(&header_parts);

        // `create table t ()` has no elements
        let mut element_block = f.text("()");
        if let Some(elements) = elements {
            let mut parts = Vec::with_capacity(elements.children_count() as usize);
            for element in self.children(elements) {
                let reg = self.reg(element);
                if reg == 0 {
                    return self.format_unimplemented(node);
                }
                parts.push(reg);
            }
            element_block = f.parenthesized(self.comma_join(&parts, None, false));
        }
        let mut statement = f.concat(&[header, f.text(" "), element_block]);
        if let Some(options) = options {
            statement = f.concat(&[statement, f.text(" with "), f.parenthesized(self.reg_or_placeholder(options))]);
        }
        if let Some(on_commit) = on_commit {
            statement = f.concat(&[statement, f.text(" "), self.reg(on_commit)]);
        }
        statement
    }

    /// `like t including defaults`, a table element that copies the columns of another table
    pub(super) fn format_table_like(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [table, options] = attrs!(self.children(node), [K::SQL_TABLE_LIKE_TABLE, K::SQL_TABLE_LIKE_OPTIONS]);
        let Some(table) = table else { return self.format_unimplemented(node) };
        let mut parts = vec![f.text("like "), self.reg_or_placeholder(table)];
        if let Some(options) = options {
            parts.push(f.text(" "));
            parts.push(self.reg_or_placeholder(options));
        }
        f.concat(&parts)
    }

    pub(super) fn format_table_like_option(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [kind, include] =
            attrs!(self.children(node), [K::SQL_TABLE_LIKE_OPTION_KIND, K::SQL_TABLE_LIKE_OPTION_INCLUDE]);
        let Some(kind) = kind else { return self.format_unimplemented(node) };
        let keyword = if super::is_true(include) { "including " } else { "excluding " };
        f.concat(&[f.text(keyword), self.reg_or_placeholder(kind)])
    }

    pub(super) fn format_table_like_option_kind(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        match TableLikeOption(super::value_u8(node)) {
            TableLikeOption::DEFAULTS => f.text("defaults"),
            TableLikeOption::CONSTRAINTS => f.text("constraints"),
            TableLikeOption::INDEXES => f.text("indexes"),
            TableLikeOption::STORAGE => f.text("storage"),
            TableLikeOption::COMMENTS => f.text("comments"),
            TableLikeOption::ALL => f.text("all"),
            _ => self.format_unimplemented(node),
        }
    }

    pub(super) fn format_create_as(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name, columns, if_not_exists, temp, statement, with_data, on_commit] = attrs!(
            self.children(node),
            [
                K::SQL_CREATE_AS_NAME,
                K::SQL_CREATE_AS_COLUMNS,
                K::SQL_CREATE_AS_IF_NOT_EXISTS,
                K::SQL_CREATE_AS_TEMP,
                K::SQL_CREATE_AS_STATEMENT,
                K::SQL_CREATE_AS_WITH_DATA,
                K::SQL_CREATE_AS_ON_COMMIT,
            ],
        );
        let (Some(name), Some(statement)) = (name, statement) else { return self.format_unimplemented(node) };

        let mut parts = vec![f.text("create ")];
        if let Some(temp) = temp {
            parts.push(self.reg(temp));
            parts.push(f.text(" "));
        }
        parts.push(f.text("table "));
        if if_not_exists.is_some() {
            parts.push(f.text("if not exists "));
        }
        parts.push(self.reg(name));
        if let Some(columns) = columns.filter(|c| c.children_count() > 0) {
            parts.push(f.parenthesized(self.reg(columns)));
        }
        if let Some(on_commit) = on_commit {
            parts.push(f.text(" "));
            parts.push(self.reg(on_commit));
        }
        parts.push(f.text(" as"));
        // The query follows on the same line only if the whole statement fits, like the query of a view
        let header = f.concat(&parts);
        let body = self.space_join(&[header, self.reg(statement)], FormattingJoinPolicy::BreakAllOrNone, false);
        match with_data {
            Some(with_data) => {
                let include_data = with_data.node_type() == NodeType::BOOL && with_data.children_begin_or_value() != 0;
                f.concat(&[body, f.text(if include_data { " with data" } else { " with no data" })])
            }
            None => body,
        }
    }

    pub(super) fn format_view(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name, columns, or_replace, temp, recursive, options, statement, check_local] = attrs!(
            self.children(node),
            [
                K::SQL_VIEW_NAME,
                K::SQL_VIEW_COLUMNS,
                K::SQL_VIEW_OR_REPLACE,
                K::SQL_VIEW_TEMP,
                K::SQL_VIEW_RECURSIVE,
                K::SQL_VIEW_OPTIONS,
                K::SQL_VIEW_STATEMENT,
                K::SQL_VIEW_CHECK_LOCAL,
            ],
        );
        let (Some(name), Some(statement)) = (name, statement) else { return self.format_unimplemented(node) };

        let mut parts = vec![f.text("create ")];
        if or_replace.is_some() {
            parts.push(f.text("or replace "));
        }
        if let Some(temp) = temp {
            parts.push(self.reg(temp));
            parts.push(f.text(" "));
        }
        if recursive.is_some() {
            parts.push(f.text("recursive "));
        }
        parts.push(f.text("view "));
        parts.push(self.reg(name));
        if let Some(columns) = columns.filter(|c| c.children_count() > 0) {
            parts.push(f.parenthesized(self.reg(columns)));
        }
        if let Some(options) = options {
            parts.push(f.text(" with "));
            parts.push(f.parenthesized(self.reg_or_placeholder(options)));
        }
        parts.push(f.text(" as"));
        let header = f.concat(&parts);
        // `with check option` is `with cascaded check option`, the default
        let check = match super::bool_value(check_local) {
            Some(true) => f.text("with local check option"),
            Some(false) => f.text("with check option"),
            None => f.empty(),
        };
        self.space_join(&[header, self.reg(statement), check], FormattingJoinPolicy::BreakAllOrNone, false)
    }

    /// `[mode] [name] type [not null] [default value]` of a function parameter or of a column of a returned table
    pub(super) fn format_function_param(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name, type_node, mode, not_null, default] = attrs!(
            self.children(node),
            [
                K::SQL_FUNCTION_PARAM_NAME,
                K::SQL_FUNCTION_PARAM_TYPE,
                K::SQL_FUNCTION_PARAM_MODE,
                K::SQL_FUNCTION_PARAM_NOT_NULL,
                K::SQL_FUNCTION_PARAM_DEFAULT,
            ],
        );
        let Some(type_node) = type_node else { return self.format_unimplemented(node) };
        let mut parts = Vec::with_capacity(7);
        for prefix in [mode, name].into_iter().flatten() {
            parts.push(self.reg(prefix));
            parts.push(f.text(" "));
        }
        parts.push(self.reg(type_node));
        if not_null.is_some() {
            parts.push(f.text(" not null"));
        }
        if let Some(default) = default {
            parts.push(f.text(" default "));
            parts.push(self.reg(default));
        }
        f.concat(&parts)
    }

    pub(super) fn format_function_parameter_mode(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        match FunctionParameterMode(super::value_u8(node)) {
            FunctionParameterMode::OUT => f.text("out"),
            FunctionParameterMode::INOUT => f.text("inout"),
            FunctionParameterMode::VARIADIC => f.text("variadic"),
            FunctionParameterMode::CONST => f.text("const"),
            FunctionParameterMode::CONSTREF => f.text("constref"),
            _ => self.format_unimplemented(node),
        }
    }

    /// The keywords of a function option, empty for SET, whose value starts with `set`
    pub(super) fn format_function_option_kind(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        match FunctionOption(super::value_u8(node)) {
            FunctionOption::CALLED_ON_NULL_INPUT => f.text("called on null input"),
            FunctionOption::STRICT => f.text("strict"),
            FunctionOption::IMMUTABLE => f.text("immutable"),
            FunctionOption::STABLE => f.text("stable"),
            FunctionOption::VOLATILE => f.text("volatile"),
            FunctionOption::SECURITY_DEFINER => f.text("security definer"),
            FunctionOption::SECURITY_INVOKER => f.text("security invoker"),
            FunctionOption::LEAKPROOF => f.text("leakproof"),
            FunctionOption::NOT_LEAKPROOF => f.text("not leakproof"),
            FunctionOption::COST => f.text("cost"),
            FunctionOption::ROWS => f.text("rows"),
            FunctionOption::SET => f.empty(),
            FunctionOption::AS => f.text("as"),
            FunctionOption::LANGUAGE => f.text("language"),
            FunctionOption::WINDOW => f.text("window"),
            _ => self.format_unimplemented(node),
        }
    }

    pub(super) fn format_create_function_option(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [kind, value] =
            attrs!(self.children(node), [K::SQL_CREATE_FUNCTION_OPTION_KIND, K::SQL_CREATE_FUNCTION_OPTION_VALUE]);
        let Some(kind) = kind else { return self.format_unimplemented(node) };
        match value {
            Some(value) if FunctionOption(super::value_u8(kind)) == FunctionOption::SET => self.reg(value),
            Some(value) => f.concat(&[self.reg(kind), f.text(" "), self.reg(value)]),
            None => self.reg(kind),
        }
    }

    /// `setof t.c%type`, `table(...)` and `only pass throughs` of a function result
    pub(super) fn format_function_return_type(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [setof, attributes, pass_through, semantics, only_pass_throughs] = attrs!(
            self.children(node),
            [
                K::SQL_FUNCTION_RETURN_TYPE_SETOF,
                K::SQL_FUNCTION_RETURN_TYPE_ATTRIBUTES,
                K::SQL_FUNCTION_RETURN_TYPE_TABLE_PASSTHROUGH,
                K::SQL_FUNCTION_RETURN_TYPE_TABLE_SEMANTICS,
                K::SQL_FUNCTION_RETURN_TYPE_ONLY_PASS_THROUGHS,
            ],
        );
        if only_pass_throughs.is_some() {
            return f.text("only pass throughs");
        }
        if setof.is_some() {
            let Some(column_type) = attributes else { return self.format_unimplemented(node) };
            return f.concat(&[f.text("setof "), self.reg(column_type)]);
        }
        let mut parts = vec![f.text("table")];
        if let Some(columns) = attributes {
            parts.push(f.parenthesized_list(self.reg(columns)));
        }
        match super::bool_value(pass_through) {
            Some(true) => parts.push(f.text(" pass through")),
            Some(false) => parts.push(f.text(" no pass through")),
            None => {}
        }
        if let Some(semantics) = semantics {
            parts.push(f.text(" "));
            parts.push(self.reg(semantics));
        }
        f.concat(&parts)
    }

    /// `with row semantics` or `with set semantics [prune|keep when empty]` of a returned table
    pub(super) fn format_table_arg_semantics(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [set, pruning] =
            attrs!(self.children(node), [K::SQL_TABLE_ARG_SEMANTICS_SET, K::SQL_TABLE_ARG_SEMANTICS_PRUNING]);
        if !super::is_true(set) {
            return f.text("with row semantics");
        }
        match super::bool_value(pruning) {
            Some(true) => f.text("with set semantics prune when empty"),
            Some(false) => f.text("with set semantics keep when empty"),
            None => f.text("with set semantics"),
        }
    }

    /// `t.c%type`, the type of a table column
    pub(super) fn format_type_table_column(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name, attributes] =
            attrs!(self.children(node), [K::SQL_TYPE_TABLE_COLUMN_NAME, K::SQL_TYPE_TABLE_COLUMN_ATTRIBUTES]);
        let (Some(name), Some(attributes)) = (name, attributes) else { return self.format_unimplemented(node) };
        f.concat(&[self.reg(name), f.text("."), self.reg(attributes), f.text("%type")])
    }

    pub(super) fn format_create_function(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name, params, order_params, star, returns, not_null, aggregate, replace, temp, options, with] = attrs!(
            self.children(node),
            [
                K::SQL_CREATE_FUNCTION_NAME,
                K::SQL_CREATE_FUNCTION_PARAMS,
                K::SQL_CREATE_FUNCTION_ORDER_PARAMS,
                K::SQL_CREATE_FUNCTION_STAR,
                K::SQL_CREATE_FUNCTION_RETURNS,
                K::SQL_CREATE_FUNCTION_RETURNS_NOT_NULL,
                K::SQL_CREATE_FUNCTION_IS_AGGREGATE,
                K::SQL_CREATE_FUNCTION_REPLACE,
                K::SQL_CREATE_FUNCTION_TEMP,
                K::SQL_CREATE_FUNCTION_OPTIONS,
                K::SQL_CREATE_FUNCTION_WITH_OPTIONS,
            ],
        );
        let Some(name) = name else { return self.format_unimplemented(node) };

        let mut header = vec![f.text("create ")];
        if replace.is_some() {
            header.push(f.text("or replace "));
        }
        if let Some(temp) = temp {
            header.push(self.reg(temp));
            header.push(f.text(" "));
        }
        header.push(f.text(if aggregate.is_some() { "aggregate " } else { "function " }));
        header.push(self.reg(name));
        header.push(self.format_function_params(star, params, order_params));

        // The clauses go on indented lines of their own if the statement does not fit on one, the parameters
        // stay at the indentation of the statement
        let mut clauses = vec![f.concat(&header)];
        if let Some(returns) = returns {
            let not_null = if not_null.is_some() { f.text(" not null") } else { f.empty() };
            clauses.push(f.indented(f.concat(&[f.text("returns "), self.reg(returns), not_null])));
        }
        if let Some(options) = options {
            clauses.push(f.indented(self.reg(options)));
        }
        if let Some(with) = with {
            clauses.push(f.indented(f.concat(&[f.text("with "), f.parenthesized_list(self.reg(with))])));
        }
        let break_separator = f.indented(f.break_());
        f.join(&clauses, f.text(" "), break_separator, Some(FormattingJoinPolicy::BreakAllOrNone), false)
    }

    pub(super) fn format_drop(&self, node: &'a Node, table: bool) -> FmtReg {
        let f = &self.fmt;
        let [name, if_exists, more_names, cascade] = attrs!(
            self.children(node),
            [K::SQL_DROP_NAME, K::SQL_DROP_IF_EXISTS, K::SQL_DROP_MORE_NAMES, K::SQL_DROP_CASCADE]
        );
        let Some(name) = name else { return self.format_unimplemented(node) };
        let object = if table { "drop table" } else { "drop view" };
        let if_exists_reg = if if_exists.is_some() { f.text(" if exists") } else { f.empty() };
        self.format_command_clauses(&[
            f.concat(&[f.text(object), if_exists_reg]),
            self.format_drop_names(name, more_names),
            cascade.map_or(f.empty(), |cascade| self.reg_or_placeholder(cascade)),
        ])
    }

    /// The names of DROP TABLE, DROP VIEW and DROP SCHEMA: the first name and the more names after it, a clause of
    /// its own that starts its line when the command breaks
    fn format_drop_names(&self, name: &'a Node, more_names: Option<&'a Node>) -> FmtReg {
        match more_names {
            Some(more_names) => {
                let mut names = vec![self.reg_or_placeholder(name)];
                names.extend(self.children(more_names).iter().map(|n| self.reg_or_placeholder(n)));
                self.comma_join_on_overflow(&names, false)
            }
            None => self.reg_or_placeholder(name),
        }
    }

    pub(super) fn format_schema_statement(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name, condition, cascade, new_name, more_names, authorization, statements] = attrs!(
            self.children(node),
            [
                K::SQL_SCHEMA_NAME,
                K::SQL_SCHEMA_IF,
                K::SQL_SCHEMA_CASCADE,
                K::SQL_SCHEMA_NEW_NAME,
                K::SQL_SCHEMA_MORE_NAMES,
                K::SQL_SCHEMA_AUTHORIZATION,
                K::SQL_SCHEMA_STATEMENTS,
            ]
        );
        match (node.node_type(), name, new_name) {
            (NodeType::OBJECT_SQL_CREATE_SCHEMA, name, _) if name.is_some() || authorization.is_some() => {
                let mut header = vec![f.text("create schema")];
                if condition.is_some() {
                    header.push(f.text(" if not exists"));
                }
                if let Some(name) = name {
                    header.push(f.text(" "));
                    header.push(self.reg_or_placeholder(name));
                }
                if let Some(authorization) = authorization {
                    header.push(f.text(" authorization "));
                    header.push(self.reg_or_placeholder(authorization));
                }
                // The statements that create the objects of the schema, each on a line of its own if they don't fit
                let mut clauses = vec![f.concat(&header)];
                if let Some(statements) = statements {
                    clauses.extend(self.children(statements).iter().map(|s| self.reg_or_placeholder(s)));
                }
                self.format_command_clauses(&clauses)
            }
            (NodeType::OBJECT_SQL_DROP_SCHEMA, Some(name), _) => {
                let condition = if condition.is_some() { f.text(" if exists") } else { f.empty() };
                self.format_command_clauses(&[
                    f.concat(&[f.text("drop schema"), condition]),
                    self.format_drop_names(name, more_names),
                    cascade.map_or(f.empty(), |cascade| self.reg_or_placeholder(cascade)),
                ])
            }
            (NodeType::OBJECT_SQL_ALTER_SCHEMA, Some(name), Some(new_name)) => {
                f.concat(&[f.text("alter schema "), self.reg(name), f.text(" rename to "), self.reg(new_name)])
            }
            _ => self.format_unimplemented(node),
        }
    }

    pub(super) fn format_alter_table(&self, node: &'a Node, statement: &'static str) -> FmtReg {
        let f = &self.fmt;
        let [name, if_exists, only, actions] = attrs!(
            self.children(node),
            [
                K::SQL_ALTER_TABLE_NAME,
                K::SQL_ALTER_TABLE_IF_EXISTS,
                K::SQL_ALTER_TABLE_ONLY,
                K::SQL_ALTER_TABLE_ACTIONS
            ]
        );
        let (Some(name), Some(actions)) = (name, actions) else { return self.format_unimplemented(node) };
        let if_exists_reg = if if_exists.is_some() { f.text("if exists ") } else { f.empty() };
        let only_reg = if only.is_some() { f.text("only ") } else { f.empty() };
        // The actions are a clause of their own, on the next line if the command does not fit
        self.format_command_clauses(&[
            f.concat(&[f.text(statement), if_exists_reg, only_reg, self.reg(name)]),
            self.reg(actions),
        ])
    }

    pub(super) fn format_alter_table_action(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [constraint] = attrs!(self.children(node), [K::SQL_ALTER_ACTION_CONSTRAINT]);
        let [column, condition, condition_after, new_name, new_table, column_type, cascade, using] = attrs!(
            self.children(node),
            [
                K::SQL_ALTER_ACTION_COLUMN,
                K::SQL_ALTER_ACTION_IF,
                K::SQL_ALTER_ACTION_IF_AFTER,
                K::SQL_ALTER_ACTION_NEW_NAME,
                K::SQL_ALTER_ACTION_NEW_TABLE,
                K::SQL_ALTER_ACTION_TYPE,
                K::SQL_ALTER_ACTION_CASCADE,
                K::SQL_ALTER_ACTION_USING,
            ],
        );
        // ` cascade` or ` restrict` after the action
        let cascade = cascade.map_or(f.empty(), |cascade| f.concat(&[f.text(" "), self.reg_or_placeholder(cascade)]));
        match (node.node_type(), column, new_name, new_table, column_type) {
            (NodeType::OBJECT_SQL_ALTER_ADD_COLUMN, Some(column), _, _, _) => {
                let condition = if condition.is_some() { f.text("if not exists ") } else { f.empty() };
                f.concat(&[f.text("add column "), condition, self.reg(column)])
            }
            (NodeType::OBJECT_SQL_ALTER_DROP_COLUMN, Some(column), _, _, _) => {
                // Trino writes the condition before the column, Hyper after it
                let condition = if condition.is_some() { f.text("if exists ") } else { f.empty() };
                let condition_after = if condition_after.is_some() { f.text(" if exists") } else { f.empty() };
                f.concat(&[f.text("drop column "), condition, self.reg(column), condition_after, cascade])
            }
            (NodeType::OBJECT_SQL_ALTER_RENAME_COLUMN, Some(column), Some(new_name), _, _) => {
                f.concat(&[f.text("rename column "), self.reg(column), f.text(" to "), self.reg(new_name)])
            }
            (NodeType::OBJECT_SQL_ALTER_RENAME_TABLE, _, _, Some(new_table), _) => {
                f.concat(&[f.text("rename to "), self.reg(new_table)])
            }
            (NodeType::OBJECT_SQL_ALTER_SET_SCHEMA, _, Some(new_name), _, _) => {
                f.concat(&[f.text("set schema "), self.reg(new_name)])
            }
            (NodeType::OBJECT_SQL_ALTER_ADD_CONSTRAINT, _, _, _, _) => match constraint {
                Some(constraint) => f.concat(&[f.text("add "), self.reg_or_placeholder(constraint)]),
                None => self.format_unimplemented(node),
            },
            (NodeType::OBJECT_SQL_ALTER_DROP_CONSTRAINT, _, _, _, _) => match constraint {
                Some(constraint) => {
                    let condition = if condition.is_some() { f.text("if exists ") } else { f.empty() };
                    f.concat(&[f.text("drop constraint "), condition, self.reg_or_placeholder(constraint), cascade])
                }
                None => self.format_unimplemented(node),
            },
            (NodeType::OBJECT_SQL_ALTER_RENAME_CONSTRAINT, _, Some(new_name), _, _) => match constraint {
                Some(constraint) => f.concat(&[
                    f.text("rename constraint "),
                    self.reg_or_placeholder(constraint),
                    f.text(" to "),
                    self.reg_or_placeholder(new_name),
                ]),
                None => self.format_unimplemented(node),
            },
            (NodeType::OBJECT_SQL_ALTER_COLUMN_TYPE, Some(column), _, _, Some(column_type)) => {
                let set_type = f.concat(&[
                    f.text("alter column "),
                    self.reg(column),
                    f.text(" set data type "),
                    self.reg(column_type),
                ]);
                // The conversion breaks before `using`
                let using = using.map_or(f.empty(), |using| f.concat(&[f.text("using "), self.reg(using)]));
                self.space_join(&[set_type, using], FormattingJoinPolicy::BreakOnOverflow, true)
            }
            _ => self.format_unimplemented(node),
        }
    }

    pub(super) fn format_attach_database_option(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [key, value] = attrs!(self.children(node), [K::SQL_GENERIC_OPTION_KEY, K::SQL_GENERIC_OPTION_VALUE]);
        let (Some(key), Some(value)) = (key, value) else { return self.format_unimplemented(node) };
        f.concat(&[self.reg(key), f.text(" = "), self.reg(value)])
    }

    pub(super) fn format_attach_database(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [path, alias, local, options] = attrs!(
            self.children(node),
            [
                K::SQL_ATTACH_DATABASE_PATH,
                K::SQL_ATTACH_DATABASE_ALIAS,
                K::SQL_ATTACH_DATABASE_LOCAL,
                K::SQL_ATTACH_DATABASE_OPTIONS,
            ],
        );
        let (Some(path), Some(alias)) = (path, alias) else { return self.format_unimplemented(node) };
        let mut parts = vec![
            f.text(if local.is_some() { "attach local database " } else { "attach database " }),
            self.reg(path),
            f.text(" as "),
            self.reg(alias),
        ];
        if let Some(options) = options {
            parts.push(f.text(" with "));
            parts.push(f.parenthesized(self.reg(options)));
        }
        f.concat(&parts)
    }

    pub(super) fn format_vararg_field(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [key, value] = attrs!(self.children(node), [K::EXT_VARARG_FIELD_KEY, K::EXT_VARARG_FIELD_VALUE]);
        let (Some(key), Some(value)) = (key, value) else { return self.format_unimplemented(node) };
        // A field as value is the rest of a key path, `a.b = v`
        if value.node_type() == NodeType::OBJECT_EXT_VARARG_FIELD {
            return f.concat(&[self.reg(key), f.text("."), self.reg(value)]);
        }
        f.concat(&[self.reg(key), f.text(" = "), self.reg(value)])
    }

    /// The values of an array in brackets, with one value per line if they don't fit on one. A single value stays next
    /// to the brackets, so that `[(` opens an object that breaks.
    pub(super) fn format_vararg_array(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [values] = attrs!(self.children(node), [K::EXT_VARARG_ARRAY_VALUES]);
        let Some(values) = values.filter(|v| v.node_type() == NodeType::ARRAY) else {
            return self.format_unimplemented(node);
        };
        if values.children_count() == 0 {
            return f.text("[]");
        }
        let items: Vec<FmtReg> = self.children(values).iter().map(|v| self.reg(v)).filter(|&r| r != 0).collect();
        if items.is_empty() {
            return f.text("[]");
        }
        if let [item] = items[..] {
            return f.concat(&[f.text("["), item, f.text("]")]);
        }
        f.bracketed_list(self.comma_join(&items, None, false))
    }

    pub(super) fn format_set(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [varargs, local] = attrs!(self.children(node), [K::EXT_SET_VARARGS, K::SQL_SET_LOCAL]);
        let Some(varargs) = varargs else { return self.format_unimplemented(node) };
        f.concat(&[f.text(if local.is_some() { "set local " } else { "set " }), self.reg(varargs)])
    }

    /// Every SET but `set a.b = v` with a single value (`OBJECT_EXT_SET`).
    ///
    /// The values of a variable follow `to`, which keeps a single value out of `OBJECT_EXT_SET`. Only values that
    /// the `to` form does not take, like a column reference first, follow `=`.
    pub(super) fn format_sql_set(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [local, name, args, parameter, default, from_current] = attrs!(
            self.children(node),
            [
                K::SQL_SET_LOCAL,
                K::SQL_SET_NAME,
                K::SQL_SET_ARGS,
                K::SQL_SET_PARAMETER,
                K::SQL_SET_DEFAULT,
                K::SQL_SET_FROM_CURRENT,
            ],
        );
        let set = f.text(if local.is_some() { "set local " } else { "set " });
        let args_reg = args.map(|a| self.reg(a));
        let rest = match parameter.map(|p| SessionParameter(super::value_u8(p))) {
            None => {
                let Some(name) = name else { return self.format_unimplemented(node) };
                let value = match (args, args_reg) {
                    _ if default.is_some() => f.text(" to default"),
                    _ if from_current.is_some() => f.text(" from current"),
                    (Some(args), Some(args_reg)) => {
                        let first = self.children(args).first().map(|a| a.node_type());
                        let to_value = matches!(
                            first,
                            Some(
                                NodeType::NAME
                                    | NodeType::LITERAL_STRING
                                    | NodeType::LITERAL_INTEGER
                                    | NodeType::LITERAL_FLOAT
                                    | NodeType::BOOL
                            )
                        );
                        f.concat(&[f.text(if to_value { " to " } else { " = " }), args_reg])
                    }
                    _ => return self.format_unimplemented(node),
                };
                f.concat(&[self.reg(name), value])
            }
            // TIME ZONE LOCAL and TIME ZONE DEFAULT are the same, and so are NAMES and NAMES DEFAULT
            Some(SessionParameter::TIME_ZONE) => {
                f.concat(&[f.text("time zone "), args_reg.unwrap_or_else(|| f.text("default"))])
            }
            Some(SessionParameter::CLIENT_ENCODING) => {
                f.concat(&[f.text("names "), args_reg.unwrap_or_else(|| f.text("default"))])
            }
            Some(SessionParameter::SESSION_AUTHORIZATION) if default.is_some() => {
                f.text("session authorization default")
            }
            Some(parameter) => {
                let keywords = match parameter {
                    SessionParameter::CATALOG => "catalog ",
                    SessionParameter::SCHEMA => "schema ",
                    SessionParameter::ROLE => "role ",
                    SessionParameter::SESSION_AUTHORIZATION => "session authorization ",
                    SessionParameter::TRANSACTION_SNAPSHOT => "transaction snapshot ",
                    SessionParameter::TRANSACTION => "transaction ",
                    SessionParameter::SESSION_CHARACTERISTICS => "session characteristics as transaction ",
                    _ => return self.format_unimplemented(node),
                };
                let Some(args_reg) = args_reg else { return self.format_unimplemented(node) };
                f.concat(&[f.text(keywords), args_reg])
            }
        };
        f.concat(&[set, rest])
    }

    /// The zone of `set time zone`
    pub(super) fn format_zone_value(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [kind, arg, modifier] =
            attrs!(self.children(node), [K::SQL_ZONE_VALUE_KIND, K::SQL_ZONE_VALUE_ARG, K::SQL_ZONE_VALUE_MOD]);
        let (Some(kind), Some(arg)) = (kind, arg) else { return self.format_unimplemented(node) };
        if ZoneValueType(super::value_u8(kind)) != ZoneValueType::INTERVAL {
            return self.reg(arg);
        }
        match modifier {
            // `interval(3) '1:00'`
            Some(precision) if precision.node_type() == NodeType::LITERAL_INTEGER => {
                f.concat(&[f.text("interval"), f.parenthesized(self.reg(precision)), f.text(" "), self.reg(arg)])
            }
            // `interval '+02:00' hour to minute`
            Some(fields) => f.concat(&[f.text("interval "), self.reg(arg), f.text(" "), self.reg(fields)]),
            None => f.concat(&[f.text("interval "), self.reg(arg)]),
        }
    }

    /// RESET, whose statement node holds a RESET node with the variable or the parameter
    pub(super) fn format_reset(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [arg, parameter, global] =
            attrs!(self.children(node), [K::SQL_RESET_ARG, K::SQL_RESET_PARAMETER, K::SQL_RESET_GLOBAL]);
        match (arg, parameter.map(|p| SessionParameter(super::value_u8(p)))) {
            (Some(arg), _) if arg.node_type() == NodeType::OBJECT_SQL_RESET => {
                f.concat(&[f.text("reset "), self.reg(arg)])
            }
            (Some(name), None) => self.reg(name),
            (None, Some(SessionParameter::ALL)) => f.text(if global.is_some() { "all global" } else { "all" }),
            (None, Some(SessionParameter::TIME_ZONE)) => f.text("time zone"),
            (None, Some(SessionParameter::TRANSACTION_ISOLATION)) => f.text("transaction isolation level"),
            (None, Some(SessionParameter::SESSION_AUTHORIZATION)) => f.text("session authorization"),
            _ => self.format_unimplemented(node),
        }
    }
}
