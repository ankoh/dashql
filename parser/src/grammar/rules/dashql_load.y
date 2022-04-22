dashql_load_statement:
    LOAD dashql_statement_name FROM dashql_statement_ref opt_dashql_load_method opt_dson {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_LOAD, {
            Attr(Key::DASHQL_STATEMENT_NAME, $2),
            Attr(Key::DASHQL_DATA_SOURCE, $4),
            Attr(Key::DASHQL_LOAD_METHOD, $5),
            Attr(Key::DASHQL_LOAD_EXTRA, $6),
        });
    }
    ;

opt_dashql_load_method:
    USING dashql_load_method_type    { $$ = $2; }
  | %empty                              { $$ = Null(); }

dashql_load_method_type:
    CSV     { $$ = Enum(@$, sx::LoadMethodType::CSV); }
  | JSON    { $$ = Enum(@$, sx::LoadMethodType::JSON); }
  | PARQUET { $$ = Enum(@$, sx::LoadMethodType::PARQUET); }
    ;
