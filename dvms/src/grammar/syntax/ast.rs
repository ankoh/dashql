use super::dashql_nodes::*;
use super::sql_nodes::*;

#[derive(Debug, Clone)]
pub enum Statement<'text, 'bump> {
    Select(SelectStatement<'text, 'bump>),
    Input(InputStatement<'text, 'bump>),
    Fetch(FetchStatement<'text, 'bump>),
    Load(LoadStatement<'text, 'bump>),
    Viz(VizStatement<'text, 'bump>),
    CreateAs(CreateAsStatement<'text, 'bump>),
    CreateView(CreateViewStatement<'text, 'bump>),
    Set(SetStatement<'text, 'bump>),
}

#[derive(Debug, Clone)]
pub struct Program<'text, 'bump> {
    pub statements: Vec<Statement<'text, 'bump>>,
}
