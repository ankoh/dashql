dashql_load_statement:
    LOAD dashql_identifier FROM dashql_load_attributes {
        $4.push_back(ctx.Attr(Key::DASHQL_LOAD_NAME, ctx.String(@2)));
        $$ = ctx.Object(@$, sx::NodeType::DASHQL_LOAD, move($4));
    }
    ;

dashql_load_attributes:
    HTTP '(' dashql_opt_http_attribute_list ')' { $$ = move($3); }
  | FILE SCONST                                 { $$ = { ctx.Attr(Key::DASHQL_FILE_LABEL, ctx.String(@2)) };  }
    ;

dashql_opt_http_attribute_list:
    dashql_http_attribute_list      { $$ = move($1); }
  | %empty                          { $$ = {}; }

dashql_http_attribute_list:
    dashql_http_attribute_list ',' dashql_http_attribute    { $1.push_back($3); $$ = move($1); }
  | dashql_http_attribute                                   { $$ = {$1}; }
    ;

dashql_http_attribute:
    METHOD '=' dashql_http_verb { $$ = ctx.Attr(Key::DASHQL_HTTP_LOAD_VERB, $3); }
  | URL '=' SCONST              { $$ = ctx.Attr(Key::DASHQL_HTTP_LOAD_URL, ctx.String(@3)); }
    ;

dashql_http_verb:
    GET     { $$ = ctx.Enum(@$, sxd::HTTPVerb::GET); }
  | PUT     { $$ = ctx.Enum(@$, sxd::HTTPVerb::PUT); }
  | POST    { $$ = ctx.Enum(@$, sxd::HTTPVerb::POST); }
    ;
