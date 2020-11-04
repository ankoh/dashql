dashql_identifier:
    IDENTIFIER
  | SCONST
    ;

dashql_opt_alias:
    %empty                  { $$ = std::nullopt; }
  | AS dashql_identifier    { $$ = ctx.Ref(@2); }
    ;
