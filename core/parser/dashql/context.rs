pub trait Error = std::error::Error;
pub type Produce<T> = Result<T, Box<dyn Error>>;

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Position {
    pub line: usize,
    pub column: usize,
}

impl From<(usize, usize)> for Position {
    fn from(value: (usize, usize)) -> Self {
        Self {
            line: value.0,
            column: value.1,
        }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Location {
    pub begin: Position,
    pub end: Position,
}

impl<'input, T> From<(&dyn lrpar::NonStreamingLexer<'input, u32>, lrpar::Lexeme<T>)> for Location
where
    T: Copy,
{
    fn from(value: (&dyn lrpar::NonStreamingLexer<'input, u32>, lrpar::Lexeme<T>)) -> Self {
        let (lexer, lexeme) = value;
        let span = lexeme.span();
        let (begin, end) = lexer.line_col(span);

        Self {
            begin: begin.into(),
            end: end.into(),
        }
    }
}

impl<'input, T>
    From<(
        &dyn lrpar::NonStreamingLexer<'input, u32>,
        lrpar::Lexeme<T>,
        lrpar::Lexeme<T>,
    )> for Location
where
    T: Copy,
{
    fn from(
        value: (
            &dyn lrpar::NonStreamingLexer<'input, u32>,
            lrpar::Lexeme<T>,
            lrpar::Lexeme<T>,
        ),
    ) -> Self {
        let lexer = value.0;
        let begin = lexer.line_col(value.1.span());
        let end = lexer.line_col(value.2.span());

        Self {
            begin: begin.0.into(),
            end: end.1.into(),
        }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Statement<'input> {
    ParameterDeclaration(ParameterDeclaration<'input>),
    LoadStatement(LoadStatement<'input>),
    ExtractStatement(ExtractStatement<'input>),
    QueryStatement(QueryStatement<'input>),
    VisualizeStatement(VisualizeStatement<'input>),
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct ParameterDeclaration<'input> {
    pub location: Location,
    pub _dummy: &'input str,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct LoadStatement<'input> {
    pub location: Location,
    pub _dummy: &'input str,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct ExtractStatement<'input> {
    pub location: Location,
    pub _dummy: &'input str,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct QueryStatement<'input> {
    pub location: Location,
    pub _dummy: &'input str,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct VisualizeStatement<'input> {
    pub location: Location,
    pub _dummy: &'input str,
}
