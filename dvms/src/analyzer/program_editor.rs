use super::program_instance::CardPosition;
use crate::grammar::syntax::dson::{DsonField, DsonKey, DsonValue};
use crate::grammar::{ASTCell, Expression, VizComponent, VizStatement};
use dashql_proto::syntax as sx;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct StatementEditOperation {
    pub statement_id: u32,
    pub variant: EditOperation,
}

#[derive(Debug, Clone, Serialize)]
pub enum EditOperation {
    SetCardPosition(CardPosition),
}

pub fn edit_viz_statement<'arena, 'edit>(
    arena: &'arena bumpalo::Bump,
    stmt: &'arena VizStatement<'arena>,
    edits: &[EditOperation],
) -> &'arena VizStatement<'arena> {
    // Clone all components
    let mut components: Vec<VizComponent<'arena>> =
        stmt.components.get().iter().map(|c| c.get().clone().clone()).collect();
    let mut extras: Vec<Vec<DsonField<'arena>>> = Vec::new();
    extras.reserve(components.len());
    for c in components.iter() {
        match c.extra.get() {
            Some(extra) => extras.push(extra.as_object().iter().map(|field| field.clone()).collect()),
            None => extras.push(Vec::new()),
        }
    }
    // Apply all edit operations
    for op in edits.iter() {
        match &op {
            EditOperation::SetCardPosition(pos) => {
                for extra in extras.iter_mut() {
                    extra.retain(|field| match field.key {
                        DsonKey::Known(sx::AttributeKey::DSON_POSITION) => false,
                        _ => true,
                    });
                }
                let fields = DsonValue::Object(arena.alloc_slice_clone(&[
                    DsonField {
                        key: DsonKey::Known(sx::AttributeKey::DSON_ROW),
                        value: DsonValue::Expression(Expression::Uint32(pos.row)),
                    },
                    DsonField {
                        key: DsonKey::Known(sx::AttributeKey::DSON_COLUMN),
                        value: DsonValue::Expression(Expression::Uint32(pos.column)),
                    },
                    DsonField {
                        key: DsonKey::Known(sx::AttributeKey::DSON_WIDTH),
                        value: DsonValue::Expression(Expression::Uint32(pos.width)),
                    },
                    DsonField {
                        key: DsonKey::Known(sx::AttributeKey::DSON_HEIGHT),
                        value: DsonValue::Expression(Expression::Uint32(pos.height)),
                    },
                ]));
                extras[0].push(DsonField {
                    key: DsonKey::Known(sx::AttributeKey::DSON_POSITION),
                    value: fields,
                });
            }
        }
    }
    // Allocate all extras and store them in the clones
    for (i, extra) in extras.iter().enumerate() {
        if extra.is_empty() {
            continue;
        }
        components[i].extra = ASTCell::with_value(Some(DsonValue::Object(arena.alloc_slice_clone(&extra))));
    }

    // Allocate new components
    let new_components: Vec<ASTCell<&'arena VizComponent<'arena>>> = components
        .iter()
        .map(|c| {
            let c: &'arena VizComponent<'arena> = arena.alloc(c.clone());
            ASTCell::with_value(c)
        })
        .collect();
    arena.alloc(VizStatement {
        target: stmt.target.clone(),
        components: ASTCell::with_value(arena.alloc_slice_clone(&new_components)),
    })
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::grammar::syntax::script_writer::{print_script, AsScript, ScriptTextConfig, ScriptWriter};
    use crate::grammar::{self, Statement};
    use std::error::Error;

    fn test_viz_edits(text: &str, expected: &str, edits: &[EditOperation]) -> Result<(), Box<dyn Error + Send + Sync>> {
        let arena = bumpalo::Bump::new();
        let ast = grammar::parse(&arena, text)?;
        let prog = grammar::deserialize_ast(&arena, text, ast)?;
        assert_eq!(prog.statements.len(), 1);

        let viz = match prog.statements[0] {
            Statement::Viz(v) => Some(v),
            _ => None,
        };
        assert!(viz.is_some());

        let edited = edit_viz_statement(&arena, viz.unwrap(), edits);

        let writer = ScriptWriter::new();
        let script_text = edited.as_script(&writer);
        let script_string = print_script(&script_text, &ScriptTextConfig::default());
        assert_eq!(&script_string, expected, "{:?}", prog);
        Ok(())
    }

    #[test]
    fn test_viz_position() -> Result<(), Box<dyn Error + Send + Sync>> {
        test_viz_edits(
            "viz foo using table",
            "viz foo using table (position = (row = 1, column = 0, width = 10, height = 3))",
            &[EditOperation::SetCardPosition(CardPosition {
                row: 1,
                column: 0,
                width: 10,
                height: 3,
            })],
        )?;
        test_viz_edits(
            "viz foo using table (position = (row = 1, column = 0, width = 10, height = 3))",
            "viz foo using table (position = (row = 2, column = 0, width = 12, height = 4))",
            &[EditOperation::SetCardPosition(CardPosition {
                row: 2,
                column: 0,
                width: 12,
                height: 4,
            })],
        )?;
        Ok(())
    }
}
