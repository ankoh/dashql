use super::ast_node::*;
use super::ast_nodes_dashql::*;
use super::ast_nodes_sql::*;

#[derive(Debug, Clone)]
pub enum Statement<'arena> {
    Select(&'arena SelectStatement<'arena>),
    Input(&'arena InputStatement<'arena>),
    Fetch(&'arena FetchStatement<'arena>),
    Load(&'arena LoadStatement<'arena>),
    Viz(&'arena VizStatement<'arena>),
    Create(&'arena CreateStatement<'arena>),
    CreateAs(&'arena CreateAsStatement<'arena>),
    CreateView(&'arena CreateViewStatement<'arena>),
    Set(&'arena SetStatement<'arena>),
}

#[derive(Clone, Default)]
pub struct Program<'arena> {
    pub nodes: Vec<&'arena ASTNode<'arena>>,
    pub statements: Vec<Statement<'arena>>,
}

impl<'arena> std::fmt::Debug for Program<'arena> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Program").field("statements", &self.statements).finish()
    }
}
