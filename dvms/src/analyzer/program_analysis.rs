use dashql_proto::syntax as sx;
use serde::Serialize;

use crate::grammar::syntax::dson::DsonValue;
use crate::grammar::syntax::enums_serde::*;

#[derive(Debug, Clone, Serialize)]
pub struct LinterMessage {
    pub node_id: u32,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub enum NodeErrorCount {
    InvalidInput,
}

#[derive(Debug, Clone, Serialize)]
pub struct NodeError {
    pub node_id: u32,
    pub error_code: NodeErrorCount,
    pub error_message: String,
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

#[derive(Debug, Clone, Serialize)]
pub struct ProgramAnalysis<'arena> {
    pub node_error_messages: Vec<NodeError>,
    pub node_linter_messages: Vec<LinterMessage>,
    pub statement_liveness: Vec<bool>,
    pub cards: Vec<Card<'arena>>,
}
