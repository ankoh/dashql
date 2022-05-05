use super::super::grammar::*;
use dashql_proto::syntax as sx;
use std::collections::HashMap;
use std::rc::Rc;

pub struct ProgramAnalysisSettings {
    pub default_schema: String,
}

impl Default for ProgramAnalysisSettings {
    fn default() -> Self {
        Self {
            default_schema: "main".to_string(),
        }
    }
}

pub struct ProgramAnalysisContext<'arena, 'text, 'ast> {
    pub settings: Rc<ProgramAnalysisSettings>,

    // AST state
    pub arena: &'arena bumpalo::Bump,
    pub script_text: &'text str,
    pub program_flat: sx::Program<'ast>,
    pub program_translated: Rc<Program<'text, 'arena>>,

    // Name resolution of statements
    pub statement_names: Vec<Option<NamePath<'text, 'arena>>>,
    pub statement_by_name: HashMap<NamePath<'text, 'arena>, usize>,
    pub statement_by_root: HashMap<usize, usize>,
    pub statement_deps: Vec<sx::DependencyT>,

    // Cached subtree sizes and diffs
    pub cached_subtree_sizes: Vec<usize>,
    pub cached_default_schema: Option<&'arena str>,
}

impl<'arena, 'text, 'ast> ProgramAnalysisContext<'arena, 'text, 'ast> {
    pub fn new(
        settings: Rc<ProgramAnalysisSettings>,
        arena: &'arena bumpalo::Bump,
        text: &'text str,
        program_flat: sx::Program<'ast>,
        program_translated: Rc<Program<'text, 'arena>>,
    ) -> Self {
        let mut ctx = ProgramAnalysisContext {
            settings,
            arena,
            script_text: text,
            program_flat,
            program_translated,
            statement_names: Vec::new(),
            statement_by_name: HashMap::default(),
            statement_by_root: HashMap::default(),
            statement_deps: Vec::new(),
            cached_subtree_sizes: Vec::new(),
            cached_default_schema: None,
        };
        let stmts_flat = program_flat.statements().unwrap_or_default();
        ctx.statement_names.resize(stmts_flat.len(), None);
        ctx.statement_by_name.reserve(stmts_flat.len());
        ctx.statement_by_root.reserve(stmts_flat.len());
        for (stmt_id, stmt) in stmts_flat.iter().enumerate() {
            ctx.statement_by_root.insert(stmt.root_node() as usize, stmt_id);
        }
        ctx
    }
}
