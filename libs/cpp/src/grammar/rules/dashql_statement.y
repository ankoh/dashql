%start dashql_statement_list;

dashql_statement_list:
    dashql_statement_list ';' dashql_statement { ctx.AddStatement($3); }
  | dashql_statement_list error     { yyclearin; yyerrok; }
  | dashql_statement                { ctx.AddStatement($1); }
  | %empty
    ;

dashql_statement:
    dashql_parameter_declaration   { $$ = $1; }
  | dashql_load_statement          { $$ = $1; }
  | dashql_extract_statement       { $$ = $1; }
  | dashql_query_statement         { $$ = $1; }
  | dashql_viz_statement           { $$ = $1; }
    ;


