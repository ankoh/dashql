dashql_extract_statement:
    EXTRACT dashql_identifier FROM dashql_identifier USING dashql_extract_method {
        $6.push_back(sx::Attribute(@2, sx::AttributeKey::DASHQL_EXTRACT_NAME, $2));
        $6.push_back(sx::Attribute(@4, sx::AttributeKey::DASHQL_EXTRACT_DATA, $4));
        $$ = ctx.CreateObject(@$, sx::ObjectType::DASHQL_EXTRACT, move($6));
    }
    ;

dashql_extract_method:
    CSV dashql_opt_csv_attribute_list   { $$ = move($2); }
  | JSON LRB RRB                        { $$ = {}; }
    ;

dashql_opt_csv_attribute_list:
    LRB dashql_csv_attribute_list RRB   { $$ = move($2); }
 |  %empty                              { $$ = {}; }
    ;

dashql_csv_attribute_list:
    dashql_csv_attribute_list COMMA dashql_csv_attribute    { $1.push_back($3); $$ = move($1); }
  | dashql_csv_attribute                                    { $$ = { $1 }; }
    ;

dashql_csv_attribute:
    ENCODING EQUAL dashql_string_value             { $$ = sx::Attribute(@$, sx::AttributeKey::DASHQL_CSV_EXTRACT_ENCODING, $3); }
  | HEADER EQUAL dashql_csv_header_value           { $$ = sx::Attribute(@$, sx::AttributeKey::DASHQL_CSV_EXTRACT_HEADER, $3); }
  | DELIMITER EQUAL dashql_string_value            { $$ = sx::Attribute(@$, sx::AttributeKey::DASHQL_CSV_EXTRACT_DELIMITER, $3); }
  | QUOTE EQUAL dashql_string_value                { $$ = sx::Attribute(@$, sx::AttributeKey::DASHQL_CSV_EXTRACT_QUOTE, $3); }
  | DATE FORMAT EQUAL dashql_string_value          { $$ = sx::Attribute(@$, sx::AttributeKey::DASHQL_CSV_EXTRACT_DATE_FORMAT, $4); }
  | TIMESTAMP FORMAT EQUAL dashql_string_value     { $$ = sx::Attribute(@$, sx::AttributeKey::DASHQL_CSV_EXTRACT_TIMESTAMP_FORMAT, $4); }
    ;

dashql_csv_header_value:
    dashql_boolean_value               { $$ = $1; }
  | LRB dashql_csv_string_list RRB     { $$ = ctx.AddArray(@$, $2); }

dashql_csv_string_list:
    dashql_csv_string_list COMMA STRING_LITERAL     { $1.push_back(@3); $$ = move($1); }
  | %empty                                          { $$ = {}; }
    ;

