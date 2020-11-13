dashql_identifier:
    sql_col_id
  | SCONST
    ;

dashql_opt_alias:
    %empty                  { $$ = Null(); }
  | AS dashql_identifier    { $$ = String(@2); }
    ;
