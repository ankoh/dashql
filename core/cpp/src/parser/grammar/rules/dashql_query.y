dashql_query_statement:
    QUERY dashql_identifier AS sql_select_stmt {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_QUERY, {
            Key::DASHQL_QUERY_NAME << String(@2),
            Key::DASHQL_QUERY_STATEMENT << $4,
        });
    }
  | sql_select_stmt {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_QUERY, {
            Key::DASHQL_QUERY_STATEMENT << $1,
        });
  }
    ;

