//! COPY, external tables and streams, and the commands of Hyper databases: CREATE, ALTER, DETACH, DROP, UNLOAD,
//! VALIDATE, IMPORT and EXPORT.
//!
//! The parser keeps no difference between `copy ... from stdin` and a COPY without a location, nor between the
//! optional `with` and `as` of the COPY options and their absence. The formatter writes `stdin` and `with`.

use super::{bool_value, value_u8, FmtReg, Formatter, K};
use dashql_buffers::parser::{
    CopyDirection, CopyOption, DatabaseCopyDirection, DatabaseLocality, DatabaseOption, Node, NodeType, StreamType,
};
use dashql_parser::attrs;

impl<'a> Formatter<'a> {
    /// Is an option of COPY, of an external table or of an external stream a legacy option, like `csv` or
    /// `force quote a, b`? The legacy options have no commas and no parentheses.
    pub(super) fn is_legacy_copy_option(&self, option: &Node) -> bool {
        option.node_type() == NodeType::OBJECT_SQL_COPY_OPTION
            && self.children(option).iter().any(|a| a.attribute_key() == K::SQL_COPY_OPTION_KIND)
    }

    /// Are the options of COPY, of an external table or of an external stream the legacy options?
    pub(super) fn are_legacy_copy_options(&self, options: &Node) -> bool {
        self.children(options).first().is_some_and(|option| self.is_legacy_copy_option(option))
    }

    /// Are the columns of an external table or stream a list of column definitions, not the table of `like t`?
    pub(super) fn is_column_list(&self, schema: &Node) -> bool {
        self.children(schema).first().is_some_and(|c| c.node_type() == NodeType::OBJECT_SQL_COLUMN_DEF)
    }

    /// The options of COPY: the legacy options as written, the others in parentheses
    fn format_copy_options(&self, options: &'a Node) -> FmtReg {
        let options_reg = self.reg_or_placeholder(options);
        if self.are_legacy_copy_options(options) {
            options_reg
        } else {
            self.fmt.parenthesized_list(options_reg)
        }
    }

    pub(super) fn format_copy_option_kind(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        use CopyOption as O;
        let text = match CopyOption(value_u8(node)) {
            O::BINARY => "binary",
            O::CSV => "csv",
            O::DELIMITER => "delimiter",
            O::ENCODING => "encoding",
            O::ESCAPE => "escape",
            O::FORCE_NOT_NULL => "force not null",
            O::FORCE_NULL => "force null",
            O::FORCE_QUOTE => "force quote",
            O::FREEZE => "freeze",
            O::HEADER => "header",
            O::NULL_ => "null",
            O::OIDS => "oids",
            O::QUOTE => "quote",
            O::SANITIZE => "sanitize",
            _ => return self.format_unimplemented(node),
        };
        f.text(text)
    }

    /// `csv`, `delimiter ';'`, `force quote *`, a legacy option of COPY, or `format csv`, a generic one
    pub(super) fn format_copy_option(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [kind, name, value] =
            attrs!(self.children(node), [K::SQL_COPY_OPTION_KIND, K::SQL_COPY_OPTION_NAME, K::SQL_COPY_OPTION_VALUE]);
        let value = value.map(|v| self.reg_or_placeholder(v));
        match (node.attribute_key(), kind, name, value) {
            // The options between the table and the location
            (K::SQL_COPY_BINARY, Some(_), None, None) => f.text("binary"),
            (K::SQL_COPY_OIDS, Some(_), None, None) => f.text("with oids"),
            (K::SQL_COPY_DELIMITER, Some(_), None, Some(value)) => f.concat(&[f.text("using delimiters "), value]),
            // `force quote *` quotes all columns
            (_, Some(kind), None, None) if CopyOption(value_u8(kind)) == CopyOption::FORCE_QUOTE => {
                f.concat(&[self.reg_or_placeholder(kind), f.text(" *")])
            }
            (_, Some(head), None, value) | (_, None, Some(head), value) => {
                let head = self.reg_or_placeholder(head);
                match value {
                    Some(value) => f.concat(&[head, f.text(" "), value]),
                    None => head,
                }
            }
            _ => self.format_unimplemented(node),
        }
    }

    /// `'file.csv'`, `program 'cmd'`, `s3_location(...)`, `stdout`, ..., the source or target of COPY
    fn format_copy_location(&self, location: Option<&'a Node>) -> FmtReg {
        match location {
            Some(location) => self.reg_or_placeholder(location),
            None => self.fmt.text("stdin"),
        }
    }

    pub(super) fn format_copy(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [direction, binary, relation, columns, oids, query, location, delimiter, options, partition_by] = attrs!(
            self.children(node),
            [
                K::SQL_COPY_DIRECTION,
                K::SQL_COPY_BINARY,
                K::SQL_COPY_RELATION,
                K::SQL_COPY_COLUMNS,
                K::SQL_COPY_OIDS,
                K::SQL_COPY_QUERY,
                K::SQL_COPY_LOCATION,
                K::SQL_COPY_DELIMITER,
                K::SQL_COPY_OPTIONS,
                K::SQL_COPY_PARTITION_BY,
            ]
        );
        let Some(direction) = direction else { return self.format_unimplemented(node) };
        let mut header = vec![f.text("copy ")];
        if let Some(binary) = binary {
            header.push(self.reg_or_placeholder(binary));
            header.push(f.text(" "));
        }
        match (relation, query) {
            (Some(relation), None) => {
                header.push(self.reg_or_placeholder(relation));
                if let Some(columns) = columns {
                    header.push(f.text(" "));
                    header.push(f.parenthesized_list(self.reg_or_placeholder(columns)));
                }
            }
            (None, Some(query)) => header.push(f.parenthesized(self.reg_or_placeholder(query))),
            _ => return self.format_unimplemented(node),
        }
        if let Some(oids) = oids {
            header.push(f.text(" "));
            header.push(self.reg_or_placeholder(oids));
        }
        let keyword = match CopyDirection(value_u8(direction)) {
            CopyDirection::FROM => "from ",
            CopyDirection::TO => "to ",
            _ => return self.format_unimplemented(node),
        };
        let mut clauses = vec![f.concat(&header), f.concat(&[f.text(keyword), self.format_copy_location(location)])];
        if let Some(delimiter) = delimiter {
            clauses.push(self.reg_or_placeholder(delimiter));
        }
        if let Some(options) = options {
            clauses.push(f.concat(&[f.text("with "), self.format_copy_options(options)]));
        }
        if let Some(partition_by) = partition_by {
            clauses.push(f.concat(&[f.text("partition by "), self.reg_or_placeholder(partition_by)]));
        }
        self.format_command_clauses(&clauses)
    }

    /// `program 'cmd'`, a location of COPY that runs a command
    pub(super) fn format_program_call(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [command] = attrs!(self.children(node), [K::SQL_PROGRAM_CALL_COMMAND]);
        let Some(command) = command else { return self.format_unimplemented(node) };
        f.concat(&[f.text("program "), self.reg_or_placeholder(command)])
    }

    /// `s3_location('s3://bucket/key', region => 'us-east-1')`, a location function of COPY
    pub(super) fn format_function_call(&self, node: &'a Node) -> FmtReg {
        let [name, args] = attrs!(self.children(node), [K::SQL_FUNCTION_CALL_NAME, K::SQL_FUNCTION_CALL_ARGS]);
        let Some(name) = name else { return self.format_unimplemented(node) };
        self.name_with_args(name, args)
    }

    pub(super) fn format_function_name(&self, node: &'a Node) -> FmtReg {
        let [name] = attrs!(self.children(node), [K::SQL_FUNCTION_NAME_NAME]);
        let Some(name) = name else { return self.format_unimplemented(node) };
        self.reg_or_placeholder(name)
    }

    /// The columns of an external table or stream: `(x int)`, `like t` or `()`
    fn format_external_schema(&self, schema: Option<&'a Node>) -> FmtReg {
        let f = &self.fmt;
        match schema {
            None => f.text("()"),
            // The schema of the file
            Some(schema) if schema.node_type() == NodeType::OBJECT_SQL_CREATE_EXTERNAL_TABLE_INFER_SCHEMA => f.empty(),
            Some(schema) if self.is_column_list(schema) => f.parenthesized_list(self.reg_or_placeholder(schema)),
            Some(schema) => f.concat(&[f.text("like "), self.reg_or_placeholder(schema)]),
        }
    }

    /// The options of an external table or stream: `with (format => 'csv')`, or the options of COPY in parentheses
    fn format_external_options(&self, options: Option<&'a Node>, old_syntax: bool) -> FmtReg {
        let f = &self.fmt;
        match options {
            Some(options)
                if !old_syntax
                    && self
                        .children(options)
                        .first()
                        .is_some_and(|o| o.node_type() == NodeType::OBJECT_SQL_NAMED_ARG_EXPR) =>
            {
                f.concat(&[f.text("with "), f.parenthesized_list(self.reg_or_placeholder(options))])
            }
            Some(options) => f.parenthesized(self.format_copy_options(options)),
            None if old_syntax => f.text("()"),
            None => f.empty(),
        }
    }

    pub(super) fn format_create_external_table(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [if_not_exists, temp, name, schema, location, options, old_syntax] = attrs!(
            self.children(node),
            [
                K::SQL_CREATE_EXTERNAL_TABLE_IF_NOT_EXISTS,
                K::SQL_CREATE_EXTERNAL_TABLE_TEMP,
                K::SQL_CREATE_EXTERNAL_TABLE_NAME,
                K::SQL_CREATE_EXTERNAL_TABLE_SCHEMA,
                K::SQL_CREATE_EXTERNAL_TABLE_FILENAME,
                K::SQL_CREATE_EXTERNAL_TABLE_OPTIONS,
                K::SQL_CREATE_EXTERNAL_TABLE_IS_OLD_SYNTAX,
            ]
        );
        let (Some(name), Some(location)) = (name, location) else { return self.format_unimplemented(node) };
        let mut header = vec![f.text("create ")];
        if let Some(temp) = temp.filter(|t| self.reg(t) != 0) {
            header.push(self.reg(temp));
            header.push(f.text(" "));
        }
        header.push(f.text("external table "));
        if if_not_exists.is_some() {
            header.push(f.text("if not exists "));
        }
        header.push(self.reg_or_placeholder(name));
        let schema = self.format_external_schema(schema);
        if schema != 0 {
            header.push(f.text(" "));
            header.push(schema);
        }
        let clauses = [
            f.concat(&header),
            f.concat(&[f.text("for "), self.reg_or_placeholder(location)]),
            self.format_external_options(options, old_syntax.is_some()),
        ];
        self.format_command_clauses(&clauses)
    }

    pub(super) fn format_stream_type(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        match StreamType(value_u8(node)) {
            StreamType::BOUNDED => f.text("bounded"),
            StreamType::BUFFERED => f.text("buffered"),
            _ => self.format_unimplemented(node),
        }
    }

    pub(super) fn format_create_external_stream(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [if_not_exists, temp, stream_type, name, schema, options] = attrs!(
            self.children(node),
            [
                K::SQL_CREATE_EXTERNAL_STREAM_IF_NOT_EXISTS,
                K::SQL_CREATE_EXTERNAL_STREAM_TEMP,
                K::SQL_CREATE_EXTERNAL_STREAM_TYPE,
                K::SQL_CREATE_EXTERNAL_STREAM_NAME,
                K::SQL_CREATE_EXTERNAL_STREAM_SCHEMA,
                K::SQL_CREATE_EXTERNAL_STREAM_OPTIONS,
            ]
        );
        let Some(name) = name else { return self.format_unimplemented(node) };
        let mut header = vec![f.text("create ")];
        for prefix in [temp.filter(|t| self.reg(t) != 0), stream_type].into_iter().flatten() {
            header.push(self.reg_or_placeholder(prefix));
            header.push(f.text(" "));
        }
        header.push(f.text("external stream "));
        if if_not_exists.is_some() {
            header.push(f.text("if not exists "));
        }
        header.push(self.reg_or_placeholder(name));
        header.push(f.text(" "));
        header.push(self.format_external_schema(schema));
        let clauses = [f.concat(&header), self.format_external_options(options, false)];
        self.format_command_clauses(&clauses)
    }

    pub(super) fn format_database_locality(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        match DatabaseLocality(value_u8(node)) {
            DatabaseLocality::LOCAL => f.text("local"),
            DatabaseLocality::GLOBAL => f.empty(),
            _ => self.format_unimplemented(node),
        }
    }

    /// `database db`, `local database db`
    fn format_database_keyword(&self, locality: Option<&'a Node>) -> FmtReg {
        let f = &self.fmt;
        match locality.map(|l| self.reg(l)).filter(|&l| l != 0) {
            Some(locality) => f.concat(&[locality, f.text(" database ")]),
            None => f.text("database "),
        }
    }

    pub(super) fn format_database_option(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [kind, name] =
            attrs!(self.children(node), [K::SQL_CREATE_DATABASE_OPTION_KIND, K::SQL_CREATE_DATABASE_OPTION_NAME]);
        match (kind, name) {
            (Some(kind), None) => {
                let text = match DatabaseOption(value_u8(kind)) {
                    DatabaseOption::CONNECTION_LIMIT => "connection limit",
                    DatabaseOption::ENCODING => "encoding",
                    DatabaseOption::LOCATION => "location",
                    DatabaseOption::OWNER => "owner",
                    DatabaseOption::TABLESPACE => "tablespace",
                    DatabaseOption::TEMPLATE => "template",
                    _ => return self.format_unimplemented(node),
                };
                f.text(text)
            }
            (None, Some(name)) => self.reg_or_placeholder(name),
            _ => self.format_unimplemented(node),
        }
    }

    /// `with owner = bob version = 3`, the options of a database
    fn format_database_options(&self, options: Option<&'a Node>) -> FmtReg {
        let f = &self.fmt;
        match options {
            Some(options) => f.concat(&[f.text("with "), self.reg_or_placeholder(options)]),
            None => f.empty(),
        }
    }

    pub(super) fn format_create_database(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [if_not_exists, locality, name, options] = attrs!(
            self.children(node),
            [
                K::SQL_CREATE_DATABASE_IF_NOT_EXISTS,
                K::SQL_CREATE_DATABASE_LOCALITY,
                K::SQL_CREATE_DATABASE_NAME,
                K::SQL_CREATE_DATABASE_OPTIONS,
            ]
        );
        let Some(name) = name else { return self.format_unimplemented(node) };
        let if_not_exists = if if_not_exists.is_some() { f.text("if not exists ") } else { f.empty() };
        let header = f.concat(&[
            f.text("create "),
            self.format_database_keyword(locality),
            if_not_exists,
            self.reg_or_placeholder(name),
        ]);
        self.format_command_clauses(&[header, self.format_database_options(options)])
    }

    /// CREATE DATABASE ... FROM, IMPORT DATABASE and EXPORT DATABASE, the copies of a database
    pub(super) fn format_create_database_copy(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [direction, if_not_exists, locality, target, options, source_locality, source, source_options] = attrs!(
            self.children(node),
            [
                K::SQL_CREATE_DATABASE_COPY_DIRECTION,
                K::SQL_CREATE_DATABASE_COPY_IF_NOT_EXISTS,
                K::SQL_CREATE_DATABASE_COPY_LOCALITY,
                K::SQL_CREATE_DATABASE_COPY_TARGET,
                K::SQL_CREATE_DATABASE_COPY_OPTIONS,
                K::SQL_CREATE_DATABASE_COPY_SOURCE_LOCALITY,
                K::SQL_CREATE_DATABASE_COPY_SOURCE,
                K::SQL_CREATE_DATABASE_COPY_SOURCE_OPTIONS,
            ]
        );
        let if_not_exists = if if_not_exists.is_some() { f.text("if not exists ") } else { f.empty() };
        let direction = direction.map(|d| DatabaseCopyDirection(value_u8(d)));
        let clauses = match (direction, target, source) {
            // `export database db to 'file'`
            (Some(DatabaseCopyDirection::EXPORT), Some(target), Some(source)) => [
                f.concat(&[
                    f.text("export "),
                    self.format_database_keyword(source_locality),
                    self.reg_or_placeholder(source),
                ]),
                self.format_database_options(source_options),
                f.concat(&[f.text("to "), self.reg_or_placeholder(target)]),
                self.format_database_options(options),
            ],
            // `import database db from 'file'` and `create database db from db2`
            (direction, Some(target), source) => {
                let keyword = match direction {
                    Some(DatabaseCopyDirection::IMPORT) => "import ",
                    None => "create ",
                    _ => return self.format_unimplemented(node),
                };
                let source = match source {
                    Some(source) => self.reg_or_placeholder(source),
                    None if direction.is_some() => f.text("stdin"),
                    None => return self.format_unimplemented(node),
                };
                [
                    f.concat(&[
                        f.text(keyword),
                        self.format_database_keyword(locality),
                        if_not_exists,
                        self.reg_or_placeholder(target),
                    ]),
                    self.format_database_options(options),
                    f.concat(&[f.text("from "), source]),
                    self.format_database_options(source_options),
                ]
            }
            _ => return self.format_unimplemented(node),
        };
        self.format_command_clauses(&clauses)
    }

    pub(super) fn format_alter_database(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [locality, database, options, args] = attrs!(
            self.children(node),
            [
                K::SQL_ALTER_DATABASE_LOCALITY,
                K::SQL_ALTER_DATABASE_DATABASE,
                K::SQL_ALTER_DATABASE_OPTIONS,
                K::SQL_ALTER_DATABASE_ARGS,
            ]
        );
        let (Some(database), Some(args)) = (database, args) else { return self.format_unimplemented(node) };
        let header =
            f.concat(&[f.text("alter "), self.format_database_keyword(locality), self.reg_or_placeholder(database)]);
        self.format_command_clauses(&[header, self.format_database_options(options), self.reg_or_placeholder(args)])
    }

    /// `detach database a, b` or `detach database *`
    pub(super) fn format_detach_database(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [aliases] = attrs!(self.children(node), [K::SQL_DETACH_DATABASE_ALIAS]);
        let aliases = match aliases {
            Some(aliases) => self.reg_or_placeholder(aliases),
            None => f.text("*"),
        };
        f.concat(&[f.text("detach database "), aliases])
    }

    pub(super) fn format_drop_database(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [if_exists, locality, name] = attrs!(
            self.children(node),
            [K::SQL_DROP_DATABASE_IF_EXISTS, K::SQL_DROP_DATABASE_LOCALITY, K::SQL_DROP_DATABASE_NAME]
        );
        let Some(name) = name else { return self.format_unimplemented(node) };
        let if_exists = if if_exists.is_some() { f.text("if exists ") } else { f.empty() };
        f.concat(&[f.text("drop "), self.format_database_keyword(locality), if_exists, self.reg_or_placeholder(name)])
    }

    pub(super) fn format_unload_database(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [forcefully, locality, name, defragment] = attrs!(
            self.children(node),
            [
                K::SQL_UNLOAD_DATABASE_FORCEFULLY,
                K::SQL_UNLOAD_DATABASE_LOCALITY,
                K::SQL_UNLOAD_DATABASE_NAME,
                K::SQL_UNLOAD_DATABASE_DEFRAGMENT,
            ]
        );
        let Some(name) = name else { return self.format_unimplemented(node) };
        let mut parts = vec![f.text("unload "), self.format_database_keyword(locality), self.reg_or_placeholder(name)];
        match bool_value(forcefully) {
            Some(true) => parts.push(f.text(" forcefully")),
            Some(false) => parts.push(f.text(" gracefully")),
            None => {}
        }
        if defragment.is_some() {
            parts.push(f.text(" with defragmentation"));
        }
        f.concat(&parts)
    }

    pub(super) fn format_validate_database(&self, node: &'a Node) -> FmtReg {
        let f = &self.fmt;
        let [locality, alias, options] = attrs!(
            self.children(node),
            [K::SQL_VALIDATE_DATABASE_LOCALITY, K::SQL_VALIDATE_DATABASE_ALIAS, K::SQL_VALIDATE_DATABASE_OPTIONS]
        );
        let Some(alias) = alias else { return self.format_unimplemented(node) };
        let header =
            f.concat(&[f.text("validate "), self.format_database_keyword(locality), self.reg_or_placeholder(alias)]);
        let options = match options {
            Some(options) => f.concat(&[f.text("with "), f.parenthesized_list(self.reg_or_placeholder(options))]),
            None => f.empty(),
        };
        self.format_command_clauses(&[header, options])
    }
}
