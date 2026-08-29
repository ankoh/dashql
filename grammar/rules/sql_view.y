sql_view_stmt:
    CREATE_P sql_opt_temp VIEW sql_qualified_name sql_opt_column_list AS sql_select_stmt {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_VIEW, {
            Attr(Key::SQL_VIEW_TEMP, $2),
            Attr(Key::SQL_VIEW_NAME, std::move($4)),
            Attr(Key::SQL_VIEW_COLUMNS, ctx.Array(@5, std::move($5))),
            Attr(Key::SQL_VIEW_STATEMENT, ctx.Object(@7, buffers::parser::NodeType::OBJECT_SQL_SELECT, std::move($7))),
        });
    }
  | CREATE_P OR REPLACE sql_opt_temp VIEW sql_qualified_name sql_opt_column_list AS sql_select_stmt {
        $$ = ctx.Object(@$, buffers::parser::NodeType::OBJECT_SQL_VIEW, {
            Attr(Key::SQL_VIEW_OR_REPLACE, Bool(Loc({@2, @3}), true)),
            Attr(Key::SQL_VIEW_TEMP, $4),
            Attr(Key::SQL_VIEW_NAME, std::move($6)),
            Attr(Key::SQL_VIEW_COLUMNS, ctx.Array(@7, std::move($7))),
            Attr(Key::SQL_VIEW_STATEMENT, ctx.Object(@9, buffers::parser::NodeType::OBJECT_SQL_SELECT, std::move($9))),
        });
    }
    ;
