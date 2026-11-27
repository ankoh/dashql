//! Utility commands: DROP of objects and functions, cursors, prepared statements, SHOW, TRUNCATE, ANALYZE, COMMENT,
//! sequences, indexes, the renaming of objects and the definitions of types, domains, aggregates, operators,
//! collations and text search objects.
//!
//! The parser drops noise words without meaning, like the `from` of `fetch next from c`, the `table` of `truncate
//! table t` and the `prepare` of `deallocate prepare p`. The formatter writes `from` after a fetch direction and
//! leaves out the others.

use super::{is_true, value_u8, FmtReg, Formatter, FormattingJoinPolicy, K};
use dashql_buffers::parser::{
    CursorOption, DefinitionType, DropBehavior, DropObjectType, FetchDirection, Node, RenameObjectType, SequenceOption,
    SessionParameter,
};
use dashql_parser::attrs;

impl<'a> Formatter<'a> {
    /// `cascade` or `restrict`
    pub(super) fn format_drop_behavior_kind(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        match DropBehavior(value_u8(node)) {
            DropBehavior::CASCADE => f.text("cascade"),
            DropBehavior::RESTRICT => f.text("restrict"),
            _ => self.format_unimplemented(node),
        }
    }

    pub(super) fn format_drop_object_type(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        use DropObjectType as T;
        let text = match DropObjectType(value_u8(node)) {
            T::COLLATION => "collation",
            T::CONVERSION => "conversion",
            T::DOMAIN => "domain",
            T::EVENT_TRIGGER => "event trigger",
            T::EXTENSION => "extension",
            T::EXTERNAL_STREAM => "external stream",
            T::EXTERNAL_TABLE => "external table",
            T::FOREIGN_TABLE => "foreign table",
            T::INDEX => "index",
            T::MATERIALIZED_VIEW => "materialized view",
            T::SEQUENCE => "sequence",
            T::TYPE => "type",
            _ => return self.format_unimplemented(node),
        };
        f.text(text)
    }

    /// DROP of indexes, sequences, types and other objects
    pub(super) fn format_drop_objects(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [object_type, concurrently, if_exists, names, behavior] = attrs!(
            self.children(node),
            [K::SQL_DROP_TYPE, K::SQL_DROP_CONCURRENTLY, K::SQL_DROP_IF_EXISTS, K::SQL_DROP_NAME, K::SQL_DROP_BEHAVIOR]
        );
        let (Some(object_type), Some(names)) = (object_type, names) else { return self.format_unimplemented(node) };
        let mut header = vec![f.text("drop "), self.reg_or_placeholder(object_type)];
        if concurrently.is_some() {
            header.push(f.text(" concurrently"));
        }
        if if_exists.is_some() {
            header.push(f.text(" if exists"));
        }
        // The names and the behavior are clauses of their own, on lines of their own if the command does not fit
        let mut clauses = vec![f.concat(&header), self.reg_or_placeholder(names)];
        if let Some(behavior) = behavior {
            clauses.push(self.reg_or_placeholder(behavior));
        }
        self.format_command_clauses(&clauses)
    }

    pub(super) fn format_drop_function(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [if_exists, name, arguments, behavior] = attrs!(
            self.children(node),
            [
                K::SQL_DROP_FUNCTION_IF_EXISTS,
                K::SQL_DROP_FUNCTION_NAME,
                K::SQL_DROP_FUNCTION_ARGUMENTS,
                K::SQL_DROP_FUNCTION_BEHAVIOR,
            ]
        );
        let Some(name) = name else { return self.format_unimplemented(node) };
        let header = if if_exists.is_some() { f.text("drop function if exists") } else { f.text("drop function") };
        // The function and the behavior are clauses of their own, like the names of the other DROP commands
        let mut clauses = vec![header, self.name_with_args(name, arguments)];
        if let Some(behavior) = behavior {
            clauses.push(self.reg_or_placeholder(behavior));
        }
        self.format_command_clauses(&clauses)
    }

    pub(super) fn format_cursor_option(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        match CursorOption(value_u8(node)) {
            CursorOption::BINARY => f.text("binary"),
            CursorOption::INSENSITIVE => f.text("insensitive"),
            CursorOption::NO_SCROLL => f.text("no scroll"),
            CursorOption::SCROLL => f.text("scroll"),
            _ => self.format_unimplemented(node),
        }
    }

    pub(super) fn format_declare_cursor(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name, options, with_hold, query] = attrs!(
            self.children(node),
            [
                K::SQL_DECLARE_CURSOR_NAME,
                K::SQL_DECLARE_CURSOR_OPTIONS,
                K::SQL_DECLARE_CURSOR_WITH_HOLD,
                K::SQL_DECLARE_CURSOR_QUERY,
            ]
        );
        let (Some(name), Some(query)) = (name, query) else { return self.format_unimplemented(node) };
        let mut parts = vec![f.text("declare "), self.reg_or_placeholder(name), f.text(" ")];
        if let Some(options) = options {
            parts.push(self.reg_or_placeholder(options));
            parts.push(f.text(" "));
        }
        parts.push(f.text("cursor "));
        match with_hold {
            Some(hold) if is_true(Some(hold)) => parts.push(f.text("with hold ")),
            Some(_) => parts.push(f.text("without hold ")),
            None => {}
        }
        parts.push(f.text("for"));
        // The query follows on the same line only if the whole statement fits, like the query of a view
        let header = f.concat(&parts);
        self.space_join(&[header, self.reg_or_placeholder(query)], FormattingJoinPolicy::BreakAllOrNone, false)
    }

    /// `next`, `absolute 3`, `backward all`, the rows that FETCH and MOVE read
    pub(super) fn format_fetch_direction(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [kind, count, all] = attrs!(
            self.children(node),
            [K::SQL_FETCH_DIRECTION_KIND, K::SQL_FETCH_DIRECTION_COUNT, K::SQL_FETCH_DIRECTION_ALL]
        );
        let mut parts = Vec::with_capacity(3);
        if let Some(kind) = kind {
            let text = match FetchDirection(value_u8(kind)) {
                FetchDirection::NEXT => "next",
                FetchDirection::PRIOR => "prior",
                FetchDirection::FIRST => "first",
                FetchDirection::LAST => "last",
                FetchDirection::ABSOLUTE => "absolute",
                FetchDirection::RELATIVE => "relative",
                FetchDirection::FORWARD => "forward",
                FetchDirection::BACKWARD => "backward",
                _ => return self.format_unimplemented(node),
            };
            parts.push(f.text(text));
        }
        if let Some(count) = count {
            parts.push(self.reg_or_placeholder(count));
        }
        if all.is_some() {
            parts.push(f.text("all"));
        }
        if parts.is_empty() {
            return self.format_unimplemented(node);
        }
        f.join(&parts, f.text(" "), f.text(" "), None, false)
    }

    pub(super) fn format_fetch(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [is_move, direction, name] =
            attrs!(self.children(node), [K::SQL_FETCH_MOVE, K::SQL_FETCH_DIRECTION, K::SQL_FETCH_NAME]);
        let Some(name) = name else { return self.format_unimplemented(node) };
        let mut parts = vec![f.text(if is_move.is_some() { "move " } else { "fetch " })];
        if let Some(direction) = direction {
            parts.push(self.reg_or_placeholder(direction));
            parts.push(f.text(" from "));
        }
        parts.push(self.reg_or_placeholder(name));
        f.concat(&parts)
    }

    /// `close c` or `close all`
    pub(super) fn format_close_cursor(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name] = attrs!(self.children(node), [K::SQL_CLOSE_CURSOR_NAME]);
        match name {
            Some(name) => f.concat(&[f.text("close "), self.reg_or_placeholder(name)]),
            None => f.text("close all"),
        }
    }

    pub(super) fn format_close_stream(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [if_exists, name] = attrs!(self.children(node), [K::SQL_CLOSE_STREAM_IF_EXISTS, K::SQL_CLOSE_STREAM_NAME]);
        let Some(name) = name else { return self.format_unimplemented(node) };
        let if_exists = if if_exists.is_some() { f.text("if exists ") } else { f.empty() };
        f.concat(&[f.text("close external stream "), if_exists, self.reg_or_placeholder(name)])
    }

    pub(super) fn format_prepare(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name, types, statement] = attrs!(
            self.children(node),
            [K::SQL_PREPARE_NAME, K::SQL_PREPARE_PARAMETER_TYPES, K::SQL_PREPARE_STATEMENT]
        );
        let (Some(name), Some(statement)) = (name, statement) else { return self.format_unimplemented(node) };
        let mut parts = vec![f.text("prepare "), self.reg_or_placeholder(name)];
        if let Some(types) = types {
            parts.push(f.parenthesized_list(self.reg_or_placeholder(types)));
        }
        parts.push(f.text(" as"));
        let header = f.concat(&parts);
        self.space_join(&[header, self.reg_or_placeholder(statement)], FormattingJoinPolicy::BreakAllOrNone, false)
    }

    pub(super) fn format_execute(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name, args] = attrs!(self.children(node), [K::SQL_EXECUTE_NAME, K::SQL_EXECUTE_ARGS]);
        let Some(name) = name else { return self.format_unimplemented(node) };
        let mut parts = vec![f.text("execute "), self.reg_or_placeholder(name)];
        if let Some(args) = args {
            parts.push(f.parenthesized_list(self.reg_or_placeholder(args)));
        }
        f.concat(&parts)
    }

    /// `deallocate p` or `deallocate all`
    pub(super) fn format_deallocate(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name] = attrs!(self.children(node), [K::SQL_DEALLOCATE_NAME]);
        match name {
            Some(name) => f.concat(&[f.text("deallocate "), self.reg_or_placeholder(name)]),
            None => f.text("deallocate all"),
        }
    }

    /// `name => value`, a named argument of EXECUTE, of the options of COPY or of a domain, or `name type`, a
    /// named parameter of PREPARE
    pub(super) fn format_named_arg_expression(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name, value] = attrs!(self.children(node), [K::SQL_NAMED_ARG_EXPR_NAME, K::SQL_NAMED_ARG_EXPR_VALUE]);
        let (Some(name), Some(value)) = (name, value) else { return self.format_unimplemented(node) };
        let in_types = self
            .ast
            .get(node.parent() as usize)
            .is_some_and(|parent| parent.attribute_key() == K::SQL_PREPARE_PARAMETER_TYPES);
        let separator = if in_types { " " } else { " => " };
        f.concat(&[self.reg_or_placeholder(name), f.text(separator), self.reg_or_placeholder(value)])
    }

    pub(super) fn format_show(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [arg, parameter] = attrs!(self.children(node), [K::SQL_SHOW_ARG, K::SQL_SHOW_PARAMETER]);
        let rest = match (arg, parameter.map(|p| SessionParameter(value_u8(p)))) {
            (Some(arg), None) => self.reg_or_placeholder(arg),
            (None, Some(SessionParameter::TIME_ZONE)) => f.text("time zone"),
            (None, Some(SessionParameter::TRANSACTION_ISOLATION)) => f.text("transaction isolation level"),
            (None, Some(SessionParameter::SESSION_AUTHORIZATION)) => f.text("session authorization"),
            (None, Some(SessionParameter::ALL)) => f.text("all"),
            _ => return self.format_unimplemented(node),
        };
        f.concat(&[f.text("show "), rest])
    }

    pub(super) fn format_truncate(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [relations, restart, behavior] = attrs!(
            self.children(node),
            [K::SQL_TRUNCATE_RELATIONS, K::SQL_TRUNCATE_RESTARTSEQS, K::SQL_TRUNCATE_BEHAVIOR]
        );
        let Some(relations) = relations else { return self.format_unimplemented(node) };
        // The relations are a clause of their own, like the names of DROP
        let mut clauses = vec![f.text("truncate"), self.reg_or_placeholder(relations)];
        if restart.is_some() {
            clauses.push(f.text("restart identity"));
        }
        if let Some(behavior) = behavior {
            clauses.push(self.reg_or_placeholder(behavior));
        }
        self.format_command_clauses(&clauses)
    }

    pub(super) fn format_analyze(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [verbose, table, columns] =
            attrs!(self.children(node), [K::SQL_ANALYZE_VERBOSE, K::SQL_ANALYZE_TABLE, K::SQL_ANALYZE_COLUMNS]);
        let mut parts = vec![f.text("analyze")];
        if verbose.is_some() {
            parts.push(f.text(" verbose"));
        }
        if let Some(table) = table {
            parts.push(f.text(" "));
            parts.push(self.reg_or_placeholder(table));
            if let Some(columns) = columns {
                parts.push(f.text(" "));
                parts.push(f.parenthesized_list(self.reg_or_placeholder(columns)));
            }
        }
        f.concat(&parts)
    }

    /// `comment on column t.x is 'text'`
    pub(super) fn format_comment(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name, description] = attrs!(self.children(node), [K::SQL_COMMENT_NAME, K::SQL_COMMENT_DESCRIPTION]);
        let Some(name) = name else { return self.format_unimplemented(node) };
        let description = match description {
            Some(description) => self.reg_or_placeholder(description),
            None => f.text("null"),
        };
        let header = f.concat(&[f.text("comment on column "), self.reg_or_placeholder(name), f.text(" is")]);
        self.space_join(&[header, description], FormattingJoinPolicy::BreakAllOrNone, true)
    }

    /// `increment by 2`, `no maxvalue`, `owned by t.x`, an option of CREATE and ALTER SEQUENCE
    pub(super) fn format_sequence_option(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [kind, value, no] = attrs!(
            self.children(node),
            [K::SQL_SEQUENCE_OPTION_KIND, K::SQL_SEQUENCE_OPTION_VALUE, K::SQL_SEQUENCE_OPTION_NO]
        );
        let Some(kind) = kind else { return self.format_unimplemented(node) };
        let kind = SequenceOption(value_u8(kind));
        let keyword = match (kind, no.is_some(), value.is_some()) {
            (SequenceOption::MIN_VALUE, true, false) => return f.text("no minvalue"),
            (SequenceOption::MAX_VALUE, true, false) => return f.text("no maxvalue"),
            (SequenceOption::CYCLE, true, false) => return f.text("no cycle"),
            (SequenceOption::CYCLE, false, false) => return f.text("cycle"),
            (SequenceOption::RESTART, false, false) => return f.text("restart"),
            (SequenceOption::AS, false, true) => "as ",
            (SequenceOption::INCREMENT, false, true) => "increment by ",
            (SequenceOption::MIN_VALUE, false, true) => "minvalue ",
            (SequenceOption::MAX_VALUE, false, true) => "maxvalue ",
            (SequenceOption::START, false, true) => "start with ",
            (SequenceOption::RESTART, false, true) => "restart with ",
            (SequenceOption::CACHE, false, true) => "cache ",
            (SequenceOption::OWNED_BY, false, true) => "owned by ",
            _ => return self.format_unimplemented(node),
        };
        let Some(value) = value else { return self.format_unimplemented(node) };
        f.concat(&[f.text(keyword), self.reg_or_placeholder(value)])
    }

    pub(super) fn format_create_sequence(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [if_not_exists, temp, name, options] = attrs!(
            self.children(node),
            [
                K::SQL_CREATE_SEQUENCE_IF_NOT_EXISTS,
                K::SQL_CREATE_SEQUENCE_TEMP,
                K::SQL_CREATE_SEQUENCE_NAME,
                K::SQL_CREATE_SEQUENCE_OPTIONS,
            ]
        );
        let Some(name) = name else { return self.format_unimplemented(node) };
        let mut header = vec![f.text("create ")];
        if let Some(temp) = temp.filter(|t| self.reg(t) != 0) {
            header.push(self.reg(temp));
            header.push(f.text(" "));
        }
        header.push(f.text("sequence "));
        if if_not_exists.is_some() {
            header.push(f.text("if not exists "));
        }
        header.push(self.reg_or_placeholder(name));
        let mut clauses = vec![f.concat(&header)];
        if let Some(options) = options {
            clauses.push(self.reg_or_placeholder(options));
        }
        self.format_command_clauses(&clauses)
    }

    pub(super) fn format_alter_sequence(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [if_exists, name, options] = attrs!(
            self.children(node),
            [K::SQL_ALTER_SEQUENCE_IF_EXISTS, K::SQL_ALTER_SEQUENCE_NAME, K::SQL_ALTER_SEQUENCE_OPTIONS]
        );
        let Some(name) = name else { return self.format_unimplemented(node) };
        let if_exists = if if_exists.is_some() { f.text("if exists ") } else { f.empty() };
        let mut clauses = vec![f.concat(&[f.text("alter sequence "), if_exists, self.reg_or_placeholder(name)])];
        if let Some(options) = options {
            clauses.push(self.reg_or_placeholder(options));
        }
        self.format_command_clauses(&clauses)
    }

    pub(super) fn format_create_index(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [if_not_exists, unique, concurrent, name, relation, method, params, options] = attrs!(
            self.children(node),
            [
                K::SQL_CREATE_INDEX_IF_NOT_EXISTS,
                K::SQL_CREATE_INDEX_UNIQUE,
                K::SQL_CREATE_INDEX_CONCURRENT,
                K::SQL_CREATE_INDEX_NAME,
                K::SQL_CREATE_INDEX_RELATION,
                K::SQL_CREATE_INDEX_ACCESS_METHOD,
                K::SQL_CREATE_INDEX_INDEX_PARAMS,
                K::SQL_CREATE_INDEX_OPTIONS,
            ]
        );
        let (Some(relation), Some(params)) = (relation, params) else { return self.format_unimplemented(node) };
        let mut header = vec![f.text(if unique.is_some() { "create unique index" } else { "create index" })];
        if concurrent.is_some() {
            header.push(f.text(" concurrently"));
        }
        if if_not_exists.is_some() {
            header.push(f.text(" if not exists"));
        }
        if let Some(name) = name {
            header.push(f.text(" "));
            header.push(self.reg_or_placeholder(name));
        }
        let mut clauses = vec![f.concat(&header)];
        let mut target = vec![f.text("on "), self.reg_or_placeholder(relation)];
        if let Some(method) = method {
            target.push(f.text(" using "));
            target.push(self.reg_or_placeholder(method));
        }
        target.push(f.text(" "));
        target.push(f.parenthesized_list(self.reg_or_placeholder(params)));
        clauses.push(f.concat(&target));
        if let Some(options) = options {
            clauses.push(f.concat(&[f.text("with "), f.parenthesized_list(self.reg_or_placeholder(options))]));
        }
        self.format_command_clauses(&clauses)
    }

    /// `name = value`, `name` or `space.name = value`, an option of an index or of the old aggregate syntax
    pub(super) fn format_definition(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name, name2, arg] =
            attrs!(self.children(node), [K::SQL_DEFINITION_NAME, K::SQL_DEFINITION_NAME2, K::SQL_DEFINITION_ARG]);
        let Some(name) = name else { return self.format_unimplemented(node) };
        let mut parts = vec![self.reg_or_placeholder(name)];
        if let Some(name2) = name2 {
            parts.push(f.text("."));
            parts.push(self.reg_or_placeholder(name2));
        }
        if let Some(arg) = arg {
            parts.push(f.text(" = "));
            parts.push(self.reg_or_placeholder(arg));
        }
        f.concat(&parts)
    }

    /// `(int)`, `(*)` or `(a int order by b int)`, the argument types of an aggregate
    pub(super) fn format_aggregation_arguments(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [star, params, order_params] = attrs!(
            self.children(node),
            [K::SQL_CREATE_FUNCTION_STAR, K::SQL_CREATE_FUNCTION_PARAMS, K::SQL_CREATE_FUNCTION_ORDER_PARAMS]
        );
        let params = params.filter(|p| p.children_count() > 0).map(|p| self.reg_or_placeholder(p));
        let order_params = order_params.map(|p| f.concat(&[f.text("order by "), self.reg_or_placeholder(p)]));
        match (star, params, order_params) {
            (Some(_), _, _) => f.text("(*)"),
            (None, Some(params), Some(order_params)) => {
                f.parenthesized_list(f.concat(&[params, f.text(" "), order_params]))
            }
            (None, Some(params), None) | (None, None, Some(params)) => f.parenthesized_list(params),
            (None, None, None) => f.text("()"),
        }
    }

    /// CREATE of aggregates, operators, types, domains, collations and text search objects
    pub(super) fn format_create_definition(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [kind, old_syntax, temp, name, args, definition, from] = attrs!(
            self.children(node),
            [
                K::SQL_CREATE_DEFINITION_KIND,
                K::SQL_CREATE_DEFINITION_OLD_SYNTAX,
                K::SQL_CREATE_DEFINITION_TEMP,
                K::SQL_CREATE_DEFINITION_NAME,
                K::SQL_CREATE_DEFINITION_ARGS,
                K::SQL_CREATE_DEFINITION_DEFINITION,
                K::SQL_CREATE_DEFINITION_FROM,
            ]
        );
        let (Some(kind), Some(name)) = (kind, name) else { return self.format_unimplemented(node) };
        let kind = DefinitionType(value_u8(kind));
        use DefinitionType as T;
        let keyword = match kind {
            T::AGGREGATE => "aggregate ",
            T::OPERATOR => "operator ",
            T::TYPE | T::STRUCT | T::ENUM | T::RANGE => "type ",
            T::DOMAIN => "domain ",
            T::COLLATION => "collation ",
            T::TEXT_SEARCH_PARSER => "text search parser ",
            T::TEXT_SEARCH_DICTIONARY => "text search dictionary ",
            T::TEXT_SEARCH_TEMPLATE => "text search template ",
            T::TEXT_SEARCH_CONFIGURATION => "text search configuration ",
            _ => return self.format_unimplemented(node),
        };
        let mut header = vec![f.text("create ")];
        if let Some(temp) = temp.filter(|t| self.reg(t) != 0) {
            header.push(self.reg(temp));
            header.push(f.text(" "));
        }
        header.push(f.text(keyword));
        header.push(self.reg_or_placeholder(name));
        // The aggregate arguments follow the name, the old aggregate syntax has none
        if let Some(args) = args.filter(|_| kind == T::AGGREGATE && old_syntax.is_none()) {
            header.push(self.reg_or_placeholder(args));
        }
        let definition_list = definition.map(|d| f.parenthesized_list(self.reg_or_placeholder(d)));
        let body = match kind {
            T::STRUCT => Some(f.concat(&[f.text("as "), definition_list.unwrap_or_else(|| f.text("()"))])),
            T::ENUM => Some(f.concat(&[f.text("as enum "), definition_list.unwrap_or_else(|| f.text("()"))])),
            T::RANGE => {
                let Some(definition_list) = definition_list else { return self.format_unimplemented(node) };
                Some(f.concat(&[f.text("as range "), definition_list]))
            }
            T::DOMAIN => {
                let Some(definition) = definition else { return self.format_unimplemented(node) };
                let mut parts = vec![f.text("as "), self.reg_or_placeholder(definition)];
                if let Some(args) = args {
                    parts.push(f.text(" with "));
                    parts.push(f.parenthesized_list(self.reg_or_placeholder(args)));
                }
                Some(f.concat(&parts))
            }
            T::COLLATION if from.is_some() => {
                from.map(|from| f.concat(&[f.text("from "), self.reg_or_placeholder(from)]))
            }
            _ => definition_list,
        };
        // The definition follows the name like the columns of CREATE TABLE
        if let Some(body) = body {
            header.push(f.text(" "));
            header.push(body);
        }
        f.concat(&header)
    }

    /// ALTER ... RENAME of objects of every kind but tables, views, columns and schemas
    pub(super) fn format_rename_object(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [kind, if_exists, locality, name, arg, new_name, behavior] = attrs!(
            self.children(node),
            [
                K::SQL_RENAME_OBJECT_KIND,
                K::SQL_RENAME_OBJECT_IF_EXISTS,
                K::SQL_RENAME_OBJECT_LOCALITY,
                K::SQL_RENAME_OBJECT_NAME,
                K::SQL_RENAME_OBJECT_ARG,
                K::SQL_RENAME_OBJECT_NEW_NAME,
                K::SQL_RENAME_OBJECT_BEHAVIOR,
            ]
        );
        let (Some(kind), Some(name), Some(new_name)) = (kind, name, new_name) else {
            return self.format_unimplemented(node);
        };
        use RenameObjectType as T;
        let kind = RenameObjectType(value_u8(kind));
        let keyword = match kind {
            T::AGGREGATE => "aggregate ",
            T::COLLATION => "collation ",
            T::CONVERSION => "conversion ",
            T::DATABASE => "database ",
            T::DOMAIN | T::DOMAIN_CONSTRAINT => "domain ",
            T::EVENT_TRIGGER => "event trigger ",
            T::FOREIGN_DATA_WRAPPER => "foreign data wrapper ",
            T::FOREIGN_TABLE | T::FOREIGN_TABLE_COLUMN => "foreign table ",
            T::FUNCTION => "function ",
            T::INDEX => "index ",
            T::LANGUAGE => "language ",
            T::MATERIALIZED_VIEW | T::MATERIALIZED_VIEW_COLUMN => "materialized view ",
            T::OPERATOR_CLASS => "operator class ",
            T::OPERATOR_FAMILY => "operator family ",
            T::POLICY => "policy ",
            T::ROLE => "role ",
            T::RULE => "rule ",
            T::SEQUENCE => "sequence ",
            T::SERVER => "server ",
            T::TABLESPACE => "tablespace ",
            T::TEXT_SEARCH_CONFIGURATION => "text search configuration ",
            T::TEXT_SEARCH_DICTIONARY => "text search dictionary ",
            T::TEXT_SEARCH_PARSER => "text search parser ",
            T::TEXT_SEARCH_TEMPLATE => "text search template ",
            T::TRIGGER => "trigger ",
            T::TYPE | T::TYPE_ATTRIBUTE => "type ",
            _ => return self.format_unimplemented(node),
        };
        let mut header = vec![f.text("alter ")];
        if let Some(locality) = locality.filter(|l| self.reg(l) != 0) {
            header.push(self.reg(locality));
            header.push(f.text(" "));
        }
        header.push(f.text(keyword));
        if if_exists.is_some() {
            header.push(f.text("if exists "));
        }
        let name = self.reg_or_placeholder(name);
        let new_name = self.reg_or_placeholder(new_name);
        let arg = arg.map(|a| self.reg_or_placeholder(a));
        // The renamed object, and what the renaming changes
        let rename = match (kind, arg) {
            (T::AGGREGATE, Some(arg)) => {
                header.push(name);
                header.push(arg);
                f.concat(&[f.text("rename to "), new_name])
            }
            (T::DOMAIN_CONSTRAINT, Some(arg)) => {
                header.push(name);
                f.concat(&[f.text("rename constraint "), arg, f.text(" to "), new_name])
            }
            (T::OPERATOR_CLASS | T::OPERATOR_FAMILY, Some(arg)) => {
                header.extend([name, f.text(" using "), arg]);
                f.concat(&[f.text("rename to "), new_name])
            }
            (T::POLICY | T::RULE | T::TRIGGER, Some(arg)) => {
                header.extend([name, f.text(" on "), arg]);
                f.concat(&[f.text("rename to "), new_name])
            }
            (T::MATERIALIZED_VIEW_COLUMN | T::FOREIGN_TABLE_COLUMN, Some(arg)) => {
                header.push(arg);
                f.concat(&[f.text("rename column "), name, f.text(" to "), new_name])
            }
            (T::TYPE_ATTRIBUTE, Some(arg)) => {
                header.push(arg);
                let mut parts = vec![f.text("rename attribute "), name, f.text(" to "), new_name];
                if let Some(behavior) = behavior {
                    parts.push(f.text(" "));
                    parts.push(self.reg_or_placeholder(behavior));
                }
                f.concat(&parts)
            }
            (
                T::AGGREGATE
                | T::DOMAIN_CONSTRAINT
                | T::OPERATOR_CLASS
                | T::OPERATOR_FAMILY
                | T::POLICY
                | T::RULE
                | T::TRIGGER
                | T::MATERIALIZED_VIEW_COLUMN
                | T::FOREIGN_TABLE_COLUMN
                | T::TYPE_ATTRIBUTE,
                None,
            ) => return self.format_unimplemented(node),
            (_, None) => {
                header.push(name);
                f.concat(&[f.text("rename to "), new_name])
            }
            (_, Some(_)) => return self.format_unimplemented(node),
        };
        self.format_command_clauses(&[f.concat(&header), rename])
    }
}
