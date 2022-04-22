// ---------------------------------------------------------------------------
// DashQL JSON

opt_dson:
    dson       { $$ = std::move($1); }
  | %empty     { $$ = {}; }
    ;

dson:
    '(' dson_fields ')'  { $$ = ctx.Add(@$, sx::NodeType::OBJECT_DSON, std::move($2)); }
    ;

dson_fields:
    dson_fields ',' opt_dson_field  { $1.push_back($3); $$ = std::move($1); }
  | opt_dson_field                  { $$ = {$1}; }
    ;

opt_dson_field:
    dson_key_path '=' dson_value    { $$ = ctx.AddDSONField(@$, std::move($1), $3); }
  | %empty                          { $$ = Null(); }
    ;

dson_key_path:
    dson_key_path '.' dson_key  { $1.push_back(@3); $$ = std::move($1); }
  | dson_key                    { $$ = { @1 }; }

dson_key:
    SCONST
  | IDENT
  | sql_unreserved_keywords
  | sql_column_name_keywords
  | sql_type_func_keywords
  | sql_reserved_keywords
  | dashql_keywords
    ;

dson_value:
    dson                      { $$ = std::move($1); }
  | dson_array_brackets       { $$ = ctx.Add(@$, std::move($1)); }
  | dashql_function_call      { $$ = $1; }
  | sql_columnref             { $$ = $1; }
  | sql_a_expr_const          { $$ = $1; }
  | '+' sql_a_expr_const %prec UMINUS   { $$ = $2; }
  | '-' sql_a_expr_const %prec UMINUS   { $$ = Negate(ctx, @$, @1, $2); }
    ;

dson_array:
    dson_array ',' dson_value     { $1.push_back($3); $$ = move($1); }
  | dson_value                    { $$ = {$1}; }
  | %empty                        { $$ = {}; }
    ;

dson_array_brackets:
    '[' dson_array ']'            { $$ = move($2); }
    ;
