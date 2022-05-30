use crate::grammar::Statement;

use super::board_space::BoardSpace;
use super::program_instance::{CardPosition, ProgramInstance};
use crate::grammar::syntax::dson::DsonAccess;
use dashql_proto::syntax as sx;
use std::error::Error;

const DEFAULT_INPUT_CARD_WIDTH: u32 = 3;
const DEFAULT_INPUT_CARD_HEIGHT: u32 = 1;
const DEFAULT_VIZ_CARD_WIDTH: u32 = 12;
const DEFAULT_VIZ_CARD_HEIGHT: u32 = 4;

pub fn derive_board_cards<'a>(ctx: &ProgramInstance<'a>) -> Result<(), Box<dyn Error + Send + Sync>> {
    let mut _space = BoardSpace::default();

    // Allocate positions of input cards
    for stmt in ctx.program.statements.iter() {
        let stmt = match stmt {
            Statement::Input(i) => i,
            _ => continue,
        };
        let settings = stmt.extra.get().unwrap_or_default();
        let position = settings.get(sx::AttributeKey::DSON_POSITION);
        let mut _requested = CardPosition {
            width: DEFAULT_INPUT_CARD_WIDTH,
            height: DEFAULT_INPUT_CARD_HEIGHT,
            row: 0,
            column: 0,
        };
        if let Some(pos) = position {
            let _w = pos
                .get(sx::AttributeKey::DSON_WIDTH)
                .map(|v| v.as_expression())
                .unwrap_or_default();
            let _h = pos
                .get(sx::AttributeKey::DSON_HEIGHT)
                .map(|v| v.as_expression())
                .unwrap_or_default();
            let _r = pos
                .get(sx::AttributeKey::DSON_ROW)
                .map(|v| v.as_expression())
                .unwrap_or_default();
            let _c = pos
                .get(sx::AttributeKey::DSON_COLUMN)
                .map(|v| v.as_expression())
                .unwrap_or_default();

            todo!()
        }
    }

    // Allocate positions of viz cards
    for stmt in ctx.program.statements.iter() {
        let stmt = match stmt {
            Statement::Viz(v) => v,
            _ => continue,
        };
        let mut position = None;
        for component in stmt.components.get().iter() {
            let settings = component.get().extra.get().unwrap_or_default();
            position = settings.get(sx::AttributeKey::DSON_POSITION);
            if position.is_some() {
                break;
            }
        }
        let mut _requested = CardPosition {
            width: DEFAULT_VIZ_CARD_WIDTH,
            height: DEFAULT_VIZ_CARD_HEIGHT,
            row: 0,
            column: 0,
        };
        if let Some(pos) = position {
            let _w = pos
                .get(sx::AttributeKey::DSON_WIDTH)
                .map(|v| v.as_expression())
                .unwrap_or_default();
            let _h = pos
                .get(sx::AttributeKey::DSON_HEIGHT)
                .map(|v| v.as_expression())
                .unwrap_or_default();
            let _r = pos
                .get(sx::AttributeKey::DSON_ROW)
                .map(|v| v.as_expression())
                .unwrap_or_default();
            let _c = pos
                .get(sx::AttributeKey::DSON_COLUMN)
                .map(|v| v.as_expression())
                .unwrap_or_default();
        }
    }

    Ok(())
}
