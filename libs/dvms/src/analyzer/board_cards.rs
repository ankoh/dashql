use crate::error::SystemError;
use crate::execution::scalar_value::LogicalType;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{Statement, TableRef};

use super::board_space::{BoardPosition, BoardSpace};
use super::program_instance::{NodeError, NodeErrorCode, ProgramInstance};
use crate::grammar::dson::{DsonAccess, DsonValue};
use dashql_proto::syntax as sx;
use serde::Serialize;
use std::collections::HashMap;

const DEFAULT_INPUT_CARD_WIDTH: usize = 3;
const DEFAULT_INPUT_CARD_HEIGHT: usize = 1;
const DEFAULT_VIZ_CARD_WIDTH: usize = 12;
const DEFAULT_VIZ_CARD_HEIGHT: usize = 4;

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub enum CardType {
    Input,
    Viz,
}

#[derive(Debug, Clone, Serialize, Eq, PartialEq)]
pub struct Card {
    pub title: String,
    pub position: BoardPosition,
}

impl Default for Card {
    fn default() -> Self {
        Self {
            title: Default::default(),
            position: Default::default(),
        }
    }
}

pub fn allocate_card_positions<'a>(inst: &mut ProgramInstance<'a>) -> Result<(), SystemError> {
    // Helper to evaluate a position value
    let eval = |out: &mut usize, pos: &DsonValue<'a>, attr: sx::AttributeKey, inst: &mut ProgramInstance<'a>| match pos
        .get(attr)
        .cloned()
        .unwrap_or_default()
        .as_expression()
        .evaluate(&mut inst.expression_evaluation)
    {
        Ok(None) => (),
        Ok(Some(v)) => match v.cast_as(LogicalType::Float64) {
            Ok(v) => *out = v.get_f64_or_default() as usize,
            Err(_) => {
                inst.node_error_messages.push(NodeError {
                    node_id: None,
                    error_code: NodeErrorCode::InvalidValueType,
                    error_message: "position value cannot be casted to double".to_string(),
                });
            }
        },
        Err(_) => {
            inst.node_error_messages.push(NodeError {
                node_id: None,
                error_code: NodeErrorCode::ExpressionEvaluationFailed,
                error_message: "failed to evaluate position value".to_string(),
            });
        }
    };

    // Allocate positions of input cards
    let mut space = BoardSpace::default();
    let mut positions = HashMap::new();
    let program = inst.program.clone();
    for (stmt_id, stmt) in program.statements.iter().enumerate() {
        let stmt = match stmt {
            Statement::Input(i) => i,
            _ => continue,
        };
        let settings = stmt.extra.get().unwrap_or_default();
        let position = settings.get(sx::AttributeKey::DSON_POSITION);
        let mut requested = BoardPosition {
            width: DEFAULT_INPUT_CARD_WIDTH,
            height: DEFAULT_INPUT_CARD_HEIGHT,
            row: 0,
            column: 0,
        };
        if let Some(pos) = position {
            eval(&mut requested.width, pos, sx::AttributeKey::DSON_WIDTH, inst);
            eval(&mut requested.height, pos, sx::AttributeKey::DSON_HEIGHT, inst);
            eval(&mut requested.row, pos, sx::AttributeKey::DSON_ROW, inst);
            eval(&mut requested.column, pos, sx::AttributeKey::DSON_COLUMN, inst);
        }
        let allocated = space.allocate(requested);
        positions.insert(stmt_id, allocated);
    }

    // Allocate positions of viz cards
    for (stmt_id, stmt) in program.statements.iter().enumerate() {
        let stmt = match stmt {
            Statement::Viz(v) => v,
            _ => continue,
        };
        let settings = stmt.extra.get().unwrap_or_default();
        let position = settings.get(sx::AttributeKey::DSON_POSITION);
        let mut requested = BoardPosition {
            width: DEFAULT_VIZ_CARD_WIDTH,
            height: DEFAULT_VIZ_CARD_HEIGHT,
            row: 0,
            column: 0,
        };
        if let Some(pos) = position {
            requested = BoardPosition::default();
            eval(&mut requested.width, pos, sx::AttributeKey::DSON_WIDTH, inst);
            eval(&mut requested.height, pos, sx::AttributeKey::DSON_HEIGHT, inst);
            eval(&mut requested.row, pos, sx::AttributeKey::DSON_ROW, inst);
            eval(&mut requested.column, pos, sx::AttributeKey::DSON_COLUMN, inst);
        }
        let allocated = space.allocate(requested);
        positions.insert(stmt_id, allocated);
    }
    inst.card_positions = positions;
    Ok(())
}

pub fn collect_cards<'a>(inst: &mut ProgramInstance<'a>) -> Result<(), SystemError> {
    for (stmt_id, stmt) in inst.program.statements.iter().enumerate() {
        let position = inst.card_positions.get(&stmt_id).cloned().unwrap_or_default();
        let mut card = Card::default();
        match stmt {
            Statement::Input(_input) => {
                card.position = position;
                if let Some(name) = inst.statement_names[stmt_id] {
                    card.title = print_ast_as_script_with_defaults(&name);
                }
            }
            Statement::Viz(viz) => {
                card.position = position;
                card.title = match viz.target.get() {
                    TableRef::Relation(rel) => print_ast_as_script_with_defaults(&rel.name.get()),
                    _ => "".to_string(),
                };
            }
            _ => {}
        }
        inst.cards.insert(stmt_id, card);
    }
    Ok(())
}
