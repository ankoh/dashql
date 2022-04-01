dashql_query_statement:
    QUERY dashql_statement_name AS sql_select_stmt {
        $4.push_back($2);
        $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_SELECT, std::move($4));
    }
  | sql_select_stmt     { $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_SELECT, std::move($1)); }
  | sql_create_stmt     { $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_CREATE, std::move($1)); }
  | sql_create_as_stmt  { $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_CREATE_AS, std::move($1)); }
  | sql_view_stmt       { $$ = ctx.Add(@$, sx::NodeType::OBJECT_SQL_VIEW, std::move($1)); }
    ;

