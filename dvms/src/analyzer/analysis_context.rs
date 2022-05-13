use super::super::grammar::*;
use super::analysis_settings::ProgramAnalysisSettings;
use dashql_proto::syntax as sx;
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::rc::Rc;

pub type StatementID = usize;
pub type NodeID = usize;

pub struct ProgramAnalysisContext<'a> {
    pub settings: Rc<ProgramAnalysisSettings>,

    // AST buffer
    pub arena: &'a bumpalo::Bump,
    pub script_text: &'a str,
    pub program_proto: sx::Program<'a>,
    pub program: Rc<Program<'a>>,

    // Analysis output
    pub statement_names: Vec<Option<NamePath<'a>>>,
    pub statement_by_name: HashMap<NamePath<'a>, usize>,
    pub statement_by_root: HashMap<usize, usize>,
    pub statement_required_for: BTreeMap<(StatementID, StatementID), (sx::DependencyType, NodeID)>,
    pub statement_depends_on: BTreeMap<(StatementID, StatementID), (sx::DependencyType, NodeID)>,
    pub statement_liveness: Vec<bool>,

    // Cached properties during analysis
    pub cached_subtree_sizes: Vec<usize>,
    pub cached_default_schema: Option<&'a str>,
}

impl<'a> ProgramAnalysisContext<'a> {
    pub fn new(
        settings: Rc<ProgramAnalysisSettings>,
        arena: &'a bumpalo::Bump,
        text: &'a str,
        program_proto: sx::Program<'a>,
        program_translated: Rc<Program<'a>>,
    ) -> Self {
        let mut ctx = ProgramAnalysisContext {
            settings,
            arena,
            script_text: text,
            program_proto: program_proto,
            program: program_translated,
            statement_names: Vec::new(),
            statement_by_name: HashMap::default(),
            statement_by_root: HashMap::default(),
            statement_required_for: BTreeMap::new(),
            statement_depends_on: BTreeMap::new(),
            statement_liveness: Vec::new(),
            cached_subtree_sizes: Vec::new(),
            cached_default_schema: None,
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
