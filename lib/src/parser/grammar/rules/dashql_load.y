dashql_load_statement:
    LOAD dashql_statement_name FROM dashql_load_method opt_dashql_options {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_LOAD, concat(NodeVector{
            Key::DASHQL_STATEMENT_NAME << $2,
            Key::DASHQL_LOAD_METHOD << $4,
        }, move($5)));
    }
    ;

dashql_load_method:
    HTTP    { $$ = Enum(@$, sx::LoadMethodType::HTTP); }
  | FILE    { $$ = Enum(@$, sx::LoadMethodType::FILE); }
    ;
