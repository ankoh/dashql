load_statement:
    LOAD identifier FROM load_attributes {
        $4.push_back(Attr(@2.encode(), AttrKey::LOAD_NAME, $2));
        $$ = ctx.CreateObject(@$.encode(), syntax::ObjectType::LOAD_STATEMENT, move($4));
    }
    ;

load_attributes:
    HTTP LRB opt_http_attribute_list RRB    { $$ = move($3); }
  | FILE string_value                       { $$ = { Attr(@$.encode(), AttrKey::FILE_LABEL, $2) };  }
    ;

opt_http_attribute_list:
    http_attribute_list     { $$ = move($1); }
  | %empty                  { $$ = {}; }

http_attribute_list:
    http_attribute_list COMMA http_attribute    { $1.push_back($3); $$ = move($1); }
  | http_attribute                              { $$ = {$1}; }
    ;

http_attribute:
    METHOD EQUAL http_verb  { $$ = Attr(@$.encode(), AttrKey::HTTP_LOAD_VERB, $3); }
  | URL EQUAL string_value  { $$ = Attr(@$.encode(), AttrKey::HTTP_LOAD_URL, $3); }
    ;

http_verb:
    GET     { $$ = Value(@$.encode(), ValueType::NUMBER, (int) HTTPVerb::GET); }
  | PUT     { $$ = Value(@$.encode(), ValueType::NUMBER, (int) HTTPVerb::PUT); }
  | POST    { $$ = Value(@$.encode(), ValueType::NUMBER, (int) HTTPVerb::POST); }
    ;
