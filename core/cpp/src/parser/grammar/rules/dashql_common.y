dashql_identifier:
    sql_col_id_or_string
    ;

dashql_opt_alias:
    %empty                  { $$ = Null(); }
  | AS dashql_identifier    { $$ = String(@2); }
    ;

// ---------------------------------------------------------------------------
// A generic object

opt_dashql_object:
    dashql_object   { $$ = move($1); }
  | %empty          { $$ = {}; }
    ;

dashql_object:
    '(' dashql_obj_attr_list ')'    { $$ = move($2); }
    ;

dashql_obj_attr_list:
    dashql_obj_attr_list ',' dashql_obj_attr    { $1.push_back($3); $$ = move($1); }
  | dashql_obj_attr                             { $$ = {$1}; }
    ;

dashql_obj_array:
    dashql_obj_array ',' dashql_obj_attr_value  { $1.push_back($3); $$ = move($1); }
  | dashql_obj_attr_value                       { $$ = {$1}; }
    ;

dashql_obj_array_brackets:
    '[' dashql_obj_array ']'                    { $$ = move($2); }
    ;

dashql_obj_attr:
    dashql_obj_attr_key '=' dashql_obj_attr_value   { $$ = ObjectAttribute(ctx, @$, $1, $3); }
    ;

dashql_obj_attr_key:
    IDENT   { $$ = ObjectAttributeKey(ctx, @1); }
  | SCONST  { $$ = ObjectAttributeKey(ctx, @1); }
    ;

dashql_obj_attr_value:
    dashql_object               { $$ = ctx.Add(@$, move($1)); }
  | dashql_obj_array_brackets   { $$ = ctx.Add(@$, move($1)); }
  | IDENT       { $$ = String(@1); }
  | UIDENT      { $$ = String(@1); }
  | FCONST      { $$ = String(@1); }
  | SCONST      { $$ = String(@1); }
  | USCONST     { $$ = String(@1); }
  | BCONST      { $$ = String(@1); }
  | XCONST      { $$ = String(@1); }
    ;

