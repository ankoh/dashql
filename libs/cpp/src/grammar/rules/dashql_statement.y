%start dashql_statement_list;

dashql_statement_list:
    dashql_statement_list dashql_statement SEMICOLON    { ctx.AddStatement($2); }
  | dashql_statement_list error SEMICOLON               { yyclearin; yyerrok; }
  | %empty
    ;

dashql_statement:
    dashql_parameter_declaration   { $$ = $1; }
  | dashql_load_statement          { $$ = $1; }
  | dashql_extract_statement       { $$ = $1; }
  | dashql_query_statement         { $$ = $1; }
  | dashql_viz_statement           { $$ = $1; }
    ;


