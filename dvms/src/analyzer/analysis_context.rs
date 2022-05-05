use super::super::grammar::Program;
use dashql_proto::syntax as sx;

pub struct ProgramAnalysisContext<'arena, 'text, 'ast> {
    pub arena: &'arena bumpalo::Bump,
    pub script_text: &'text str,
    pub program_flat: sx::Program<'ast>,
    pub program_translated: Option<Program<'text, 'arena>>,
    pub subtree_sizes: Vec<usize>,
    pub statement_deps: Vec<sx::DependencyT>,
}

impl<'arena, 'text, 'ast> ProgramAnalysisContext<'arena, 'text, 'ast> {
    pub fn new(arena: &'arena bumpalo::Bump, text: &'text str, ast: sx::Program<'ast>) -> Self {
        ProgramAnalysisContext {
            arena,
            script_text: text,
            program_flat: ast,
            program_translated: None,
            subtree_sizes: Vec::new(),
            statement_deps: Vec::new(),
        }
    }
}
