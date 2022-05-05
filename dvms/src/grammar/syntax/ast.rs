use super::ast_node::*;
use super::ast_nodes_dashql::*;
use super::ast_nodes_sql::*;

#[derive(Debug, Clone)]
pub enum Statement<'text, 'arena> {
    Select(&'arena SelectStatement<'text, 'arena>),
    Input(&'arena InputStatement<'text, 'arena>),
    Fetch(&'arena FetchStatement<'text, 'arena>),
    Load(&'arena LoadStatement<'text, 'arena>),
    Viz(&'arena VizStatement<'text, 'arena>),
    Create(&'arena CreateStatement<'text, 'arena>),
    CreateAs(&'arena CreateAsStatement<'text, 'arena>),
    CreateView(&'arena CreateViewStatement<'text, 'arena>),
    Set(&'arena SetStatement<'text, 'arena>),
}

#[derive(Clone, Default)]
pub struct Program<'text, 'arena> {
    pub nodes: Vec<&'arena ASTNode<'text, 'arena>>,
    pub statements: Vec<Statement<'text, 'arena>>,
}

impl<'text, 'arena> std::fmt::Debug for Program<'text, 'arena> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Program").field("statements", &self.statements).finish()
    }
}
