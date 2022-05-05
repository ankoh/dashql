use super::super::grammar::*;
use dashql_proto::syntax as sx;
use std::collections::HashMap;
use std::rc::Rc;

pub struct ProgramAnalysisContext<'arena, 'text, 'ast> {
    pub arena: &'arena bumpalo::Bump,
    pub script_text: &'text str,
    pub program_flat: sx::Program<'ast>,
    pub program_translated: Rc<Program<'text, 'arena>>,
    pub subtree_sizes: Vec<usize>,
    pub statement_names: Vec<NamePath<'text, 'arena>>,
    pub statement_by_name: HashMap<NamePath<'text, 'arena>, usize>,
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
            statement_names: Vec::new(),
            statement_by_name: HashMap::default(),
            statement_deps: Vec::new(),
        }
    }
}
