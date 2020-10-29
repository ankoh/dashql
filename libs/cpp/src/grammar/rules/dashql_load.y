dashql_load_statement:
    LOAD dashql_identifier FROM dashql_load_attributes {
        $4.push_back(sx::Attribute(@2, sx::AttributeKey::DASHQL_LOAD_NAME, $2));
        $$ = ctx.CreateObject(@$, sx::ObjectTag::DASHQL_LOAD_STATEMENT, move($4));
    }
    ;

dashql_load_attributes:
    HTTP LRB dashql_opt_http_attribute_list RRB     { $$ = move($3); }
  | FILE dashql_string_value                        { $$ = { sx::Attribute(@$, sx::AttributeKey::DASHQL_FILE_LABEL, $2) };  }
    ;

dashql_opt_http_attribute_list:
    dashql_http_attribute_list      { $$ = move($1); }
  | %empty                          { $$ = {}; }

dashql_http_attribute_list:
    dashql_http_attribute_list COMMA dashql_http_attribute      { $1.push_back($3); $$ = move($1); }
  | dashql_http_attribute                                       { $$ = {$1}; }
    ;

dashql_http_attribute:
    METHOD EQUAL dashql_http_verb   { $$ = sx::Attribute(@$, sx::AttributeKey::DASHQL_HTTP_LOAD_VERB, $3); }
  | URL EQUAL dashql_string_value   { $$ = sx::Attribute(@$, sx::AttributeKey::DASHQL_HTTP_LOAD_URL, $3); }
    ;

dashql_http_verb:
    GET     { $$ = sx::Value(@$, sx::ValueType::I32, (int) sxd::HTTPVerb::GET); }
  | PUT     { $$ = sx::Value(@$, sx::ValueType::I32, (int) sxd::HTTPVerb::PUT); }
  | POST    { $$ = sx::Value(@$, sx::ValueType::I32, (int) sxd::HTTPVerb::POST); }
    ;
