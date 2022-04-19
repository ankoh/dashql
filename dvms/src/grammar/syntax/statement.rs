use super::sql_nodes::SelectStatement;

#[derive(Debug, Clone)]
pub enum Statement<'text> {
    Select(SelectStatement<'text>),
}
