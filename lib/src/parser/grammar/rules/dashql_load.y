dashql_load_statement:
    LOAD dashql_statement_name FROM dashql_load_method opt_dashql_options {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_LOAD, concat(NodeVector{
            Key::DASHQL_STATEMENT_NAME << $2,
            $4
        }, move($5)));
    }
    ;

dashql_load_method:
    HTTP    { $$ = Key::DASHQL_LOAD_METHOD << Enum(@$, sx::LoadMethodType::HTTP); }
  | FILE    { $$ = Key::DASHQL_LOAD_METHOD << Enum(@$, sx::LoadMethodType::FILE); }
  | SCONST  { $$ = Key::DASHQL_LOAD_FROM_URI << String(@1); }
    ;
