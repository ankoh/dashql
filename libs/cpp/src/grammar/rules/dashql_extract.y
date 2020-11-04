dashql_extract_statement:
    EXTRACT dashql_identifier FROM dashql_identifier USING dashql_extract_method {
        $6.push_back(ctx.Attr(Key::DASHQL_EXTRACT_NAME, ctx.String(@2)));
        $6.push_back(ctx.Attr(Key::DASHQL_EXTRACT_DATA, ctx.String(@4)));
        $$ = ctx.Object(@$, sx::NodeType::DASHQL_EXTRACT, move($6));
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
    ENCODING '=' SCONST                 { $$ = ctx.Attr(Key::DASHQL_CSV_EXTRACT_ENCODING, ctx.String(@3)); }
  | HEADER '=' dashql_csv_header_value  { $$ = ctx.Attr(Key::DASHQL_CSV_EXTRACT_HEADER, $3); }
  | DELIMITER '=' SCONST                { $$ = ctx.Attr(Key::DASHQL_CSV_EXTRACT_DELIMITER, ctx.String(@3)); }
  | QUOTE '=' SCONST                    { $$ = ctx.Attr(Key::DASHQL_CSV_EXTRACT_QUOTE, ctx.String(@3)); }
  | DATE FORMAT '=' SCONST              { $$ = ctx.Attr(Key::DASHQL_CSV_EXTRACT_DATE_FORMAT, ctx.String(@4)); }
  | TIMESTAMP FORMAT '=' SCONST         { $$ = ctx.Attr(Key::DASHQL_CSV_EXTRACT_TIMESTAMP_FORMAT, ctx.String(@4)); }
    ;

dashql_csv_header_value:
    FALSE_P                         { $$ = ctx.Bool(@$, false); }
  | '(' dashql_csv_string_list ')'  { $$ = ctx.Array(@$, move($2)); }

dashql_csv_string_list:
    dashql_csv_string_list ',' STRING_LITERAL   { $1.push_back(ctx.String(@3)); $$ = move($1); }
  | %empty                                      { $$ = {}; }
    ;

