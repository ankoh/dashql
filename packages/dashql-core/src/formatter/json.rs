//! SQL/JSON functions and external streams.

use super::{value_u8, FmtReg, Formatter, FormattingJoinPolicy, K};
use dashql_buffers::parser::{JsonBehavior, JsonWrapper, Node, NodeType};
use dashql_parser::attrs;

/// The value of a BOOL node, None without the node
fn bool_value(node: Option<&Node>) -> Option<bool> {
    node.filter(|n| n.node_type() == NodeType::BOOL).map(|n| n.children_begin_or_value() != 0)
}

impl<'a> Formatter<'a> {
    /// A JSON function: its name and its arguments in parentheses, the clauses after the arguments
    fn format_json_call(&self, name: &'static str, arguments: &[FmtReg], clauses: &[FmtReg]) -> FmtReg {
        let f = &self.fmt;
        let arguments = self.comma_join_on_overflow(arguments, false);
        let mut parts = vec![arguments];
        parts.extend(clauses.iter().copied().filter(|&c| c != 0));
        let inner = self.space_join(&parts, FormattingJoinPolicy::BreakOnOverflow, true);
        if inner == 0 {
            return f.concat(&[f.text(name), f.text("()")]);
        }
        f.concat(&[f.text(name), f.parenthesized(inner)])
    }

    /// `null on null` or `absent on null`
    fn json_nulls_clause(&self, absent: Option<&Node>) -> FmtReg {
        match bool_value(absent) {
            Some(true) => self.fmt.text("absent on null"),
            Some(false) => self.fmt.text("null on null"),
            None => 0,
        }
    }

    /// `with unique keys` or `without unique keys`
    fn json_unique_clause(&self, unique: Option<&Node>) -> FmtReg {
        match bool_value(unique) {
            Some(true) => self.fmt.text("with unique keys"),
            Some(false) => self.fmt.text("without unique keys"),
            None => 0,
        }
    }

    /// `passing <value> as <name>, ...`
    fn json_passing_clause(&self, passing: Option<&Node>) -> FmtReg {
        let f = &self.fmt;
        match passing.filter(|p| p.children_count() > 0) {
            Some(passing) => f.concat(&[f.text("passing "), self.reg_or_placeholder(passing)]),
            None => 0,
        }
    }

    /// `returning <type>`
    fn json_returning_clause(&self, returning: Option<&Node>) -> FmtReg {
        let f = &self.fmt;
        match returning {
            Some(returning) => f.concat(&[f.text("returning "), self.reg_or_placeholder(returning)]),
            None => 0,
        }
    }

    /// The input and the path of `json_query`, `json_value` and `json_exists`
    fn json_input_and_path(&self, input: Option<&Node>, path: Option<&Node>) -> Option<[FmtReg; 2]> {
        Some([self.reg_or_placeholder(input?), self.reg_or_placeholder(path?)])
    }

    pub(super) fn format_json_parse(&self, node: &'a Node) -> FmtReg {
        let [value, unique] = attrs!(self.children(node), [K::SQL_JSON_VALUE, K::SQL_JSON_UNIQUE_KEYS]);
        let Some(value) = value else { return self.format_unimplemented(node) };
        self.format_json_call("json", &[self.reg_or_placeholder(value)], &[self.json_unique_clause(unique)])
    }

    pub(super) fn format_json_scalar(&self, node: &'a Node) -> FmtReg {
        let [value] = attrs!(self.children(node), [K::SQL_JSON_VALUE]);
        let Some(value) = value else { return self.format_unimplemented(node) };
        self.format_json_call("json_scalar", &[self.reg_or_placeholder(value)], &[])
    }

    pub(super) fn format_json_object(&self, node: &'a Node) -> FmtReg {
        let [members, absent, unique] =
            attrs!(self.children(node), [K::SQL_JSON_MEMBERS, K::SQL_JSON_ABSENT_ON_NULL, K::SQL_JSON_UNIQUE_KEYS]);
        let members = members.filter(|m| m.children_count() > 0).map_or(0, |m| self.reg_or_placeholder(m));
        let clauses = [self.json_nulls_clause(absent), self.json_unique_clause(unique)];
        self.format_json_call("json_object", &[members], &clauses)
    }

    pub(super) fn format_json_member(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [key, value] = attrs!(self.children(node), [K::SQL_JSON_MEMBER_KEY, K::SQL_JSON_MEMBER_VALUE]);
        let (Some(key), Some(value)) = (key, value) else { return self.format_unimplemented(node) };
        f.concat(&[self.reg_or_placeholder(key), f.text(": "), self.reg_or_placeholder(value)])
    }

    pub(super) fn format_json_array(&self, node: &'a Node) -> FmtReg {
        let [values, absent] = attrs!(self.children(node), [K::SQL_JSON_VALUES, K::SQL_JSON_ABSENT_ON_NULL]);
        let values = values.filter(|v| v.children_count() > 0).map_or(0, |v| self.reg_or_placeholder(v));
        self.format_json_call("json_array", &[values], &[self.json_nulls_clause(absent)])
    }

    pub(super) fn format_json_query(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [input, path, passing, returning, wrapper, quotes, behaviors] = attrs!(
            self.children(node),
            [
                K::SQL_JSON_VALUE,
                K::SQL_JSON_PATH,
                K::SQL_JSON_PASSING,
                K::SQL_JSON_RETURNING,
                K::SQL_JSON_WRAPPER,
                K::SQL_JSON_QUOTES,
                K::SQL_JSON_BEHAVIORS,
            ],
        );
        let Some(arguments) = self.json_input_and_path(input, path) else { return self.format_unimplemented(node) };
        let wrapper = match wrapper.map(|w| JsonWrapper(value_u8(w))) {
            Some(JsonWrapper::WITHOUT) => f.text("without wrapper"),
            Some(JsonWrapper::CONDITIONAL) => f.text("with conditional wrapper"),
            Some(JsonWrapper::UNCONDITIONAL) => f.text("with unconditional wrapper"),
            Some(_) => return self.format_unimplemented(node),
            None => 0,
        };
        let quotes = match bool_value(quotes) {
            Some(true) => f.text("keep quotes"),
            Some(false) => f.text("omit quotes"),
            None => 0,
        };
        let clauses = [
            self.json_passing_clause(passing),
            self.json_returning_clause(returning),
            wrapper,
            quotes,
            behaviors.map_or(0, |b| self.reg_or_placeholder(b)),
        ];
        self.format_json_call("json_query", &arguments, &clauses)
    }

    pub(super) fn format_json_value(&self, node: &'a Node) -> FmtReg {
        let [input, path, passing, returning, behaviors] = attrs!(
            self.children(node),
            [K::SQL_JSON_VALUE, K::SQL_JSON_PATH, K::SQL_JSON_PASSING, K::SQL_JSON_RETURNING, K::SQL_JSON_BEHAVIORS],
        );
        let Some(arguments) = self.json_input_and_path(input, path) else { return self.format_unimplemented(node) };
        let clauses = [
            self.json_passing_clause(passing),
            self.json_returning_clause(returning),
            behaviors.map_or(0, |b| self.reg_or_placeholder(b)),
        ];
        self.format_json_call("json_value", &arguments, &clauses)
    }

    pub(super) fn format_json_exists(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [input, path, passing, on_error] = attrs!(
            self.children(node),
            [K::SQL_JSON_VALUE, K::SQL_JSON_PATH, K::SQL_JSON_PASSING, K::SQL_JSON_ON_ERROR],
        );
        let Some(arguments) = self.json_input_and_path(input, path) else { return self.format_unimplemented(node) };
        let on_error = on_error.map_or(0, |b| f.concat(&[self.reg_or_placeholder(b), f.text(" on error")]));
        self.format_json_call("json_exists", &arguments, &[self.json_passing_clause(passing), on_error])
    }

    /// A value with an optional `format json`
    pub(super) fn format_json_input(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [value, format] = attrs!(self.children(node), [K::SQL_JSON_VALUE, K::SQL_JSON_FORMAT]);
        let Some(value) = value else { return self.format_unimplemented(node) };
        let value = self.reg_or_placeholder(value);
        match bool_value(format) {
            Some(true) => f.concat(&[value, f.text(" format json")]),
            _ => value,
        }
    }

    /// `<value> as <name>` of a `passing` clause
    pub(super) fn format_json_argument(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name, value] = attrs!(self.children(node), [K::SQL_JSON_ARGUMENT_NAME, K::SQL_JSON_ARGUMENT_VALUE]);
        let (Some(name), Some(value)) = (name, value) else { return self.format_unimplemented(node) };
        f.concat(&[self.reg_or_placeholder(value), f.text(" as "), self.reg_or_placeholder(name)])
    }

    /// `<behavior> on empty <behavior> on error`
    pub(super) fn format_json_behaviors(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [on_empty, on_error] = attrs!(self.children(node), [K::SQL_JSON_ON_EMPTY, K::SQL_JSON_ON_ERROR]);
        let on_empty = on_empty.map_or(0, |b| f.concat(&[self.reg_or_placeholder(b), f.text(" on empty")]));
        let on_error = on_error.map_or(0, |b| f.concat(&[self.reg_or_placeholder(b), f.text(" on error")]));
        if on_empty == 0 && on_error == 0 {
            return self.format_unimplemented(node);
        }
        self.space_join(&[on_empty, on_error], FormattingJoinPolicy::BreakOnOverflow, false)
    }

    pub(super) fn format_json_behavior(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [kind, default] = attrs!(self.children(node), [K::SQL_JSON_BEHAVIOR_KIND, K::SQL_JSON_BEHAVIOR_DEFAULT]);
        let Some(kind) = kind else { return self.format_unimplemented(node) };
        match JsonBehavior(value_u8(kind)) {
            JsonBehavior::NULL_ => f.text("null"),
            JsonBehavior::ERROR => f.text("error"),
            JsonBehavior::TRUE => f.text("true"),
            JsonBehavior::FALSE => f.text("false"),
            JsonBehavior::UNKNOWN => f.text("unknown"),
            JsonBehavior::EMPTY_ARRAY => f.text("empty array"),
            JsonBehavior::EMPTY_OBJECT => f.text("empty object"),
            JsonBehavior::DEFAULT => match default {
                Some(default) => f.concat(&[f.text("default "), self.reg_or_placeholder(default)]),
                None => self.format_unimplemented(node),
            },
            _ => self.format_unimplemented(node),
        }
    }

    /// `external stream <name>` with its cardinality hint
    pub(super) fn format_external_stream(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [name, cardinality] =
            attrs!(self.children(node), [K::SQL_EXTERNAL_STREAM_NAME, K::SQL_EXTERNAL_STREAM_CARDINALITY]);
        let Some(name) = name else { return self.format_unimplemented(node) };
        let stream = f.concat(&[f.text("external stream "), self.reg_or_placeholder(name)]);
        match cardinality {
            Some(cardinality) => {
                f.concat(&[stream, f.text(" (with (cardinality "), self.reg_or_placeholder(cardinality), f.text("))")])
            }
            None => stream,
        }
    }
}
