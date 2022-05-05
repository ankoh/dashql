use super::super::grammar::Program;
use dashql_proto::syntax as sx;
use std::rc::Rc;

pub struct ProgramAnalysisContext<'arena, 'text, 'ast> {
    pub arena: &'arena bumpalo::Bump,
    pub script_text: &'text str,
    pub program_flat: sx::Program<'ast>,
    pub program_translated: Rc<Program<'text, 'arena>>,
    pub subtree_sizes: Vec<usize>,
    pub statement_deps: Vec<sx::DependencyT>,
}

impl<'arena, 'text, 'ast> ProgramAnalysisContext<'arena, 'text, 'ast> {
    pub fn new(
        arena: &'arena bumpalo::Bump,
        text: &'text str,
        program_flat: sx::Program<'ast>,
        program_translated: Rc<Program<'text, 'arena>>,
    ) -> Self {
        ProgramAnalysisContext {
            arena,
            script_text: text,
            program_flat,
            program_translated,
            subtree_sizes: Vec::new(),
            statement_deps: Vec::new(),
        }
    }
}
