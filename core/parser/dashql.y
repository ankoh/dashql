%start Statements

%%

Statements -> Produce<Vec<Statement<'input>>>:
    Statement ";"               { Ok(vec!($1?)) }
  | Statements Statement ";"    { let mut vec = $1?; vec.push($2?); Ok(vec) }
  ;

Statement -> Produce<Statement<'input>>:
    ParameterDeclaration    { $1 }
  | LoadStatement           { $1 }
  | ExtractStatement        { $1 }
  | QueryStatement          { $1 }
  | VisualizeStatement      { $1 }
  ;

ParameterDeclaration -> Produce<Statement<'input>>:
    "declare" "parameter"   { Ok(Statement::ParameterDeclaration) }
  ;

LoadStatement -> Produce<Statement<'input>>:
    "load"  { Ok(Statement::LoadStatement) }
  ;

ExtractStatement -> Produce<Statement<'input>>:
    "extract"   { Ok(Statement::ExtractStatement) }
  ;

QueryStatement -> Produce<Statement<'input>>:
    "query" { Ok(Statement::QueryStatement) }
  ;

VisualizeStatement -> Produce<Statement<'input>>:
    "visualize" { Ok(Statement::VisualizeStatement) }
  ;

%%

use crate::parser::context::*;
