use crate::execution::expression_evaluator::ExpressionEvaluationContext;
use crate::execution::scalar_value::LogicalType;
use crate::grammar::Statement;

use super::board_space::BoardSpace;
use super::program_instance::{CardPosition, ProgramInstance};
use crate::grammar::syntax::dson::{DsonAccess, DsonValue};
use dashql_proto::syntax as sx;
use std::error::Error;

const DEFAULT_INPUT_CARD_WIDTH: u32 = 3;
const DEFAULT_INPUT_CARD_HEIGHT: u32 = 1;
const DEFAULT_VIZ_CARD_WIDTH: u32 = 12;
const DEFAULT_VIZ_CARD_HEIGHT: u32 = 4;

pub fn derive_board_cards<'a>(
    ctx: &ProgramInstance<'a>,
    eval_ctx: &mut ExpressionEvaluationContext<'a>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let mut _space = BoardSpace::default();

    let eval =
        |out: &mut u32, pos: &DsonValue<'a>, attr: sx::AttributeKey, eval: &mut ExpressionEvaluationContext<'a>| {
            match pos
                .get(attr)
                .cloned()
                .unwrap_or_default()
                .as_expression()
                .evaluate(eval)
            {
                Ok(None) => (),
                Ok(Some(v)) => match v.cast_as(LogicalType::Float64) {
                    Ok(v) => *out = v.get_f64_or_default() as u32,
                    Err(e) => {
                        // TODO warn, value cannot be casted as double
                    }
                },
                Err(e) => {
                    // TODO warn, expression could not be evaluated
                }
            }
        };

    // Allocate positions of input cards
    for stmt in ctx.program.statements.iter() {
        let stmt = match stmt {
            Statement::Input(i) => i,
            _ => continue,
        };
        let settings = stmt.extra.get().unwrap_or_default();
        let position = settings.get(sx::AttributeKey::DSON_POSITION);
        let mut requested = CardPosition {
            width: DEFAULT_INPUT_CARD_WIDTH,
            height: DEFAULT_INPUT_CARD_HEIGHT,
            row: 0,
            column: 0,
        };
        if let Some(pos) = position {
            eval(&mut requested.width, pos, sx::AttributeKey::DSON_WIDTH, eval_ctx);
            eval(&mut requested.height, pos, sx::AttributeKey::DSON_HEIGHT, eval_ctx);
            eval(&mut requested.row, pos, sx::AttributeKey::DSON_ROW, eval_ctx);
            eval(&mut requested.column, pos, sx::AttributeKey::DSON_COLUMN, eval_ctx);
        }
    }

    // Allocate positions of viz cards
    for stmt in ctx.program.statements.iter() {
        let stmt = match stmt {
            Statement::Viz(v) => v,
            _ => continue,
        };
        let mut position = None;
        let mut requested = CardPosition {
            width: DEFAULT_VIZ_CARD_WIDTH,
            height: DEFAULT_VIZ_CARD_HEIGHT,
            row: 0,
            column: 0,
        };
        for component in stmt.components.get().iter() {
            let settings = component.get().extra.get().unwrap_or_default();
            position = settings.get(sx::AttributeKey::DSON_POSITION);
            if let Some(pos) = position {
                requested = CardPosition::default();
                eval(&mut requested.width, pos, sx::AttributeKey::DSON_WIDTH, eval_ctx);
                eval(&mut requested.height, pos, sx::AttributeKey::DSON_HEIGHT, eval_ctx);
                eval(&mut requested.row, pos, sx::AttributeKey::DSON_ROW, eval_ctx);
                eval(&mut requested.column, pos, sx::AttributeKey::DSON_COLUMN, eval_ctx);
            }
        }
    }

    Ok(())
}
