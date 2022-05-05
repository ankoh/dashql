use dashql_proto::syntax as sx;

pub struct ProgramAnalysisContext<'text, 'ast> {
    pub script_text: &'text str,
    pub script_ast: sx::Program<'ast>,
    pub subtree_sizes: Vec<usize>,
    pub dependencies: Vec<sx::DependencyT>,
}

impl<'text, 'ast> ProgramAnalysisContext<'text, 'ast> {
    pub fn new(text: &'text str, ast: sx::Program<'ast>) -> Self {
        ProgramAnalysisContext {
            script_text: text,
            script_ast: ast,
            subtree_sizes: Vec::new(),
            dependencies: Vec::new(),
        }
    }
}
