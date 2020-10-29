extract_statement:
    EXTRACT identifier FROM identifier USING extract_method {
        $6.push_back(Attr(@2.encode(), AttrKey::EXTRACT_STATEMENT_NAME, $2));
        $6.push_back(Attr(@4.encode(), AttrKey::EXTRACT_STATEMENT_DATA, $4));
        $$ = ctx.CreateObject(@$.encode(), syntax::ObjectType::EXTRACT_STATEMENT, move($6));
    }
    ;

extract_method:
    CSV opt_csv_attribute_list  { $$ = move($2); }
  | JSON LRB RRB                { $$ = {}; }
    ;

opt_csv_attribute_list:
    LRB csv_attribute_list RRB  { $$ = move($2); }
 |  %empty                      { $$ = {}; }
    ;

csv_attribute_list:
    csv_attribute_list COMMA csv_attribute  { $1.push_back($3); $$ = move($1); }
  | csv_attribute                           { $$ = { $1 }; }
    ;

csv_attribute:
    ENCODING EQUAL string_value             { $$ = Attr(@$.encode(), AttrKey::CSV_EXTRACT_ENCODING, $3); }
  | HEADER EQUAL csv_header_value           { $$ = Attr(@$.encode(), AttrKey::CSV_EXTRACT_HEADER, $3); }
  | DELIMITER EQUAL string_value            { $$ = Attr(@$.encode(), AttrKey::CSV_EXTRACT_DELIMITER, $3); }
  | QUOTE EQUAL string_value                { $$ = Attr(@$.encode(), AttrKey::CSV_EXTRACT_QUOTE, $3); }
  | DATE FORMAT EQUAL string_value          { $$ = Attr(@$.encode(), AttrKey::CSV_EXTRACT_DATE_FORMAT, $4); }
  | TIMESTAMP FORMAT EQUAL string_value     { $$ = Attr(@$.encode(), AttrKey::CSV_EXTRACT_TIMESTAMP_FORMAT, $4); }
    ;

csv_header_value:
    boolean_value               { $$ = $1; }
  | LRB csv_string_list RRB     { $$ = ctx.AddStringArray(@$.encode(), $2); }

csv_string_list:
    csv_string_list COMMA STRING_LITERAL    { $1.push_back(ctx.TextAt(@3)); $$ = move($1); }
  | %empty                                  { $$ = {}; }
    ;

