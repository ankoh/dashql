use lrpar::lex::Lexeme;

pub trait Error = std::error::Error;
pub type Produce<T> = Result<T, Box<dyn Error>>;

#[derive(Debug, PartialEq, Eq)]
pub struct Position {
    pub line: u32,
    pub column: u32,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Location {
    pub begin: Position,
    pub end: Position,
}

impl<T> From<Lexeme<T>> for Location {
    fn from(_: lrpar::Lexeme<T>) -> Self {
        todo!()
    }
}

impl<T> From<(Lexeme<T>, Lexeme<T>)> for Location {
    fn from(_: (lrpar::Lexeme<T>, lrpar::Lexeme<T>)) -> Self {
        todo!()
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Statement<'input> {
    ParameterDeclaration(ParameterDeclaration<'input>),
    LoadStatement(LoadStatement<'input>),
    ExtractStatement(ExtractStatement<'input>),
    QueryStatement(QueryStatement<'input>),
    VisualizeStatement(VisualizeStatement<'input>),
}

#[derive(Debug, PartialEq, Eq)]
pub struct ParameterDeclaration<'input> {
    pub location: Location,
    pub _dummy: &'input str,
}

#[derive(Debug, PartialEq, Eq)]
pub struct LoadStatement<'input> {
    pub location: Location,
    pub _dummy: &'input str,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ExtractStatement<'input> {
    pub location: Location,
    pub _dummy: &'input str,
}

#[derive(Debug, PartialEq, Eq)]
pub struct QueryStatement<'input> {
    pub location: Location,
    pub _dummy: &'input str,
}

#[derive(Debug, PartialEq, Eq)]
pub struct VisualizeStatement<'input> {
    pub location: Location,
    pub _dummy: &'input str,
}
