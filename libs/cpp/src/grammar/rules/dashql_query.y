dashql_query_statement:
    QUERY dashql_identifier AS sql_select_statement {
        $$ = ctx.CreateObject(@$, sx::ObjectType::DASHQL_QUERY_STATEMENT, {
            {@2, sx::AttributeKey::DASHQL_QUERY_STATEMENT_NAME, $2},
            {@4, sx::AttributeKey::DASHQL_QUERY_STATEMENT_TEXT, ctx.AddObject($4)},
        });
    }
  | sql_select_statement {
        $$ = ctx.CreateObject(@$, sx::ObjectType::DASHQL_QUERY_STATEMENT, {
            {@1, sx::AttributeKey::DASHQL_QUERY_STATEMENT_TEXT, ctx.AddObject($1)},
        });
  }
    ;

