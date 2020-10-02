pub trait Error = std::error::Error;
pub type Produce<T> = Result<T, Box<dyn Error>>;

#[derive(Debug, PartialEq, Eq)]
pub enum Statement<'input> {
    ParameterDeclaration,
    LoadStatement,
    ExtractStatement,
    QueryStatement,
    VisualizeStatement,
    Dummy(&'input str),
}
