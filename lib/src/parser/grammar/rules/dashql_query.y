dashql_query_statement:
    QUERY dashql_statement_name AS sql_select_stmt {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_QUERY, {
            Key::DASHQL_STATEMENT_NAME << $2,
            Key::DASHQL_QUERY_STATEMENT << $4,
        });
    }
  | sql_select_stmt {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_QUERY, {
            Key::DASHQL_QUERY_STATEMENT << $1,
        });
    }
  | sql_create_as_stmt {
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_DASHQL_QUERY, {
            Key::DASHQL_QUERY_STATEMENT << $1,
        });
    }
    ;

