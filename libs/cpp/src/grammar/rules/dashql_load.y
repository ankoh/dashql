dashql_load_statement:
    LOAD dashql_identifier FROM dashql_load_attributes {
        $4.push_back(Key::DASHQL_LOAD_NAME << ctx.Ref(@2));
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_LOAD, move($4));
    }
    ;

dashql_load_attributes:
    HTTP '(' dashql_opt_http_attribute_list ')' { $$ = move($3); }
  | FILE SCONST                                 { $$ = { Key::DASHQL_FILE_LABEL << ctx.Ref(@2) };  }
    ;

dashql_opt_http_attribute_list:
    dashql_http_attribute_list      { $$ = move($1); }
  | %empty                          { $$ = {}; }

dashql_http_attribute_list:
    dashql_http_attribute_list ',' dashql_http_attribute    { $1.push_back($3); $$ = move($1); }
  | dashql_http_attribute                                   { $$ = {$1}; }
    ;

dashql_http_attribute:
    METHOD '=' dashql_http_verb { $$ = Key::DASHQL_HTTP_LOAD_VERB << $3; }
  | URL '=' SCONST              { $$ = Key::DASHQL_HTTP_LOAD_URL << ctx.Ref(@3); }
    ;

dashql_http_verb:
    GET     { $$ = EnumNode(@$, sxd::HTTPVerb::GET); }
  | PUT     { $$ = EnumNode(@$, sxd::HTTPVerb::PUT); }
  | POST    { $$ = EnumNode(@$, sxd::HTTPVerb::POST); }
    ;
