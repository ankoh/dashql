dashql_identifier:
    IDENTIFIER
  | SCONST
    ;

dashql_opt_alias:
    %empty                  { $$ = ctx.Null(); }
  | AS dashql_identifier    { $$ = ctx.Ref(@2); }
    ;
