dashql_load_statement:
    LOAD dashql_identifier FROM dashql_load_method opt_dashql_options {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_LOAD, concat(NodeVector{
            Key::DASHQL_LOAD_NAME << String(@2),
            Key::DASHQL_LOAD_METHOD << $4,
        }, move($5)));
    }
    ;

dashql_load_method:
    HTTP    { $$ = Enum(@$, sxd::LoadMethodType::HTTP); }
  | FILE    { $$ = Enum(@$, sxd::LoadMethodType::FILE); }
    ;
