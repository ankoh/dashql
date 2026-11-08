//! The relations that statements create or drop.
//!
//! The catalog of a connection holds what the connection reports. After a successful statement the host
//! asks the connection about the relations that the statement touched, the parser names them.

use dashql_buffers::analyzer::QualifiedTableNameT;
use dashql_buffers::catalog::TouchedRelationsT;
use dashql_buffers::parser::StatementType;
use dashql_core::catalog::Catalog;
use dashql_core::pack::pack_parsed_statement;
use dashql_core::script::Script;
use dashql_parser::parser::ParsedScript;

/// The relation that a statement creates or drops, named as written. None for other statements and for a
/// statement whose relation the parser could not name.
pub fn touched_relation(parsed: &ParsedScript, statement_id: usize) -> Option<QualifiedTableNameT> {
    let statement = parsed.statements.get(statement_id)?;
    if !matches!(
        statement.statement_type,
        StatementType::CREATE_TABLE
            | StatementType::CREATE_TABLE_AS
            | StatementType::CREATE_VIEW
            | StatementType::SELECT_INTO
            | StatementType::DROP_TABLE
            | StatementType::DROP_VIEW
    ) {
        return None;
    }
    let target = pack_parsed_statement(parsed, statement_id).target?;
    let table_name = target.relation_name.filter(|n| !n.is_empty())?;
    let mut name = QualifiedTableNameT::default();
    name.database_name = target.database_name;
    name.schema_name = target.schema_name;
    name.table_name = Some(table_name);
    Some(name)
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
    touched.parsed = parsed.errors.is_empty() && parsed.scanned.errors.is_empty();
    touched.relations = Some((0..parsed.statements.len()).filter_map(|id| touched_relation(parsed, id)).collect());
    touched
}
