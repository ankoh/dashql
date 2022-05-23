use super::super::grammar::*;
use super::analysis_settings::ProgramAnalysisSettings;
use super::input_value::InputValue;
use dashql_proto::syntax as sx;
use serde::Serialize;
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::error::Error;
use std::rc::Rc;

use crate::analyzer::liveness::determine_statement_liveness;
use crate::analyzer::name_resolution::{discover_statement_dependencies, normalize_statement_names};
use crate::grammar::syntax::dson::DsonValue;
use crate::grammar::syntax::enums_serde::*;
use crate::grammar::Program;

pub type StatementID = usize;
pub type NodeID = usize;

#[derive(Debug, Clone)]
pub struct ProgramInstance<'a> {
    pub settings: Rc<ProgramAnalysisSettings>,

    // AST buffer
    pub arena: &'a bumpalo::Bump,
    pub script_text: &'a str,
    pub program_proto: sx::Program<'a>,
    pub program: Rc<Program<'a>>,

    // The input values
    pub input: HashMap<usize, InputValue>,

    // Analysis output
    pub node_error_messages: Vec<NodeError>,
    pub node_linter_messages: Vec<NodeLinterMessage>,
    pub statement_names: Vec<Option<NamePath<'a>>>,
    pub statement_by_name: HashMap<NamePath<'a>, usize>,
    pub statement_by_root: HashMap<usize, usize>,
    pub statement_required_for: BTreeMap<(StatementID, StatementID), (sx::DependencyType, NodeID)>,
    pub statement_depends_on: BTreeMap<(StatementID, StatementID), (sx::DependencyType, NodeID)>,
    pub statement_liveness: Vec<bool>,
    pub cards: Vec<Card<'a>>,

    // Cached properties during analysis
    pub(super) cached_subtree_sizes: RefCell<Vec<usize>>,
    pub(super) cached_default_schema: RefCell<Option<&'a str>>,
}

impl<'a> ProgramInstance<'a> {
    pub fn new(
        settings: Rc<ProgramAnalysisSettings>,
        arena: &'a bumpalo::Bump,
        text: &'a str,
        program_proto: sx::Program<'a>,
        program_translated: Rc<Program<'a>>,
        input: HashMap<usize, InputValue>,
    ) -> Self {
        let mut ctx = ProgramInstance {
            settings,
            arena,
            script_text: text,
            program_proto: program_proto,
            program: program_translated,
            input,
            node_error_messages: Vec::new(),
            node_linter_messages: Vec::new(),
            statement_names: Vec::new(),
            statement_by_name: HashMap::default(),
            statement_by_root: HashMap::default(),
            statement_required_for: BTreeMap::new(),
            statement_depends_on: BTreeMap::new(),
            statement_liveness: Vec::new(),
            cards: Vec::new(),
            cached_subtree_sizes: RefCell::new(Vec::new()),
            cached_default_schema: RefCell::new(None),
        };
        let stmts_proto = program_proto.statements().unwrap_or_default();
        ctx.statement_names.resize(stmts_proto.len(), None);
        ctx.statement_by_name.reserve(stmts_proto.len());
        ctx.statement_by_root.reserve(stmts_proto.len());
        for (stmt_id, stmt) in stmts_proto.iter().enumerate() {
            ctx.statement_by_root.insert(stmt.root_node() as usize, stmt_id);
        }
        ctx
    }
}

pub fn analyze_program<'arena>(
    settings: Rc<ProgramAnalysisSettings>,
    arena: &'arena bumpalo::Bump,
    text: &'arena str,
    program_proto: sx::Program<'arena>,
    program: Rc<Program<'arena>>,
    input: HashMap<usize, InputValue>,
) -> Result<ProgramInstance<'arena>, Box<dyn Error + Send + Sync>> {
    let mut ctx = ProgramInstance::new(settings, arena, text, program_proto, program, input);
    normalize_statement_names(&mut ctx);
    discover_statement_dependencies(&mut ctx);
    determine_statement_liveness(&mut ctx);

    todo!();
}

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

#[derive(Debug, Clone, Serialize)]
pub enum CardType {
    Input,
    Viz,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct CardPosition {
    pub row: u32,
    pub column: u32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct Card<'a> {
    pub card_type: CardType,
    pub card_title: String,
    pub card_position: CardPosition,
    pub statement_id: u32,
    #[serde(with = "serde_input_component_type")]
    pub input_component: sx::InputComponentType,
    pub input_extra: Option<DsonValue<'a>>,
}
