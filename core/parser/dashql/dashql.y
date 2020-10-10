%start Statements

%%

Statements -> Produce<Vec<Statement<'input>>>:
    Statement               { Ok(vec![$1?]) }
  | Statements Statement    { let mut vec = $1?; vec.push($2?); Ok(vec) }
  ;

Statement -> Produce<Statement<'input>>:
    ParameterDeclaration    { Ok(Statement::ParameterDeclaration($1?)) }
  | LoadStatement           { Ok(Statement::LoadStatement($1?)) }
  | ExtractStatement        { Ok(Statement::ExtractStatement($1?)) }
  | QueryStatement          { Ok(Statement::QueryStatement($1?)) }
  | VisualizeStatement      { Ok(Statement::VisualizeStatement($1?)) }
  ;

ParameterDeclaration -> Produce<ParameterDeclaration<'input>>:
    "DECLARE" "PARAMETER" Identifier Alias "TYPE" ParameterType ";" { let label = $3?; let identifier = $4?.or(Some(label)).unwrap(); Ok(ParameterDeclaration { location: ($lexer, $1?, $7?).into(), identifier, label }) }
  ;

Identifier -> Produce<String<'input>>:
    "SINGLY_QUOTED_STRING"  { Ok(String { location: ($lexer, $1?).into(), string: $lexer.span_str($1?.span()) }) }
  | "IDENTIFIER"            { Ok(String { location: ($lexer, $1?).into(), string: $lexer.span_str($1?.span()) }) }
  | Keyword                 { $1 }
  ;

Keyword -> Produce<String<'input>>:
    "AS"        { Ok(String { location: ($lexer, $1?).into(), string: $lexer.span_str($1?.span()) }) }
  | "DATE"      { Ok(String { location: ($lexer, $1?).into(), string: $lexer.span_str($1?.span()) }) }
  | "DATETIME"  { Ok(String { location: ($lexer, $1?).into(), string: $lexer.span_str($1?.span()) }) }
  | "DECLARE"   { Ok(String { location: ($lexer, $1?).into(), string: $lexer.span_str($1?.span()) }) }
  | "EXTRACT"   { Ok(String { location: ($lexer, $1?).into(), string: $lexer.span_str($1?.span()) }) }
  | "FILE"      { Ok(String { location: ($lexer, $1?).into(), string: $lexer.span_str($1?.span()) }) }
  | "FLOAT"     { Ok(String { location: ($lexer, $1?).into(), string: $lexer.span_str($1?.span()) }) }
  | "INTEGER"   { Ok(String { location: ($lexer, $1?).into(), string: $lexer.span_str($1?.span()) }) }
  | "LOAD"      { Ok(String { location: ($lexer, $1?).into(), string: $lexer.span_str($1?.span()) }) }
  | "PARAMETER" { Ok(String { location: ($lexer, $1?).into(), string: $lexer.span_str($1?.span()) }) }
  | "QUERY"     { Ok(String { location: ($lexer, $1?).into(), string: $lexer.span_str($1?.span()) }) }
  | "TEXT"      { Ok(String { location: ($lexer, $1?).into(), string: $lexer.span_str($1?.span()) }) }
  | "TIME"      { Ok(String { location: ($lexer, $1?).into(), string: $lexer.span_str($1?.span()) }) }
  | "TYPE"      { Ok(String { location: ($lexer, $1?).into(), string: $lexer.span_str($1?.span()) }) }
  | "VISUALIZE" { Ok(String { location: ($lexer, $1?).into(), string: $lexer.span_str($1?.span()) }) }
  ;

Alias -> Produce<Option<String<'input>>>:
                    { Ok(None) }
  | "AS" Identifier { Ok(Some($2?)) }
  ;

ParameterType -> Produce<ParameterType<'input>>:
    "DATE"      { Ok(ParameterType::Date(($lexer, $1?).into())) }
  | "DATETIME"  { Ok(ParameterType::DateTime(($lexer, $1?).into())) }
  | "FILE"      { Ok(ParameterType::File(($lexer, $1?).into())) }
  | "FLOAT"     { Ok(ParameterType::Float(($lexer, $1?).into())) }
  | "INTEGER"   { Ok(ParameterType::Integer(($lexer, $1?).into())) }
  | "TEXT"      { Ok(ParameterType::Text(($lexer, $1?).into())) }
  | "TIME"      { Ok(ParameterType::Time(($lexer, $1?).into())) }
  ;

LoadStatement -> Produce<LoadStatement<'input>>:
    "LOAD" ";"  { Ok(LoadStatement { location: ($lexer, $2?).into() }) }
  ;

ExtractStatement -> Produce<ExtractStatement<'input>>:
    "EXTRACT" ";"   { Ok(ExtractStatement { location: ($lexer, $2?).into() }) }
  ;

QueryStatement -> Produce<QueryStatement<'input>>:
    "QUERY" ";" { Ok(QueryStatement { location: ($lexer, $2?).into() }) }
  ;

VisualizeStatement -> Produce<VisualizeStatement<'input>>:
    "VISUALIZE" ";" { Ok(VisualizeStatement { location: ($lexer, $2?).into() }) }
  ;

%%

use crate::parser::dashql::context::*;
