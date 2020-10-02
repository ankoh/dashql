%start Statements

%%

Statements -> Produce<Vec<Statement<'input>>>:
    Statement ";"               { Ok(vec!($1?)) }
  | Statements Statement ";"    { let mut vec = $1?; vec.push($2?); Ok(vec) }
  ;

Statement -> Produce<Statement<'input>>:
    ParameterDeclaration    { Ok(Statement::ParameterDeclaration($1?)) }
  | LoadStatement           { Ok(Statement::LoadStatement($1?)) }
  | ExtractStatement        { Ok(Statement::ExtractStatement($1?)) }
  | QueryStatement          { Ok(Statement::QueryStatement($1?)) }
  | VisualizeStatement      { Ok(Statement::VisualizeStatement($1?)) }
  ;

ParameterDeclaration -> Produce<ParameterDeclaration<'input>>:
    "declare" "parameter"   { Ok(ParameterDeclaration { location: ($1?, $2?).into(), _dummy: "" }) }
  ;

LoadStatement -> Produce<LoadStatement<'input>>:
    "load"  { Ok(LoadStatement { location: $1?.into(), _dummy: "" }) }
  ;

ExtractStatement -> Produce<ExtractStatement<'input>>:
    "extract"   { Ok(ExtractStatement { location: $1?.into(), _dummy: "" }) }
  ;

QueryStatement -> Produce<QueryStatement<'input>>:
    "query" { Ok(QueryStatement { location: $1?.into(), _dummy: "" }) }
  ;

VisualizeStatement -> Produce<VisualizeStatement<'input>>:
    "visualize" { Ok(VisualizeStatement { location: $1?.into(), _dummy: "" }) }
  ;

%%

use crate::parser::context::*;
