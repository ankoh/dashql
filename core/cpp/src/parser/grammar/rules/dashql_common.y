dashql_identifier:
    sql_col_id_or_string
    ;

dashql_opt_alias:
    %empty                  { $$ = Null(); }
  | AS dashql_identifier    { $$ = String(@2); }
    ;

// ---------------------------------------------------------------------------
// DashQL options

opt_dashql_options:
    dashql_options   { $$ = move($1); }
  | %empty          { $$ = {}; }
    ;

dashql_options:
    '(' dashql_option_list ')'    { $$ = move($2); }
    ;

dashql_option_list:
    dashql_option_list ',' dashql_option    { $1.push_back($3); $$ = move($1); }
  | dashql_option                           { $$ = {$1}; }
    ;

dashql_option:
    dashql_option_key '=' dashql_option_value       { $$ = Option(ctx, @$, @1, $3); }
    ;

dashql_option_key:
    IDENT
  | SCONST
    ;

dashql_option_value:
    dashql_options                  { $$ = ctx.Add(@$, move($1)); }
  | dashql_option_array_brackets    { $$ = ctx.Add(@$, move($1)); }
  | IDENT       { $$ = String(@1); }
  | UIDENT      { $$ = String(@1); }
  | FCONST      { $$ = String(@1); }
  | SCONST      { $$ = String(@1); }
  | USCONST     { $$ = String(@1); }
  | BCONST      { $$ = String(@1); }
  | XCONST      { $$ = String(@1); }
    ;

dashql_option_array:
    dashql_option_array ',' dashql_option_value     { $1.push_back($3); $$ = move($1); }
  | dashql_option_value                             { $$ = {$1}; }
    ;

dashql_option_array_brackets:
    '[' dashql_option_array ']'                     { $$ = move($2); }
    ;
