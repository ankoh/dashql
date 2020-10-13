%start Statements

%%

Statements -> Produce<'input, Vec<Statement<'input>>>:
    StatementList           { let list = $1?; Ok((list.0, list.1)) }
  ;

StatementList -> Produce<'input, Vec<Statement<'input>>>:
                            { Ok((vec![], Location::invalid())) }
  | Statements Statement    { let statements = $1?; let statement = $2?; let mut vec = statements.0; vec.push(statement.0); Ok((vec, (statements.1, statement.1).into())) }
  ;

Statement -> Produce<'input, Statement<'input>>:
    ParameterDeclaration    { let declaration = $1?; Ok((Statement::ParameterDeclaration(declaration.0), declaration.1)) }
  | LoadStatement           { let statement = $1?; Ok((Statement::LoadStatement(statement.0), statement.1)) }
  | ExtractStatement        { let statement = $1?; Ok((Statement::ExtractStatement(statement.0), statement.1)) }
  | QueryStatement          { let statement = $1?; Ok((Statement::QueryStatement(statement.0), statement.1)) }
  | VisualizeStatement      { let statement = $1?; Ok((Statement::VisualizeStatement(statement.0), statement.1)) }
  ;

ParameterDeclaration -> Produce<'input, ParameterDeclaration<'input>>:
    "DECLARE" "PARAMETER" Identifier Alias "TYPE" ParameterType ";" { let location = ($lexer, $1?, $7?).into(); let label = $3?; let alias = $4?; let identifier = alias.0.or(Some(label.0)).unwrap(); Ok((ParameterDeclaration { location, identifier, label: label.0 }, location)) }
  ;

Identifier -> Produce<'input, String<'input>>:
    "SINGLY_QUOTED_STRING"  { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "IDENTIFIER"            { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | Keyword                 { $1 }
  ;

Keyword -> Produce<'input, String<'input>>:
    "AS"        { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "CSV"       { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "DATE"      { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "DATETIME"  { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "DECLARE"   { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "DELIMITER" { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "ENCODING"  { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "EXTRACT"   { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "FALSE"     { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "FILE"      { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "FLOAT"     { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "FORMAT"    { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "FROM"      { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "GET"       { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "HEADER"    { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "HTTP"      { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "INTEGER"   { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "LOAD"      { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "METHOD"    { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "PARAMETER" { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "POST"      { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "PUT"       { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "QUERY"     { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "QUOTE"     { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "TEXT"      { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "TIME"      { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "TIMESTAMP" { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "TRUE"      { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "TYPE"      { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "URL"       { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "USING"     { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  | "VISUALIZE" { let location = ($lexer, $1?).into(); Ok((String { location, string: $lexer.span_str($1?.span()) }, location)) }
  ;

Alias -> Produce<'input, Option<String<'input>>>:
                    { Ok((None, Location::invalid())) }
  | "AS" Identifier { let identifier = $2?; Ok((Some(identifier.0), identifier.1)) }
  ;

ParameterType -> Produce<'input, ParameterType<'input>>:
    "DATE"      { let location = ($lexer, $1?).into(); Ok((ParameterType::Date(location), location)) }
  | "DATETIME"  { let location = ($lexer, $1?).into(); Ok((ParameterType::DateTime(location), location)) }
  | "FILE"      { let location = ($lexer, $1?).into(); Ok((ParameterType::File(location), location)) }
  | "FLOAT"     { let location = ($lexer, $1?).into(); Ok((ParameterType::Float(location), location)) }
  | "INTEGER"   { let location = ($lexer, $1?).into(); Ok((ParameterType::Integer(location), location)) }
  | "TEXT"      { let location = ($lexer, $1?).into(); Ok((ParameterType::Text(location), location)) }
  | "TIME"      { let location = ($lexer, $1?).into(); Ok((ParameterType::Time(location), location)) }
  ;

LoadStatement -> Produce<'input, LoadStatement<'input>>:
    "LOAD" Identifier "FROM" LoadMethod ";" { let location = ($lexer, $1?, $5?).into(); Ok((LoadStatement { location, identifier: $2?.0, method: $4?.0 }, location)) }
  ;

LoadMethod -> Produce<'input, LoadMethod<'input>>:
    "HTTP" HttpLoaderAttributes { let http = $1?; let attributes = $2?; let location = (($lexer, http).into(), if attributes.0.is_some() { attributes.1 } else { ($lexer, http).into() }).into(); Ok((LoadMethod::Http(HttpLoader { location, attributes: attributes.0 }), location)) }
  | "FILE" Variable             { let file = $1?; let variable = $2?; let location = (($lexer, file).into(), if variable.0.is_some() { variable.1 } else { ($lexer, file).into() }).into(); Ok((LoadMethod::File(FileLoader { location, variable: variable.0 }), location)) }
  ;

HttpLoaderAttributes -> Produce<'input, Option<HttpLoaderAttributes<'input>>>:
                                    { Ok((None, Location::invalid())) }
  | "(" HttpLoaderAttributeList ")" { let location = ($lexer, $1?, $3?).into(); Ok((Some(HttpLoaderAttributes { location, attributes: $2?.0 }), location)) }
  ;

HttpLoaderAttributeList -> Produce<'input, Vec<HttpLoaderAttribute<'input>>>:
                                                    { Ok((vec![], Location::invalid())) }
  | HttpLoaderAttribute                             { let attribute = $1?; Ok((vec![attribute.0], attribute.1)) }
  | HttpLoaderAttributeList "," HttpLoaderAttribute { let attributes = $1?; let attribute = $3?; let mut vec = attributes.0; vec.push(attribute.0); Ok((vec, (attributes.1, attribute.1).into())) }
  ;

HttpLoaderAttribute -> Produce<'input, HttpLoaderAttribute<'input>>:
    "METHOD" "=" HttpMethod             { let value = $3?; let location = (($lexer, $1?).into(), value.1).into(); Ok((HttpLoaderAttribute::Method(location, value.0), location)) }
  | "URL" "=" "SINGLY_QUOTED_STRING"    { let value = $3?; let location = ($lexer, $1?, value).into(); Ok((HttpLoaderAttribute::Url(location, String { location: ($lexer, value).into(), string: $lexer.span_str(value.span()) }), location)) }
  ;

HttpMethod -> Produce<'input, HttpMethod<'input>>:
    "GET"   { let location = ($lexer, $1?).into(); Ok((HttpMethod::Get(location), location)) }
  | "PUT"   { let location = ($lexer, $1?).into(); Ok((HttpMethod::Put(location), location)) }
  | "POST"  { let location = ($lexer, $1?).into(); Ok((HttpMethod::Post(location), location)) }
  ;

Variable -> Produce<'input, Option<Variable<'input>>>:
                    { Ok(None, Location::invalid()) }
    "$" Identifier  { let identifier = $2?; let location = (($lexer, $1?).into(), identifier.1).into(); Ok((Some(Variable { location, identifier: identifier.0 }), location)) }
  ;

ExtractStatement -> Produce<'input, ExtractStatement<'input>>:
    "EXTRACT" Identifier "FROM" Identifier "USING" ExtractMethod ";"   { let location = ($lexer, $1?, $7?).into(); Ok((ExtractStatement { location, identifier: $2?.0, source: $4?.0, method: $6?.0 }, location)) }
  ;

ExtractMethod -> Produce<'input, ExtractMethod<'input>>:
    "CSV" CsvExtractorAttributes    { let csv = $1?; let attributes = $2?; let location = (($lexer, $1?).into(), if attributes.0.is_some() { attributes.1 } else { ($lexer, csv).into() }).into(); Ok((ExtractMethod::Csv(CsvExtractor { location, attributes: attributes.0 }), location)) }
  ;

CsvExtractorAttributes -> Produce<'input, Option<CsvExtractorAttributes<'input>>>:
                                        { Ok((None, Location::invalid())) }
  | "(" CsvExtractorAttributeList ")"   { let location = ($lexer, $1?, $3?).into(); Ok((Some(CsvExtractorAttributes { location, attributes: $2?.0 }), location)) }
  ;

CsvExtractorAttributeList -> Produce<'input, Vec<CsvExtractorAttribute<'input>>>:
                                                        { Ok((vec![], Location::invalid())) }
  | CsvExtractorAttribute                               { let attribute = $1?; Ok((vec![attribute.0], attribute.1)) }
  | CsvExtractorAttributeList "," CsvExtractorAttribute { let attributes = $1?; let attribute = $3?; let mut vec = attributes.0; vec.push(attribute.0); Ok((vec, (attributes.1, attribute.1).into())) }
  ;

CsvExtractorAttribute -> Produce<'input, CsvExtractorAttribute<'input>>:
    "ENCODING" "=" "SINGLY_QUOTED_STRING"           { let value = $3?; let location = ($lexer, $1?, value).into(); Ok((CsvExtractorAttribute::Encoding(location, String { location: ($lexer, value).into(), string: $lexer.span_str(value.span()) }), location)) }
  | "HEADER" "=" CsvHeaderValue                     { let value = $3?; let location = (($lexer, $1?).into(), value.1).into(); Ok((CsvExtractorAttribute::Header(location, value.0), location)) }
  | "DELIMITER" "=" "SINGLY_QUOTED_STRING"          { let value = $3?; let location = ($lexer, $1?, value).into(); Ok((CsvExtractorAttribute::Delimiter(location, String { location: ($lexer, value).into(), string: $lexer.span_str(value.span()) }), location)) }
  | "QUOTE" "=" "SINGLY_QUOTED_STRING"              { let value = $3?; let location = ($lexer, $1?, value).into(); Ok((CsvExtractorAttribute::Quote(location, String { location: ($lexer, value).into(), string: $lexer.span_str(value.span()) }), location)) }
  | "DATE" "FORMAT" "=" "SINGLY_QUOTED_STRING"      { let value = $4?; let location = ($lexer, $1?, value).into(); Ok((CsvExtractorAttribute::DateFormat(location, String { location: ($lexer, value).into(), string: $lexer.span_str(value.span()) }), location)) }
  | "TIMESTAMP" "FORMAT" "=" "SINGLY_QUOTED_STRING" { let value = $4?; let location = ($lexer, $1?, value).into(); Ok((CsvExtractorAttribute::TimestampFormat(location, String { location: ($lexer, value).into(), string: $lexer.span_str(value.span()) }), location)) }
  ;

CsvHeaderValue -> Produce<'input, CsvHeaderValue<'input>>:
    Boolean { let boolean = $1?; Ok((CsvHeaderValue::Boolean(boolean.0), boolean.1)) }
  | Strings { let strings = $1?; Ok((CsvHeaderValue::Strings(strings.0), strings.1)) }
  ;

Boolean -> Produce<'input, Boolean<'input>>:
    "TRUE"  { let location = ($lexer, $1?).into(); Ok((Boolean { location, boolean: true }, location)) }
  | "FALSE" { let location = ($lexer, $1?).into(); Ok((Boolean { location, boolean: false }, location)) }
  ;

Strings -> Produce<'input, Strings<'input>>:
    "(" StringList ")"  { let location = ($lexer, $1?, $3?).into(); Ok((Strings { location, strings: $2?.0 }, location)) }
  ;

StringList -> Produce<'input, Vec<String<'input>>>:
                                            { Ok((vec![], Location::invalid())) }
  | "SINGLY_QUOTED_STRING"                  { let string = $1?; let location = ($lexer, string).into(); Ok((vec![String { location, string: $lexer.span_str(string.span()) }], location)) }
  | StringList "," "SINGLY_QUOTED_STRING"   { let strings = $1?; let string = $3?; let location = (strings.1, ($lexer, string).into()).into(); let mut vec = strings.0; vec.push(String { location: ($lexer, string).into(), string: $lexer.span_str(string.span()) }); Ok((vec, location)) }
  ;

QueryStatement -> Produce<'input, QueryStatement<'input>>:
    "QUERY" ";" { let location = ($lexer, $1?, $2?).into(); Ok((QueryStatement { location }, location)) }
  ;

VisualizeStatement -> Produce<'input, VisualizeStatement<'input>>:
    "VISUALIZE" ";" { let location = ($lexer, $1?, $2?).into(); Ok((VisualizeStatement { location }, location)) }
  ;

%%

use crate::parser::dashql::syntax::*;
