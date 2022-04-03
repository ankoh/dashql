dashql_fetch_statement:
    FETCH dashql_statement_name FROM dashql_fetch_method opt_dson {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_FETCH, Concat(NodeVector{
            Key::DASHQL_STATEMENT_NAME << $2,
            $4
        }, std::move($5)));
    }
    ;

dashql_fetch_method:
    HTTP    { $$ = Key::DASHQL_FETCH_METHOD << Enum(@$, sx::FetchMethodType::HTTP); }
  | FILE    { $$ = Key::DASHQL_FETCH_METHOD << Enum(@$, sx::FetchMethodType::FILE); }
  | SCONST  { $$ = Key::DASHQL_FETCH_FROM_URI << String(@1); }
    ;
