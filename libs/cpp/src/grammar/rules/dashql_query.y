dashql_query_statement:
    QUERY dashql_identifier AS dashql_sql_literal {
        $$ = ctx.CreateObject(@$, syntax::ObjectType::QUERY_STATEMENT, {
            {@2, AttrKey::QUERY_STATEMENT_NAME, $2},
            {@4, AttrKey::QUERY_STATEMENT_TEXT, $4},
        });
    }
  | dashql_sql_literal {
        $$ = ctx.CreateObject(@$, syntax::ObjectType::QUERY_STATEMENT, {
            {@1, AttrKey::QUERY_STATEMENT_TEXT, $1},
        });
  }
    ;

dashql_sql_literal:
    SQL_SELECT  { $$ = Value(@$, ValueType::STRING, 0); }
  | SQL_WITH    { $$ = Value(@$, ValueType::STRING, 0); }
    ;

