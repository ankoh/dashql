use std::sync::Arc;

use super::board_space::BoardPosition;
use crate::error::SystemError;
use crate::grammar::dson::{DsonField, DsonKey, DsonValue};
use crate::grammar::{Expression, ProgramContainer, Statement, VizStatement};
use dashql_proto as proto;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct StatementEditOperation {
    pub statement_id: u32,
    pub operation: EditOperation,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "t", content = "v")]
pub enum EditOperation {
    SetBoardPosition(BoardPosition),
}

//
pub fn edit_statements(
    container: &ProgramContainer,
    edits: &mut [StatementEditOperation],
) -> Result<Arc<ProgramContainer>, SystemError> {
    // Clone the ast.
    // This will not re-parse the string but deserialize nodes into a separate bump allocator.
    let container = Arc::new(container.clone());
    let arena = container.get_arena();
    let program = container.get_program();

    // Sort edit operations by statement id
    edits.sort_unstable_by_key(|e| e.statement_id);
    let mut reader = 0;
    while reader < edits.len() {
        let stmt_id = edits[reader].statement_id;
        let n = edits[reader..].partition_point(|x| x.statement_id <= stmt_id);
        let edits: Vec<_> = edits[reader..(reader + n)]
            .iter()
            .map(|e| e.operation.clone())
            .collect();
        reader += n;

        let stmt = &program.statements[stmt_id as usize];
        match stmt {
            Statement::Viz(v) => edit_viz_statement(arena, v, &edits),
            _ => (),
        }
    }
    Ok(container)
}

pub fn edit_viz_statement<'arena, 'edit>(
    arena: &'arena bumpalo::Bump,
    stmt: &'arena VizStatement<'arena>,
    edits: &[EditOperation],
) {
    // Collect extra data
    let mut extras: Vec<DsonField<'arena>> = Vec::new();
    if let Some(extra) = stmt.extra.get() {
        extras = extra.as_object().iter().map(|field| field.clone()).collect();
    }
    // Apply all edit operations
    for op in edits.iter() {
        match &op {
            EditOperation::SetBoardPosition(pos) => {
                extras.retain(|field| match field.key {
                    DsonKey::Known(proto::AttributeKey::DSON_POSITION) => false,
                    _ => true,
                });
                let fields = DsonValue::Object(arena.alloc_slice_clone(&[
                    DsonField {
                        key: DsonKey::Known(proto::AttributeKey::DSON_ROW),
                        value: DsonValue::Expression(Expression::Uint32(pos.row as u32)),
                    },
                    DsonField {
                        key: DsonKey::Known(proto::AttributeKey::DSON_COLUMN),
                        value: DsonValue::Expression(Expression::Uint32(pos.column as u32)),
                    },
                    DsonField {
                        key: DsonKey::Known(proto::AttributeKey::DSON_WIDTH),
                        value: DsonValue::Expression(Expression::Uint32(pos.width as u32)),
                    },
                    DsonField {
                        key: DsonKey::Known(proto::AttributeKey::DSON_HEIGHT),
                        value: DsonValue::Expression(Expression::Uint32(pos.height as u32)),
                    },
                ]));
                extras.push(DsonField {
                    key: DsonKey::Known(proto::AttributeKey::DSON_POSITION),
                    value: fields,
                });
            }
        }
    }
    // Allocate all extras and store them in the clones
    if !extras.is_empty() {
        stmt.extra
            .set(Some(DsonValue::Object(arena.alloc_slice_clone(&extras))));
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::external::parser::parse_into;
    use crate::grammar::script_writer::{print_script, ScriptTextConfig, ScriptWriter, ToSQL};
    use crate::grammar::{self, Statement};
    use std::error::Error;

    async fn test_viz_edits(
        text: &'static str,
        expected: &'static str,
        edits: &[EditOperation],
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        let arena = bumpalo::Bump::new();
        let (ast, ast_data) = parse_into(&arena, text).await?;
        let prog = grammar::deserialize_ast(&arena, text, ast, ast_data).unwrap();
        assert_eq!(prog.statements.len(), 1);

        let viz = match prog.statements[0] {
            Statement::Viz(v) => Some(v),
            _ => None,
        };
        assert!(viz.is_some());

        let viz = viz.unwrap();
        edit_viz_statement(&arena, viz, edits);

        let writer = ScriptWriter::new();
        let script_text = viz.to_sql(&writer);
        let script_string = print_script(&script_text, &ScriptTextConfig::default());
        assert_eq!(&script_string, expected, "{:?}", prog);
        Ok(())
    }

    #[tokio::test]
    async fn test_viz_position() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_viz_edits(
            "viz foo using table",
            "viz foo using table (position = (row = 1, column = 0, width = 10, height = 3))",
            &[EditOperation::SetBoardPosition(BoardPosition {
                row: 1,
                column: 0,
                width: 10,
                height: 3,
            })],
        )
        .await?;
        test_viz_edits(
            "viz foo using table (position = (row = 1, column = 0, width = 10, height = 3))",
            "viz foo using table (position = (row = 2, column = 0, width = 12, height = 4))",
            &[EditOperation::SetBoardPosition(BoardPosition {
                row: 2,
                column: 0,
                width: 12,
                height: 4,
            })],
        )
        .await?;
        Ok(())
    }
}
