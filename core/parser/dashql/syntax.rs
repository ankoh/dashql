pub trait Error = std::error::Error;

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Position<'input> {
    pub line: usize,
    pub column: usize,
    phantom: std::marker::PhantomData<&'input str>,
}

impl<'input> From<(usize, usize)> for Position<'input> {
    fn from(value: (usize, usize)) -> Self {
        Self {
            line: value.0,
            column: value.1,
            phantom: std::marker::PhantomData,
        }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Location<'input> {
    pub begin: Position<'input>,
    pub end: Position<'input>,
    phantom: std::marker::PhantomData<&'input str>,
}

impl<'input> Location<'input> {
    pub fn invalid() -> Self {
        ((0, 0), (0, 0)).into()
    }

    pub fn is_valid(&self) -> bool {
        let begin_greater_zero = self.begin.line > 0 && self.begin.column > 0;
        let end_after_begin = self.end.line > self.begin.line
            || self.end.line == self.begin.line && self.end.column >= self.begin.column;

        begin_greater_zero && end_after_begin
    }
}

impl<'input, T> From<(&dyn lrpar::NonStreamingLexer<'input, u32>, lrpar::Lexeme<T>)>
    for Location<'input>
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
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'input, T>
    From<(
        &dyn lrpar::NonStreamingLexer<'input, u32>,
        lrpar::Lexeme<T>,
        lrpar::Lexeme<T>,
    )> for Location<'input>
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
            phantom: std::marker::PhantomData,
        }
    }
}

impl<'input> From<(Location<'input>, Location<'input>)> for Location<'input> {
    fn from(value: (Location<'input>, Location<'input>)) -> Self {
        let left = value.0;
        let right = value.1;

        match (left.is_valid(), right.is_valid()) {
            (false, false) => Self::invalid(),
            (false, true) => right,
            (true, false) => left,
            (true, true) => Self {
                begin: value.0.begin,
                end: value.1.end,
                phantom: std::marker::PhantomData,
            },
        }
    }
}

impl<'input> From<((usize, usize), (usize, usize))> for Location<'input> {
    fn from(value: ((usize, usize), (usize, usize))) -> Self {
        Self {
            begin: value.0.into(),
            end: value.1.into(),
            phantom: std::marker::PhantomData,
        }
    }
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct String<'input> {
    pub location: Location<'input>,
    pub string: &'input str,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Statement<'input> {
    ParameterDeclaration(ParameterDeclaration<'input>),
    LoadStatement(LoadStatement<'input>),
    ExtractStatement(ExtractStatement<'input>),
    QueryStatement(QueryStatement<'input>),
    VisualizeStatement(VisualizeStatement<'input>),
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct ParameterDeclaration<'input> {
    pub location: Location<'input>,
    pub identifier: String<'input>,
    pub label: String<'input>,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum ParameterType<'input> {
    Integer(Location<'input>),
    Float(Location<'input>),
    Text(Location<'input>),
    Date(Location<'input>),
    DateTime(Location<'input>),
    Time(Location<'input>),
    File(Location<'input>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LoadStatement<'input> {
    pub location: Location<'input>,
    pub identifier: String<'input>,
    pub method: LoadMethod<'input>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LoadMethod<'input> {
    Http(HttpLoader<'input>),
    File(FileLoader<'input>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HttpLoader<'input> {
    pub location: Location<'input>,
    pub attributes: Option<HttpLoaderAttributes<'input>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HttpLoaderAttributes<'input> {
    pub location: Location<'input>,
    pub attributes: Vec<HttpLoaderAttribute<'input>>,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum HttpLoaderAttribute<'input> {
    Method(Location<'input>, HttpMethod<'input>),
    Url(Location<'input>, String<'input>),
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum HttpMethod<'input> {
    Get(Location<'input>),
    Put(Location<'input>),
    Post(Location<'input>),
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct FileLoader<'input> {
    pub location: Location<'input>,
    pub variable: Option<Variable<'input>>,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Variable<'input> {
    pub location: Location<'input>,
    pub identifier: String<'input>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExtractStatement<'input> {
    pub location: Location<'input>,
    pub identifier: String<'input>,
    pub source: String<'input>,
    pub method: ExtractMethod<'input>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExtractMethod<'input> {
    Csv(CsvExtractor<'input>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CsvExtractor<'input> {
    pub location: Location<'input>,
    pub attributes: Option<CsvExtractorAttributes<'input>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CsvExtractorAttributes<'input> {
    pub location: Location<'input>,
    pub attributes: Vec<CsvExtractorAttribute<'input>>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CsvExtractorAttribute<'input> {
    Encoding(Location<'input>, String<'input>),
    Header(Location<'input>, CsvHeaderValue<'input>),
    Delimiter(Location<'input>, String<'input>),
    Quote(Location<'input>, String<'input>),
    DateFormat(Location<'input>, String<'input>),
    TimestampFormat(Location<'input>, String<'input>),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CsvHeaderValue<'input> {
    Boolean(Boolean<'input>),
    Strings(Strings<'input>),
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Boolean<'input> {
    pub location: Location<'input>,
    pub boolean: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Strings<'input> {
    pub location: Location<'input>,
    pub strings: Vec<String<'input>>,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct QueryStatement<'input> {
    pub location: Location<'input>,
    pub identifier: String<'input>,
    pub query: String<'input>,
}

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct VisualizeStatement<'input> {
    pub location: Location<'input>,
}
