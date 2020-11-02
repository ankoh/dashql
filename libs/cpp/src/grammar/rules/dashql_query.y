dashql_query_statement:
    QUERY dashql_identifier AS sql_select_stmt {
        $$ = ctx.CreateObject(@$, sx::ObjectType::DASHQL_QUERY, {
            {sx::AttributeKey::DASHQL_QUERY_NAME, $2},
            {sx::AttributeKey::DASHQL_QUERY_STATEMENT, ctx.AddObject($4)},
        });
    }
  | sql_select_stmt {
        $$ = ctx.CreateObject(@$, sx::ObjectType::DASHQL_QUERY, {
            {sx::AttributeKey::DASHQL_QUERY_STATEMENT, ctx.AddObject($1)},
        });
  }
    ;

