sql_view_stmt:
CREATE_P sql_opt_temp sql_view_recursive VIEW sql_qualified_name sql_opt_column_list sql_opt_definition AS sql_select_stmt sql_view_check {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_VIEW,
            &[
                attr(Key::SQL_VIEW_OR_REPLACE, null()),
                attr(Key::SQL_VIEW_TEMP, $2),
                attr(Key::SQL_VIEW_RECURSIVE, $3),
                attr(Key::SQL_VIEW_NAME, $5),
                attr(Key::SQL_VIEW_COLUMNS, ctx.array(@6, $6)),
                attr(Key::SQL_VIEW_OPTIONS, ctx.array(@7, $7)),
                attr(Key::SQL_VIEW_STATEMENT, ctx.object(@9, NodeType::OBJECT_SQL_SELECT, $9)),
                attr(Key::SQL_VIEW_CHECK, $10),
            ],
        )
    }
  | CREATE_P OR REPLACE sql_opt_temp sql_view_recursive VIEW sql_qualified_name sql_opt_column_list sql_opt_definition AS sql_select_stmt sql_view_check {
        ctx.object(
            @$,
            NodeType::OBJECT_SQL_VIEW,
            &[
                attr(Key::SQL_VIEW_OR_REPLACE, bool_node(loc(&[@2, @3]), true)),
                attr(Key::SQL_VIEW_TEMP, $4),
                attr(Key::SQL_VIEW_RECURSIVE, $5),
                attr(Key::SQL_VIEW_NAME, $7),
                attr(Key::SQL_VIEW_COLUMNS, ctx.array(@8, $8)),
                attr(Key::SQL_VIEW_OPTIONS, ctx.array(@9, $9)),
                attr(
                    Key::SQL_VIEW_STATEMENT,
                    ctx.object(@11, NodeType::OBJECT_SQL_SELECT, $11),
                ),
                attr(Key::SQL_VIEW_CHECK, $12),
            ],
        )
    }
    ;
sql_view_recursive: RECURSIVE { bool_node(@$,true) } | %empty { null() };
sql_view_check: WITH CHECK_P OPTION { ctx.name_from_keyword(@$,"cascaded") } | WITH CASCADED CHECK_P OPTION { ctx.name_from_keyword(@$,"cascaded") } | WITH LOCAL CHECK_P OPTION { ctx.name_from_keyword(@$,"local") } | %empty { null() };
