dashql_extract_statement:
    EXTRACT dashql_statement_name FROM dashql_statement_ref opt_dashql_extract_method opt_dashql_options {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_EXTRACT, concat(NodeVector{
            Key::DASHQL_STATEMENT_NAME << $2,
            Key::DASHQL_EXTRACT_DATA << $4,
            Key::DASHQL_EXTRACT_METHOD << $5
        }, move($6)));
    }
    ;

opt_dashql_extract_method:
    USING dashql_extract_method_type    { $$ = $2; }
  | %empty                              { $$ = Null(); }

dashql_extract_method_type:
    CSV     { $$ = Enum(@$, sx::ExtractMethodType::CSV); }
  | JSON    { $$ = Enum(@$, sx::ExtractMethodType::JSON); }
  | PARQUET { $$ = Enum(@$, sx::ExtractMethodType::PARQUET); }
    ;
