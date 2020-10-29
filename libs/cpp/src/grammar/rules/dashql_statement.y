%start statement_list;

statement_list:
    statement_list statement SEMICOLON  { ctx.AddStatement($2); }
  | statement_list error SEMICOLON      { yyclearin; yyerrok; }
  | %empty
    ;

statement:
    parameter_declaration   { $$ = $1; }
  | load_statement          { $$ = $1; }
  | extract_statement       { $$ = $1; }
  | query_statement         { $$ = $1; }
  | viz_statement           { $$ = $1; }
    ;


