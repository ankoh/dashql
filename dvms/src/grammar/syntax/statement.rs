use super::sql_nodes::SelectStatement;

pub enum Statement<'text> {
    Select(SelectStatement<'text>),
}
