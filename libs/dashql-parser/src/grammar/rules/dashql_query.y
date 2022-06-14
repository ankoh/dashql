dashql_query_statement:
    QUERY dashql_statement_name AS sql_select_stmt {
        $4.push_back($2);
        $$ = ctx.Add(@$, proto::NodeType::OBJECT_SQL_SELECT, std::move($4));
    }
  | sql_select_stmt     { $$ = ctx.Add(@$, proto::NodeType::OBJECT_SQL_SELECT, std::move($1)); }
  | sql_create_stmt     { $$ = std::move($1); }
  | sql_create_as_stmt  { $$ = std::move($1); }
  | sql_view_stmt       { $$ = std::move($1); }
    ;

