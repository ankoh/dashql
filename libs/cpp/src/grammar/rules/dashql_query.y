dashql_query_statement:
    QUERY dashql_identifier AS dashql_sql_literal {
        $$ = ctx.CreateObject(@$, sx::ObjectType::DASHQL_QUERY_STATEMENT, {
            {@2, sx::AttributeKey::DASHQL_QUERY_STATEMENT_NAME, $2},
            {@4, sx::AttributeKey::DASHQL_QUERY_STATEMENT_TEXT, $4},
        });
    }
  | dashql_sql_literal {
        $$ = ctx.CreateObject(@$, sx::ObjectType::DASHQL_QUERY_STATEMENT, {
            {@1, sx::AttributeKey::DASHQL_QUERY_STATEMENT_TEXT, $1},
        });
  }
    ;

dashql_sql_literal:
    SQL_SELECT  { $$ = sx::Value(@$, sx::ValueType::STRING, 0); }
  | SQL_WITH    { $$ = sx::Value(@$, sx::ValueType::STRING, 0); }
    ;

