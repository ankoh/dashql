// ---------------------------------------------------------------------------
// DashQL Objects

varargs:
    LRB vararg_fields RRB  { $$ = std::move($2); }
    ;

vararg_fields:
    vararg_fields COMMA opt_vararg_field  { $1->push_back($3); $$ = std::move($1); }
  | opt_vararg_field                    { $$ = ctx.List({$1}); }
    ;

opt_vararg_field:
    vararg_key_path EQUALS vararg_value { $$ = VarArgField(ctx, @$, std::move($1), $3); }
  | %empty                           { $$ = Null(); }
    ;

vararg_key_path:
    vararg_key_path DOT vararg_key  { $1->push_back($3); $$ = std::move($1); }
  | vararg_key                      { $$ = ctx.List({ $1 }); }

vararg_key:
    SCONST                      { $$ = Const(@1, buffers::parser::AConstType::STRING); }
  | IDENT                       { $$ = NameFromIdentifier(@1, $1); }
  | sql_unreserved_keywords     { $$ = ctx.NameFromKeyword(@1, $1); }
  | sql_column_name_keywords    { $$ = ctx.NameFromKeyword(@1, $1); }
  | sql_type_func_keywords      { $$ = ctx.NameFromKeyword(@1, $1); }
  | sql_reserved_keywords       { $$ = ctx.NameFromKeyword(@1, $1); }
    ;

vararg_value:
    varargs                   { $$ = ctx.Array(@$, std::move($1)); }
  | vararg_array_brackets {
      $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_EXT_VARARG_ARRAY, {
          Attr(Key::EXT_VARARG_ARRAY_VALUES, ctx.Array(@1, std::move($1))),
      });
    }
  | sql_func_expr             { $$ = $1; }
  | sql_columnref             { $$ = $1; }
  | sql_a_expr_const          { $$ = ctx.Expression(std::move($1)); }
  | PLUS sql_a_expr_const %prec UMINUS   { $$ = ctx.Expression(std::move($2)); }
  | MINUS sql_a_expr_const %prec UMINUS   { $$ = Negate(ctx, @$, @1, ctx.Expression(std::move($2))); }
    ;

vararg_array:
    vararg_array COMMA vararg_value   { $1->push_back($3); $$ = std::move($1); }
  | vararg_value                    { $$ = ctx.List({$1}); }
  | %empty                          { $$ = ctx.List(); }
    ;

vararg_array_brackets:
    LSB vararg_array RSB            { $$ = std::move($2); }
    ;
