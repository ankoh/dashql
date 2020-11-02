%start opt_dashql_statement_list;

opt_dashql_statement_list:
    dashql_statement_list
  | %empty

dashql_statement_list:
    dashql_statement_list ';' opt_dashql_statement  { ctx.AddStatement($3); }
  | dashql_statement error ';'                      { yyclearin; yyerrok; }
  | dashql_statement                                { ctx.AddStatement($1); }
    ;

opt_dashql_statement:
    dashql_statement               { $$ = $1; }
  | %empty                         { $$ = sx::Value(@$, sx::ValueType::NONE, 0); }

dashql_statement:
    dashql_parameter_declaration   { $$ = $1; }
  | dashql_load_statement          { $$ = $1; }
  | dashql_extract_statement       { $$ = $1; }
  | dashql_query_statement         { $$ = $1; }
  | dashql_viz_statement           { $$ = $1; }
    ;


