dashql_query_statement:
    QUERY dashql_identifier AS dashql_sql_literal {
        $$ = ctx.CreateObject(@$.encode(), syntax::ObjectType::QUERY_STATEMENT, {
            {@2.encode(), AttrKey::QUERY_STATEMENT_NAME, $2},
            {@4.encode(), AttrKey::QUERY_STATEMENT_TEXT, $4},
        });
    }
  | dashql_sql_literal {
        $$ = ctx.CreateObject(@$.encode(), syntax::ObjectType::QUERY_STATEMENT, {
            {@1.encode(), AttrKey::QUERY_STATEMENT_TEXT, $1},
        });
  }
    ;

dashql_sql_literal:
    SQL_SELECT  { $$ = Value(@$.encode(), ValueType::STRING, 0); }
  | SQL_WITH    { $$ = Value(@$.encode(), ValueType::STRING, 0); }
    ;

