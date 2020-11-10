dashql_extract_statement:
    EXTRACT dashql_identifier FROM dashql_identifier USING dashql_extract_method {
        $6.push_back(Key::DASHQL_EXTRACT_NAME << ctx.Ref(@2));
        $6.push_back(Key::DASHQL_EXTRACT_DATA << ctx.Ref(@4));
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_EXTRACT, move($6));
    }
    ;

dashql_extract_method:
    CSV dashql_opt_csv_attribute_list   { $$ = move($2); }
  | JSON '(' ')'                        { $$ = {}; }
    ;

dashql_opt_csv_attribute_list:
    '(' dashql_csv_attribute_list ')'   { $$ = move($2); }
 |  %empty                              { $$ = {}; }
    ;

dashql_csv_attribute_list:
    dashql_csv_attribute_list ',' dashql_csv_attribute      { $1.push_back($3); $$ = move($1); }
  | dashql_csv_attribute                                    { $$ = { $1 }; }
    ;

dashql_csv_attribute:
    ENCODING '=' SCONST                 { $$ = Key::DASHQL_CSV_EXTRACT_ENCODING << ctx.Ref(@3); }
  | HEADER '=' dashql_csv_header_value  { $$ = Key::DASHQL_CSV_EXTRACT_HEADER << $3; }
  | DELIMITER '=' SCONST                { $$ = Key::DASHQL_CSV_EXTRACT_DELIMITER << ctx.Ref(@3); }
  | QUOTE '=' SCONST                    { $$ = Key::DASHQL_CSV_EXTRACT_QUOTE << ctx.Ref(@3); }
  | DATE FORMAT '=' SCONST              { $$ = Key::DASHQL_CSV_EXTRACT_DATE_FORMAT << ctx.Ref(@4); }
  | TIMESTAMP FORMAT '=' SCONST         { $$ = Key::DASHQL_CSV_EXTRACT_TIMESTAMP_FORMAT << ctx.Ref(@4); }
    ;

dashql_csv_header_value:
    FALSE_P                         { $$ = ctx.Ref(@$, false); }
  | '(' dashql_csv_string_list ')'  { $$ = ctx.Add(@$, move($2)); }

dashql_csv_string_list:
    dashql_csv_string_list ',' STRING_LITERAL   { $1.push_back(ctx.Ref(@3)); $$ = move($1); }
  | %empty                                      { $$ = {}; }
    ;

