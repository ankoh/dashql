//! The relations that statements create, change or drop.
//!
//! The catalog of a connection holds what the connection reports. After a successful statement the host
//! asks the connection about the relations that the statement touched, the parser names them. A text
//! that doesn't parse touches nothing that we know of.

use dashql_buffers::analyzer::QualifiedTableNameT;
use dashql_buffers::catalog::TouchedRelationsT;
use dashql_buffers::parser::{AttributeKey, Node, NodeType, StatementType};
use dashql_core::catalog::Catalog;
use dashql_core::pack::{pack_parsed_statement, read_name_path};
use dashql_core::script::Script;
use dashql_parser::parser::ParsedScript;
use dashql_parser::parser::context::resolve_text_span;

/// A relation name from its parts, an empty part is not named
fn relation_name(database: Option<String>, schema: Option<String>, table: String) -> QualifiedTableNameT {
    let mut name = QualifiedTableNameT::default();
    name.database_name = database;
    name.schema_name = schema;
    name.table_name = Some(table);
    name
}

/// Do the options of an `EXPLAIN` run its statement? Unknown arguments of `analyze` count as running it.
pub fn explain_executes(parsed: &ParsedScript, options: Option<&Node>) -> bool {
    let scanned = &parsed.scanned;
    let option_text = |n: Option<&Node>| -> String {
        let Some(n) = n.filter(|n| n.node_type() != NodeType::NONE) else { return String::new() };
        let span = resolve_text_span(&scanned.text, &scanned.symbols, *n.symbol_span());
        let text = scanned.text[span.offset as usize..(span.offset + span.length) as usize].to_ascii_lowercase();
        let b = text.as_bytes();
        if b.len() >= 2 && (b[0] == b'\'' || b[0] == b'"') && b[b.len() - 1] == b[0] {
            return text[1..text.len() - 1].to_string();
        }
        text
    };
    let mut executes = false;
    for option in options.filter(|o| o.node_type() == NodeType::ARRAY).iter().flat_map(|o| parsed.children(o)) {
        if option.node_type() != NodeType::OBJECT_SQL_GENERIC_OPTION {
            continue;
        }
        let key = attribute_of(parsed, option, AttributeKey::SQL_GENERIC_OPTION_KEY);
        let value = attribute_of(parsed, option, AttributeKey::SQL_GENERIC_OPTION_VALUE);
        let name = option_text(key);
        if name == "analyze" || name == "analyse" {
            executes |= value.is_none_or(|v| v.node_type() != NodeType::BOOL || v.children_begin_or_value() != 0);
        } else if name == "format" && matches!(option_text(value).as_str(), "analyze" | "analyse") {
            executes = true;
        }
    }
    executes
}

/// The child of a node with an attribute key
fn attribute_of<'a>(parsed: &'a ParsedScript, node: &Node, key: AttributeKey) -> Option<&'a Node> {
    parsed.children(node).iter().find(|c| c.attribute_key() == key)
}

/// A name from the parts of a name path, an empty table names a whole schema
fn name_of_path(path: &[String], database: &Option<String>, schema: &Option<String>) -> Option<QualifiedTableNameT> {
    match path {
        [name] => Some(relation_name(database.clone(), schema.clone(), name.clone())),
        [new_schema, name] => Some(relation_name(database.clone(), Some(new_schema.clone()), name.clone())),
        [new_database, new_schema, name] => Some(relation_name(Some(new_database.clone()), Some(new_schema.clone()), name.clone())),
        _ => None,
    }
}

/// The relations that a statement touches, named as written. A statement that moves a relation touches its old and its
/// new name, one that changes a schema touches everything in it: its name has an empty table. Empty for other statements
/// and for a statement whose relation the parser could not name.
pub fn touched_relations_of_statement(parsed: &ParsedScript, statement_id: usize) -> Vec<QualifiedTableNameT> {
    let Some(statement) = parsed.statements.get(statement_id) else { return Vec::new() };
    let root = &parsed.nodes[statement.root as usize];
    let read = |node: &Node| read_name_path(parsed, node);
    let attribute = |node: &Node, key: AttributeKey| attribute_of(parsed, node, key);
    match statement.statement_type {
        StatementType::CREATE_TABLE
        | StatementType::CREATE_TABLE_AS
        | StatementType::CREATE_VIEW
        | StatementType::SELECT_INTO
        | StatementType::DROP_TABLE
        | StatementType::DROP_VIEW
        | StatementType::ALTER_TABLE
        | StatementType::ALTER_VIEW => {}
        StatementType::DROP_SCHEMA | StatementType::ALTER_SCHEMA => {
            let Some(path) = attribute(root, AttributeKey::SQL_SCHEMA_NAME).map(read) else { return Vec::new() };
            let (database, schema) = match path.as_slice() {
                [schema] => (None, schema.clone()),
                [database, schema] => (Some(database.clone()), schema.clone()),
                _ => return Vec::new(),
            };
            let mut out = vec![relation_name(database.clone(), Some(schema), String::new())];
            if let Some([new_schema]) = attribute(root, AttributeKey::SQL_SCHEMA_NEW_NAME).map(read).as_deref() {
                out.push(relation_name(database, Some(new_schema.clone()), String::new()));
            }
            return out;
        }
        // A statement that `EXPLAIN` runs creates its table
        StatementType::EXPLAIN => {
            let options = attribute(root, AttributeKey::EXT_EXPLAIN_OPTIONS);
            let body = attribute(root, AttributeKey::EXT_EXPLAIN_STATEMENT);
            let Some(body) = body.filter(|b| b.node_type() == NodeType::OBJECT_SQL_CREATE_AS && explain_executes(parsed, options)) else { return Vec::new() };
            let Some(path) = attribute(body, AttributeKey::SQL_CREATE_AS_NAME).map(read) else { return Vec::new() };
            return name_of_path(&path, &None, &None).into_iter().collect();
        }
        _ => return Vec::new(),
    }
    let Some(target) = pack_parsed_statement(parsed, statement_id).target else { return Vec::new() };
    let Some(table) = target.relation_name.clone().filter(|n| !n.is_empty()) else { return Vec::new() };
    let (database, schema) = (target.database_name.clone(), target.schema_name.clone());
    let mut out = vec![relation_name(database.clone(), schema.clone(), table.clone())];
    if matches!(statement.statement_type, StatementType::ALTER_TABLE | StatementType::ALTER_VIEW) {
        let actions = attribute(root, AttributeKey::SQL_ALTER_TABLE_ACTIONS);
        for action in actions.iter().flat_map(|actions| parsed.children(actions)) {
            match action.node_type() {
                // A new name without a schema stays where the relation is
                NodeType::OBJECT_SQL_ALTER_RENAME_TABLE => {
                    if let Some(path) = attribute(action, AttributeKey::SQL_ALTER_ACTION_NEW_TABLE).map(read) {
                        out.extend(name_of_path(&path, &database, &schema));
                    }
                }
                NodeType::OBJECT_SQL_ALTER_SET_SCHEMA => {
                    if let Some([new_schema]) = attribute(action, AttributeKey::SQL_ALTER_ACTION_NEW_NAME).map(read).as_deref() {
                        out.push(relation_name(database.clone(), Some(new_schema.clone()), table.clone()));
                    }
                }
                _ => {}
            }
        }
    }
    out
}

/// The relations that the statements of a text touch
pub fn touched_relations(text: &str) -> TouchedRelationsT {
    let mut script = Script::new(&Catalog::new());
    script.replace_text(text);
    script.parse();
    let mut touched = TouchedRelationsT::default();
    let Some(parsed) = script.parsed.as_ref() else {
        return touched;
    };
    touched.relations = Some((0..parsed.statements.len()).flat_map(|id| touched_relations_of_statement(parsed, id)).collect());
    touched
}
