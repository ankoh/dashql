use super::board_space::BoardPosition;
use crate::grammar::dson::{DsonField, DsonKey, DsonValue};
use crate::grammar::{Expression, VizStatement};
use dashql_proto::syntax as sx;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct StatementEditOperation {
    pub statement_id: u32,
    pub variant: EditOperation,
}

#[derive(Debug, Clone, Serialize)]
pub enum EditOperation {
    SetBoardPosition(BoardPosition),
}

pub fn edit_viz_statement<'arena, 'edit>(
    arena: &'arena bumpalo::Bump,
    stmt: &'arena VizStatement<'arena>,
    edits: &[EditOperation],
) {
    // Clone all components
    let mut extras: Vec<DsonField<'arena>> = Vec::new();
    if let Some(extra) = stmt.extra.get() {
        extras = extra.as_object().iter().map(|field| field.clone()).collect();
    }

    // Apply all edit operations
    for op in edits.iter() {
        match &op {
            EditOperation::SetBoardPosition(pos) => {
                extras.retain(|field| match field.key {
                    DsonKey::Known(sx::AttributeKey::DSON_POSITION) => false,
                    _ => true,
                });
                let fields = DsonValue::Object(arena.alloc_slice_clone(&[
                    DsonField {
                        key: DsonKey::Known(sx::AttributeKey::DSON_ROW),
                        value: DsonValue::Expression(Expression::Uint32(pos.row as u32)),
                    },
                    DsonField {
                        key: DsonKey::Known(sx::AttributeKey::DSON_COLUMN),
                        value: DsonValue::Expression(Expression::Uint32(pos.column as u32)),
                    },
                    DsonField {
                        key: DsonKey::Known(sx::AttributeKey::DSON_WIDTH),
                        value: DsonValue::Expression(Expression::Uint32(pos.width as u32)),
                    },
                    DsonField {
                        key: DsonKey::Known(sx::AttributeKey::DSON_HEIGHT),
                        value: DsonValue::Expression(Expression::Uint32(pos.height as u32)),
                    },
                ]));
                extras.push(DsonField {
                    key: DsonKey::Known(sx::AttributeKey::DSON_POSITION),
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
    use crate::grammar::script_writer::{print_script, ScriptTextConfig, ScriptWriter, ToSQL};
    use crate::grammar::{self, Statement};
    use std::error::Error;

    fn test_viz_edits(
        text: &'static str,
        expected: &'static str,
        edits: &[EditOperation],
    ) -> Result<(), Box<dyn Error + Send + Sync>> {
        let arena = bumpalo::Bump::new();
        let ast = grammar::parse(&arena, text)?;
        let prog = grammar::deserialize_ast(&arena, text, ast).unwrap();
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

    #[test]
    fn test_viz_position() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_viz_edits(
            "viz foo using table",
            "viz foo using table (position = (row = 1, column = 0, width = 10, height = 3))",
            &[EditOperation::SetBoardPosition(BoardPosition {
                row: 1,
                column: 0,
                width: 10,
                height: 3,
            })],
        )?;
        test_viz_edits(
            "viz foo using table (position = (row = 1, column = 0, width = 10, height = 3))",
            "viz foo using table (position = (row = 2, column = 0, width = 12, height = 4))",
            &[EditOperation::SetBoardPosition(BoardPosition {
                row: 2,
                column: 0,
                width: 12,
                height: 4,
            })],
        )?;
        Ok(())
    }
}
