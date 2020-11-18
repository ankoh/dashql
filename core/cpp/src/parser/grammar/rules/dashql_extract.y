dashql_extract_statement:
    EXTRACT dashql_statement_name FROM dashql_statement_ref USING dashql_extract_method opt_dashql_options {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_EXTRACT, concat(NodeVector{
            Key::DASHQL_STATEMENT_NAME << $2,
            Key::DASHQL_EXTRACT_DATA << $4,
            Key::DASHQL_EXTRACT_METHOD << $6
        }, move($7)));
    }
    ;

dashql_extract_method:
    CSV     { $$ = Enum(@$, sxd::ExtractMethodType::CSV); }
  | JSON    { $$ = Enum(@$, sxd::ExtractMethodType::JSON); }
    ;
