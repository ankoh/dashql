dashql_identifier:
    IDENTIFIER
  | SCONST
    ;

dashql_opt_alias:
    %empty                  { $$ = Null(); }
  | AS dashql_identifier    { $$ = String(@2); }
    ;
