use super::analysis_settings::ProgramAnalysisSettings;
use super::sql_value::SQLValue;
use dashql_proto::syntax as sx;
use serde::Serialize;
use std::error::Error;
use std::rc::Rc;

use crate::analyzer::analysis_context::ProgramAnalysisContext;
use crate::analyzer::liveness::determine_statement_liveness;
use crate::analyzer::name_resolution::{discover_statement_dependencies, normalize_statement_names};
use crate::grammar::syntax::dson::DsonValue;
use crate::grammar::syntax::enums_serde::*;
use crate::grammar::Program;

#[derive(Debug, Clone, Serialize)]
pub struct NodeLinterMessage {
    pub node_id: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub enum NodeErrorCode {
    InvalidInput,
}

#[derive(Debug, Clone, Serialize)]
pub struct NodeError {
    pub node_id: u32,
    pub error_code: NodeErrorCode,
    pub error_message: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct InputValue {
    pub statement_id: u32,
    pub value: SQLValue,
}

#[derive(Debug, Clone, Serialize)]
pub enum CardType {
    Input,
    Viz,
}

#[derive(Debug, Clone, Serialize)]
pub struct CardPosition {
    pub row: u32,
    pub column: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct Card<'arena> {
    pub card_type: CardType,
    pub card_title: String,
    pub card_position: CardPosition,
    pub statement_id: u32,
    #[serde(with = "serde_input_component_type")]
    pub input_component: sx::InputComponentType,
    pub input_extra: Option<DsonValue<'arena>>,
}

#[derive(Default, Debug, Clone, Serialize)]
pub struct ProgramAnalysis<'arena> {
    pub node_error_messages: Vec<NodeError>,
    pub node_linter_messages: Vec<NodeLinterMessage>,
    pub statement_liveness: Vec<bool>,
    pub cards: Vec<Card<'arena>>,
}

pub fn analyze_program<'arena>(
    settings: Rc<ProgramAnalysisSettings>,
    arena: &'arena bumpalo::Bump,
    text: &'arena str,
    program_proto: sx::Program<'arena>,
    program: Rc<Program<'arena>>,
    input: &[InputValue],
) -> Result<ProgramAnalysis<'arena>, Box<dyn Error + Send + Sync>> {
    let mut ctx = ProgramAnalysisContext::new(settings, arena, text, program_proto, program);
    normalize_statement_names(&mut ctx);
    discover_statement_dependencies(&mut ctx);
    determine_statement_liveness(&mut ctx);

    todo!();
}
