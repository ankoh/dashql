use crate::error::SystemError;
use crate::execution::execution_context::ExecutionContextSnapshot;
use crate::execution::scalar_value::LogicalType;
use crate::grammar::script_writer::print_ast_as_script_with_defaults;
use crate::grammar::{Statement, TableRef};

use super::board_space::{BoardPosition, BoardSpace};
use super::program_instance::{NodeError, NodeErrorCode, ProgramInstance};
use crate::grammar::dson::{DsonAccess, DsonValue};
use dashql_proto as proto;
use serde::Serialize;
use std::collections::HashMap;

const DEFAULT_INPUT_CARD_WIDTH: usize = 3;
const DEFAULT_INPUT_CARD_HEIGHT: usize = 1;
const DEFAULT_VIZ_CARD_WIDTH: usize = 12;
const DEFAULT_VIZ_CARD_HEIGHT: usize = 4;

#[derive(Debug, Clone, Serialize)]
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

pub fn allocate_card_positions<'ast>(inst: &mut ProgramInstance<'ast>) -> Result<(), SystemError> {
    let mut snap = inst.context.snapshot();
    let mut errors = Vec::new();
    type Key = proto::AttributeKey;

    // Helper to evaluate a position value
    let eval = |out: &mut usize,
                pos: &DsonValue<'ast>,
                attr: proto::AttributeKey,
                exec: &mut ExecutionContextSnapshot<'ast, '_>,
                errors: &mut Vec<NodeError>| match pos
        .get(attr)
        .cloned()
        .unwrap_or_default()
        .as_expression()
        .evaluate(exec)
    {
        Ok(None) => (),
        Ok(Some(v)) => match v.cast_as(LogicalType::Float64) {
            Ok(v) => *out = v.get_f64_or_default() as usize,
            Err(_) => {
                errors.push(NodeError {
                    node_id: None,
                    error_code: NodeErrorCode::InvalidValueType,
                    error_message: "position value cannot be casted to double".to_string(),
                });
            }
        },
        Err(_) => {
            errors.push(NodeError {
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
            Statement::Declare(i) => i,
            _ => continue,
        };
        let settings = stmt.extra.get().unwrap_or_default();
        let position = settings.get(proto::AttributeKey::DSON_POSITION);
        let mut requested = BoardPosition {
            width: DEFAULT_INPUT_CARD_WIDTH,
            height: DEFAULT_INPUT_CARD_HEIGHT,
            row: 0,
            column: 0,
        };
        if let Some(pos) = position {
            eval(&mut requested.width, pos, Key::DSON_WIDTH, &mut snap, &mut errors);
            eval(&mut requested.height, pos, Key::DSON_HEIGHT, &mut snap, &mut errors);
            eval(&mut requested.row, pos, Key::DSON_ROW, &mut snap, &mut errors);
            eval(&mut requested.column, pos, Key::DSON_COLUMN, &mut snap, &mut errors);
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
        let position = settings.get(proto::AttributeKey::DSON_POSITION);
        let mut requested = BoardPosition {
            width: DEFAULT_VIZ_CARD_WIDTH,
            height: DEFAULT_VIZ_CARD_HEIGHT,
            row: 0,
            column: 0,
        };
        if let Some(pos) = position {
            requested = BoardPosition::default();
            eval(&mut requested.width, pos, Key::DSON_WIDTH, &mut snap, &mut errors);
            eval(&mut requested.height, pos, Key::DSON_HEIGHT, &mut snap, &mut errors);
            eval(&mut requested.row, pos, Key::DSON_ROW, &mut snap, &mut errors);
            eval(&mut requested.column, pos, Key::DSON_COLUMN, &mut snap, &mut errors);
        }
        let allocated = space.allocate(requested);
        positions.insert(stmt_id, allocated);
    }

    // Update instance
    inst.card_positions = positions;
    for err in errors.drain(..) {
        inst.node_error_messages.push(err);
    }
    let exec_update = snap.finish();
    let exec_data = &mut inst.context.state.write().unwrap();
    exec_update.merge_into(exec_data);
    Ok(())
}

pub fn collect_cards<'ast>(inst: &mut ProgramInstance<'ast>) -> Result<(), SystemError> {
    for (stmt_id, stmt) in inst.program.statements.iter().enumerate() {
        let position = inst.card_positions.get(&stmt_id).cloned().unwrap_or_default();
        let mut card = Card::default();
        match stmt {
            Statement::Declare(_input) => {
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
            _ => continue,
        }
        inst.cards.insert(stmt_id, card);
    }
    Ok(())
}
