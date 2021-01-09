dashql_function_call:
    sql_func_application { $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_FUNCTION_CALL, move($1)); }
    ;

// ---------------------------------------------------------------------------
// DashQL options

opt_dashql_options:
    dashql_options      { $$ = move($1); }
  | %empty              { $$ = {}; }
    ;

dashql_options:
    '(' dashql_option_list ')'  { $$ = move($2); }
    ;

dashql_option_list:
    dashql_option_list ',' dashql_option    { $1.push_back($3); $$ = move($1); }
  | dashql_option                           { $$ = {$1}; }
    ;

dashql_option:
    dashql_option_key '=' dashql_option_value       { $$ = Option(ctx, @$, @1, $3); }
    ;

dashql_option_key:
    SCONST
  | IDENT
  | sql_unreserved_keywords
  | sql_column_name_keywords
  | sql_type_func_keywords
  | sql_reserved_keywords
  | dashql_keywords
    ;

dashql_option_value:
    dashql_options                  { $$ = ctx.Add(@$, move($1)); }
  | dashql_option_array_brackets    { $$ = ctx.Add(@$, move($1)); }
  | dashql_function_call            { $$ = $1; }
  | sql_columnref                   { $$ = $1; }
  | sql_a_expr_const                { $$ = $1; }
    ;

dashql_option_array:
    dashql_option_array ',' dashql_option_value     { $1.push_back($3); $$ = move($1); }
  | dashql_option_value                             { $$ = {$1}; }
    ;

dashql_option_array_brackets:
    '[' dashql_option_array ']'                     { $$ = move($2); }
    ;
