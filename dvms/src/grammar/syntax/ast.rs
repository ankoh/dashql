use super::ast_nodes_dashql::*;
use super::ast_nodes_sql::*;

#[derive(Debug, Clone)]
pub enum Statement<'text, 'arena> {
    Select(&'arena SelectStatement<'text, 'arena>),
    Input(&'arena InputStatement<'text, 'arena>),
    Fetch(&'arena FetchStatement<'text, 'arena>),
    Load(&'arena LoadStatement<'text, 'arena>),
    Viz(&'arena VizStatement<'text, 'arena>),
    CreateAs(&'arena CreateAsStatement<'text, 'arena>),
    CreateView(&'arena CreateViewStatement<'text, 'arena>),
    Set(&'arena SetStatement<'text, 'arena>),
}

#[derive(Debug, Clone)]
pub struct Program<'text, 'arena> {
    pub statements: Vec<Statement<'text, 'arena>>,
}
