
sql_select_statement:
    LRB sql_select_statement RRB    { $$ = $2; }
  | sql_select_no_parens            { $$ = $1; }
    ;

sql_select_no_parens:
    sql_simple_select               { $$ = $1; }

sql_simple_select:
    SELECT                          { $$ = {}; }
